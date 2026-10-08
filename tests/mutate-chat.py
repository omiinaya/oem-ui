#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 16a: the conversation family.

Byte-exact patterns, pre-checked (--scan prints every miss with its
count instead of dying on the first), baselines before any mutation,
restores in finally. A crashed or timed-out check counts as KILLED -
surviving on a dead oracle is not passing. The final restore is
verified too: if the tree is left mutated, that is a crash, not a
result.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
TAB = '\t'

MUTANTS = [
    # (label, path, old, new, target)
    ('the 80% cap disappears', 'src/styles/components.css',
     TAB + 'max-width: var(--bubble-max, 80%);\n',
     TAB + 'max-width: none;\n', 'harness'),
    ('ghost keeps its cap', 'src/styles/components.css',
     '.cm-bubble--ghost { background: transparent; border-color: transparent; color: var(--ink); max-width: none;',
     '.cm-bubble--ghost { background: transparent; border-color: transparent; color: var(--ink);', 'suite'),
    ('end alignment never flips', 'src/styles/components.css',
     '.cm-bubble--end { align-self: flex-end; }',
     '.cm-bubble--end { align-self: flex-start; }', 'harness'),
    ('the row never flips', 'src/styles/components.css',
     '.cm-msg--end { grid-template-columns: 1fr auto; }',
     '.cm-msg--end { grid-template-columns: auto 1fr; }', 'harness'),
    ('the avatar never bottom-anchors', 'src/styles/components.css',
     TAB + 'gap: var(--space-2);\n' + TAB + 'align-items: end;\n}',
     TAB + 'gap: var(--space-2);\n' + TAB + 'align-items: start;\n}', 'harness'),
    ('the footer stops following the side', 'src/styles/components.css',
     '.cm-msg--end .cm-msg__footer { justify-content: flex-end; }',
     '.cm-msg--end .cm-msg__footer { justify-content: flex-start; }', 'harness'),
    ('reactions never tuck into the edge', 'src/styles/components.css',
     TAB + 'margin-top: calc(-1 * (var(--space-1) + var(--space-2)));\n',
     TAB + 'margin-top: 0;\n', 'harness'),
    ('the separator loses its lines', 'src/styles/components.css',
     TAB + 'content: "";\n' + TAB + 'flex: 1;\n' + TAB + 'border-top: 1px solid var(--line-soft);\n}',
     TAB + 'content: "";\n' + TAB + 'flex: 1;\n}', 'harness'),
    ('danger loses the double rule', 'src/styles/components.css',
     '.cm-bubble--danger { background: transparent; color: var(--ink); border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }',
     '.cm-bubble--danger { background: transparent; color: var(--ink); border-color: var(--ink); }', 'suite'),
    ('reactions lose their label', 'src/pages/index.astro',
     'role="img" aria-label="reacted with eyes and rocket, plus 2"',
     'aria-hidden="true"', 'suite'),
    ('the icon is no longer decorative', 'src/pages/index.astro',
     '<span class="cm-marker__icon" aria-hidden="true">',
     '<span class="cm-marker__icon">', 'suite'),
    ('the section leaves the nav', 'src/pages/index.astro',
     "'scrollarea', 'utilities', 'chat', 'search',",
     "'scrollarea', 'utilities', 'search',", 'suite'),
]

SUITE_CMD = 'npm test'
HARNESS_CMD = '/root/.venvs/mau/bin/python tests/verify-chat.py'


def run_check(cmd, timeout=240):
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (treated as a kill: an oracle that cannot run is not an oracle that passed)'


def build():
    """npm test does NOT rebuild (probe: suite went green while dist still
    held the un-mutated markup) - every window therefore rebuilds dist
    from the mutated source itself, and the run rebuilds once more after
    the final restore so the tree is never left stale."""
    try:
        r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True,
                           text=True, timeout=240)
        return r.returncode == 0
    except subprocess.TimeoutExpired:
        return False


if '--scan' in sys.argv:
    bad = 0
    for name, path, old, _new, _t in MUTANTS:
        n = (ROOT / path).read_text().count(old)
        if n != 1:
            print(f'  PATTERN ABSENT - {name}: {path} matches {n}')
            bad += 1
    print(f'{len(MUTANTS) - bad}/{len(MUTANTS)} patterns present')
    sys.exit(2 if bad else 0)

originals = {p: (ROOT / p).read_text() for p in {m[1] for m in MUTANTS}}

assert build(), 'baseline build broke'
rc, out = run_check(SUITE_CMD)
assert rc == 0, f'baseline suite not green:\n{out[-2000:]}'
print('baseline suite green', end=' | ')
assert build(), 'baseline rebuild for the harness broke'
rc, out = run_check(HARNESS_CMD, timeout=180)
assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
print('baseline harness green')
for name, path, old, _new, _t in MUTANTS:
    assert originals[path].count(old) == 1, f'PATTERN ABSENT: {name}'

killed, survived = [], []
for name, path, old, new, target in MUTANTS:
    data = originals[path]
    (ROOT / path).write_text(data.replace(old, new, 1))
    try:
        if not build():
            rc, out, dead = -1, 'build broke under the mutation', True
        else:
            rc, out = run_check(HARNESS_CMD if target == 'harness' else SUITE_CMD,
                                timeout=180)
            dead = (rc != 0) or ('FAIL' in out) or ('not ok' in out)
        (killed if dead else survived).append(
            (name, 'BUILD BROKE' if rc == -1 and 'build broke' in out else
             ('TIMEOUT' if rc == -1 else
              ('FAIL-line' if dead else f'rc={rc}'))))
    finally:
        (ROOT / path).write_text(originals[path])

for p, data in originals.items():
    assert (ROOT / p).read_text() == data, f'RESTORE FAILED: {p} - crash, not a result'
assert build(), 'post-run rebuild failed - the tree is restored but dist is stale'
print()
for name, how in killed:
    print(f'  killed - {name} :: {how}')
if survived:
    print('SURVIVED:')
    for name, _ in survived:
        print(f'  - {name}')
print(f'killed={len(killed)} survived={len(survived)} of {len(MUTANTS)}')
sys.exit(0 if not survived else 1)
