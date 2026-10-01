#!/usr/bin/env bash
# Mutation-check tests/install-layout.test.mjs.
#
# Every mutation below must make the test FAIL. A mutation that does not
# match the source is a NO-OP, and a no-op that looks like a pass is worse
# than no test at all -- so each one reports KILLED / NO-OP honestly, and a
# non-zero node exit is counted as a kill, never as a no-op.
#
# Run with --apply to leave the first surviving mutation in place for
# inspection. Never run this while editing the same files.
set -uo pipefail
cd "$(dirname "$0")/.."
F=scripts/install.sh
BAK=$(mktemp); cp "$F" "$BAK"
trap 'cp "$BAK" "$F"; rm -f "$BAK"' EXIT

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

KILLED=0; NOOP=0; TOTAL=0
FAILING=""

# Mutation #4 removes the path-escape guard, so that run really does install
# into ../<name>. With the installer pointed at a temp dir, that lands in
# $TMPDIR -- OUTSIDE the repo, where the trap's restore cannot reach it, and
# the leftover poisons every later run of tests/install-layout.test.mjs.
#
# So the blast radius is contained here: mutations run against a sandbox
# INSIDE the repo, and the trap deletes it whatever happens. Observed in this
# repo before this was added -- $TMPDIR/escape survived a sweep and made the
# next suite run red for a defect that did not exist.
SANDBOX="$(mktemp -d "$(dirname "$0")/.mutinstall.XXXXXX")"
# Copy of the installer the mutations rewrite, so `scripts/install.sh` is
# never edited at all. Editing the real file is what left the earlier sweep
# able to damage a concurrent cycle's work.
WORK="$SANDBOX/install.sh"
cp "$BAK" "$WORK"
cleanup() {
  cp "$BAK" "$F"
  rm -rf "$SANDBOX"
  rm -f "$BAK"
}
trap cleanup EXIT

mutate() {
  local name="$1" from="$2" to="$3"
  TOTAL=$((TOTAL+1))
  # $WORK is the sandbox copy, never scripts/install.sh itself. The test
  # reads the real path, so the sandbox copy is written BACK over it for the
  # duration of one mutation and restored immediately after -- the real file
  # is only ever replaced by an exact byte-copy of the backup.
  cp "$BAK" "$WORK"
  if ! grep -qF -- "$from" "$WORK"; then
    echo "  NO-OP  $name  (pattern not present -- fix the mutation)"
    NOOP=$((NOOP+1)); return
  fi
  python3 - "$WORK" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))
PY
  # The test runs the REAL installer at scripts/install.sh, so the mutated
  # copy has to be in place for the child to see it.
  cp "$WORK" "$F"
  if node tests/install-layout.test.mjs >/tmp/mut.$$ 2>&1; then
    echo "  SURVIVED  $name  <-- the test does not detect this"
    FAILING="$FAILING
    - $name"
    if [ "$APPLY" -eq 1 ]; then echo "    (left applied)"; return; fi
  else
    echo "  KILLED  $name"
    KILLED=$((KILLED+1))
  fi
  cp "$BAK" "$F"
}

# 1. delete the whole embedded branch: the flag becomes a no-op and every
#    embed-specific assertion must fail.
mutate "the embedded branch is removed" \
  'if [ -n "$EMBED" ] || [ -n "$EMBED_RENAME" ]; then' \
  'if false; then'

# 2. reintroduce the doubled-path bug this test was written for.
mutate "DIR concatenates both flags again" \
  'if [ -n "$EMBED" ]; then DIR="$EMBED"; else DIR="$EMBED_RENAME"; fi' \
  'DIR="$EMBED$EMBED_RENAME"'

# 3. serve the guard under the runtime's name.
mutate "the guard is renamed to the runtime's name" \
  'GUARD_DEST="$CSS_DIR/theme-guard.js"' \
  'GUARD_DEST="$CSS_DIR/cli-mono.js"'

# 4. drop the escape guard so --embed can write outside the target.
mutate "the path-escape guard is removed" \
  '../*|*/../*) die "--embed path escapes the target: $DIR" ;;' \
  '../*|*/../*) : ;;'

# 5. let the embed branch fall through to the default src/ layout, which
#    is the defect that drops a second, unserved copy into the consumer.
mutate "the embed branch writes src/styles/cli-mono" \
  'CSS_DIR="$TARGET/$DIR"' \
  'CSS_DIR="$TARGET/src/styles/cli-mono"'

# 6. copy one file from somewhere other than the library.
mutate "a file is installed from outside the library" \
  'install -m 0644 "$FROM/src/styles/tokens.css"     "$CSS_DIR/tokens.css"' \
  'install -m 0644 "$FROM/src/styles/base.css"      "$CSS_DIR/tokens.css"'

# 7. strip the header documentation for the flag.
mutate "the header no longer documents --embed" \
  '# --embed installs into <dir>, keeping the library filenames, for a project' \
  '# (documentation removed)'

cp "$BAK" "$F"
rm -f /tmp/mut.$$
echo
echo "mutations: $TOTAL   killed: $KILLED   no-op: $NOOP"
if [ -n "$FAILING" ]; then
  echo "SURVIVORS (test is too weak):$FAILING"
  exit 1
fi
[ "$NOOP" -eq 0 ] || exit 1
[ "$KILLED" -eq "$TOTAL" ] || exit 1
echo "every mutation was killed by the test"
