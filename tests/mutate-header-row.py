"""Mutation proof for contract-header-row.py.

The stacking and the stranded chip were both invisible in a green suite
and in a source diff - they only show up in a rendered rect. So the guard
has to be proven able to fail on exactly those two, plus the mistake a
future edit would actually make: adding a second .cm-head-row__text rule
that silently outranks the block.
"""
import pathlib
import subprocess
import sys

TEST = '/root/projects/oem-ui/tests/contract-header-row.py'
LIB = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
DASH = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/pages/Dashboard.tsx')
MET = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/pages/Metrics.tsx')
PY = '/root/.venvs/mau/bin/python'

FLEX = '\tdisplay: flex;\n\talign-items: center;\n\tgap: var(--space-3);\n\tmin-width: 0;\n'
ONELINER = '.cm-head-row__text { min-width: 0; }\n'

MUTATIONS = [
    # the original defect: the wrapper has no layout at all
    ('the badge/title wrapper loses its flex row',
     LIB,
     lambda s: s.replace(FLEX, '\tmin-width: 0;\n', 1)),

    # the subtle one: a second rule that outranks the block
    ('a second .cm-head-row__text one-liner outranks the block',
     LIB,
     lambda s: s + '\n' + ONELINER),

    # the chip stops being pushed
    ('the trailing chip stops being pushed to the far end',
     LIB,
     lambda s: s.replace('.cm-head-row__meta { margin-left: auto;',
                        '.cm-head-row__meta { margin-left: 0;', 1)),

    # the pages stop asking for it
    ('the dashboard stops right-aligning its chip',
     DASH,
     lambda s: s.replace('cm-tag cm-head-row__meta', 'cm-tag', 1)),

    ('metrics stops right-aligning its chips',
     MET,
     lambda s: s.replace('cm-head-row__meta', 'cm-head-row__action', 1)),
]

baseline = subprocess.run([PY, TEST], capture_output=True, text=True)
print(f'baseline rc={baseline.returncode} (want 0)')
if baseline.returncode != 0:
    print('baseline is not green - fix the test before mutating')
    print(baseline.stdout[-800:])
    sys.exit(1)

survivors = []
for name, path, mutate in MUTATIONS:
    orig = path.read_text()
    mutated = mutate(orig)
    if mutated == orig:
        print(f'  BROKEN MUTATION  {name} - nothing changed')
        survivors.append(name)
        continue
    path.write_text(mutated)
    r = subprocess.run([PY, TEST], capture_output=True, text=True)
    path.write_text(orig)
    verdict = 'killed' if r.returncode != 0 else 'SURVIVED'
    print(f'  {verdict:8}  {name}')
    if r.returncode == 0:
        survivors.append(name)

print()
if survivors:
    print(f'FAIL - {len(survivors)} mutation(s) survived: {survivors}')
    sys.exit(1)
print(f'PASS - all {len(MUTATIONS)} mutations killed')
