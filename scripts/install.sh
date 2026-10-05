#!/usr/bin/env bash
# oem-ui installer — copies the design system into a target project.
#
# The repo is PRIVATE, so the raw.githubusercontent.com and npm paths in the
# README do not work for an anonymous consumer. Everything on this fleet is
# local, so the default source is a path on disk.
#
#   scripts/install.sh <target-project-dir> [--from <path-to-oem-ui>]
#
# Layout it creates (identical in every project, so paths never vary):
#
#   <target>/src/styles/cli-mono/tokens.css
#   <target>/src/styles/cli-mono/base.css
#   <target>/src/styles/cli-mono/components.css
#   <target>/src/js/cli-mono.js
#   <target>/src/js/cli-mono-theme-guard.js
#
# --astro additionally installs src/astro/ into the target:
#
#   <target>/src/astro/*.astro  +  <target>/src/astro/config.ts
#
# THE COMPONENTS ARE THE LARGEST PART OF THE LIBRARY, AND UNTIL THIS FLAG
# EXISTED NO DOCUMENTED INVOCATION COULD INSTALL THEM. The five files above
# are CSS and JS; every measured fix that matters to a consumer - the
# 18x44 tap floor on the header's icon link, the phone burger, the
# generated footer separator that cannot strand at the end of a wrapped
# line - lives in an .astro file. install.sh shipped the stylesheet that
# STYLES those components without ever shipping the components, so a
# consumer had no supported way to adopt them and hand-rolled a parallel
# implementation instead. That is not a preference, it is a measured
# regression, live in production at the time of writing:
#
#   links.oem.ngo emits its footer separators as ELEMENTS
#   (`<span class="dot">·</span>`) inside a `flex-wrap: wrap` row, which is
#   precisely the shape this library deleted in d2ec654. MEASURED in WebKit
#   against the LIVE site at 320/360/390/402/430 x {667,844}: a line
#   ENDS with a stranded `·` at 10 of 12 phone widths, and at 320x667 the
#   footer renders three lines for three fragments. Its header is equally
#   hand-rolled: the theme toggle measures 32x32 against the library's
#   44px floor, and the header carries NO .cm-* class at all, so the
#   library's scroll-spy and `[aria-current='page']` rules cannot see it.
#
# The drift checker could not name any of this. It compares the five
# vendored files byte-for-byte and they ARE in sync where they exist - the
# defect is in the files the checker never looks at, in a directory it
# does not know exists. A check that only verifies what it can see is
# green precisely when the divergence moved somewhere it cannot reach.
#
# So this flag closes the gap from BOTH ends: it makes the components
# installable, and check-design-sync.sh --astro names any consumer whose
# copy of a library component has drifted, which is the only way the next
# one gets caught before it reaches a phone.
#
# For a project that serves static files from elsewhere (a plain
# web/index.html, an mkdocs site), pass --flat to get them at the top level:
#
#   <target>/cli-mono/tokens.css  ...  <target>/cli-mono.js
#
# --public additionally installs the two JS files into <target>/public/ so a
# project can serve the runtime VERBATIM:
#
#   <target>/public/cli-mono.js
#   <target>/public/cli-mono-theme-guard.js
#
# --embed installs into <dir>, keeping the library filenames, for a project
# that compiles the assets INTO a binary or a non-Astro bundle rather than
# serving a tree:
#
#   --embed <dir>   ->  <dir>/tokens.css  <dir>/base.css  <dir>/components.css
#                        <dir>/cli-mono.js  <dir>/cli-mono-theme-guard.js
#
# --embed-rename <dir>  same, but the two JS files are RENAMED on the way in
# and the recommended <script> tags are printed with those names.
#
# That is a REAL shape, not a hypothetical: oem-cdn compiles its admin UI
# into the binary with include_str! and serves it from Rust routes NAMED
# `runtime.js` and `theme-guard.js`, so its vendored copy lives at
# web/oem-ui/{runtime.js,theme-guard.js}. Before this flag existed no
# documented invocation of this script could produce that path -- --flat puts
# the CSS in <target>/cli-mono/ and the JS at the top level, and the default
# and --public both assume src/ or public/.
#
# That matters because the drift checker follows CONTENT, so the renamed
# pair verifies against the same library bytes as every other layout, and
# because its remedy line is now performable for this shape:
#
#     fix: scripts/install.sh /root/projects/oem-cdn --embed-rename web/oem-ui
#
# Previously that line was a NO-OP for oem-cdn: it wrote five files into
# paths the project does not serve, left the drifted web/oem-ui/ copy
# untouched, and the next run reported the same finding. A remediation the
# tool cannot perform is worse than no remediation, because it converts a
# visible failure into a loop.
#
# NOTE the checker's `fix:` line does NOT append this flag for you. It prints
# the bare invocation, because the flag depends on a LAYOUT choice that only
# the consumer's author can make. check-design-sync.sh reports the layout a
# target actually uses (see its RENAMED lines) so the right flag is visible
# in the output, but the operator has to choose it. That is deliberate: a
# checker that guessed a layout would install a second, unserved copy.
#
# That is a real shape, not a preference. Astro TREATS <script src> as a
# bundler asset reference, and when the src is a variable it cannot resolve
# the tag is dropped from dist/ entirely while the HTML comment above it
# still ships - so the page looks wired up and has no runtime at all. The
# documented workaround is a copy in public/ loaded with is:inline, which
# means the project has to maintain a SECOND copy of the runtime by hand.
# It did, for three days, 140 lines behind, and the drift checker could not
# see it because it only compared src/js. This flag is how a consumer gets
# that copy from the library instead of from itself.
#
# Idempotent: re-running overwrites with the current library.

set -euo pipefail

die() { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[32mok\033[0m    %s\n' "$*"; }

TARGET=""
FROM=""
FLAT=0
PUBLIC=0
EMBED=""
EMBED_RENAME=""

ASTRO=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --flat) FLAT=1; shift ;;
    --public) PUBLIC=1; shift ;;
    --astro) ASTRO=1; shift ;;
    --embed) EMBED="${2:-}"; shift 2 ;;
    --embed-rename) EMBED_RENAME="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,110p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown flag: $1" ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || die "usage: install.sh <target-project-dir> [--from <oem-ui-path>] [--flat | --public | --astro | --embed <dir> | --embed-rename <dir>]"
[ -n "$EMBED" ] && [ -n "$EMBED_RENAME" ] && die "--embed and --embed-rename are alternatives, not a pair"

# Default source: the checkout this script lives in, resolved through any
# symlinks so a parent directory that links a project tree still finds the
# real files.
if [ -z "$FROM" ]; then
  FROM="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
fi
[ -d "$FROM/src/styles" ] || die "not an oem-ui checkout: $FROM"

TARGET="$(mkdir -p "$TARGET" && cd "$TARGET" && pwd)"

if [ -n "$EMBED" ] || [ -n "$EMBED_RENAME" ]; then
  # An EMBEDDED layout: the files go into <dir> under their own names, with
  # no src/ or public/ segment invented. `<dir>` is interpreted relative to
  # $TARGET, because the whole point is to reproduce a path inside the target
  # (`--embed web/oem-ui`), not to escape it.
  #
  # The two flags are alternatives, so exactly one of them is non-empty here
  # and DIR must be THAT one. Selecting with ${EMBED_RENAME:-$EMBED} appends
  # to $EMBED instead of choosing between them, so `--embed web/oem-ui`
  # wrote web/oem-uiweb/oem-ui -- a doubled path that still "succeeded".
  if [ -n "$EMBED" ]; then DIR="$EMBED"; else DIR="$EMBED_RENAME"; fi
  case "$DIR" in
    /*) die "--embed takes a path INSIDE the target, not an absolute one: $DIR" ;;
    ../*|*/../*) die "--embed path escapes the target: $DIR" ;;
  esac
  CSS_DIR="$TARGET/$DIR"
  JS_DEST="$CSS_DIR/cli-mono.js"
  GUARD_DEST="$CSS_DIR/cli-mono-theme-guard.js"
  mkdir -p "$CSS_DIR"
  if [ -n "$EMBED_RENAME" ]; then
    # The RENAMED shape: the two JS files keep the library's CONTENT but take
    # the name the host serves them under, so its routes/HTML keep working.
    # Content is what check-design-sync.sh follows, so this stays verifiable
    # against the same library bytes as every other layout.
    JS_DEST="$CSS_DIR/runtime.js"
    GUARD_DEST="$CSS_DIR/theme-guard.js"
  fi
elif [ "$FLAT" -eq 1 ]; then
  CSS_DIR="$TARGET/cli-mono"
  JS_DEST="$TARGET/cli-mono.js"
  GUARD_DEST="$TARGET/cli-mono-theme-guard.js"
  mkdir -p "$CSS_DIR"
else
  CSS_DIR="$TARGET/src/styles/cli-mono"
  JS_DEST="$TARGET/src/js/cli-mono.js"
  GUARD_DEST="$TARGET/src/js/cli-mono-theme-guard.js"
  mkdir -p "$CSS_DIR" "$(dirname "$JS_DEST")"
fi

install -m 0644 "$FROM/src/styles/tokens.css"     "$CSS_DIR/tokens.css"
install -m 0644 "$FROM/src/styles/base.css"       "$CSS_DIR/base.css"
install -m 0644 "$FROM/src/styles/components.css" "$CSS_DIR/components.css"
install -m 0644 "$FROM/src/js/cli-mono.js"        "$JS_DEST"
install -m 0644 "$FROM/src/js/cli-mono-theme-guard.js" "$GUARD_DEST"

say "tokens.css     -> $CSS_DIR/tokens.css"
say "base.css       -> $CSS_DIR/base.css"
say "components.css -> $CSS_DIR/components.css"
say "cli-mono.js    -> $JS_DEST"
say "guard          -> $GUARD_DEST"

# --astro: the COMPONENTS. Additive, so it composes with every layout above
# rather than being a seventh competing shape.
#
# It installs .astro files but NOT config.ts over an existing one, and that
# asymmetry is deliberate. A component copy is a VENDORED artifact: the
# consumer is expected to re-sync it and never edit it, so overwriting is
# correct and drift is a bug. config.ts is the opposite - it is the one
# file the consumer OWNS and edits with its own title, author and email,
# so overwriting it would silently republish the library's placeholder
# identity over a real site. A consumer that has not adopted it gets a
# fresh copy, because there is nothing there to destroy.
#
# Skipping config.ts is not silent either: it is reported on stdout by name,
# so "the installer ran" never reads as "the installer overwrote my site".
ASTRO_DEST=""
if [ "$ASTRO" -eq 1 ]; then
  ASTRO_DEST="$TARGET/src/astro"
  [ -d "$FROM/src/astro" ] || die "this checkout has no src/astro to install"
  mkdir -p "$ASTRO_DEST"
  # Everything the library ships: every .astro AND every .ts in src/astro.
  #
  # Driven by the directory, NOT by a second hand-kept list, so a component
  # added to the library cannot reach a consumer without a test asserting it
  # exists (CodeBlock.astro did exactly that until this flag existed).
  #
  # The .ts glob is the fix for a bug that shipped in the very release that
  # added the shared current-page matcher. `src/astro/current.ts` is imported
  # by BOTH Header.astro and HeaderLink.astro, and this loop matched `*.astro
  # config.ts` only - so the two components were installed WITHOUT the module
  # they import. `ls` exits 0, the install "succeeded", and check-design-sync
  # reported the consumer IN SYNC.
  #
  # The build stayed green too, for the worst possible reason: the two files
  # that fail to resolve are only compiled if a consumer imports them, so a
  # site that had not yet adopted the header (as links.oem.ngo had not) saw
  # nothing at all. The library's flagship component - the one carrying the
  # 18x44 tap floor and the phone burger - was uninstallable in practice, and
  # every green signal agreed it was fine.
  #
  # So .ts is installed unconditionally alongside .astro. config.ts is still
  # singled out below, because it is the one file the consumer OWNS.
  for f in $(cd "$FROM/src/astro" && ls *.astro *.ts 2>/dev/null | sort -u); do
    if [ "$f" = "config.ts" ] && [ -f "$ASTRO_DEST/$f" ]; then
      say "config.ts     -> $ASTRO_DEST/config.ts (KEPT - the consumer owns its site identity)"
      continue
    fi
    install -m 0644 "$FROM/src/astro/$f" "$ASTRO_DEST/$f"
    say "$(printf '%-14s' "$f") -> $ASTRO_DEST/$f"
  done
fi

# --public: the verbatim-serve copy. Kept INSIDE this script on purpose - if
# it lived in a README, every consumer would hand-maintain it and drift,
# which is the failure this flag exists to remove. Both files come from the
# same $FROM, so they cannot disagree with each other or with src/js.
if [ "$PUBLIC" -eq 1 ]; then
	mkdir -p "$TARGET/public"
	install -m 0644 "$FROM/src/js/cli-mono.js"            "$TARGET/public/cli-mono.js"
	install -m 0644 "$FROM/src/js/cli-mono-theme-guard.js" "$TARGET/public/cli-mono-theme-guard.js"
	say "cli-mono.js    -> $TARGET/public/cli-mono.js (verbatim serve)"
	say "guard          -> $TARGET/public/cli-mono-theme-guard.js (verbatim serve)"
fi

printf '\nLoad in this order (tokens, base, components), JS last:\n'
if [ -n "$EMBED" ] || [ -n "$EMBED_RENAME" ]; then
  printf '  <link rel="stylesheet" href="%s/tokens.css" />\n' "$DIR"
  printf '  <link rel="stylesheet" href="%s/base.css" />\n' "$DIR"
  printf '  <link rel="stylesheet" href="%s/components.css" />\n' "$DIR"
  printf '  <script src="%s/%s"></script>\n' "$DIR" "$(basename "$JS_DEST")"
  printf '  and FIRST in <head>, before any stylesheet:\n'
  printf '  <script src="%s/%s"></script>\n' "$DIR" "$(basename "$GUARD_DEST")"
  printf '\nThese files are compiled into your binary or bundle. Serve them\n'
  printf 'verbatim under the paths above; do not edit them in place - re-run\n'
  printf 'this script to pick up a library update.\n'
elif [ "$FLAT" -eq 1 ]; then
  printf '  <link rel="stylesheet" href="/cli-mono/tokens.css" />\n'
  printf '  <link rel="stylesheet" href="/cli-mono/base.css" />\n'
  printf '  <link rel="stylesheet" href="/cli-mono/components.css" />\n'
  printf '  <script src="/cli-mono.js"></script>\n'
  printf '  and FIRST in <head>, before any stylesheet:\n'
  printf '  <script src="/cli-mono-theme-guard.js"></script>\n'
else
  printf '  <link rel="stylesheet" href="/src/styles/cli-mono/tokens.css" />\n'
  printf '  <link rel="stylesheet" href="/src/styles/cli-mono/base.css" />\n'
  printf '  <link rel="stylesheet" href="/src/styles/cli-mono/components.css" />\n'
  printf '  <script src="/src/js/cli-mono.js"></script>\n'
  printf '  and FIRST in <head>, before any stylesheet (Astro: ?raw import):\n'
  printf '  import guard from "../js/cli-mono-theme-guard.js?raw";\n'
  printf '  <script is:inline set:html={guard} />\n'
  if [ "$PUBLIC" -eq 1 ]; then
    printf '\nThis copy is ALSO in public/, to be served verbatim (Astro needs\n'
    printf 'is:inline, or a variable src is dropped from dist/ entirely):\n'
    printf '  const base = import.meta.env.BASE_URL;   // never a leading /\n'
    printf '  <script is:inline src={base + "cli-mono.js"}></script>\n'
    printf 'check-design-sync.sh now compares BOTH copies, so neither can drift.\n'
  fi
fi
if [ "$ASTRO" -eq 1 ]; then
  printf '\nAstro components -> %s\n' "$ASTRO_DEST"
  printf '  import Header from "../astro/Header.astro";   // default export\n'
  printf 'A component copy is VENDORED: do not edit it in place, re-run this\n'
  printf 'script to pick up a library fix. config.ts is yours to edit.\n'
fi
printf '\nStyle with the .cm-* classes; tokens are the contract.\n'
