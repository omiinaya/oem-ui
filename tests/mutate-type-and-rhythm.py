"""Mutation proof for contract-type-and-rhythm.py.

Each mutation edits the REAL css, runs the guard, and requires it to
fail. A mutation that survives means the guard cannot see that defect -
which is precisely how the stat value stayed louder than its heading
while a literal-parsing guard read `undefined` and called it a pass.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LIB = Path('/root/projects/oem-ui/src/styles')
GUARD = Path('/root/projects/oem-ui/tests/contract-type-and-rhythm.py')
PY = '/root/.venvs/mau/bin/python'

MUTATIONS = [
    ('the type scale is gone (one step declared twice)',
     'tokens.css', lambda t: t.replace('--text-sm: 0.875rem;', '--text-sm: 1rem;')),

    ('a scale step is missing entirely',
     'tokens.css', lambda t: t.replace('\t--text-xs: 0.8125rem;\n', '')),

    ('the scale no longer descends',
     'tokens.css', lambda t: t.replace('--text-micro: 0.75rem;', '--text-micro: 2rem;')),

    ('the smallest step falls back under the 12px floor',
     'tokens.css', lambda t: t.replace('--text-micro: 0.75rem;', '--text-micro: 0.6rem;')),

    ('a component goes back to a raw rem literal',
     'components.css', lambda t: t.replace('font-size: var(--text-md);', 'font-size: 1.35rem;')),

    ('the stat value outshouts its heading again',
     'components.css', lambda t: t.replace(
         'font-size: var(--text);', 'font-size: var(--text-lg);')),

    ('body stops resolving the scale',
     'base.css', lambda t: t.replace('font-size: var(--text);', 'font-size: 16px;')),

    ('the rhythm collapses: gap back under the padding',
     'components.css', lambda t: t.replace('gap: var(--space-5);', 'gap: var(--space-1);')),

    ('the stack gap is a raw value, off the scale',
     'components.css', lambda t: t.replace('gap: var(--space-5);', 'gap: 8px;')),

    ('a FLOORED size goes back to a raw literal (the max() class)',
     'components.css', lambda t: t.replace(
         'font-size: max(var(--min-font), var(--text));',
         'font-size: max(var(--min-font), 1.35rem);')),

    ('the tile value outshouts its heading',
     'components.css', lambda t: t.replace(
         'font-size: max(var(--min-font), var(--text));',
         'font-size: max(var(--min-font), var(--text-md));')),
    ('a value equals its heading, leaving the order ambiguous',
     'components.css', lambda t: t.replace(
         'font-size: var(--text);', 'font-size: var(--text-md);')),

    ('the tight variant is deleted',
     'components.css', lambda t: t.replace('.cm-stack--tight { gap: var(--space-2); }', '')),
]


def run_guard():
    r = subprocess.run([PY, str(GUARD)], capture_output=True, text=True, timeout=90)
    return r.returncode


def main():
    base = subprocess.run([PY, str(GUARD)], capture_output=True, text=True, timeout=90)
    print(f'baseline: guard rc={base.returncode} (must be 0)')
    if base.returncode != 0:
        print(base.stdout[-1200:])
        print('the guard is already failing; fix it before trusting a mutation')
        return 2

    backups = {n: (LIB / n).read_text() for n in ('tokens.css', 'components.css', 'base.css')}
    killed, survivors = 0, []

    try:
        for name, fname, fn in MUTATIONS:
            mutated = fn(backups[fname])
            if mutated == backups[fname]:
                print(f'  SKIP   {name} (the mutation did not change anything)')
                survivors.append(name + ' [NO-OP MUTATION]')
                continue
            (LIB / fname).write_text(mutated)
            rc = run_guard()
            (LIB / fname).write_text(backups[fname])
            if rc != 0:
                print(f'  KILLED  {name}')
                killed += 1
            else:
                print(f'  SURVIVED  {name}')
                survivors.append(name)
    finally:
        for n, t in backups.items():
            (LIB / n).write_text(t)

    total = len(MUTATIONS)
    print(f'\n{killed}/{total} mutations killed')
    if survivors:
        print('SURVIVORS:')
        for s in survivors:
            print(f'   - {s}')
        return 1
    print('MUTATION PROOF PASS')
    return 0


sys.exit(main())
