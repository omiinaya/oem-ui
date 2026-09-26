#!/usr/bin/env bash
# Verify the vendored oem-ui files in a consumer project are byte-identical
# to the oem-ui source. Drift is silent by design: the CSS builds fine, the
# site renders fine, and the only symptom is a bug that was already fixed in
# the library. This turns that into a failing check.
#
#   usage: scripts/check-design-sync.sh [consumer-dir ...]
#
# With no arguments it checks every project under /root/projects that has a
# src/styles/cli-mono/ directory. Exit 1 if anything is stale.

set -uo pipefail

SRC="${OEM_UI_SRC:-/root/projects/oem-ui}"
MAP=(
	"src/styles/tokens.css:src/styles/cli-mono/tokens.css"
	"src/styles/base.css:src/styles/cli-mono/base.css"
	"src/styles/components.css:src/styles/cli-mono/components.css"
	"src/js/cli-mono.js:src/js/cli-mono.js"
)

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
	for d in /root/projects/*/; do
		[ -d "$d/src/styles/cli-mono" ] && targets+=("${d%/}")
	done
fi

if [ ${#targets[@]} -eq 0 ]; then
	echo "no consumer projects found"
	exit 0
fi

stale=0
for t in "${targets[@]}"; do
	out=""
	for pair in "${MAP[@]}"; do
		s="$SRC/${pair%%:*}"
		d="$t/${pair##*:}"
		if [ ! -f "$d" ]; then
			out+="  MISSING  ${pair##*:}"$'\n'
			stale=1
		elif ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${pair##*:} ($n lines differ)"$'\n'
			stale=1
		fi
	done
	if [ -n "$out" ]; then
		echo "drift in $t"
		echo -n "$out"
		echo "  fix: $SRC/scripts/install.sh $t"
	else
		echo "in sync  $t"
	fi
done

exit $stale
