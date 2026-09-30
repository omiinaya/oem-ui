#!/usr/bin/env python3
"""
Mutation harness for the drift checker's PREFIX DISCOVERY and the
RESERVED reserved-prefix check.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "check-design-sync.sh")

NOOP = "NO-OP"
NAMED = "NAMED"
UNNAMED = "UNNAMED"
SURVIVED = "SURVIVED"

MUTATIONS = []


def mutation(name, path, old, new, expect_named=None):
    MUTATIONS.append(dict(name=name, path=path, old=old, new=new,
                          expect_named=expect_named))


mutation(
    "discovery: only ever look for the canonical src/ prefix",
    SCRIPT,
    '[ -f "$t/src/styles/cli-mono/components.css" ] && { printf \'src\'; return 0; }',
    'if [ -f "$t/src/styles/cli-mono/components.css" ]; then printf \'src\'; return 0; fi; return 1',
    expect_named="bare scan must FIND",
)

mutation(
    "discovery: bare scan only tests src/styles/cli-mono",
    SCRIPT,
    'prefix_for "$(strip_slash "$d")" >/dev/null 2>&1 && targets+=("$(strip_slash "$d")")',
    '[ -d "$d/src/styles/cli-mono" ] && targets+=("$(strip_slash "$d")")',
    expect_named="bare scan must FIND",
)

mutation(
    "discovery: prefix_for always fails",
    SCRIPT,
    "\t\t\tprintf '%s' \"${d%/cli-mono}\" | sed \"s|^$t/*||; s|/*\\$||; s|/styles\\$||\"\n\t\t\treturn 0",
    "\t\t\treturn 1",
    expect_named="bare scan must FIND",
)

mutation(
    "discovery: return the path INCLUDING /styles",
    SCRIPT,
    r"s|^$t/*||; s|/*\$||; s|/styles\$||",
    r"s|^$t/*||; s|/*\$||",
    expect_named="nested (web/src): a byte-identical consumer",
)

mutation(
    "discovery: js half hardcoded to repo-root src/js",
    SCRIPT,
    'JP="$CP/js"',
    'JP="src/js"',
    expect_named="nested (web/src): a byte-identical consumer",
)

mutation(
    "discovery: comparison hardcodes the src/ prefix",
    SCRIPT,
    "\t\tcase \"$dest\" in\n\t\t\tsrc/styles/*) d=\"$t/${CP:-src}/styles/${dest#src/styles/}\" ;;",
    "\t\tcase \"$dest\" in\n\t\t\tsrc/styles/*) d=\"$t/src/styles/${dest#src/styles/}\" ;;",
    expect_named="nested (web/src): a byte-identical consumer",
)

mutation(
    "reserved: reserved-prefix check disabled",
    SCRIPT,
    '\t\tif [ -n "$extra" ]; then',
    '\t\tif false; then',
    expect_named="RESERVED",
)

mutation(
    "reserved: do not strip CSS comments before matching",
    SCRIPT,
    "css = re.sub(r'/\\*.*?\\*/', '', open(p).read(), flags=re.S)",
    "css = open(p).read()",
    expect_named="nothing is rogue when the only difference is a comment",
)

mutation(
    "reserved: match only the block prefix, so cm-x-y is treated as cm-x",
    SCRIPT,
    "rogue = sorted(n for n in con_names - lib_names)",
    "rogue = sorted({n.split('-')[0] + '-' + n.split('-')[1] if n.count('-') > 1 else n for n in con_names - lib_names})",
    expect_named="offending class must be NAMED",
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

    # Every pattern must be UNIQUE before we mutate, or a mutation lands on
    # an unrelated line and proves nothing.
    #
    # This check ran OUTSIDE the try/finally in the first version, so its
    # early `return 2` skipped the restore and left the PREVIOUS run's
    # mutant sitting in the working tree - which then looked like someone
    # else's edit. A harness that can leave the repo in a state it never
    # measured is worse than no harness, so the pre-check now only decides
    # whether to proceed; the restore below always runs.
    bad_pattern = None
    for m in MUTATIONS:
        src = open(m["path"], encoding="utf8").read()
        n = src.count(m["old"])
        if n != 1:
            bad_pattern = f"{m['name']!r} matches {n} times, expected 1"
            break

    backup = tempfile.mkdtemp(prefix="mut-sync-")
    snaps = {}
    for m in MUTATIONS:
        f = m["path"]
        if f not in snaps:
            dst = os.path.join(backup, os.path.basename(f) + "." + str(len(snaps)))
            shutil.copy2(f, dst)
            snaps[f] = dst
    original = {f: md5(d) for f, d in snaps.items()}

    def restore():
        for f, d in snaps.items():
            shutil.copy2(d, f)

    results = []
    try:
        if bad_pattern:
            print(f"FIX THE HARNESS: {bad_pattern}")
            return 2
        for i, m in enumerate(MUTATIONS, 1):
            restore()
            src = open(m["path"], encoding="utf8").read()
            mutated = src.replace(m["old"], m["new"], 1)
            if mutated == src:
                results.append((m["name"], NOOP, "replacement was a no-op"))
                continue
            open(m["path"], "w", encoding="utf8").write(mutated)
            if md5(m["path"]) == original[m["path"]]:
                results.append((m["name"], NOOP, "mutation did not change the file"))
                continue
            rc, out = run_suite()
            if rc == 0:
                verdict = SURVIVED
            elif m["expect_named"] and m["expect_named"] in out:
                verdict = NAMED
            else:
                verdict = UNNAMED
            results.append((m["name"], verdict,
                            out[-400:] if verdict in (UNNAMED, SURVIVED) else ""))
            print(f"[{i}/{len(MUTATIONS)}] {verdict:8} {m['name']}")
    finally:
        restore()
        for f, h in original.items():
            if md5(f) != h:
                print(f"RESTORE FAILED for {f}")
                return 1

    print("\n--- tally ---")
    counts = {}
    for name, verdict, detail in results:
        counts[verdict] = counts.get(verdict, 0) + 1
        print(f"  {verdict:8} {name}")
        if verdict in (NOOP, SURVIVED, UNNAMED):
            print(f"           {detail.strip()[-300:]}")
    print(f"\n{counts}")
    print("restore verified byte-for-byte: True")

    shutil.rmtree(backup, ignore_errors=True)
    if counts.get(NOOP, 0) or counts.get(SURVIVED, 0) or counts.get(UNNAMED, 0):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
