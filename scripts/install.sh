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
#
# For a project that serves static files from elsewhere (a plain
# web/index.html, an mkdocs site), pass --flat to get them at the top level:
#
#   <target>/cli-mono/tokens.css  ...  <target>/cli-mono.js
#
# Idempotent: re-running overwrites with the current library.

set -euo pipefail

die() { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[32mok\033[0m    %s\n' "$*"; }

TARGET=""
FROM=""
FLAT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --flat) FLAT=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown flag: $1" ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || die "usage: install.sh <target-project-dir> [--from <oem-ui-path>] [--flat]"

# Default source: the checkout this script lives in, resolved through any
# symlinks so a parent directory that links a project tree still finds the
# real files.
if [ -z "$FROM" ]; then
  FROM="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
fi
[ -d "$FROM/src/styles" ] || die "not an oem-ui checkout: $FROM"

TARGET="$(mkdir -p "$TARGET" && cd "$TARGET" && pwd)"

if [ "$FLAT" -eq 1 ]; then
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

printf '\nLoad in this order (tokens, base, components), JS last:\n'
if [ "$FLAT" -eq 1 ]; then
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
fi
printf '\nStyle with the .cm-* classes; tokens are the contract.\n'
