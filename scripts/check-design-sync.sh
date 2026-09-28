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
	"src/js/cli-mono-theme-guard.js:src/js/cli-mono-theme-guard.js"
)
# The runtime's SECOND, OPTIONAL home. A project that serves it verbatim
# keeps a copy at public/ (Astro) or the flat layout; install.sh --public
# produces exactly these. They are compared as hard as the MAP entries when
# present, but their absence is not a failure - a project needs no verbatim
# copy, and reporting a MISSING one would make the check cry wolf on every
# consumer that does not use the flag.
ALT=(
	"src/js/cli-mono.js:public/cli-mono.js"
	"src/js/cli-mono-theme-guard.js:public/cli-mono-theme-guard.js"
	"src/js/cli-mono.js:cli-mono.js"
	"src/js/cli-mono-theme-guard.js:cli-mono-theme-guard.js"
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

	# The ALT copies: the verbatim-serve homes. Compared exactly as hard as a
	# MAP entry when the file exists, and silent when it does not - a project
	# that does not serve the runtime verbatim needs no copy, and demanding
	# one would make this check cry wolf on every such consumer.
	for pair in "${ALT[@]}"; do
		s="$SRC/${pair%%:*}"
		d="$t/${pair##*:}"
		[ -f "$d" ] || continue
		if ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${pair##*:} ($n lines differ)"$'\n'
			stale=1
		fi
	done

	# ---- shadow copies (the map is a whitelist, and a whitelist is a hole) ----
	# MAP and ALT together are still a WHITELIST: they name paths this script
	# already knows. A consumer can hold a copy on any other path, and that
	# copy is invisible to both. public/ is the shape that actually occurred
	# - Astro TREATS <script src> as a bundler asset reference, so when the
	# src is a variable it cannot resolve the tag is dropped from dist/
	# entirely, and the documented workaround is a copy in public/ loaded
	# with is:inline.
	#
	# That is not hypothetical. oem-portfolio reported "in sync" for three
	# days while the runtime it SERVED over HTTP was 140 lines behind the
	# library, missing initNav, the copy-button rebind guard and the DOM-read
	# key list. Its src/js copy stayed current the whole time, which is
	# exactly why nothing looked twice.
	#
	# So every OTHER cli-mono*.js the consumer holds is reported, and BOTH
	# outcomes fail, because both are silent:
	#   SHADOW  - it differs, so it is a drifted second copy
	#   ORPHAN  - it is byte-identical, so it is adoption on a path nothing
	#             compares, which is the state the drift grows out of.
	#             Identical is NOT safe: a file nothing checks is a file
	#             that drifts the first time the library changes.
	#
	# Matching on the full DESTINATION PATH, never the basename. A basename
	# match would skip every copy called cli-mono.js - including the public/
	# one this section exists to catch - because MAP also has a file of that
	# name. That bug was written, caught by the suite against the real
	# oem-portfolio state, and fixed in the same commit.
	#
	# Excluded: every path MAP and ALT already own, build output (dist/ is
	# generated, and a hashed bundle asset is not a hand-kept copy) and
	# vendored trees.
	for f in $(find "$t" -type f -name 'cli-mono*.js' \
		! -path '*/dist/*' ! -path '*/build/*' ! -path '*/node_modules/*' \
		! -path '*/.git/*' ! -path '*/target/*' 2>/dev/null | sort); do
		# Generated output, not a hand-kept copy.
		case "$f" in
			*.min.js|*.map) continue ;;
		esac
		already=0
		for pair in "${MAP[@]}" "${ALT[@]}"; do
			[ "$f" = "$t/${pair##*:}" ] && already=1 && break
		done
		[ "$already" -eq 1 ] && continue
		# Which origin does this name correspond to?
		case "$(basename "$f")" in
			cli-mono.js)             o="$SRC/src/js/cli-mono.js" ;;
			cli-mono-theme-guard.js) o="$SRC/src/js/cli-mono-theme-guard.js" ;;
			*)                       o="" ;;
		esac
		# A cli-mono*.js that matches no known origin is some other tool's
		# file. Naming it would be noise, and a noisy check gets ignored.
		[ -n "$o" ] && [ -f "$o" ] || continue
		rel="${f#$t/}"
		if ! cmp -s "$o" "$f"; then
			n=$(diff "$o" "$f" | grep -c '^[<>]' || true)
			out+="  SHADOW   $rel ($n lines differ from the library)"$'\n'
			stale=1
		else
			out+="  ORPHAN   $rel is byte-identical but on no path this check compares"$'\n'
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
			! -path "*/styles/cli-mono/*" ! -name 'cli-mono.js' \
			! -name 'cli-mono-theme-guard.js' 2>/dev/null)
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

			# The FOUC guard is NOT optional the way the runtime is. A
			# project can legitimately adopt the design system and not
			# want a theme toggle, but a vendored guard that no <head>
			# loads means a light-theme visitor gets a black flash, and
			# the file sitting there unused reads as adoption. Fail hard.
			#
			# Match the FILE NAME, not a vendored path: a consumer may
			# load it by a `?raw` import or by <script src>, and both are
			# real. Requiring the literal path flagged a correct consumer
			# in this repo's own history.
			case "$blob" in
				*"cli-mono-theme-guard.js"*) ;;
				*)
					out+="  UNREACHABLE  cli-mono-theme-guard.js is vendored but no <head> loads it"$'\n'
					stale=1
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
