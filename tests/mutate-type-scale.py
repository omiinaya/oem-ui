"""Mutation proof for contract-type-scale.py.

A test that passes is worth nothing if it cannot fail. Each mutation
breaks ONE real thing the test claims to pin; the test must go red on
every one. If any mutation survives, the test is a liar.
"""
import pathlib
import shutil
import subprocess
import sys

TEST = '/root/projects/oem-ui/tests/contract-type-scale.py'
LIB = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
TOK = pathlib.Path('/root/projects/oem-ui/src/styles/tokens.css')
DASH = pathlib.Path('/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/pages/Dashboard.tsx')
PY = '/root/.venvs/mau/bin/python'

MUTATIONS = [
    ('delete the section heading from the library',
     LIB,
     lambda s: s.replace('.cm-section__title {', '.cm-section__titleXX {', 1)),
    # The scale moved into tokens.css as --head-h2, so these mutate the
    # TOKEN. Editing `font-size: 1.15rem` in components.css mutated
    # nothing at all and three mutations "survived" - which meant they
    # never happened, not that the guard was weak.
    ('collapse the section heading onto the body step',
     TOK,
     lambda s: s.replace('--head-h2: var(--text-md);', '--head-h2: var(--text);', 1)),
    ('shove the section title below legibility',
     TOK,
     lambda s: s.replace('--text-md: 1.25rem;', '--text-md: 0.5rem;', 1)),
    ('put a panel heading back in the page-title class',
     DASH,
     lambda s: s.replace('<h2 className="cm-section__title">',
                         '<h2 className="cm-head__title">', 1)),
    ('drop every section title from the app',
     DASH,
     lambda s: s.replace('cm-section__title', 'cm-head__title')),
    ('collapse section back onto the card title',
     TOK,
     lambda s: s.replace('--head-h2: var(--text-md);', '--head-h2: var(--text-xs);', 1)),
    ('the section title stops reading the token at all',
     LIB,
     lambda s: s.replace('font-size: var(--head-h2);', 'font-size: 1.15rem;', 1)),
]

baseline = subprocess.run([PY, TEST], capture_output=True, text=True)
print(f'baseline rc={baseline.returncode} (want 0)')
if baseline.returncode != 0:
    print('baseline is not green - fix the test before mutating')
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
    path.write_text(orig)  # always restore
    verdict = 'killed' if r.returncode != 0 else 'SURVIVED'
    print(f'  {verdict:8}  {name}')
    if r.returncode == 0:
        survivors.append(name)

print()
if survivors:
    print(f'FAIL - {len(survivors)} mutation(s) survived: {survivors}')
    sys.exit(1)
print(f'PASS - all {len(MUTATIONS)} mutations killed')
