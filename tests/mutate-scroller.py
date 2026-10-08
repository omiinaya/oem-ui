#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 17: the message scroller.

Byte-exact patterns, pre-checked, build in every window, restore
verified, post-run rebuild. A crash, timeout or broken build is a kill -
never a silent pass.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')

MUTANTS = [
    ('the frame stops opening at the live edge (attr)', 'src/pages/index.astro',
     'class="cm-scroller" data-cm-scroller data-track-visible data-start-at-end',
     'class="cm-scroller" data-cm-scroller data-track-visible', 'harness'),
    ('the frame stops opening at the live edge (impl)', 'src/js/cli-mono.js',
     "if (frame.hasAttribute('data-start-at-end')) {",
     "if (false && frame.hasAttribute('data-start-at-end')) {", 'harness'),
    ('growth stops pinning the live edge', 'src/js/cli-mono.js',
     "if (frame.getAttribute('data-following') === 'true') {",
     "if (frame.getAttribute('data-following') === 'pin-never') {", 'harness'),
    ('the start button never goes inert', 'src/js/cli-mono.js',
     'btnStart.inert = !s;', 'btnStart.inert = false;', 'harness'),
    ('the start button keeps its focus stop', 'src/js/cli-mono.js',
     'btnStart.tabIndex = s ? 0 : -1;', 'btnStart.tabIndex = 0;', 'harness'),
    ('data-active stops tracking the edge', 'src/js/cli-mono.js',
     "btnStart.setAttribute('data-active', s ? 'true' : 'false');",
     "btnStart.setAttribute('data-active', 'true');", 'harness'),
    ('the scrollable tokens stop mirroring', 'src/js/cli-mono.js',
     "vp.setAttribute('data-scrollable', bits.join(' '));",
     "vp.setAttribute('data-scrollable', '');", 'harness'),
    ('scrollToMessage stops parking near the top', 'src/js/cli-mono.js',
     'vp.scrollTop += rr.top - vr.top - 24;',
     'vp.scrollTop += rr.top - vr.top - 400;', 'harness'),
    ('an unknown id claims success', 'src/js/cli-mono.js',
     'if (!row) return false;', 'if (!row) return true;', 'harness'),
    ('the outline stops tracking the anchored turn', 'src/js/cli-mono.js',
     "marks[m].setAttribute('aria-current', 'true');",
     "marks[m].removeAttribute('aria-current');", 'harness'),
    ('the status line stops reading the edges', 'src/js/cli-mono.js',
     "status.textContent = s && e ? 'both ways scrollable'",
     "status.textContent = 'static text'", 'harness'),
    ('the content stops being a log', 'src/pages/index.astro',
     'class="cm-scroller__content" role="log" aria-relevant="additions"',
     'class="cm-scroller__content"', 'suite'),
    ('the viewport loses its name', 'src/pages/index.astro',
     'aria-label="Messages" tabindex="0"', 'tabindex="0"', 'suite'),
    ('rows stop skipping off-screen paint', 'src/styles/components.css',
     '\tcontent-visibility: auto;\n\tcontain-intrinsic-size: auto 76px;',
     '\tcontain-intrinsic-size: auto 76px;', 'suite'),
    ('cmInitScroller leaves init', 'src/js/cli-mono.js',
     '\t\tcmInitScroller(root);\n', '', 'suite'),
    ('the observer list forgets the scroller', 'src/js/cli-mono.js',
     '[data-cm-quiz], [data-cm-scroller], ', '[data-cm-quiz], ', 'suite'),
]

SUITE_CMD = 'npm test'
HARNESS_CMD = '/root/.venvs/mau/bin/python tests/verify-scroller.py'


def run_check(cmd, timeout=240):
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (treated as a kill)'


def build():
    try:
        r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True,
                           text=True, timeout=300)
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
assert build(), 'baseline rebuild broke'
rc, out = run_check(HARNESS_CMD, timeout=180)
assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
print('baseline harness green')
for name, path, old, _new, _t in MUTANTS:
    assert originals[path].count(old) == 1, f'PATTERN ABSENT: {name}'

killed, survived = [], []
for name, path, old, new, target in MUTANTS:
    (ROOT / path).write_text(originals[path].replace(old, new, 1))
    try:
        if not build():
            rc, out, dead = -1, 'build broke under the mutation', True
        else:
            rc, out = run_check(HARNESS_CMD if target == 'harness' else SUITE_CMD,
                                timeout=180)
            dead = (rc != 0) or ('FAIL' in out) or ('not ok' in out)
        (killed if dead else survived).append(
            (name, 'BUILD BROKE' if 'build broke' in out else
             ('TIMEOUT' if rc == -1 else ('FAIL-line' if dead else f'rc={rc}'))))
    finally:
        (ROOT / path).write_text(originals[path])

for p, data in originals.items():
    assert (ROOT / p).read_text() == data, f'RESTORE FAILED: {p}'
assert build(), 'post-run rebuild failed'

print()
for name, how in killed:
    print(f'  killed - {name} :: {how}')
if survived:
    print('SURVIVED:')
    for name, _ in survived:
        print(f'  - {name}')
print(f'killed={len(killed)} survived={len(survived)} of {len(MUTANTS)}')
sys.exit(0 if not survived else 1)