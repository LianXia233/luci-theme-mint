#!/usr/bin/env bash
#
# verify-ucode-compat.sh - compile every ucode asset against the OLDEST
# ucode the theme still supports, so a syntax form that only newer
# interpreters accept can never reach a release again.
#
# Why this exists (issue #17): ucode before 2026-02-11 (fix commit
# 552ca3cf55, "allow export function declarations without trailing
# semicolon") rejects `export function name() { ... }` declarations
# because compile_export() unconditionally consumes a trailing
# semicolon after a function declaration. wallpaper.uc used that form,
# so on ImmortalWrt 25.12 (ucode v0.0.20250529) the module failed to
# compile, header.ut failed with it, and the whole theme fell back to
# the default one. The pinned reference build below reproduces that
# environment; anything that does not compile here is a release blocker.
#
# The check has two layers:
#   1. static gate  - reject the known-bad `export function` form outright
#   2. compile gate - build the pinned ucode and really compile every
#                     .uc module and .ut template (imports of modules
#                     that do not ship in this repo are stubbed)
# If the pinned ucode cannot be built (offline runner, missing
# toolchain) the compile gate degrades to a warning; the static gate
# always runs.
#
# Usage:
#   ./scripts/verify-ucode-compat.sh [--repo-root DIR]
#                                    [--ucode-version TAG]
#                                    [--keep-workdir]
#
# Exits non-zero when any check fails.

set -euo pipefail

log()  { printf '[ucode-compat] %s\n' "$*"; }
warn() { printf '[ucode-compat] WARN: %s\n' "$*" >&2; }
fail() { printf '[ucode-compat] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
REPO_ROOT=""
UCODE_VERSION="v0.0.20250529"   # newest tagged release; pre-dates the fix
KEEP_WORKDIR=0

while [ $# -gt 0 ]; do
	case "$1" in
	--repo-root)      REPO_ROOT="${2:-}"; shift 2 ;;
	--ucode-version)  UCODE_VERSION="${2:-}"; shift 2 ;;
	--keep-workdir)   KEEP_WORKDIR=1; shift ;;
	-h|--help)        sed -n '2,30p' "$0"; exit 0 ;;
	*) printf '[ucode-compat] unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

if [ -z "$REPO_ROOT" ]; then
	REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$REPO_ROOT"

# ---------------------------------------------------------------- static gate
# `export function` is the one form broken on ucode < 2026-02-11; the
# portable replacement is `function ...` + `export { ... }` (see the
# comment block in theme/ucode/mint/wallpaper.uc).
static_hits=0
while IFS= read -r f; do
	if grep -nE '^[[:space:]]*export[[:space:]]+function([[:space:]]|$)' "$f"; then
		fail "$f uses 'export function' (broken on ucode < 2026-02-11); use 'function' + 'export { ... }'"
		static_hits=1
	fi
done < <(find . -name '*.uc' -not -path './.git/*' | sort)
[ "$static_hits" -eq 0 ] && log "static gate: no 'export function' declarations"

# -------------------------------------------------------------- compile gate
WORKDIR="$(mktemp -d /tmp/ucode-compat.XXXXXX)"
trap '[ "$KEEP_WORKDIR" -eq 1 ] || rm -rf "$WORKDIR"' EXIT

build_ucode() {
	local url="https://codeload.github.com/jow-/ucode/tar.gz/refs/tags/${UCODE_VERSION}"
	log "downloading ucode ${UCODE_VERSION}"
	if ! curl -fsSL -o "$WORKDIR/ucode.tar.gz" "$url"; then
		warn "cannot download ucode ${UCODE_VERSION} (offline?) - compile gate skipped"
		return 1
	fi
	tar -xzf "$WORKDIR/ucode.tar.gz" -C "$WORKDIR"
	local srcdir
	srcdir="$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -type d -name 'ucode-*' | head -1)"
	if [ -z "$srcdir" ]; then
		warn "unexpected ucode tarball layout - compile gate skipped"
		return 1
	fi
	log "building ucode in $srcdir"
	if ! (cd "$srcdir" && cmake . -DCMAKE_BUILD_TYPE=Release > "$WORKDIR/cmake.log" 2>&1); then
		warn "cmake failed (see $WORKDIR/cmake.log) - compile gate skipped"
		return 1
	fi
	if ! (cd "$srcdir" && make -j"$(nproc)" > "$WORKDIR/make.log" 2>&1); then
		warn "make failed (see $WORKDIR/make.log) - compile gate skipped"
		return 1
	fi
	UCODE_BIN="$srcdir/ucode"
	UCODE_LIBDIR="$srcdir"
	return 0
}

# Modules the repo's ucode imports but does not ship itself ('fs' and
# friends come from the ucode build when it provides them; everything
# else gets a stub). ucode checks named imports at COMPILE time
# ("Module ... does not export 'x'"), so a stub must export exactly the
# names the repo imports from it.
#
# Install layout (scripts/build-direct.sh): theme/ucode/ maps to
# /usr/share/ucode/luci/, so theme/ucode/mint/wallpaper.uc is the
# module 'luci.mint.wallpaper' at run time.
repo_uc_path() { # dotted module name -> repo source path
	echo "theme/ucode/$(echo "${1#luci.}" | tr '.' '/').uc"
}

make_stubs() {
	local modroot="$WORKDIR/modroot"
	mkdir -p "$modroot"

	# module -> imported names, from every `import { a, b } from 'mod';`
	declare -A IMPORTS=()
	local line mod names name src
	while IFS= read -r line; do
		mod="$(printf '%s' "$line" | sed -E "s/.*from[[:space:]]+'([^']+)'.*/\1/")"
		names="$(printf '%s' "$line" | sed -E "s/import[[:space:]]*\{([^}]*)\}.*/\1/" \
			| tr ',' '\n' | sed -E 's/[[:space:]]//g; s/[[:space:]]*as[[:space:]]*.*//' | grep -v '^$')"
		for name in $names; do
			IMPORTS["$mod"]="${IMPORTS[$mod]:-} $name"
		done
	done < <(grep -rhoE "import[[:space:]]*\{[^}]*\}[[:space:]]*from[[:space:]]*'[^']+'" \
		--include='*.uc' --include='*.ut' . | sort -u)

	for mod in "${!IMPORTS[@]}"; do
		# provided by the ucode build (fs.so, math.so, ...)? keep the real one
		[ -f "$UCODE_LIBDIR/$mod.so" ] && continue
		# shipped by this repo? copied in below
		src="$(repo_uc_path "$mod")"
		[ -f "$src" ] && continue

		path="$modroot/$(echo "$mod" | tr '.' '/').uc"
		mkdir -p "$(dirname "$path")"
		{
			printf '// compatibility stub for %s (external module, not shipped here)\n' "'$mod'"
			for name in ${IMPORTS[$mod]}; do
				printf 'const %s = null;\n' "$name"
			done
			printf 'export { %s };\n' "$(printf '%s' "${IMPORTS[$mod]# }" | tr ' ' ',')"
		} > "$path"
	done

	# ship the repo's real modules under their dotted names
	local f rel
	for f in $(find theme -name '*.uc' | sort); do
		rel="luci/${f#theme/ucode/}"
		mkdir -p "$modroot/$(dirname "$rel")"
		cp "$f" "$modroot/$rel"
	done

	MODROOT="$modroot"
}

compile_all() {
	local f name importer rc=0

	for f in $(find theme -name '*.uc' | sort); do
		name="luci.$(echo "${f#theme/ucode/}" | sed -E 's/\.uc$//; s#/#.#g')"
		importer="$WORKDIR/import_${name//[^a-zA-Z0-9]/_}.uc"
		printf "import * as _m from '%s';\n" "$name" > "$importer"
		if ! "$UCODE_BIN" -L "$MODROOT" -L "$UCODE_LIBDIR" "$importer" \
				> "$WORKDIR/last.log" 2>&1; then
			fail "module $f does not compile on ucode $UCODE_VERSION:"
			sed 's/^/    /' "$WORKDIR/last.log" >&2
			rc=1
		else
			log "module OK: $f"
		fi
	done

	for f in $(find theme -name '*.ut' | sort); do
		if ! "$UCODE_BIN" -T -c -o /dev/null -L "$MODROOT" -L "$UCODE_LIBDIR" "$f" \
				> "$WORKDIR/last.log" 2>&1; then
			fail "template $f does not compile on ucode $UCODE_VERSION:"
			sed 's/^/    /' "$WORKDIR/last.log" >&2
			rc=1
		else
			log "template OK: $f"
		fi
	done

	return "$rc"
}

if build_ucode; then
	make_stubs
	compile_all || true
else
	warn "compile gate skipped; only the static gate protected this run"
fi

if [ "$FAILURES" -gt 0 ]; then
	printf '[ucode-compat] %s failure(s)\n' "$FAILURES" >&2
	exit 1
fi
log "all checks passed"
