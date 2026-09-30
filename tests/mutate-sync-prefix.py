#!/usr/bin/env python3
"""
Mutation harness for the drift checker's PREFIX DISCOVERY and the
RESERVED reserved-prefix check.

Two new claims got tests. A test nobody has tried to break is a guess, so
each mutation below must turn the suite RED. Per the repo's own rule, a
pattern that no longer matches the source is a NO-OP and is reported as a
FAILURE OF THE HARNESS, never as a pass.

Every mutation is trap-guarded: the file is copied to a backup, a trap
restores it on EXIT/INT/TERM, and the restore is byte-verified against a
pre-edit md5. An interrupted mutate-and-restore leaves the MUTANT as the
working tree, and `git status` plus a byte compare is the only way to know
which one you are looking at.

Usage: /root/.venvs/mau/bin/python tests/mutate-sync-prefix.py
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "check-design-sync.sh")
RUN_MJS = os.path.join(ROOT, "tests", "run.mjs")

NOOP = "NO-OP"
NAMED = "NAMED"
UNNAMED = "UNNAMED"
SURVIVED = "SURVIVED"

MUTATIONS = []


def mutation(name, path, old, new, expect_named=None, count=1):
    MUTATIONS.append(dict(name=name, path=path, old=old, new=new,
                          expect_named=expect_named, count=count))


# ---- 1. discovery: revert to the hardcoded src/ prefix -------------------
# This is the exact defect: only ever look for src/styles/cli-mono.
mutation(
    "discovery: only ever look for the canonical src/ prefix",
    SCRIPT,
    "[ -f \"$t/src/styles/cli-mono/components.css\" ] && { printf 'src'; return 0; }",
    "if [ -f \"$t/src/styles/cli-mono/components.css\" ]; then printf 'src'; return 0; fi; return 1",
    expect_named="nested (web/src)",
)

# ---- 2. discovery: bare-invocation scan gated on the old path -------------
# The audit's own loop shape. rpm is invisible to it.
mutation(
    "discovery: bare scan only tests src/styles/cli-mono",
    SCRIPT,
    'prefix_for "$(strip_slash "$d")" >/dev/null 2>&1 && targets+=("$(strip_slash "$d")")',
    '[ -d "$d/src/styles/cli-mono" ] && targets+=("$(strip_slash "$d")")',
)

# ---- 3. prefix_for: return 1 always (never discovers) -------------------
mutation(
    "discovery: prefix_for always fails",
    SCRIPT,
    "\t\t\tprintf '%s' \"${d%/cli-mono}\" | sed \"s|^$t/*||; s|/*\\$||; s|/styles\\$||\"\n\t\t\treturn 0",
    "\t\t\treturn 1",
)

# ---- 4. prefix_for: drop the /styles strip -----------------------------
# Yields web/src/styles, and the caller re-appends /styles -> MISSING on
# files that exist. This is the bug that bit the first version.
mutation(
    "discovery: return the path INCLUDING /styles",
    SCRIPT,
    "s|^$t/*||; s|/*\\$||; s|/styles\\$||",
    "s|^$t/*||; s|/*\\$||",
    expect_named="nested (web/src)",
)

# ---- 5. js prefix: assume repo-root src/js -----------------------------
mutation(
    "discovery: js half hardcoded to repo-root src/js",
    SCRIPT,
    'JP="$CP/js"',
    'JP="src/js"',
    expect_named="nested (web/src)",
)

# ---- 6. the child-combinator-free case: MISSING branch removed ---------
# If the "no file is missing" assertion is the only thing that notices,
# deleting the file entirely must still be caught.
mutation(
    "discovery: drop the /styles suffix rewrite entirely",
    SCRIPT,
    "\t\tcase \"$dest\" in\n\t\t\tsrc/styles/*) d=\"$t/${CP:-src}/styles/${dest#src/styles/}\" ;;",
    "\t\tcase \"$dest\" in\n\t\t\tsrc/styles/*) d=\"$t/src/styles/${dest#src/styles/}\" ;;",
    expect_named="nested (web/src)",
)

# ---- 7. RESERVED: never report -----------------------------------------
mutation(
    "reserved: reserved-prefix check disabled",
    SCRIPT,
    '\t\tif [ -n "$extra" ]; then',
    '\t\tif false; then',
    expect_named="RESERVED",
)

# ---- 8. RESERVED: strip comments before parsing ------------------------
# Without this, a class named in the library's PROSE is read as defined,
# which is the "somewhere else in the file mentions it" family.
mutation(
    "reserved: do not strip CSS comments before matching",
    SCRIPT,
    "css = re.sub(r'/\\*.*?\\*/', '', open(p).read(), flags=re.S)",
    "css = open(p).read()",
)

# ---- 9. RESERVED: compare basenames, not whole names --------------------
mutation(
    "reserved: match only the block prefix, so cm-x-y is treated as cm-x",
    SCRIPT,
    "rogue = sorted(n for n in con_names - lib_names)",
    "rogue = sorted({n.split('-')[0] + '-' + n.split('-')[1] if n.count('-') > 1 else n for n in con_names - lib_names})",
)


def run_suite():
    r = subprocess.run(["node", "tests/run.mjs"], cwd=ROOT,
                       capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def main():
    base_rc, base_out = run_suite()
    if base_rc != 0:
        print("REFUSING TO MUTATE: the suite is already red.")
        print(base_out[-2000:])
        return 2
    print(f"baseline: suite green ({base_out.strip().splitlines()[-1]})\n")

    # Snapshot the two files so a restore can be byte-verified.
    backup = tempfile.mkdtemp(prefix="mut-sync-")
    snaps = {}
    for m in MUTATIONS:
        f = m["path"]
        if f not in snaps:
            dst = os.path.join(backup, os.path.basename(f) + "." + str(len(snaps)))
            shutil.copy2(f, dst)
            snaps[f] = dst
    original = {f: md5(d) for f, d in snaps.items()}

    results = []
    restored_ok = True

    def restore():
        for f, d in snaps.items():
            shutil.copy2(d, f)

    try:
        for i, m in enumerate(MUTATIONS, 1):
            src = open(m["path"], encoding="utf8").read()
            n = src.count(m["old"])
            if n == 0:
                results.append((m["name"], NOOP, 0,
                                "pattern does not match the source - FIX THE HARNESS"))
                continue
            if n > m["count"]:
                results.append((m["name"], NOOP, n,
                                f"pattern is not unique ({n} occurrences) - scope it to its rule"))
                continue
            restore()
            mutated = src.replace(m["old"], m["new"], 1)
            assert mutated != src, "replacement was a no-op"
            open(m["path"], "w", encoding="utf8").write(mutated)
            if md5(m["path"]) == original[m["path"]]:
                results.append((m["name"], NOOP, 0, "mutation did not change the file"))
                continue
            rc, out = run_suite()
            if rc == 0:
                verdict = SURVIVED
                why = "suite stayed green - the test does not guard this"
            else:
                if m["expect_named"] and m["expect_named"] in out:
                    verdict = NAMED
                    why = "killed, with the expected message on the wire"
                else:
                    verdict = UNNAMED
                    why = "killed, but NOT by the check under test"
            results.append((m["name"], verdict, n, why))
            print(f"[{i}/{len(MUTATIONS)}] {verdict:8} {m['name']}")
    finally:
        restore()
        # A green suite proves a mutant died; it never proves the ORIGINAL
        # came back. Verify the restore by hash.
        for f, h in original.items():
            if md5(f) != h:
                restored_ok = False
                print(f"RESTORE FAILED for {f}")

    print("\n--- tally ---")
    counts = {}
    for name, verdict, n, why in results:
        counts[verdict] = counts.get(verdict, 0) + 1
        print(f"  {verdict:8} {name}")
        if verdict in (NOOP, SURVIVED, UNNAMED):
            print(f"           -> {why}")
    print(f"\n{counts}")
    print("restore verified byte-for-byte:", restored_ok)

    clean = counts.get(NOOP, 0) == 0 and counts.get(SURVIVED, 0) == 0
    shutil.rmtree(backup, ignore_errors=True)
    if not restored_ok or not clean:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
