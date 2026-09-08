#!/bin/sh
# mz-wallpaper-fetch.sh - server-side wallpaper cache refresher
# Copyright (C) 2026 LianXia233
# Licensed to the public under the Apache License 2.0.
#
# The random wallpaper APIs answer every request with a 302 redirect to a
# DIFFERENT image, so the browser HTTP cache can never pin one picture:
# even with the frontend's sessionStorage URL cache each navigation
# followed the redirect to a fresh image. This script makes the ROUTER
# resolve the randomness: every CACHE_PERIOD minutes it fetches one image
# per device class (pc / mobile) into /www/luci-static/mint/ and the
# frontends then reference the stable local file. uhttpd serves it with a
# Last-Modified header, so browsers reuse it (304) until the file changes
# - exactly the 5-minute cache window requested.
#
# Files written:
#   /www/luci-static/mint/wallpaper-pc.img
#   /www/luci-static/mint/wallpaper-mobile.img
#
# Only used when the matching UCI mode is "random"; custom images ignore
# the proxy files entirely.

CACHE_DIR="/www/luci-static/mint"
LOCK="/tmp/mz-wallpaper-fetch.lock"
UA="Mozilla/5.0 (X11; Linux) AppleWebKit/537.36 mint-wallpaper/1.0"
# Hard cap on a single download. Without it a hostile or broken endpoint
# streams until /www (flash on most devices) is full; the size check below
# only runs AFTER curl has already written everything.
MAX_BYTES=8388608

# Only http(s). This script runs as root from cron and writes straight into
# the uhttpd document root, which is readable WITHOUT authentication (the
# login page needs it). curl natively speaks file://, ftp:// and friends, so
# an unrestricted UCI value turns "set a wallpaper source" into "publish any
# local file to anonymous readers" - see the rpcd ACL group "wallpaper",
# which grants write access to uci:mint.
valid_src() {
	case "$1" in
		http://*|https://*) return 0 ;;
		*) return 1 ;;
	esac
}

# One configured source (or the built-in default) per call.
# $1 = kind ("pc" | "mobile"), $2 = source URL
fetch_one() {
	kind="$1"
	src="$2"
	out="$CACHE_DIR/wallpaper-$kind.img"
	tmp="$CACHE_DIR/.wallpaper-$kind.tmp"

	[ -n "$src" ] || return 1

	# Reject anything that is not http(s) before it ever reaches curl.
	if ! valid_src "$src"; then
		logger -t mz-wallpaper "refusing non-http source for $kind"
		return 1
	fi

	# Never write partial/garbage over a good image: download to a temp
	# file first, verify it is an image, then atomically move it in.
	rm -f "$tmp"
	# --proto/--proto-redir: also block a 302 to file:// on the redirect
	# hop. --max-filesize: enforced by curl while streaming.
	# --: end of options, so a value starting with '-' is treated as a URL
	# and never as an unexpected curl option.
	curl -sL --max-time 25 --max-filesize "$MAX_BYTES" \
		--proto '=http,https' --proto-redir '=http,https' \
		-A "$UA" -o "$tmp" -- "$src" || {
		rm -f "$tmp"
		return 1
	}

	# Validate: at least 3 KB and a real image signature
	# (JPEG ffd8 / PNG 89504e47 / WEBP RIFF....WEBP / GIF).
	size=$(wc -c < "$tmp" 2>/dev/null)
	[ "${size:-0}" -ge 3072 ] || { rm -f "$tmp"; return 1; }

	# Hex dump, not command substitution: $(dd ...) cannot carry NUL bytes
	# (PNG's magic is followed by 00 00 00 0d), so the previous
	# $'\xff\xd8'*|$(printf '\211PN') match silently never matched PNG at
	# all - the pattern had no trailing wildcard AND the value was
	# truncated at the first NUL.
	sig=$(head -c 12 "$tmp" 2>/dev/null | od -An -tx1 | tr -d ' \n')
	case "$sig" in
		ffd8ff*) ;;                                # JPEG
		89504e470d0a1a0a*) ;;                      # PNG
		474946383*) ;;                             # GIF87a / GIF89a
		52494646*) ;;                              # WEBP (RIFF....WEBP)
		*) rm -f "$tmp"; return 1 ;;
	esac

	mv -f "$tmp" "$out"
	return 0
}

# Pick one random source from a UCI list (or the built-in default).
# The random APIs differ per device class; keep the same defaults as the
# frontend so the proxy and the fallback pull from the same pool.
pick_source() {
	kind="$1"
	cfg_opt="$1_sources"
	list=$(uci -q get "mint.wallpaper.$cfg_opt" 2>/dev/null)

	if [ -z "$list" ]; then
		case "$kind" in
			pc)     echo "https://t.alcy.cc/bd" ;;
			mobile) echo "https://t.alcy.cc/mp" ;;
		esac
		return
	fi

	# uci returns list entries space-separated; N-th pick rotates instead
	# of true-random so consecutive runs sample the whole list.
	n=$(printf '%s\n' "$list" | wc -w)
	i=$(( ($RANDOM + $(date +%s)) % n + 1 ))
	printf '%s\n' "$list" | cut -d' ' -f"$i"
}

# --- main ---------------------------------------------------------------

# Simple lock: overlapping runs (cron + manual refresh) must not fight.
exec 9>"$LOCK"
flock -n 9 || exit 0

# Random mode only: when a device class is set to a custom image the
# proxy file is pointless (and would just waste bandwidth).
for kind in pc mobile; do
	mode=$(uci -q get "mint.wallpaper.${kind}_mode" 2>/dev/null)
	[ "$mode" = "custom" ] && continue

	src=$(pick_source "$kind")
	valid_src "$src" || {
		logger -t mz-wallpaper "refusing non-http source for $kind"
		continue
	}

	# seaya.link's /wap endpoint returns an HTML page instead of a
	# redirect; translate it to the direct image link it advertises.
	case "$src" in
		*api.seaya.link/wap*)
			html=$(curl -s --max-time 15 --proto '=http,https' \
				--proto-redir '=http,https' -A "$UA" -- "$src")
			src=$(printf '%s' "$html" | grep -oE 'https://img\.seaya\.link/[^" ]+\.(jpg|jpeg|png|webp)' | head -n1)
			# Re-validate: this value is scraped out of remote HTML, so it
			# is attacker-controlled even when the configured source is not.
			valid_src "$src" || continue
			;;
	esac

	fetch_one "$kind" "$src" || continue
done

exit 0
