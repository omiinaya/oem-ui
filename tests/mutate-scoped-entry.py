#!/usr/bin/env python3
"""mutate-scoped-entry.py - prove each new contract can FAIL.

Every mutant is validated BEFORE the sweep runs: a pattern that does not
match is a loud error, never a silently-shrinking total. (Two earlier
harnesses reported "6 survived" from unparsable npm output, and one filed
a broken BUILD as a no-op - both looked like a green sweep.)

Kill counting and the summary come from the SAME list, and a suite that
cannot be parsed is an ERROR, not a pass.

Snapshot-and-restore with `cp`, never `git checkout`: this repo is edited
by concurrent cycles, and a checkout would revert THEIR work too.
"""
import pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path("/root/projects/oem-ui")
RUN = ROOT / "tests/run.mjs"
CHECKER = ROOT / "scripts/check-design-sync.sh"
GEN = ROOT / "scripts/make-scoped-entry.mjs"
TOKENS = ROOT / "src/styles/tokens.css"

MUTANTS = [
    # (name, target, pattern, replacement, which contract must fail)
    ("checker pass deleted",
     CHECKER, r"\t# ---- generated scoped entries -+\n(.*?\n)\tdone\n", "\tdone\n",
     "the fleet checker looks at generated scoped entries"),

    ("checker keyed on the FILENAME cm-scoped.css",
     CHECKER, r"grep -q 'make-scoped-entry\.mjs' \|\| continue", "grep -q 'cm-scoped.css' || continue",
     "the scoped-entry pass is keyed on CONTENT, not on a filename"),

    ("checker reimplements the generator instead of calling it",
     CHECKER, r'\$SRC/scripts/make-scoped-entry\.mjs', 'echo "$f"',
     "the scoped-entry pass delegates to the generator, never reimplements it"),

    ("checker hands the generator a project-root-relative path",
     CHECKER, r'--components "\$imp"', '--components styles/cli-mono/components.css',
     "a scoped entry is handed the components.css it actually IMPORTS"),

    ("checker stops reporting an unresolvable @import",
     CHECKER, r'out\+="  SCOPED.*?does not exist - PostCSS drops it silently"\$\'\\n\'\\\n', '',
     "a scoped entry importing a MISSING components.css fails loudly"),

    ("generator drops the whole z scale from the scoped entry",
     GEN, r"\tfor \(const \[n, v\] of scale\) \{", "\tfor (const [n, v] of scale) {\n\t\tif (n.startsWith('--z-')) continue;",
     "the scoped-entry generator emits EVERY z token, not a sample"),

    ("a z token consumed by a component is never declared",
     TOKENS, r"\t--z-toast: 200;", "",
     "every z-index token components.css consumes is declared in the scoped scale"),

    ("the z scale loses its ORDER (toast under the scrim)",
     TOKENS, r"\t--z-toast: 200;", "\t--z-toast: 5;",
     "the z scale is a single contiguous block in :root"),
]


def run_suite():
    r = subprocess.run(["node", str(RUN)], cwd=ROOT, capture_output=True, text=True)
    # vitest/node emit ANSI even when piped; strip before matching, and
    # search the WHOLE transcript (tail -6 once kept only a post-summary
    # notice and made 6 real kills read as 0).
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", r.stdout + r.stderr)
    return clean


def main():
    # Pre-flight every pattern. A miss is an ERROR, never a smaller run.
    bad = []
    for name, target, pat, _rep, _t in MUTANTS:
        text = target.read_text()
        if not re.search(pat, text, re.S):
            bad.append((name, target.name))
    if bad:
        print("PRE-FLIGHT FAILED - pattern absent, mutant would be a NO-OP:")
        for n, f in bad:
            print(f"   {n}  ({f})")
        return 2
    print(f"pre-flight: all {len(MUTANTS)} patterns matched\n")

    killed, survived, errors = [], [], []
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="mutate-scoped-"))

    for name, target, pat, rep, contract in MUTANTS:
        orig = target.read_text()
        bak = tmp / target.name
        shutil.copy2(target, bak)
        try:
            new, n = re.subn(pat, rep, orig, count=1, flags=re.S)
            assert n == 1, f"{name}: pattern matched {n} times, not 1"
            # The precondition: the mutation must actually LAND. A
            # `.replace(x, 1)` that hit a different rule than the one under
            # test is how a mutant survives its own test by construction.
            assert new != orig, f"{name}: substitution was a no-op"
            target.write_text(new)

            out = run_suite()
            if "passed," not in out and "failed" not in out:
                errors.append((name, "unreadable suite output"))
                print(f"ERROR  {name}: suite output unparsable")
                continue

            # The contract must be the one that fails, and it must FAIL.
            if re.search(rf"FAIL {re.escape(contract)}", out):
                killed.append(name)
                print(f"KILLED  {name}")
            else:
                survived.append(name)
                print(f"SURVIVED {name}")
                tail = [l for l in out.splitlines() if "FAIL" in l][:3]
                for t in tail:
                    print(f"        {t}")
        finally:
            shutil.copy2(bak, target)

    shutil.rmtree(tmp, ignore_errors=True)

    # Kill count and summary derive from the SAME lists.
    print()
    print(f"MUTANTS: {len(MUTANTS)}   KILLED: {len(killed)}   "
          f"SURVIVED: {len(survived)}   ERRORS: {len(errors)}")
    for n in survived:
        print(f"   survivor: {n}")
    for n, e in errors:
        print(f"   error: {n} - {e}")
    return 1 if survived or errors else 0


if __name__ == "__main__":
    sys.exit(main())