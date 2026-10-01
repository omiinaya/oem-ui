"""Mutation proof for contract-header-shrink.py.

Each mutation edits the real CSS, runs the guard, and requires it to
FAIL. A mutation that survives means the guard cannot see that defect -
which is precisely what happened for real: the badge fix that caused
the collapse was added by a guard that only checked for the word
`flex`, so it blessed a layout that wrecked 22 headings.
"""
import pathlib
import shutil
import subprocess
import sys

CSS = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
GUARD = pathlib.Path('/root/projects/oem-ui/tests/contract-header-shrink.py')
BACKUP = pathlib.Path('/tmp/components.css.bak')

original = CSS.read_text()
shutil.copy2(CSS, BACKUP)

MUTATIONS = [
    # name, old, new - each must be caught by the guard
    ('revert to the bug: children get no shrink floor',
     'min-width: min(100%, 12rem);', 'min-width: 0;'),

    ('floor removed entirely',
     '\tflex: 0 1 auto;\n\tmin-width: min(100%, 12rem);', '\tflex: 1 1 auto;'),

    ('the badge is allowed to shrink',
     '\tflex: 0 0 auto;\n\tmin-width: auto;', '\tflex: 0 1 auto;'),

    ('the wrapper stops being a flex row (the badge stacks again)',
     '.cm-head-row__text {\n\tdisplay: flex;', '.cm-head-row__text {\n\tdisplay: block;'),

    ('floor set to a useless value',
     'min-width: min(100%, 12rem);', 'min-width: min(0%, 12rem);'),
]


def run_guard():
    r = subprocess.run([sys.executable, str(GUARD)],
                       capture_output=True, text=True)
    return r.returncode


results = []
try:
    print(f'baseline: guard rc={run_guard()} (must be 0)\n')

    for name, old, new in MUTATIONS:
        if original.count(old) != 1:
            results.append((name, False, 'PATTERN NOT FOUND / not unique'))
            print(f'  SKIP  {name}  <- pattern count '
                  f'{original.count(old)}')
            continue

        CSS.write_text(original.replace(old, new))
        rc = run_guard()
        killed = rc != 0
        results.append((name, killed, f'rc={rc}'))
        print(f'  {"KILLED " if killed else "SURVIVED"}  {name}  ({rc=})')
        CSS.write_text(original)
finally:
    shutil.copy2(BACKUP, CSS)
    assert CSS.read_text() == original, 'restore failed'

print()
survived = [n for n, k, _ in results if not k]
print(f'{len(results) - len(survived)}/{len(results)} mutations killed')
if survived:
    print('SURVIVORS:')
    for n in survived:
        print(f'   - {n}')
    sys.exit(1)
print('MUTATION PROOF PASS')
