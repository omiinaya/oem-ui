#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 10: the tree and the resizable panels.

Every mutant restores the byte-exact file first, PRE-CHECKS that its pattern
exists (a pattern that does not match is reported, never counted), rebuilds,
and runs the WebKit harness. A harness that CRASHES counts as a kill - a dead
harness that "passes" by never running is the failure mode this runner exists
to prevent.
"""
import subprocess
import sys
import time
from pathlib import Path

REPO = Path('/root/projects/oem-ui')
JS = REPO / 'src/js/cli-mono.js'
CSS = REPO / 'src/styles/components.css'
LOG = Path('/root/.hermes/cache/scratch/mut10.txt')
HARNESS = REPO / 'tests/verify-tree-resize.py'
BUILDLOG = Path('/root/.hermes/cache/scratch/mut10-build.txt')

MUTANTS = [
    (JS, '\t\t\t\tif (row.checkVisibility) return row.checkVisibility();',
         '\t\t\t\tif (row.checkVisibility) return true;',
         'tree walks into rows behind a closed branch'),
    (JS, '\t\t\t\trow.click();\n\t\t\t\tnext = rows[rows.indexOf(row) + 1] || row;',
         '\t\t\t\tvoid 0;\n\t\t\t\tnext = rows[rows.indexOf(row) + 1] || row;',
         'ArrowRight stops opening the branch'),
    (JS, '\t\t\tif (branch && branch.open) row.click();',
         '\t\t\tif (branch && branch.open) { /* stays open */ }',
         'ArrowLeft stops closing the branch'),
    (JS, '\t\t\t\tnext = rows[rows.indexOf(row) + 1] || row;',
         '\t\t\t\tnext = row;',
         'ArrowRight opens but never steps inside'),
    (JS, 'next = treeParentRow(row) || rows[Math.max(i - 1, 0)];',
         'next = null;',
         'ArrowLeft on a leaf stops stepping out'),
    (JS, "else if (e.key === 'End') next = rows[rows.length - 1];",
         "else if (e.key === 'End') next = rows[0];",
         'End goes to the first row'),
    (JS, 'treeRows(tree).forEach(function (r) { r.tabIndex = r === row ? 0 : -1; });',
         'treeRows(tree).forEach(function (r) { r.tabIndex = -1; });',
         'roving tabindex makes every row a non-stop'),
    (JS, "g.style.setProperty('--cm-resize', pct + '%');",
         '/* no write */',
         'the drag stops painting the split it reports'),
    (JS, "handle.setAttribute('aria-valuenow', String(Math.round(pct)));",
         '/* no report */',
         'the drag stops reporting its value'),
    (JS, 'return Math.min(max, Math.max(min, pct));',
         'return pct;',
         'the boundary stops clamping'),
    (JS, 'var base = stacked() ? r.height : r.width;',
         'var base = r.height;',
         'the drag measures the wrong axis'),
    (JS, 'if (typeof handle.setPointerCapture === \'function\') handle.setPointerCapture(e.pointerId);',
         '/* no capture */',
         'the drag loses the pointer outside the seam'),
    (JS, 'var step = base ? (16 / base) * 100 : 4;',
         'var step = base ? (40 / base) * 100 : 4;',
         'the keyboard step stops being 16px'),
    (JS, "handle.setAttribute('aria-orientation', stacked() ? 'horizontal' : 'vertical');",
         "handle.setAttribute('aria-orientation', stacked() ? 'vertical' : 'horizontal');",
         'the separator reports the wrong orientation on a phone'),
    (CSS, '.cm-resize__panel:first-child { flex: 0 0 var(--cm-resize, 50%); }',
          '.cm-resize__panel:first-child { flex: auto; }',
          'the first panel stops consuming the knob'),
    (CSS, '\t.cm-resize { flex-direction: column; }',
          '\t.cm-resize { }',
          'the phone layout stops stacking'),
]

lines = []


def say(msg):
    print(msg, flush=True)
    lines.append(msg)
    try:
        LOG.write_text('\n'.join(lines) + '\n')
    except OSError:
        pass


def build():
    with open(BUILDLOG, 'a') as lf:
        rc = subprocess.run(['npm', 'run', 'build'], cwd=REPO, stdout=lf,
                            stderr=subprocess.STDOUT).returncode
    return rc


def run_harness():
    try:
        r = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                           cwd=REPO, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return False, 'HARNESS TIMEOUT (treated as a kill)'
    tail = (r.stdout or '').strip().split('\n')[-1:]
    return r.returncode != 0, (tail[0] if tail else f'exit={r.returncode}')


def main():
    js0, css0 = JS.read_bytes(), CSS.read_bytes()
    say(f'snapshot js={len(js0)} css={len(css0)}')
    killed, survived, absent = [], [], []
    t0 = time.time()
    try:
        for n, (path, old, new, why) in enumerate(MUTANTS, 1):
            JS.write_bytes(js0)
            CSS.write_bytes(css0)
            src = path.read_text()
            count = src.count(old)
            if count != 1:
                absent.append(f'{n} {why} (matches={count})')
                say(f'{n:2} PATTERN ABSENT/AMBIGUOUS ({count}) - {why}')
                continue
            path.write_text(src.replace(old, new, 1))
            if build() != 0:
                killed.append(why)
                say(f'{n:2} KILLED (build failed) - {why}')
                continue
            failed, tail = run_harness()
            if failed:
                killed.append(why)
                say(f'{n:2} KILLED - {why} :: {tail}')
            else:
                survived.append(why)
                say(f'{n:2} SURVIVED - {why} :: {tail}')
    finally:
        JS.write_bytes(js0)
        CSS.write_bytes(css0)
        build()
    say(f'\nkilled={len(killed)} survived={len(survived)} absent={len(absent)} '
        f'in {time.time() - t0:.0f}s')
    for s in survived:
        say(f'  SURVIVED: {s}')
    for a in absent:
        say(f'  ABSENT: {a}')
    say('MUTATION PROOF ' + ('PASS' if killed and not survived and not absent else 'FAIL'))
    sys.exit(0 if (killed and not survived and not absent) else 1)


if __name__ == '__main__':
    main()
