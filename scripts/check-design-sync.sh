#!/usr/bin/env bash
# Verify the vendored oem-ui files in a consumer project are byte-identical
# to the oem-ui source. Drift is silent by design: the CSS builds fine, the
# site renders fine, and the only symptom is a bug that was already fixed in
# the library. This turns that into a failing check.
#
#   usage: scripts/check-design-sync.sh [consumer-dir ...]
#
# With no arguments it checks every project under $CONSUMER_ROOT that has a
# src/styles/cli-mono/ directory. Exit 1 if anything is stale.
#
# A file that is byte-identical but NEVER IMPORTED is worse than stale: it
# reports "in sync" for CSS that ships to no page. That is not hypothetical
# - dev-blog vendored all three layers, passed this check for a week, and
# loaded none of them, so it kept rendering its own 264-line hand-written
# design system with --ink-faint at 2.66:1. Byte equality proved nothing
# about the only question that matters: is the library actually loaded?
# So this script now also requires that every vendored file is imported.

set -uo pipefail

# Default to this checkout, not a machine-specific path, so a clone
# anywhere works. Override with OEM_UI_SRC, or with CONSUMER_ROOT to
# re-point the no-argument sweep at a different projects tree.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${OEM_UI_SRC:-$HERE}"
CONSUMER_ROOT="${CONSUMER_ROOT:-/root/projects}"
MAP=(
	"src/styles/tokens.css:src/styles/cli-mono/tokens.css"
	"src/styles/base.css:src/styles/cli-mono/base.css"
	"src/styles/components.css:src/styles/cli-mono/components.css"
	"src/js/cli-mono.js:src/js/cli-mono.js"
)

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
	for d in "$CONSUMER_ROOT"/*/; do
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

	# ---- reachability -----------------------------------------------------
	# Byte-identical and unreferenced is the failure this check missed. Scan
	# the project's source for any mention of the vendored file names. A
	# vendored file that nothing imports is dead weight that reads as
	# adoption.
	#
	# Scoped to projects that HAVE source files. A directory with the layers
	# copied in and no pages yet is not drifted, it is simply not built -
	# reporting it as a failure is a false positive, and a check that cries
	# wolf gets ignored, which is the same end state as no check at all.
	# The defect worth catching is the one dev-blog had: real pages, none of
	# which load the library.
	if [ -z "${OEM_UI_SKIP_REACHABILITY:-}" ]; then
		# Every .astro/.ts/.js/.css file outside the vendored dir itself.
		sources=$(find "$t/src" -type f \
			\( -name '*.astro' -o -name '*.ts' -o -name '*.js' -o -name '*.css' -o -name '*.mjs' \) \
			! -path "*/styles/cli-mono/*" ! -name 'cli-mono.js' 2>/dev/null)
		if [ -n "$sources" ]; then
			# grep the whole source set once, not per file.
			blob=$(cat $sources 2>/dev/null || true)
			# The three CSS layers are all-or-nothing: a project that styles
			# with .cm-* is loading them, and if it does not, none of the
			# library reached the page.
			#
			# The runtime is NOT all-or-nothing. cli-mono.js carries the
			# theme toggle, scroll-spy and copy buttons, and a static site
			# can perfectly well adopt the design system without wanting
			# any of it. So the runtime is only reported when the project
			# ships a page at all AND the site itself needs it - which
			# dev-blog does, since its own Header.astro carries a hand-
			# rolled theme toggle that the runtime would replace. Checked
			# as a warning line, not a failure.
			for v in "tokens.css" "base.css" "components.css"; do
				case "$blob" in
					*"$v"*) ;;
					*)
						out+="  UNREACHABLE  $v is vendored but nothing imports it"$'\n'
						stale=1
						;;
				esac
			done
			case "$blob" in
				*"cli-mono.js"*) ;;
				*)
					echo "  note: $t vendors cli-mono.js but references no script tag for it"
					echo "        (fine if the site needs no runtime; wire it as"
					echo "         <script is:inline src=...> or the tag is dropped from dist/)"
					;;
			esac
		fi
	fi

	if [ -n "$out" ]; then
		echo "drift in $t"
		echo -n "$out"
		echo "  fix: $SRC/scripts/install.sh $t"
	else
		echo "in sync  $t"
	fi
done

exit $stale
