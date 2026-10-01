"""Mutation proof for contract-vendor-sync.py.

The bug this guard exists for was invisible to every other check: the
deploy succeeded, the suite passed, and the page was unchanged. So the
guard has to be proven able to fail on exactly that.
"""
import pathlib
import subprocess
import sys

TEST = '/root/projects/oem-ui/tests/contract-vendor-sync.py'
VEND = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/styles/cli-mono/components.css')
INDEX = pathlib.Path('/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/index.css')
PY = '/root/.venvs/mau/bin/python'

MUTATIONS = [
    ('the library gains a rule the vendored copy never received',
     VEND,
     lambda s: s.replace('.cm-section__title {', '.cm-section__title-vendored-drift-probe {', 1)),
    ('the app stops importing the vendored copy and loads nothing',
     INDEX,
     lambda s: s.replace("@import './styles/cli-mono/components.css';", '', 1)),
    ('a vendored rule is silently deleted',
     VEND,
     lambda s: s.replace('.cm-section__title {', '.cm-section__titlePROBE {', 1)),
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
