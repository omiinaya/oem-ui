#!/usr/bin/env bash
# Mutation-check the checker's VERDICT split (scripts/check-design-sync.sh).
#
# THE DEFECT
# The `drift in <target>` header and the `fix:` line were driven by "was
# there any output at all" rather than by the VERDICT. The RENAMED verdict is
# ADOPTION and does not set `stale`, so a byte-identical consumer exited 0
# while its own output read:
#
#     drift in /root/projects/oem-cdn
#     RENAMED ... (adoption, not drift)
#     fix: scripts/install.sh /root/projects/oem-cdn
#
# i.e. the exit code said clean and the text said drift, and the one command
# offered could not perform the repair -- it writes the canonical src/ layout,
# which such a project does not serve, so following it adds a second, unserved
# copy and the next run reports the same thing.
#
# HERMETIC FIXTURES, NOT LIVE CONSUMERS
# The first version of this harness pointed at /root/projects/oem-cdn and
# /root/projects/dev-blog. That was a measurement that could lie, and it did:
# those projects are edited by CONCURRENT runs of this same cron, so
# mid-sweep a re-vendor made oem-cdn genuinely STALE. Every mutation then
# "died" for the wrong reason -- the fixture's precondition (adoption-only)
# had been destroyed by someone else's work, not by the mutation. Five
# identical-looking kills, all of them noise.
#
# So both consumers are BUILT here, byte-for-byte, from this checkout, and
# nothing outside the sandbox is read. The run is reproducible no matter what
# another cycle is doing to a real project.
#
# A harness that cannot count its own kills is not measuring: the summary is
# derived from the same counter the verdicts increment, and a mutation whose
# pattern does not match the source is a NO-OP, never a pass.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
F=scripts/check-design-sync.sh

BAK=$(mktemp); cp "$F" "$BAK"
SANDBOX="$(mktemp -d "$ROOT/tests/.mutverdict.XXXXXX")"
cleanup() { cp "$BAK" "$F"; rm -rf "$SANDBOX" "$BAK"; }
trap cleanup EXIT

# ---- build the two consumers ------------------------------------------
# ADOPT: canonical CSS plus a RENAMED JS pair, all byte-identical to the
# library. Must be reported in sync, with no `fix:` line.
# DRIFT: same layout but one file deliberately left behind. Must be reported
# as drift, WITH a `fix:` line, and exit 1.
build_fixtures() {
  ADOPT="$SANDBOX/adopt"
  DRIFT="$SANDBOX/drift"
  local css=src/styles/cli-mono js=src/js f
  mkdir -p "$ADOPT/$css" "$ADOPT/$js" "$DRIFT/$css" "$DRIFT/$js"
  for f in tokens.css base.css components.css; do
    cp "src/styles/$f" "$ADOPT/$css/$f"
    cp "src/styles/$f" "$DRIFT/$css/$f"
  done
  cp src/js/cli-mono.js            "$ADOPT/$js/runtime.js"
  cp src/js/cli-mono-theme-guard.js "$ADOPT/$js/theme-guard.js"
  cp src/js/cli-mono.js            "$DRIFT/$js/cli-mono.js"
  cp src/js/cli-mono-theme-guard.js "$DRIFT/$js/cli-mono-theme-guard.js"
  printf '\n/* drifted copy */\n' >> "$DRIFT/$css/tokens.css"

  # Both consumers need a page that REFERENCES what they vendor. The
  # reachability scan greps for the filenames, so a tree with no HTML reports
  # every CSS file UNREACHABLE -- which is a correct finding about a
  # directory that no real project looks like, and it drowns the verdict
  # under test. A consumer is a vendored tree PLUS the page that loads it.
  #
  # The guard must be loaded in <head> and the CSS linked from it, because
  # that is the shape the scan looks for; loading the RENAMED runtime under
  # the name the project actually serves is the whole point of ADOPT.
  local head
  for head in "$ADOPT" "$DRIFT"; do
    mkdir -p "$head/src/pages"
    cat > "$head/src/pages/index.html" <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script src="/src/js/theme-guard.js"></script>
    <link rel="stylesheet" href="/src/styles/cli-mono/tokens.css" />
    <link rel="stylesheet" href="/src/styles/cli-mono/base.css" />
    <link rel="stylesheet" href="/src/styles/cli-mono/components.css" />
  </head>
  <body>
    <script src="/src/js/runtime.js"></script>
  </body>
</html>
HTML
  done
  # DRIFT is not renamed, so its page must name the canonical files.
  sed -i 's|theme-guard\.js|cli-mono-theme-guard.js|; s|runtime\.js|cli-mono.js|' \
    "$DRIFT/src/pages/index.html"
}
build_fixtures

# ---- the contract, asserted on the WORDS the tool prints ---------------
# Preflight: the fixtures must exercise both halves, or every mutation below
# "passes" for free. A harness whose own premise is broken reports nothing.
verify_fixtures() {
  local a d arc drc both bad=""
  a="$(bash scripts/check-design-sync.sh "$ADOPT" 2>&1)"; arc=$?
  d="$(bash scripts/check-design-sync.sh "$DRIFT" 2>&1)"; drc=$?
  grep -q '^in sync  ' <<<"$a"  || bad+=" [ADOPT alone is not 'in sync']"
  grep -q '^drift in ' <<<"$a"   && bad+=" [ADOPT alone reads 'drift in']"
  grep -q '^  fix: '   <<<"$a"   && bad+=" [ADOPT alone gets a fix: line]"
  [ "$arc" -eq 0 ]               || bad+=" [ADOPT alone exits $arc, not 0]"
  grep -q '^drift in ' <<<"$d"   || bad+=" [DRIFT is not 'drift in']"
  grep -q '^  fix: '   <<<"$d"   || bad+=" [DRIFT gets no fix: line]"
  [ "$drc" -eq 1 ]               || bad+=" [DRIFT exits $drc, not 1]"
  grep -q 'STALE'      <<<"$d"   || bad+=" [DRIFT reports no STALE file]"

  # The adoption detail must still be VISIBLE on an in-sync target. It is
  # the only thing that tells a reader this consumer's runtime is reached
  # under a name the canonical layout does not use, so silently dropping it
  # is a regression even though the verdict is unchanged -- and two mutations
  # that removed the branch entirely survived until this assertion existed.
  # Asserted on the RENAMED line specifically, not "some output": the fix:
  # hint may legitimately change, the finding may not disappear.
  grep -q '^  RENAMED  ' <<<"$a" \
    || bad+=" [ADOPT is in sync but the RENAMED adoption detail is NOT printed]"

  # The per-target reset is only observable when BOTH targets are checked in
  # ONE run, with the drifting one FIRST. Run separately they can never
  # interact, so a `tstale` that leaks across the loop is invisible -- three
  # mutations of this harness survived exactly that way before this line
  # existed. Order is the point: the leak propagates forwards, so ADOPT must
  # come after DRIFT to catch it.
  both="$(bash scripts/check-design-sync.sh "$DRIFT" "$ADOPT" 2>&1)"
  # Fixed-string match: $ADOPT is a mktemp path and must not be read as a
  # regex (`grep -q "^in sync  $ADOPT\$"` would break on the dots in the
  # random suffix, or worse match something else).
  grep -qxF "in sync  $ADOPT" <<<"$both" \
    || bad+=" [ADOPT after DRIFT in one run is not 'in sync' (tstale leaks across targets)]"
  local adopt_block
  adopt_block="$(awk -v t="in sync  $ADOPT" '
    $0 == t { grab = 1; next }
    grab && /^in sync |^drift in / { exit }
    grab { print }
  ' <<<"$both")"
  grep -q '^  fix: ' <<<"$adopt_block" \
    && bad+=" [ADOPT after DRIFT in one run gets a fix: line (stale leak)]"
  echo "$bad"
}

PRE="$(verify_fixtures | tr -d ' \n')"
if [ -n "$PRE" ]; then
  echo "FIXTURE BROKEN -- every result below would be meaningless:"
  echo "  $PRE"
  exit 1
fi
echo "fixtures verified: ADOPT reads 'in sync' (no fix:), DRIFT reads 'drift in' (fix:, exit 1)"
echo

KILLED=0; NOOP=0; TOTAL=0; FAILING=""

# A mutation is killed when the mutated checker no longer holds the invariant
# on the fixtures, so verify_fixtures() IS the oracle: a mutation that leaves
# every verdict intact is a SURVIVOR and says so. This is inverted relative
# to the usual shape, and deliberately -- the thing under test is a PAIR of
# verdicts that must not move.
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
  local bad
  bad="$(verify_fixtures | tr -d ' \n')"
  if [ -n "$bad" ]; then
    echo "  KILLED  $name  [verdict contract broken: $bad]"
    KILLED=$((KILLED+1))
  else
    echo "  SURVIVED  $name  <-- both verdicts unchanged; the check is too weak"
    FAILING="$FAILING
    - $name"
  fi
  cp "$BAK" "$F"
}

# 1. The original bug, verbatim: header follows output, not verdict.
mutate "the verdict split is reverted (header follows any output)" \
  'if [ "$tstale" -eq 1 ]; then' \
  'if [ -n "$out" ]; then'

# 2. Keep the honest header but restore the unperformable remedy for an
#    adoption-only consumer.
mutate "the fix: line is printed whenever there is output" \
  '	elif [ -n "$out" ]; then' \
  '	elif false; then'

# 3. Make the byte-identical RENAMED adoption count as a finding: the
#    false-drift bug's twin, same printed words, opposite cause.
mutate "the byte-identical RENAMED adoption counts as a finding" \
  '				if cmp -s "$s" "$t/$renamed"; then' \
  '				if cmp -s "$s" "$t/$renamed"; then tstale=1; :'

# 4. Break the per-target reset, so a drifting consumer labels every LATER
#    adoption-only consumer as drifting too.
mutate "tstale is never reset between targets" \
  '	tstale=0' \
  '	tstale=${tstale:-0}'

# 5. Make the adoption branch unreachable, dropping it into the drift branch.
mutate "the adoption branch is unreachable" \
  '	elif [ -n "$out" ]; then' \
  '	elif false && [ -n "$out" ]; then'

cp "$BAK" "$F"
echo
echo "mutations: $TOTAL   killed: $KILLED   no-op: $NOOP"
if [ -n "$FAILING" ]; then
  echo "SURVIVORS (the checker is too weak):$FAILING"
  exit 1
fi
[ "$NOOP" -eq 0 ] || exit 1
[ "$KILLED" -eq "$TOTAL" ] || exit 1
echo "every mutation broke the verdict contract and was killed"