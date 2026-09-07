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

# One configured source (or the built-in default) per call.
# $1 = kind ("pc" | "mobile"), $2 = source URL
fetch_one() {
	kind="$1"
	src="$2"
	out="$CACHE_DIR/wallpaper-$kind.img"
	tmp="$CACHE_DIR/.wallpaper-$kind.tmp"

	[ -n "$src" ] || return 1

	# Never write partial/garbage over a good image: download to a temp
	# file first, verify it is an image, then atomically move it in.
	rm -f "$tmp"
	curl -sL --max-time 25 -A "$UA" -o "$tmp" "$src" || {
		rm -f "$tmp"
		return 1
	}

	# Validate: at least 3 KB and a real image signature
	# (JPEG ffd8 / PNG 8950 / WEBP RIFF....WEBP / GIF).
	size=$(wc -c < "$tmp" 2>/dev/null)
	[ "${size:-0}" -ge 3072 ] || { rm -f "$tmp"; return 1; }

	sig=$(dd if="$tmp" bs=1 count=12 2>/dev/null)
	case "$sig" in
		$'\xff\xd8'*|$(printf '\211PN')) ;;       # JPEG / PNG
		RIFF*) ;;                                  # WEBP (RIFF....WEBP)
		GIF8*) ;;                                  # GIF
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
	# seaya.link's /wap endpoint returns an HTML page instead of a
	# redirect; translate it to the direct image link it advertises.
	case "$src" in
		*api.seaya.link/wap*)
			html=$(curl -s --max-time 15 -A "$UA" "$src")
			src=$(printf '%s' "$html" | grep -oE 'https://img\.seaya\.link/[^" ]+\.(jpg|jpeg|png|webp)' | head -n1)
			[ -n "$src" ] || continue
			;;
	esac

	fetch_one "$kind" "$src" || continue
done

exit 0
