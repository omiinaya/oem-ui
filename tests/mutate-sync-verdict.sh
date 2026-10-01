#!/usr/bin/env bash
# Mutation-check the checker's VERDICT split (scripts/check-design-sync.sh).
#
# The defect: the header and the `fix:` line were driven by "was there any
# output at all" rather than by the verdict. The RENAMED verdict is ADOPTION
# and does not set `stale`, so a byte-identical consumer exited 0 while its
# output read "drift in <target>" plus a `fix:` command that could not perform
# the repair -- following it wrote a second, unserved copy.
#
# These mutations are proven against REAL consumers on this host:
#   /root/projects/oem-cdn   adoption-only  -> must say "in sync", no fix:
#   /root/projects/dev-blog genuinely drifted -> must still say "drift in" + fix:
#
# A harness that cannot count its own kills is not measuring, so the summary
# is derived from the same counters the verdicts increment, and a mutation
# whose pattern does not match the source is a NO-OP, never a pass.
set -uo pipefail
cd "$(dirname "$0")/.."
F=scripts/check-design-sync.sh
ADOPT=/root/projects/oem-cdn
STALE=/root/projects/dev-blog

[ -d "$ADOPT" ] || { echo "skip: $ADOPT not present on this host"; exit 0; }
[ -d "$STALE" ] || { echo "skip: $STALE not present on this host"; exit 0; }

BAK=$(mktemp); cp "$F" "$BAK"
cleanup() { cp "$BAK" "$F"; rm -f "$BAK"; }
trap cleanup EXIT

KILLED=0; NOOP=0; TOTAL=0; FAILING=""

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
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY

  # The contract, in the WORDS the tool prints. A consumer that only drifted
  # must be called drift; an adoption-only one must not be, and must not be
  # handed a fix: line.
  local bad=""
  adopt_out="$(bash scripts/check-design-sync.sh "$ADOPT" 2>&1)"; adopt_rc=$?
  stale_out="$(bash scripts/check-design-sync.sh "$STALE" 2>&1)"; stale_rc=$?

  grep -q '^drift in ' <<<"$adopt_out" && bad+=" adoption-only consumer labelled 'drift in'"
  grep -q '^  fix: '  <<<"$adopt_out" && bad+=" adoption-only consumer given a fix: line"
  grep -q '^in sync '  <<<"$adopt_out" || bad+=" adoption-only consumer not reported in sync"
  [ "$adopt_rc" -eq 0 ] || bad+=" adoption-only consumer exits $adopt_rc"

  grep -q '^drift in ' <<<"$stale_out" || bad+=" genuinely drifted consumer NOT labelled 'drift in'"
  grep -q '^  fix: '   <<<"$stale_out" || bad+=" genuinely drifted consumer got no fix: line"
  [ "$stale_rc" -eq 1 ] || bad+=" genuinely drifted consumer exits $stale_rc, not 1"

  if [ -z "$bad" ]; then
    echo "  SURVIVED  $name  <-- the suite does not detect this"
    FAILING="$FAILING
    - $name ($bad)"
  else
    echo "  KILLED  $name  [detected: ${bad# }]"
    KILLED=$((KILLED+1))
  fi
  cp "$BAK" "$F"
}

# 1. Back to the original bug: the header follows any output, not the verdict.
#    This is the exact regression the split removed, so it MUST die.
mutate "the verdict split is reverted (header follows any output)" \
  'if [ "$tstale" -eq 1 ]; then' \
  'if [ -n "$out" ]; then'

# 2. Only fix the FIRST half: keep the honest header but still print the
#    unperformable remedy for an adoption-only consumer.
mutate "the fix: line is printed whenever there is output" \
  'elif [ -n "$out" ]; then' \
  'elif false; then'

# 3. Make the ADOPTION verdict a finding. This is the false-drift bug's twin:
#    a byte-identical renamed consumer is now called drift and handed a
#    remedy that cannot repair it. Same printed words, opposite cause.
#    Anchored on the byte-identical `cmp`, which is the exact line that
#    separates adoption from drift.
mutate "the byte-identical RENAMED adoption counts as a finding" \
  '				if cmp -s "$s" "$t/$renamed"; then' \
  '				if cmp -s "$s" "$t/$renamed"; then tstale=1; :'

# 4. Break the per-target reset, so a drifting consumer labels every LATER
#    adoption-only consumer as drifting too. Order matters: stale first.
mutate "tstale is never reset per target" \
  '	tstale=0' \
  '	tstale=0; tstale=${tstale:-0}'

# 5. Drop the "no fix: for adoption" guarantee by making tstale sticky
#    across targets -- the false-drift bug's other direction.
mutate "the adoption branch is unreachable (falls into the drift branch)" \
  'elif [ -n "$out" ]; then' \
  'elif false && [ -n "$out" ]; then'

cp "$BAK" "$F"
echo
echo "mutations: $TOTAL   killed: $KILLED   no-op: $NOOP"
if [ -n "$FAILING" ]; then
  echo "SURVIVORS (the checker is too weak):$FAILING"
  exit 1
fi
[ "$NOOP" -eq 0 ] || exit 1
[ "$KILLED" -eq "$TOTAL" ] || exit 1
echo "every mutation was killed"