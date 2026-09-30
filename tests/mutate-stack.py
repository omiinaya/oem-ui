#!/usr/bin/env python3
"""Mutation-check the record-stack contract.

The increment is one class, so the mutations target the three claims the
contract actually makes: it is a COLUMN, its gap is off the scale, and it
is OPT-IN (a list that did not ask for a stack is still flush).

Each mutation edits the library source in a temp copy, runs the real
suite, and must be caught. A survivor is a broken transfer.

Run from /root/projects/oem-ui:  /root/.venvs/mau/bin/python tests/mutate-stack.py
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LIB = Path('/root/projects/oem-ui').resolve()
CSS = LIB / 'src/styles/components.css'
VENV = '/root/.venvs/mau/bin/python'

# (label, original, replacement, the check that must fail)
MUTANTS = [
    (
        'the stack becomes a row',
        'flex-direction: column;',
        'flex-direction: row;',
        'a stack whose flex-direction is not column lays records out in a ROW',
    ),
    (
        'the gap is a hardcoded rem',
        'gap: var(--space-2);',
        'gap: 0.5rem;',
        'the gap must come off the spacing scale',
    ),
    (
        'the gap is zero - a stack with no air',
        'gap: var(--space-2);',
        'gap: 0;',
        'the gap must come off the spacing scale',
    ),
    (
        # The opt-in claim. Renaming .cm-stack to .cm-rows.cm-stack is NOT a
        # break - it renders identically, so it is not a mutant. The real
        # break is a rule that reaches a plain <ul class="cm-rows"> that
        # never asked to be stacked.
        'a stacked list reaches a plain .cm-rows too',
        '.cm-stack {',
        '.cm-stack, .cm-rows {',
        'the stack rule also targets a plain .cm-rows list',
    ),
    (
        '.cm-rows grows the gap, spacing every list',
        '.cm-rows { list-style: none; margin: 0; padding: 0; }',
        '.cm-rows { list-style: none; margin: 0; padding: 0; gap: var(--space-2); }',
        'reaches a list that never asked for a stack; it carries a gap',
    ),
]


def run_suite(cwd):
    r = subprocess.run([VENV, '-c',
                        'import subprocess,re,sys;'
                        'r=subprocess.run(["node","tests/run.mjs"],capture_output=True,text=True);'
                        'print(re.sub(r"\\x1b\\[[0-9;]*m","",r.stdout+r.stderr))'],
                       cwd=cwd, capture_output=True, text=True, timeout=900)
    return re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)


def main():
    baseline = run_suite(LIB)
    m = re.search(r'(\d+) passed, (\d+) failed', baseline)
    if not m or m.group(2) != '0' or int(m.group(1)) == 0:
        print('ABORT - no clean baseline:\n' + baseline[-600:])
        return 1
    base_n = int(m.group(1))
    print(f'baseline: {base_n} passed, 0 failed\n')

    killed = 0
    for label, old, new, claim in MUTANTS:
        src = CSS.read_text()
        # Scope the edit to the rule that owns the claim. An unscoped
        # replace hits whichever rule comes first in the file - which is
        # how a mutant gets killed by a NEIGHBOURING guard and the run
        # reports success for entirely the wrong reason.
        start = src.index('.cm-stack {')
        end = src.index('.cm-auth {')
        # A mutant about .cm-rows is not about .cm-stack; scope each edit
        # to the rule its claim actually names, not to the stack block.
        scope = src if old.startswith('.cm-rows') else src[start:end]
        if old not in scope:
            print(f'  SURVIVED  {label}\n            (anchor not in scope - the mutation never landed)')
            continue
        mutated = (scope.replace(old, new, 1) if scope is src
                   else src[:start] + scope.replace(old, new, 1) + src[end:])
        tmp = Path(tempfile.mkdtemp())
        try:
            # The repo root contains a self-referential `oem-ui` symlink
            # (an NFS artefact): copytree follows it and never terminates,
            # so symlinks are copied AS symlinks, never followed.
            # `dist` MUST come along - several contract checks read the
            # BUILT page, and dropping it turns the run into a wall of
            # unrelated failures that hide which claim actually fired.
            dst = tmp / 'lib'
            shutil.copytree(LIB, dst, ignore=shutil.ignore_patterns(
                'node_modules', '.git', 'oem-ui', '.astro'), symlinks=True)
            (tmp / 'lib/src/styles/components.css').write_text(mutated)
            out = run_suite(tmp / 'lib')
            m = re.search(r'(\d+) passed, (\d+) failed', out)
            if m and int(m.group(2)) > 0 and claim in out:
                print(f'  killed    {label}\n            on its own claim: "{claim[:66]}"')
                killed += 1
            elif m and int(m.group(2)) == 0:
                print(f'  SURVIVED  {label}  (suite still {m.group(1)}/0)')
            else:
                print(f'  WRONG CLAIM  {label}\n            died, but not on "{claim[:40]}"')
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    print(f'\n{killed}/{len(MUTANTS)} killed, each on its own claim')
    return 0 if killed == len(MUTANTS) else 1


if __name__ == '__main__':
    sys.exit(main())
