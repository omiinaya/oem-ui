#!/usr/bin/env bash
# Sync rpm's vendored oem-ui copy from the library.
#
# rpm imports ./styles/cli-mono/*.css and ./js/cli-mono.js - snapshots,
# not the library. Any oem-ui edit is invisible to rpm until this runs.
# It ran by hand for months, and the omission once shipped a deploy that
# changed nothing on screen while every check passed.
#
# CSS and runtime are listed in one array on purpose: the first version of
# this script handled CSS only, and the very next library change (toast
# severity) was a JS edit that sailed straight past it.
set -euo pipefail

LIB="${1:-/root/projects/oem-ui/src}"
DEST="${2:-/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src}"

PAIRS=(
  "styles/tokens.css:styles/cli-mono/tokens.css"
  "styles/base.css:styles/cli-mono/base.css"
  "styles/components.css:styles/cli-mono/components.css"
  "js/cli-mono.js:js/cli-mono.js"
  "js/cli-mono-theme-guard.js:js/cli-mono-theme-guard.js"
)

rc=0
for pair in "${PAIRS[@]}"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  if [ ! -f "$LIB/$src" ]; then
    printf '  skip %-26s (not in library)\n' "$src"
    continue
  fi
  mkdir -p "$(dirname "$DEST/$dst")"
  cp "$LIB/$src" "$DEST/$dst"
  a=$(md5sum < "$LIB/$src" | cut -d' ' -f1)
  b=$(md5sum < "$DEST/$dst" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then
    printf '  ok   %-26s %s\n' "$src" "${a:0:8}"
  else
    printf '  FAIL %-26s lib=%s vend=%s\n' "$src" "${a:0:8}" "${b:0:8}"
    rc=1
  fi
done

exit $rc
