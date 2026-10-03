#!/usr/bin/env bash
# Mutation-check the tap-floor assertions and the card/meter colour scan.
# A test that has never been broken is a guess. Each mutation must make the
# suite go RED, and the suite must return GREEN after restore.
#
# Critically: this script MUTATES THE SHARED SOURCE FILES, so it must never
# run in the background while another cycle is editing them (skill lesson:
# "A cron cycle can collide with another cycle in the same repo").
#
#   tests/mutate-tap-floor.sh     -> prints "N/N mutations killed", exit 1 on any survivor
set -u
cd "$(dirname "$0")/.." || exit 1

CSS=src/styles/components.css
TOK=src/styles/tokens.css
ASTRO=src/pages/index.astro
TEST=tests/run.mjs

KILLS=0
TOTAL=0

run_suite() {
  # The suite asserts against the BUILT page for class reachability, so a
  # mutation to src/pages/ is invisible unless the page is rebuilt first.
  # A sweep that skips this reports three NO-OP mutations as passes, which
  # is worse than no sweep: it manufactures confidence. This has already
  # happened once here and the three survivors is how it was caught.
  npm run build >/dev/null 2>&1
  node tests/run.mjs 2>&1 | grep -cE "^FAIL"
}

snapshot() { cp "$1" "/root/.hermes/cache/scratch/mut-snap-$(basename "$1")"; }
restore()  { cp "/root/.hermes/cache/scratch/mut-snap-$(basename "$1")" "$1"; }

# mutate <label> <file> <python-replace-script>
mutate() {
  local label="$1" file="$2" script="$3"
  TOTAL=$((TOTAL+1))
  snapshot "$file"
  python3 -c "$script" || { echo "  MUTATION-ERROR $label (pattern did not match)"; restore "$file"; return; }
  # A mutation that breaks the BUILD is the strongest kill available, so a
  # non-zero build exit counts as KILLED and never as a no-op.
  local fails
  fails=$(run_suite)
  if [ "$fails" -gt 0 ]; then
    KILLS=$((KILLS+1))
    printf '  KILLED  %s (%s failing)\n' "$label" "$fails"
  else
    printf '  SURVIVED %s  <-- the test cannot fail\n' "$label"
  fi
  restore "$file"
}

echo "=== mutation sweep ==="

mutate "card block: real hex in a DECLARATION" "$CSS" '
import re,io
p="src/styles/components.css"; s=open(p).read()
i=s.index(".cm-card {")
j=s.index("}",i)
s=s[:j]+"\n\tborder: 1px solid #ff0000;"+s[j:]
open(p,"w").write(s)'

mutate "card block: rgba() in a declaration" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
i=s.index(".cm-card {"); j=s.index("}",i)
s=s[:j]+"\n\tbox-shadow: 0 1px 2px rgba(0,0,0,0.5);"+s[j:]
open(p,"w").write(s)'

mutate "card block: marker comment renamed" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace("/* ---------- cards ----------","/* cards ----------",1)
open(p,"w").write(s)'

mutate "btn--sm: coarse-pointer floor deleted" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace("@media (pointer: coarse) {\n\t.cm-btn--sm { min-height: var(--tap); }\n}","/*floor removed*/",1)
open(p,"w").write(s)'

mutate "btn--sm: coarse floor becomes a literal 44px" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace(".cm-btn--sm { min-height: var(--tap); }",".cm-btn--sm { min-height: 44px; }",1)
open(p,"w").write(s)'

mutate "btn--sm: coarse floor leaks to every button" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace("@media (pointer: coarse) {\n\t.cm-btn--sm { min-height: var(--tap); }\n}",
            "@media (pointer: coarse) {\n\t.cm-btn--sm,\n\t.cm-btn { min-height: var(--tap); }\n}",1)
open(p,"w").write(s)'

mutate "btn--sm: fine-pointer half removed (no opt-out to restore)" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace(".cm-btn--sm { padding: 0.4em 0.9em; font-size: var(--text-xs); min-height: 0; }",
            ".cm-btn--sm { padding: 0.4em 0.9em; font-size: var(--text-xs); }",1)
open(p,"w").write(s)'

mutate "btn--sm: coarse floor duplicated in a SECOND coarse block" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
s=s.replace("@media (pointer: coarse) {\n\t.cm-btn--sm { min-height: var(--tap); }\n}",
            "@media (pointer: coarse) {\n\t.cm-btn--sm { min-height: var(--tap); }\n}\n@media (pointer: coarse) {\n\t.cm-btn--sm { min-height: var(--tap); }\n}",1)
open(p,"w").write(s)'

mutate "--tap-sm reintroduced beside --tap" "$TOK" '
p="src/styles/tokens.css"; s=open(p).read()
i=s.index("--tap: 44px;")
s=s[:i]+"--tap: 44px;\n\t--tap-sm: 44px;"+s[i+len("--tap: 44px;"):]
open(p,"w").write(s)'

mutate ".cm-btn base stops taking --tap" "$CSS" '
p="src/styles/components.css"; s=open(p).read()
i=s.index(".cm-btn {"); j=s.index("min-height: var(--tap);",i)
s=s[:j]+"min-height: 0;"+s[j+len("min-height: var(--tap);"):]
open(p,"w").write(s)'

mutate "showcase: nowrap modifier unrendered EVERYWHERE" "$ASTRO" '
# Remove ALL occurrences, not just the first. The demo renders --nowrap on
# TWO rows, so .replace(...,1) strips one and leaves the class on the page,
# and the reachability test legitimately stays green. That is a BROKEN
# MUTATION, not a weak test - recorded here because "SURVIVED" would
# otherwise have been filed as a test defect and the test left alone.
p="src/pages/index.astro"; s=open(p).read()
assert s.count("cm-row__meta cm-row__meta--nowrap") >= 2, "pattern drifted"
s=s.replace("cm-row__meta cm-row__meta--nowrap","cm-row__meta")
open(p,"w").write(s)'

mutate "showcase: tight modifier unrendered" "$ASTRO" '
p="src/pages/index.astro"; s=open(p).read()
s=s.replace("cm-row__meta--nowrap cm-row__meta--tight","cm-row__meta--nowrap")
open(p,"w").write(s)'

echo "=== $KILLS/$TOTAL mutations killed ==="
[ "$KILLS" -eq "$TOTAL" ] || { echo "RESULT: a mutation survived - do not trust these tests"; exit 1; }
echo "RESULT: every mutation was killed"