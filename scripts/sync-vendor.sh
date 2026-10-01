#!/usr/bin/env bash
# Sync rpm's vendored oem-ui copy from the library.
#
# rpm imports ./styles/cli-mono/*.css - a snapshot, not the library. Any
# oem-ui edit is invisible to rpm until this runs. It ran by hand for
# months, and the omission once shipped a deploy that changed nothing.
set -euo pipefail

LIB="${1:-/root/projects/oem-ui/src/styles}"
DEST="${2:-/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/styles/cli-mono}"

mkdir -p "$DEST"
for f in tokens.css base.css components.css; do
  cp -v "$LIB/$f" "$DEST/$f"
done

echo
echo "verifying byte-identical:"
rc=0
for f in tokens.css base.css components.css; do
  a=$(md5sum < "$LIB/$f" | cut -d' ' -f1)
  b=$(md5sum < "$DEST/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then
    printf '  ok   %-16s %s\n' "$f" "${a:0:8}"
  else
    printf '  FAIL %-16s lib=%s vend=%s\n' "$f" "${a:0:8}" "${b:0:8}"
    rc=1
  fi
done
exit $rc
