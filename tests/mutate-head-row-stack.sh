#!/usr/bin/env bash
# Mutation-check the header-row stack fix in src/styles/components.css.
#
# THE DEFECT (measured, not inferred)
# `.cm-head-row__text` is `display: flex` in a ROW, holding a title and a
# section lede as siblings. In a row the lede sits BESIDE the title instead
# of under it. Measured in WebKit at 375px: the title's `min-width:
# min(100%, 12rem)` floor took 192px of a 295px column and left the lede 91px
# at x=244, 527px tall, wrapping one word per line. And because the column is
# `nowrap` with no clipping ancestor, the lede also overflowed to x=436 --
# a horizontal overflow on the showcase's own header.
#
# THE FIX is a `:has()` rule that makes the column a COLUMN only when it
# holds a lede, so a `.cm-head-row__text` holding just a badge and a title
# stays a row (measured: index 20 on the showcase, badge at left=40 and
# title at left=74).
#
# These mutations must each be caught by the WebKit probe. The probe is the
# oracle: it measures the RENDERED geometry, so it fails when the title and
# lede stop stacking or when anything overflows the viewport again.
set -uo pipefail
cd "$(dirname "$0")/.."
F=src/styles/components.css

# Measured by hand, so the harness does not depend on a preview being up:
# the probe needs a served page and a WebKit build. If it is not reachable,
# say so and skip rather than report a green run that proved nothing.
URL=http://192.168.1.68:4321/
if ! curl -sf -o /dev/null "$URL"; then
  echo "skip: $URL is not serving -- start the preview, this harness needs a real page"
  exit 0
fi

BAK=$(mktemp); cp "$F" "$BAK"
cleanup() { cp "$BAK" "$F"; rm -f "$BAK"; }
trap cleanup EXIT

KILLED=0; NOOP=0; TOTAL=0; FAILING=""

# The probe must be GREEN before a mutation means anything. A sweep run
# against an already-broken tree reports five kills that are all the same
# pre-existing failure.
if ! /root/.venvs/mau/bin/python tests/verify-showcase-nowrap-webkit.py >/tmp/base.$$ 2>&1; then
  echo "PREFLIGHT FAILED -- the probe is red before any mutation:"
  sed 's/^/  /' /tmp/base.$$
  rm -f /tmp/base.$$
  exit 1
fi
echo "preflight: probe green on the unmutated source"

mutate() {
  local name="$1" from="$2" to="$3"
  TOTAL=$((TOTAL+1))
  cp "$BAK" "$F"
  if ! grep -qF -- "$from" "$F"; then
    echo "  NO-OP  $name  (pattern not present -- fix the mutation)"
    NOOP=$((NOOP+1)); return
  fi
  python3 - "$F" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
if a not in s:
    sys.exit(3)
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
  # The probe measures the SERVED page, so the mutation has to be built.
  if ! npm run build >/dev/null 2>&1; then
    # A build failure is the strongest kill available, not a no-op.
    echo "  KILLED  $name  [the mutation does not compile]"
    KILLED=$((KILLED+1)); cp "$BAK" "$F"; npm run build >/dev/null 2>&1; return
  fi
  if /root/.venvs/mau/bin/python tests/verify-showcase-nowrap-webkit.py >/tmp/mut.$$ 2>&1; then
    echo "  SURVIVED  $name  <-- the probe does not detect this"
    FAILING="$FAILING
    - $name"
  else
    echo "  KILLED  $name  [detected: $(grep -m2 '^  - ' /tmp/mut.$$ | head -2 | sed 's/^  - //' | tr '\n' ';')]"
    KILLED=$((KILLED+1))
  fi
  cp "$BAK" "$F"
  npm run build >/dev/null 2>&1
}

# 1. Delete the whole rule: the title and lede go back to sitting side by side,
#    and the lede overflows the column again. This IS the bug.
mutate "the :has() column rule is deleted" \
  '.cm-head-row__text:has(> .cm-section__sub),' \
  '.cm-head-row__text:has(> .cm-section__sub-DEL),'

# 2. Keep the rule but ignore the lede: `column` never applies.
mutate "the rule is scoped to a child that never exists" \
  ':has(> .cm-section__sub)' \
  ':has(> .cm-section__subs)'

# 3. Inert value: the property is DECLARED, so a value-shaped grep matches
#    it, but `row` is what it already was.
mutate "the rule declares row, the value it replaced" \
  '	flex-direction: column;
	align-items: flex-start;' \
  '	flex-direction: row;
	align-items: center;'

# 4. The column without the alignment: the lede centres instead of starting
#    at the title's left edge, so the two no longer read as one block.
mutate "align-items is left alone" \
  '	flex-direction: column;
	align-items: flex-start;' \
  '	flex-direction: column;'

cp "$BAK" "$F"
npm run build >/dev/null 2>&1
rm -f /tmp/mut.$$ /tmp/base.$$
echo
echo "mutations: $TOTAL   killed: $KILLED   no-op: $NOOP"
if [ -n "$FAILING" ]; then
  echo "SURVIVORS (the probe is too weak):$FAILING"
  exit 1
fi
[ "$NOOP" -eq 0 ] || exit 1
[ "$KILLED" -eq "$TOTAL" ] || exit 1
echo "every mutation was killed by the measured geometry"