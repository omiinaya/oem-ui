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
# Consumers are not all UNDER $CONSUMER_ROOT. hermes-hearth's source repo is
# /root/browser-hub - only its deploy venv lives under /root/projects - so a
# sweep bounded by $CONSUMER_ROOT reported it as neither a consumer nor a
# holdout: an adoption could exist and the sweep that exists to notice
# adoptions would never see it. Extra roots get the SAME content test as any
# other directory (a tokens.css whose lines match the library's), so listing
# one costs nothing until it actually vendors the library - and once it does,
# it is graded exactly like everyone else.
EXTRA_CONSUMER_ROOTS="${EXTRA_CONSUMER_ROOTS:-${HOME}/browser-hub}"
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
	# The same two homes under a nested web root. A Vite app serves from
	# web/, so the guard it needs in order to run at all lives in
	# web/public/. ALT entries are compared when present and SILENT when
	# absent, so naming them costs nothing for a consumer that has no
	# verbatim-serve copy -- while giving the shadow scan an owned path so
	# it stops reporting three correctly-wired guards as ORPHAN.
	"src/js/cli-mono.js:web/public/cli-mono.js"
	"src/js/cli-mono-theme-guard.js:web/public/cli-mono-theme-guard.js"
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
# What fraction of the LIBRARY file's distinct non-blank lines also appear
# in the candidate. CONTENT is what makes a copy a copy; the filename is
# only what a reader guesses at.
#
# Measured across this fleet, not guessed. Every real vendored layer
# shares a large slice of the library's own distinct lines - the four
# copies under /root/projects score 44%, 49%, 49% and 53% - while every
# PROJECT's own stylesheet scores 0-1% (gantree's 2648-line global.css
# shares ten lines, 0%). The runtime separates further still: oem-cdn's
# stale copy shares 77% of the runtime's distinct lines and its own
# app.js shares 0%.
#
# The threshold therefore sits with 1.7x headroom BELOW the lowest real
# copy and 25x ABOVE the highest noise reading. That margin is the entire
# reason a content test is safe here: the failure mode of getting the
# threshold wrong is a FALSE FAILURE on a correct consumer, which is the
# outcome this script's own history names as its worst state.
COPY_PCT=25

# MAP writes the layers as `src/styles/cli-mono/<leaf>`, but that middle
# segment is the CANONICAL home, not a required one. A consumer whose
# layers sit in `web/oem-ui/` still holds `tokens.css`; appending
# `cli-mono/` to that directory asks for `web/oem-ui/cli-mono/tokens.css`
# and reports MISSING for a file that exists. So the leaf is taken by
# BASENAME whenever the discovered directory already contains it.
#
# A directory that is ALREADY the canonical one is returned unchanged, and
# the test below is what keeps that true: `web/oem-ui` has no
# `tokens.css`-bearing `cli-mono` child, so it takes the basename, while
# `src/styles/cli-mono` holds the leaf directly and also takes the
# basename. The doubled `src/styles/cli-mono/cli-mono/tokens.css` is the
# shape you get when the existence test is skipped - it asks for a
# directory that does not exist and reports MISSING for a file that does.
css_leaf() {
	local rel="$1" base="${1##*/}"
	if [ -f "$t/$CD/$base" ]; then printf '%s' "$base"; return 0; fi
	printf '%s' "$rel"
}

# Make $d relative to the project root $t. NOT `${d#"$t"/}`: when $d IS
# $t that expansion has nothing to match and bash returns the string
# UNCHANGED, so the caller gets an ABSOLUTE path where it expected a
# relative one.
#
# That is not a theoretical shape. `install.sh --flat` is documented for
# exactly the project that has no src/ tree - a plain web/index.html or a
# static page served from the project root - and it writes the runtime to
# <target>/cli-mono.js, i.e. the vendored JS directory IS the project root.
# js_dir_for then returned "$t" verbatim, and every caller built
# "$t/$JD/cli-mono.js" = "/a/b//a/b/cli-mono.js", a path that exists
# nowhere. Measured: the checker printed MISSING for BOTH JS files of a
# flat install whose copies were BYTE-IDENTICAL, then advised running
# install.sh again - which would have added a second, unserved copy under
# src/js/. The install the checker told the reader to re-run was correct;
# the checker could not see the layout it had produced.
#
# '.' stands for the root. It is not empty, because an empty CD/JD means
# "not discovered" to the callers below, and this one WAS discovered.
rel_to_t() {
	if [ "$1" = "$t" ]; then printf '.'; return 0; fi
	printf '%s' "${1#"$t"/}"
}

similar_to() {
	python3 - "$1" "$2" 2>/dev/null <<'PY' || printf '0\n'
import sys
def uniq(p):
	with open(p, encoding='utf-8', errors='replace') as f:
		return {l.strip() for l in f if l.strip()}
a = uniq(sys.argv[1])
if not a:
	print(0)
else:
	print(len(a & uniq(sys.argv[2])) * 100 // len(a))
PY
}

# ---- where a consumer KEEPS the vendored layers, discovered by content ----
#
# The directory NAME is not a safe key. The canonical home is
# src/styles/cli-mono/, but a project that compiles its assets into a
# binary picks its own: oem-cdn serves its admin console through
# include_str! and holds the layers at web/oem-ui/.
#
# The old discovery looked for a directory NAMED `cli-mono`, found none,
# and printed five MISSING lines for a consumer that in fact ships all
# five files. That is the crying-wolf end state - and it also buried the
# real defect sitting directly behind it, because a checker reporting the
# wrong reason is not a checker anyone reads twice.
#
# So the return value is the DIRECTORY, not a prefix. Callers used to
# re-assemble a path by appending /styles, which cannot express a vendored
# tree that has no `styles` segment at all - which is precisely the
# oem-cdn shape. (That double-append bug already bit this script once;
# it is recorded in the note below the original prefix_for.)
css_dir_for() {
	local t="$1" d
	# The canonical layout first, so an unchanged project keeps the
	# paths it has always reported.
	if [ -f "$t/src/styles/cli-mono/components.css" ]; then
		printf 'src/styles/cli-mono'; return 0
	fi
	for d in $(find "$t" -type f -name 'components.css' \
		! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' \
		! -path '*/build/*' ! -path '*/target/*' 2>/dev/null | sort); do
		d="${d%/components.css}"
		# Never adopt the library's own file as a consumer's.
		[ "$d/components.css" = "$SRC/src/styles/components.css" ] && continue
		if [ "$(similar_to "$SRC/src/styles/components.css" "$d/components.css")" \
			-ge "$COPY_PCT" ]; then
			rel_to_t "$d"
			return 0
		fi
	done
	return 1
}

# The bare scan above only needs "is this a consumer at all", which is
# the same question asked with a coarser key. Kept as its own function
# because the bare-invocation path uses it and the MAP path does not:
# css_dir_for names a DIRECTORY, this only answers yes/no.
#
# It previously searched for a directory NAMED `cli-mono` and had to
# strip `/styles` off the end to give a prefix back. Both halves of that
# are gone: discovery is by content, and the caller no longer
# re-assembles a path, so a vendored tree with no `styles` segment at all
# is expressible rather than needing the prefix shaped around it.
prefix_for() {
	css_dir_for "$1" >/dev/null 2>&1
}

# The same question for the two JS files. Their home is usually a sibling
# of the styles, but not always, and a copy that is byte-identical OR
# merely similar is the same file for this purpose.
js_dir_for() {
	local t="$1" f d best="" rel dep bestdep=""
	if [ -f "$t/src/js/cli-mono.js" ]; then
		printf 'src/js'; return 0
	fi
	# Every .js is a candidate, and the origin is resolved by CONTENT,
	# not by filename. Searching for the two known names would miss the
	# copy that is most worth finding: oem-cdn compiles its assets into
	# the binary and its asset route names the runtime `runtime.js`, so a
	# name-keyed search never even lists it.
	#
	# Two different questions, and they must not be answered by one
	# pass. "Where does this project keep the vendored runtime?" is
	# about the home; "is there a copy here that has drifted?" is about
	# the shadow scan, which walks every .js on its own. A SHADOWED
	# runtime is the one that can never be adopted as the home, because
	# the home is exactly what the drift is hiding from.
	#
	# Adopting the first match instead was how `assets/cli-mono.js` came
	# to be the project's declared JS directory: MAP then compared that
	# file against itself and reported the shadow as in sync, which is
	# the one verdict a shadow scan must never produce.
	for f in $(find "$t" -type f -name '*.js' \
		! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' \
		! -path '*/build/*' ! -path '*/target/*' 2>/dev/null | sort); do
		case "$f" in *.min.js|*.map) continue ;; esac
		# A canonical src/js wins outright: it is the layout the
		# installer writes, so nothing else should be able to
		# outvote it for the role of "where the runtime lives".
		case "${f%/*}" in
			"$t/src/js") printf 'src/js'; return 0 ;;
		esac
		# An EXACT match is a candidate home. A merely-similar one is
		# not: a drifted copy is precisely what the shadow scan exists
		# to report, and adopting it here would compare the drifted
		# file against itself and call the result in sync.
		cmp -s "$SRC/src/js/cli-mono.js" "$f" \
			|| cmp -s "$SRC/src/js/cli-mono-theme-guard.js" "$f" || continue
		# public/ is a VERBATIM-SERVE copy, never the project home: it
		# exists because a <script src> in an Astro or Vite head has to
		# resolve to a served path, so the library lands there too.
		# Prefer any src/-style home over it, however deep. Judging on
		# depth alone picked web/public/ (one level) over web/src/js/
		# (three) once a Vite app guard was wired, and MAP then demanded
		# a runtime copy at web/public/cli-mono.js that nothing had ever
		# put there -- the checker flagging the fix as the defect.
		case "${f%/*}" in
			*/public|*/public/*) continue ;;
		esac
		# Otherwise remember the shallowest match, because a copy
		# buried deep in the tree is more likely to be a
		# secondary/verbatim-serve copy than the project home.
		# Depth is counted RELATIVE to the project root: counting
		# the absolute path made every comparison a tie at the
		# same offset, so the first match always won.
		d="${f%/*}"
		rel="$(rel_to_t "$d")"
		dep="${rel//[^\/]/}"
		if [ -z "$best" ] || [ "${#dep}" -lt "${#bestdep}" ]; then
			best="$d"; bestdep="$dep"
		fi
	done
	[ -n "$best" ] || return 1
	rel_to_t "$best"
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
	# Word-split on purpose: EXTRA_CONSUMER_ROOTS is a space-separated list
	# of directories, each tested on its own merits below.
	# shellcheck disable=SC2086
	for d in $EXTRA_CONSUMER_ROOTS; do
		[ -d "$d" ] || continue
		prefix_for "$(strip_slash "$d")" >/dev/null 2>&1 && targets+=("$(strip_slash "$d")")
	done
fi

if [ ${#targets[@]} -eq 0 ]; then
	echo "no consumer projects found"
	exit 0
fi

stale=0
# Findings that REQUIRE action, kept apart from the informational notes.
#
# Before this split, ANY non-empty output printed the `drift in <target>`
# header and a `fix:` line -- including the RENAMED verdict, which is
# explicitly ADOPTION and does not set `stale`. So a byte-identical consumer
# (oem-cdn) exited 0 while its output still read "drift in oem-cdn" and
# "fix: install.sh /root/projects/oem-cdn". Two readers disagreed: the exit
# code said clean, the text said drift.
#
# The text is what a human reads and what CI pastes, so it was the one that
# lied. Worse, the fix: line was UNPERFORMABLE for exactly those targets:
# the remedy writes the canonical src/ layout, which the project does not
# serve, so following it adds a second, unserved copy and the next run
# reports the same thing. A remediation the tool cannot perform is worse
# than no remediation, because it converts a clean result into a loop.
#
# So: `out` is informational (RENAMED = adoption, and its layout hint), and
# `findings` is what makes the run fail. Only a finding prints `fix:`.
declare -A ACCOUNTED=()
declare -A GUARD_NAMES=()
declare -A RUNTIME_NAMES=()
for t in "${targets[@]}"; do
	out=""
	findings=""
	# Whether THIS target has a finding, as opposed to the run as a whole.
	# Reset per target: without it, one drifting consumer would label every
	# later adoption-only consumer as drifting too.
	tstale=0
	# Discovered, not assumed - see prefix_for. Empty means "no vendored
	# layer anywhere in this project", which is reported rather than
	# silently skipped, because an undetectable consumer is precisely the
	# rpm failure this fixes.
	# Both are DIRECTORIES, discovered by content. Empty means "no
	# vendored layer of that kind anywhere in this project", which is
	# reported below rather than silently skipped - an undetectable
	# consumer is exactly the rpm failure this script exists to prevent.
	CD="$(css_dir_for "$t" || true)"
	JD="$(js_dir_for "$t" || true)"
	for pair in "${MAP[@]}"; do
		s="$SRC/${pair%%:*}"
		dest="${pair##*:}"
		case "$dest" in
			src/styles/*) d="$t/${CD:-src/styles/cli-mono}/$(css_leaf "${dest#src/styles/}")" ;;
			src/js/*)     d="$t/${JD:-src/js}/${dest#src/js/}" ;;
			*)            d="$t/$dest" ;;
		esac
		if [ ! -f "$d" ]; then
			# A renamed vendored file is NOT a missing one. oem-cdn
			# compiles its assets into the binary with include_str! and
			# its asset route names the runtime `runtime.js` and the
			# guard `theme-guard.js`; both are genuine vendored copies
			# (the guard is byte-identical) and both are reported as
			# SHADOW/ORPHAN by the content scan a few lines below.
			# Printing MISSING for them is a false alarm that hides the
			# real finding behind a path the consumer never chose and
			# that install.sh would "fix" by adding a second, unserved
			# copy under the canonical name.
			renamed=""
			case "$dest" in
			src/js/*)
				for c in $(find "$t/${JD:-src/js}" -maxdepth 1 -type f -name '*.js' \
					! -name "${dest##*/}" 2>/dev/null); do
					cmp -s "$s" "$c" || [ "$(similar_to "$s" "$c")" -ge "$COPY_PCT" ] || continue
					renamed="${c#$t/}"; break
				done ;;
			esac
			if [ -n "$renamed" ]; then
				# A renamed copy is ADOPTION, not drift - provided it is
				# byte-identical. It is reported, because a reader has to
				# be able to see that this consumer's runtime is reached
				# under a name MAP does not use, but reporting must not
				# by itself fail the run: oem-cdn serves `runtime.js`
				# because its Rust route is named that, and nothing
				# about that is a defect. The drift that matters is
				# caught below, where the copy is COMPARED.
				if cmp -s "$s" "$t/$renamed"; then
					out+="  RENAMED  ${d#$t/} is vendored as $renamed"$'\n'"                 (adoption, not drift; the comparison follows the CONTENT)"$'\n'
				else
					out+="  RENAMED  ${d#$t/} is vendored as $renamed"$'\n'"                 and that copy has DRIFTED from the library"$'\n'
					stale=1; tstale=1
				fi
				# This copy IS the vendored file, reached under another
				# name, so it is accounted for - and must be remembered
				# as such. Without this the shadow scan reports it a
				# second time as an ORPHAN, and a consumer that did
				# nothing wrong fails on the same file twice.
				ACCOUNTED["$t/$renamed"]=1
				# The reachability scan below greps for the CANONICAL
				# filename, so a consumer that loaded its renamed guard
				# would still be reported UNREACHABLE. Record the names
				# actually in use and let that scan accept either.
				case "$dest" in
				*theme-guard.js) GUARD_NAMES["${renamed##*/}"]=1 ;;
				*/cli-mono.js)   RUNTIME_NAMES["${renamed##*/}"]=1 ;;
				esac
			else
				out+="  MISSING  ${d#$t/}"$'\n'
				stale=1; tstale=1
			fi
		elif ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${d#$t/} ($n lines differ)"$'\n'
			stale=1; tstale=1
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
			src/js/*) d="$t/${JD:-src/js}/${dest#src/js/}" ;;
			*)        d="$t/$dest" ;;
		esac
		[ -f "$d" ] || continue
		if ! cmp -s "$s" "$d"; then
			n=$(diff "$s" "$d" | grep -c '^[<>]' || true)
			out+="  STALE    ${d#$t/} ($n lines differ)"$'\n'
			stale=1; tstale=1
		fi
	done

	# ---- the Astro components: the other half of install.sh's promise ----
	# install.sh's own header says this script "names any consumer whose
	# copy of a library component has drifted". It did not, until this
	# block: MAP and ALT name the three CSS layers and the two runtime
	# files, and NOTHING named src/astro/. MEASURED 2026-10-09 on
	# dev-blog - the blog the library's header was copied FROM - its
	# Header.astro and HeaderLink.astro were both stale and current.ts,
	# the module both of them import, was missing outright, and every
	# fleet check reported the consumer IN SYNC the whole time. A
	# consumer could fork the library's flagship component and pass.
	#
	# config.ts is EXCLUDED and on purpose, matching install.sh: it skips
	# an existing config.ts because it is the one file the consumer owns
	# and edits with its own title, author and email. Comparing it would
	# fail every correct consumer for having an identity.
	#
	# A consumer with no src/astro/ at all is SILENT, not MISSING: the
	# components are an optional adoption, and a checker that demanded
	# them would fail the majority of the fleet that never took them.
	if [ -d "$t/src/astro" ] && [ -d "$SRC/src/astro" ]; then
		for f in "$SRC/src/astro/"*.astro "$SRC/src/astro/"*.ts; do
			[ -e "$f" ] || continue
			b="$(basename "$f")"
			[ "$b" = "config.ts" ] && continue
			d="$t/src/astro/$b"
			if [ ! -f "$d" ]; then
				out+="  MISSING  src/astro/$b (install.sh --astro installs it)"$'\n'
				stale=1; tstale=1
			elif ! cmp -s "$f" "$d"; then
				n=$(diff "$f" "$d" | grep -c '^[<>]' || true)
				out+="  STALE    src/astro/$b ($n lines differ)"$'\n'
				stale=1; tstale=1
			fi
		done
		# The reverse direction too: a file here the library no longer
		# ships is a fork or a leftover, and nothing but this consumer's
		# own suite can see it.
		for d in "$t/src/astro/"*.astro "$t/src/astro/"*.ts; do
			[ -e "$d" ] || continue
			b="$(basename "$d")"
			[ "$b" = "config.ts" ] && continue
			if [ ! -e "$SRC/src/astro/$b" ]; then
				out+="  ORPHAN   src/astro/$b (the library no longer ships it)"$'\n'
				stale=1; tstale=1
			fi
		done
	fi

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
	for f in $(find "$t" -type f -name '*.js' \
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
				src/styles/*) owned="$t/${CD:-src/styles/cli-mono}/$(css_leaf "${pdest#src/styles/}")" ;;
				src/js/*)     owned="$t/${JD:-src/js}/${pdest#src/js/}" ;;
				*)            owned="$t/$pdest" ;;
			esac
			[ "$f" = "$owned" ] && already=1 && break
		done
		[ "$already" -eq 1 ] && continue
		# Already reached under a non-canonical name and reported as
		# RENAMED above. Reporting it again here would fail a correct
		# consumer twice over one file, which teaches the reader to
		# ignore both lines.
		[ -n "${ACCOUNTED[$f]:-}" ] && continue
		# Which origin does this CONTENT correspond to? Resolved by
		# similarity, never by filename: a consumer that compiles its
		# assets into a binary renames the runtime to whatever its asset
		# route calls it, and oem-cdn's is `runtime.js`. Keyed on the
		# basename, that copy is structurally invisible - and oem-cdn
		# was serving a runtime 175 lines behind the library while this
		# script reported it MISSING five files it actually ships.
		#
		# The NAME is the fallback, and it has to be. A shadow copy that
		# has been truncated or stubbed to a single line shares 0% of
		# the library's lines, so similarity alone discards it as "some
		# other tool's file" - and a one-line `assets/cli-mono.js` is
		# the most damaged copy there is, which is exactly the one
		# worth reporting. A file NAMED after the library is a claim
		# about the library, and an unresolvable claim is a failure to
		# name, not a file to skip in silence.
		#
		# Both signals, then: content finds the copies that were
		# renamed, the name finds the copies that were destroyed.
		o=""
		if cmp -s "$SRC/src/js/cli-mono.js" "$f" \
			|| [ "$(similar_to "$SRC/src/js/cli-mono.js" "$f")" -ge "$COPY_PCT" ]; then
			o="$SRC/src/js/cli-mono.js"
		elif cmp -s "$SRC/src/js/cli-mono-theme-guard.js" "$f" \
			|| [ "$(similar_to "$SRC/src/js/cli-mono-theme-guard.js" "$f")" -ge "$COPY_PCT" ]; then
			o="$SRC/src/js/cli-mono-theme-guard.js"
		fi
		# A .js that matches no known origin AND is not named after
		# the library is some other tool's file. Naming it would be
		# noise, and a noisy check gets ignored. A file called
		# cli-mono*.js is NOT that: it is named after the library, so
		# it is resolved against the runtime and reported either way.
		if [ -z "$o" ] || [ ! -f "$o" ]; then
			case "${f##*/}" in
			cli-mono*.js)
				o="$SRC/src/js/cli-mono.js"
				case "$f" in
				*theme-guard.js) o="$SRC/src/js/cli-mono-theme-guard.js" ;;
				esac ;;
			*) continue ;;
			esac
		fi
		rel="${f#$t/}"
		if ! cmp -s "$o" "$f"; then
			n=$(diff "$o" "$f" | grep -c '^[<>]' || true)
			out+="  SHADOW   $rel ($n lines differ from the library)"$'\n'
			stale=1; tstale=1
		else
			out+="  ORPHAN   $rel is byte-identical but on no path this check compares"$'\n'
			stale=1; tstale=1
		fi
	done

	# ---- generated scoped entries ------------------------------------------
	# A THIRD file class, and the one this script could not see at all.
	#
	# MAP and ALT name files the CONSUMER copies. They cannot name a file the
	# LIBRARY generates for the consumer: `make-scoped-entry.mjs` writes a
	# `cm-scoped.css` (any name) that re-declares the theme-independent token
	# scale and imports components.css, for the consumer whose build inlines
	# Tailwind into @layers and cannot import base.css globally. The
	# components.css it imports is compared here, so this consumer looks
	# perfectly adopted - while the file that actually carries the tokens is
	# on a path nothing in MAP names.
	#
	# MEASURED 2026-10-08, all three scoped consumers on the fleet
	# (spacetime-kanban, spacetime-memory, hermes-articles): each was
	# generated before the library gained its --z-* scale, and each was
	# missing ALL NINE tokens, so `z-index: var(--z-header)` and its twelve
	# siblings (13 declarations in components.css) computed as invalid at
	# computed-value time and resolved to `auto`. The stale toolbar, scrim,
	# drawer, popover, hovercard and toast all had NO stacking order at all -
	# verified in WebKit at 390px, reading the computed value rather than
	# the source. They also still carried `--radius: 10px` from before
	# e79e3d5 took the rounding out.
	#
	# The check is by CONTENT, never by filename: the generator is told which
	# components.css each consumer actually serves, because a scoped entry
	# whose @import target does not exist is dropped silently by PostCSS -
	# the same failure install.sh documents for an unserved copy. So the
	# import path is READ from the file and resolved relative to it, which
	# is what makes one rule cover cm-scoped.css, cm-prose.css and any
	# other name the generator was pointed at.
	#
	# Delegated to the generator's own `--check`, not reimplemented: a second
	# implementation of "what the generator would emit" is a second thing to
	# drift, and this script already learned that lesson from the runtime.
	for f in $(find "$t" -type f -name '*.css' \
		! -path '*/dist/*' ! -path '*/build/*' ! -path '*/node_modules/*' \
		! -path '*/.git/*' ! -path '*/target/*' 2>/dev/null | sort); do
		# Only a file the generator claims. The header is the contract,
		# and it is checked on the RAW text: stripping comments first
		# would discard the very line that identifies the file.
		head -6 "$f" 2>/dev/null | grep -q 'make-scoped-entry.mjs' || continue
		imp="$(sed -n 's/^@import "\(.*components\.css\)";.*/\1/p' "$f" | head -1)"
		[ -n "$imp" ] || continue
		# The import is relative to the FILE, not the project root - a
		# flat-scoped entry at web/src/ says ../cli-mono/components.css.
		resolved="$(cd "$(dirname "$f")" 2>/dev/null && cd "$(dirname "$imp")" 2>/dev/null && pwd)/$(basename "$imp")"
		if [ ! -f "$resolved" ]; then
			# Both fragments stay quoted. A `\` continuation that left the
			# SECOND string indented ended the assignment at the closing
			# quote and ran the rest as a command: `line 662: the whole
			# design system is absent...: command not found`, once per
			# scoped consumer, while the SCOPED line still printed - so
			# the report looked right and stderr looked broken.
			out+="  SCOPED   ${f#$t/} imports $imp, which does not exist - PostCSS drops it silently"$'\n'"            the whole design system is absent while every other check passes"$'\n'
			stale=1; tstale=1
			continue
		fi
		# The generator resolves --components relative to the TARGET
		# FILE's own directory (make-scoped-entry.mjs:
		# `path.resolve(targetDir, relComponents)`) - NOT relative to
		# the CWD and NOT relative to the project root. So the argument
		# is the import path exactly as the scoped entry already spells
		# it. Prefixing the file's directory onto it is what produced
		# `web/src/../cli-mono/...` resolving to web/src/web/cli-mono/...
		# and a perfectly correct consumer printing NOT FOUND.
		scoped_out="$(cd "$t" && node "$SRC/scripts/make-scoped-entry.mjs" \
			--check "${f#$t/}" --components "$imp" 2>&1)"
		if ! printf '%s' "$scoped_out" | grep -q 'in sync'; then
			out+="  STALE    ${f#$t/} (generated scoped entry)"$'\n'
			# Appending to the VARIABLE. `>> "$out"` created a file
			# literally named `out` and the generator's own
			# "first difference at line 36" went to stderr beside the
			# verdict - so the finding carried no explanation.
			out+="$(printf '%s\n' "$scoped_out" | sed 's/^/            /')"$'\n'
			out+="  fix:      (cd $t && node $SRC/scripts/make-scoped-entry.mjs --out ${f#$t/} --components $imp)"$'\n'
			stale=1; tstale=1
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
		#
		# `$t` and NOT `$t/src`. `install.sh --flat` exists for a project
		# with no src/ tree at all - plain index.html files served from
		# the project root, which is exactly what oem-ngo-brand is -
		# so scanning `$t/src` found nothing there and the whole
		# reachability pass was skipped: a flat consumer that vendored
		# the library and imported NONE of it reported "in sync" on
		# every run. That is the dev-blog bug again, in the one layout
		# the checker could not see, and it was silent for the whole
		# life of the --flat flag.
		#
		# Scanning $t instead is safe: the vendored copies themselves are
		# excluded by name and by the cli-mono/ path, so they can never
		# vouch for their own reachability. The `$CD` exclusion is
		# widened to the discovered vendored dir so a consumer whose
		# tree is named something else (oem-cdn's web/oem-ui/) is equally
		# unable to grade its own homework.
		#
		# *.html is in the set, and it is the ONLY member that matters
		# for a flat consumer. A static site has no .astro and no .ts:
		# its pages are plain HTML at the project root, which is what
		# --flat was written for. Without it the scan found nothing at
		# all, `sources` came back empty, and the entire reachability
		# pass - the one added because dev-blog imported none of what it
		# vendored - was skipped outright for this layout.
		#
		# *.tsx and *.jsx are in it because a React consumer keeps its
		# components there and NOWHERE else. MEASURED on code-spaces
		# (2026-10-08, the migration that found this): 87 .tsx files
		# against 50 .ts, so the scan was reading a third of the
		# project and the runtime note fired even though main.tsx
		# imports './js/cli-mono.js' on line one. Same class of miss
		# as *.py: a file extension the sweep never learned is a
		# consumer it grades from a partial transcript - here it
		# reports "vendors cli-mono.js but references no script tag"
		# for a site that wires it through the module graph, which is
		# the correct wiring and steers the next person toward a
		# <script src> that Vite does not even serve.
		sources=$(find "$t" \
			\( -type d \( -name node_modules -o -name .git -o -name dist \
				-o -name build -o -name target -o -name .astro \
				-o -name .next -o -name vendor \) -prune \) -o \
			\( -type f \
			\( -name '*.astro' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
				-o -name '*.css' -o -name '*.mjs' -o -name '*.html' \
				-o -name '*.py' \) \
			! -path "*/styles/cli-mono/*" ! -path "$t/$CD/*" \
			! -name 'cli-mono.js' \
			! -name 'cli-mono-theme-guard.js' -print \) 2>/dev/null)
		if [ -n "$sources" ]; then
			# grep the whole source set once, not per file.
			blob=$(cat $sources 2>/dev/null || true)
			# Comments are NOT references. A page that says
			# "<!-- we inline cli-mono-theme-guard.js here -->" and then
			# does not load it has no guard, and a check satisfied by a
			# filename in a sentence is the dev-blog trap wearing a
			# different hat. So strip comments before asking what the
			# project actually wires up. Only HTML comments: a consumer
			# may legitimately document the library in a .md-adjacent
			# comment inside CSS, but CSS comments cannot contain the
			# tag-bearing markup these checks look for, so stripping
			# them buys nothing and risks eating a real @import line
			# that a stylesheet legitimately hides behind a comment.
			#
			# *.py is in the set now, and a Python consumer names its
			# files in `#` comments as readily as an HTML one does in
			# <!-- -->: hermes-hearth's WebUI is a Python STRING, so it
			# has no .html at all and the whole pass used to skip. A
			# line-leading # is stripped for the same reason, and the
			# worry of eating real content does not apply: a CSS id
			# selector or an #anchor at column 0 is never a filename
			# the page loads, and hex colours live mid-declaration.
			blob=$(printf '%s' "$blob" | perl -0pe 's/<!--.*?-->//gs; s/^[ 	]*#.*$//gm')
			# Known limit, recorded rather than hidden: for a Python
			# consumer the PASS here only proves the filename appears
			# somewhere outside the vendored copy - and the server's own
			# asset allowlist names it too, so deleting the <link> from
			# the page does not turn this red. The page-level guarantee
			# is the consumer's own suite (hermes-hearth asserts the tag
			# ORDER, and a mutation dropping components.css's <link>
			# fails it). This pass's job here is narrower: run at all,
			# where before the source set was empty and it skipped.
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
						stale=1; tstale=1
						;;
				esac
			done
			rt=0
			case "$blob" in
			*"cli-mono.js"*) rt=1 ;;
			*)
				for n in "${!RUNTIME_NAMES[@]}"; do
					case "$blob" in *"$n"*) rt=1; break ;; esac
				done ;;
			esac
			if [ "$rt" -eq 0 ]; then
				echo "  note: $t vendors cli-mono.js but references no script tag for it"
				echo "        (fine if the site needs no runtime; wire it as"
				echo "         <script is:inline src=...> or the tag is dropped from dist/)"
			fi

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
			#
			# And match the BODY, because inlining it verbatim is the
			# shape the guard's own header recommends and the shape
			# spacetime-rpm actually ships: the whole file pasted into a
			# <script> element in web/index.html. No filename appears
			# anywhere in that page, so a name-only match calls a wired
			# guard UNREACHABLE - the exact false positive that trains
			# people to ignore this line. The signature below is from the
			# guard's executable body, not its comments, so it cannot be
			# satisfied by the file merely being quoted in prose.
			#
			# Generated from the guard source rather than hand-copied: a
			# literal here would rot the moment the guard changes, and a
			# signature that no longer matches its own guard is a check
			# that has quietly stopped checking.
			guard_sig() {
				sed -n '/^(function () {/,/^})();/p' \
					"$SRC/src/js/cli-mono-theme-guard.js" |
					grep -o "s === 'light' || s === 'dark'" | head -1
			}
			case "$blob" in
			*"cli-mono-theme-guard.js"*) ;;
			*"$(guard_sig)"*) ;;
			*)
				# A renamed guard counts as loaded under its own name.
				# oem-cdn serves `theme-guard.js` and its <head> loads
				# exactly that; requiring the canonical filename called
				# a shipped, wired guard UNREACHABLE.
				loaded=0
				for n in "${!GUARD_NAMES[@]}"; do
					case "$blob" in *"$n"*) loaded=1; break ;; esac
				done
				if [ "$loaded" -eq 0 ]; then
					out+="  UNREACHABLE  cli-mono-theme-guard.js is vendored but no <head> loads it"$'\n'
					stale=1; tstale=1
				fi
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
	if [ -n "$CD" ] && [ -f "$t/$CD/components.css" ]; then
		extra=$(python3 - "$SRC/src/styles/components.css" "$t/$CD/components.css" <<'PY' 2>/dev/null
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
			out+="  RESERVED  $CD/components.css defines $# .cm-* class(es) the library does not:"
			out+=$'\n'"            $*"
			out+=$'\n'"            the prefix is reserved for the library. Surface added here reaches"
			out+=$'\n'"            no consumer, and no library fix ever lands on it."
			out+=$'\n'
			stale=1; tstale=1
		fi
	fi

	# `out` carries BOTH the informational notes and the findings; `tstale`
	# says which target actually failed. The header and the `fix:` line are
	# driven by the verdict, not by whether there was anything to say:
	#
	#   tstale=1  -> "drift in <t>" + the notes + "fix: ..."   (unchanged)
	#   tstale=0 and notes -> "in sync  <t>" + the notes, and NO fix: line.
	#     oem-cdn is exactly this: two RENAMED adoptions, byte-identical,
	#     exit 0. It previously printed "drift in oem-cdn" and a fix: line
	#     whose command could not perform the repair.
	if [ "$tstale" -eq 1 ]; then
		echo "drift in $t"
		echo -n "$out"
		echo "  fix: $SRC/scripts/install.sh $t"
	elif [ -n "$out" ]; then
		# In sync, with something worth saying: an adoption under a layout
		# the canonical MAP does not name. Renaming the header is the point
		# -- a reader must not have to know the exit code to know whether a
		# target drifted.
		echo "in sync  $t"
		echo -n "$out"
		echo "        (adoption under a renamed/embedded layout; nothing to fix."
		echo "         re-vendor with: $SRC/scripts/install.sh $t --embed-rename <dir>)"
	else
		echo "in sync  $t"
	fi
done

exit $stale
