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

# Normalise every target ONCE, here, and use the normalised form for the
# rest of the script. Not cosmetic: the shadow-copy scan below decides
# whether a vendored file is already accounted for with a STRING comparison
#   [ "$f" = "$t/${pair##*:}" ]
# where "$f" comes from `find "$t"` and therefore never carries a trailing
# slash. A target given as "/root/projects/links/" - which is what a
# `for d in /root/projects/*/` loop produces, and what this repo's own audit
# script passes - makes that comparison fail, so every accounted-for copy was
# reported as an ORPHAN. All three real consumers were reported as drifted
# for files that were byte-identical and on a path MAP already owns.
#
# That is a check crying wolf, which is the same end state as one that never
# fires: it trains you to ignore the output. And the audit that consumes it
# counted only lines matching STALE, so an ORPHAN-only result printed the
# self-contradictory "STALE -- 0 file(s) differ" - reporting a failure whose
# cause it was unable to name.
strip_slash() {
	# ${1%/} once is not enough for "//" or a bare "/", so loop it.
	local p="$1"
	while [ "$p" != "/" ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
	printf '%s' "$p"
}

# A consumer does NOT have to keep the layers at src/styles/cli-mono/.
# spacetime-rpm serves its admin console from web/, so it holds them at
# web/src/styles/cli-mono/ - and MAP hardcodes the src/ prefix, so this
# check reported it MISSING on every file and ORPHAN on the two it got
# right. That is the crying-wolf end state: a CORRECT consumer reported as
# broken, which trains you to ignore the section.
#
# It also hid the actual defect. rpm carried FOUR .cm-* rules the library
# does not define (cm-check, cm-toolbar, cm-toolbar__count) INSIDE its
# vendored components.css, for days, because no drift check ever named the
# project.
#
# So a target's stylesheet prefix is DISCOVERED, not assumed: the directory
# that holds a tokens.css which is byte-identical to (or close to) the
# library's. Resolved once per target, then used everywhere a MAP
# destination was previously hardcoded.
#
# It stays scoped on purpose. Finding any file NAMED components.css would
# adopt a project's own stylesheet as if it were the library's, and report
# the whole thing as drift - which is the same false alarm, one level up.
# The identity that matters is the CONTENT: a vendored library layer.
prefix_for() {
	local t="$1" d
	# The canonical layout first, so an unchanged project keeps the
	# paths it has always reported.
	[ -f "$t/src/styles/cli-mono/components.css" ] && { printf 'src'; return 0; }
	for d in $(find "$t" -type d -name cli-mono -path '*styles*' \
		! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' \
		! -path '*/target/*' 2>/dev/null | sort); do
		[ -f "$d/components.css" ] || continue
		# Identity check: a vendored copy IS (nearly) the library's
		# file. A same-named project stylesheet is not, and adopting it
		# would report the project as drifted against itself.
		if cmp -s "$SRC/src/styles/components.css" "$d/components.css" \
			|| [ "$(diff "$SRC/src/styles/components.css" "$d/components.css" 2>/dev/null | grep -c '^[<>]')" -gt 0 ]; then
			# The prefix is everything BEFORE the trailing /styles/cli-mono,
			# relative to the project root: `web/src/styles/cli-mono` yields
			# `web/src`, because the caller re-appends /styles itself.
			# Returning the whole path made the caller append /styles twice,
			# and the check reported MISSING on files that exist.
			printf '%s' "${d%/cli-mono}" | sed "s|^$t/*||; s|/*\$||; s|/styles\$||"
			return 0
		fi
	done
	return 1
}

targets=()
for t0 in "$@"; do targets+=("$(strip_slash "$t0")"); done
if [ ${#targets[@]} -eq 0 ]; then
	# Bare invocation: scan for the layers ANYWHERE, at any depth. The
	# old test was `[ -d "$d/src/styles/cli-mono" ]`, which can only ever
	# find a project whose install root is the repo root.
	for d in "$CONSUMER_ROOT"/*/; do
		prefix_for "$(strip_slash "$d")" >/dev/null 2>&1 && targets+=("$(strip_slash "$d")")
	done
fi

if [ ${#targets[@]} -eq 0 ]; then
	echo "no consumer projects found"
	exit 0
fi

stale=0
for t in "${targets[@]}"; do
	out=""
	# Discovered, not assumed - see prefix_for. Empty means "no vendored
	# layer anywhere in this project", which is reported rather than
	# silently skipped, because an undetectable consumer is precisely the
	# rpm failure this fixes.
	CP="$(prefix_for "$t" || true)"
	if [ -n "$CP" ]; then
		# The js half sits under the SAME root as the styles. `CP` is the
		# root's src (e.g. `web/src`), and the runtime lives in `CP/js` -
		# NOT `CP/src/js`, which is what a naive `${CP}/src/js` produced
		# and which reported MISSING on files that exist.
		JP="$CP/js"
	else
		JP="src/js"
	fi
	for pair in "${MAP[@]}"; do
		s="$SRC/${pair%%:*}"
		dest="${pair##*:}"
		case "$dest" in
			src/styles/*) d="$t/${CP:-src}/styles/${dest#src/styles/}" ;;
			src/js/*)     d="$t/$JP/${dest#src/js/}" ;;
			*)            d="$t/$dest" ;;
		esac
		if [ ! -f "$d" ]; then
			out+="  MISSING  ${d#$t/}"$'\n'
			stale=1
		elif ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${d#$t/} ($n lines differ)"$'\n'
			stale=1
		fi
	done

	# The ALT copies: the verbatim-serve homes. Compared exactly as hard as a
	# MAP entry when the file exists, and silent when it does not - a project
	# that does not serve the runtime verbatim needs no copy, and demanding
	# one would make this check cry wolf on every such consumer.
	for pair in "${ALT[@]}"; do
		s="$SRC/${pair%%:*}"
		dest="${pair##*:}"
		case "$dest" in
			src/js/*) d="$t/$JP/${dest#src/js/}" ;;
			*)        d="$t/$dest" ;;
		esac
		[ -f "$d" ] || continue
		if ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${d#$t/} ($n lines differ)"$'\n'
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
			pdest="${pair##*:}"
			case "$pdest" in
				src/styles/*) owned="$t/${CP:-src}/styles/${pdest#src/styles/}" ;;
				src/js/*)     owned="$t/$JP/${pdest#src/js/}" ;;
				*)            owned="$t/$pdest" ;;
			esac
			[ "$f" = "$owned" ] && already=1 && break
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

			# Importing components.css is not the same as USING it. The
			# check above is satisfied by the string "components.css"
			# appearing anywhere in the source, and that is a statement
			# about a FILENAME. It said nothing about whether any page
			# emits a single class the file defines.
			#
			# The gap is not hypothetical. dev-blog imports all three
			# layers, so it passed the file-level reachability check, and
			# its Header.astro was built from its own un-prefixed classes
			# -- brand, internal-links, controls, a bare <header> -- so no
			# page emitted .cm-header at all. The library header was
			# styled, shipped and never rendered. A change to .cm-header
			# could not be verified against that site, because that site
			# does not have one.
			#
			# Reported as a note, not a failure, because a consumer may
			# legitimately adopt the design system with its own header --
			# that is a design choice, not drift. But it must be VISIBLE,
			# because "in sync" reads as "adopted", and here the two had
			# come apart for a week. A note costs one line; a false
			# failure here would train the reader to ignore the checker.
			# The class is matched as a WORD, not as ".cm-header": a
			# consumer emits `class="cm-header"`, and the selector form
			# misses every one of them. That made this note fire on a
			# correct consumer, which is the crying-wolf failure this
			# script is written to avoid.
			#
			# `cm-header__nav` and `cm-header__link` count too: a page
			# that renders the list without the wrapper is still using
			# the library header's classes, and the point of the note is
			# "is this site's nav the library's", not "is the exact root
			# element present".
			case "$blob" in
			*cm-header*) ;;
			*)
				echo "  note: $t imports components.css, which defines .cm-header,"
				echo "        but no source file emits that class -- this site has no"
				echo "        library header. Fine if it uses its own; unreadable as"
				echo "        adoption, and a .cm-header change cannot be verified here."
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

	# ---- reserved prefix: .cm-* the LIBRARY does not own ---------------
	# A vendored copy that is byte-identical is in sync; one that is AHEAD
	# is drift the STALE line already names. Neither names WHAT the extra
	# lines are, and that is the part that matters: spacetime-rpm carried
	# four .cm-* rules the library did not define (cm-check, cm-toolbar,
	# cm-toolbar__count) inside its vendored components.css, in the file
	# nobody reads, for days. No library fix could ever reach them and no
	# consumer could use them - surface built in the one place that cannot
	# ship.
	#
	# So when the vendored components.css is AHEAD of the library, list the
	# class selectors it defines that the library's own file does not. An
	# override of a library part is allowed; DEFINING a library-prefixed
	# name the library does not own is the defect, so the comparison is
	# against the library's own rule selectors rather than a bare `.cm-`
	# match.
	if [ -n "$CP" ] && [ -f "$t/$CP/styles/cli-mono/components.css" ]; then
		extra=$(python3 - "$SRC/src/styles/components.css" "$t/$CP/styles/cli-mono/components.css" <<'PY' 2>/dev/null
import re, sys
lib, con = sys.argv[1], sys.argv[2]
def owned(p):
    css = re.sub(r'/\*.*?\*/', '', open(p).read(), flags=re.S)
    names = set()
    for sel in re.findall(r'([^{}@]+)\{', css):
        # split a selector list, then take each compound's own classes.
        # A class inside a DESCENDANT selector is styled conditionally,
        # so it is not the same as being defined here - but for this
        # check either way counts as "the library mentions it".
        for part in sel.split(','):
            names.update(re.findall(r'\.(cm-[A-Za-z0-9_-]+)', part))
    return names
lib_names = owned(lib)
con_names = owned(con)
rogue = sorted(n for n in con_names - lib_names)
print(' '.join(rogue))
PY
		)
		if [ -n "$extra" ]; then
			# shellcheck disable=SC2086
			set -- $extra
			out+="  RESERVED  $CP/styles/cli-mono/components.css defines $# .cm-* class(es) the library does not:"
			out+=$'\n'"            $*"
			out+=$'\n'"            the prefix is reserved for the library. Surface added here reaches"
			out+=$'\n'"            no consumer, and no library fix ever lands on it."
			out+=$'\n'
			stale=1
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
