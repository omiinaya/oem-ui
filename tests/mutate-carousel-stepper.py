#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-carousel-stepper.py.
Byte-snapshot restore of CSS and JS, rebuild each time, named failing checks."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/styles/components.css'
JS = ROOT / 'src/js/cli-mono.js'
HARNESS = ROOT / 'tests/verify-carousel-stepper.py'
css0, js0 = CSS.read_bytes(), JS.read_bytes()

MUTANTS = [
    ('the connector hangs off the button again (the shipped bug)',
     CSS, '.cm-stepper > li:not(:last-child)::after', '.cm-step:not(:last-child)::after'),
    ('the stacked row shows its connector',
     CSS, '.cm-stepper > li:not(:last-child)::after { display: none; }',
     '.cm-stepper > li:not(:last-child)::after { display: block; }'),
    ('the current marker stops inverting',
     CSS, '.cm-step.is-current .cm-step__marker { background: var(--ink);',
     '.cm-step.is-current .cm-step__marker { background: var(--bg-2);'),
    ('the swipe is no longer observed',
     JS, "track.addEventListener('scroll'", "track.addEventListener('wheel'"),
    ('prev never disables at the first slide',
     JS, 'prev.disabled = i <= 0;', 'prev.disabled = false;'),
    ('next never disables at the last slide',
     JS, 'next.disabled = i >= slides.length - 1;', 'next.disabled = false;'),
    ('the active mark is never mirrored to aria',
     JS, "p.setAttribute('aria-current', 'true');", "p.setAttribute('data-active', 'true');"),
    # NOT 'keyup': Playwright's press() fires keydown AND keyup, so renaming
    # the listener changes nothing and the mutant survives for the wrong
    # reason. Point it at a name nothing emits.
    ('the track stops owning its arrow keys',
     JS, "track.addEventListener('keydown'", "track.addEventListener('nokey'"),
    ('a click cannot make a step current',
     JS, "classList.toggle('is-current', n === i);", "classList.toggle('is-current', false);"),
    ('aria-current never moves to the clicked step',
     JS, "s.setAttribute('aria-current', 'step');", "s.setAttribute('data-next', 'step');"),
]

# These run against the contract suite instead of the browser: a bug that
# only the SOURCE can see (scroll-snap hides the wrong landing from WebKit).
SUITE_MUTANTS = [
    ('the slide landing goes back to offsetLeft',
     JS, 'return track.scrollLeft + (r.left - t.left);', 'return slides[i].offsetLeft;'),
]

def restore():
    CSS.write_bytes(css0)
    JS.write_bytes(js0)

def run_suite(name, path, old, new):
    src = path.read_text()
    if src.count(old) == 0:
        print(f'SKIP     {name}  (pattern x0)')
        return None, False, ''
    path.write_text(src.replace(old, new, 1))
    r = subprocess.run(['node', 'tests/run.mjs'], cwd=ROOT,
                       capture_output=True, text=True, timeout=600)
    restore()
    out = r.stdout + r.stderr
    failing = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
    crashed = r.returncode != 0 and not failing
    tail = '' if not crashed else 'CRASH ' + out.strip().splitlines()[-1]
    return failing, crashed, tail


def run(name, path, old, new):
    src = path.read_text()
    if src.count(old) == 0:
        print(f'SKIP     {name}  (pattern x0)')
        return None
    path.write_text(src.replace(old, new, 1))
    subprocess.run(['node', '--check', str(JS)], cwd=ROOT, capture_output=True)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
    r = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                       cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = r.stdout + r.stderr
    restore()
    failing = [l.strip() for l in out.splitlines() if l.startswith('  FAIL')]
    # A harness that DIES - a wait_for_function that times out because the
    # behavior under test never happened - is the test failing, not passing.
    # Counting only printed FAIL lines recorded every timeout as a survivor.
    crashed = r.returncode != 0 or 'Traceback' in out
    tail = ''
    if crashed and not failing:
        tb = [l for l in out.splitlines() if 'Error' in l or 'Timeout' in l]
        tail = 'CRASH ' + (tb[-1] if tb else out.strip().splitlines()[-1])
    return failing, crashed, tail

try:
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
    baseline = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                              cwd=ROOT, capture_output=True, text=True, timeout=300)
    ok0 = baseline.returncode == 0
    print(('baseline GREEN' if ok0 else 'baseline RED') + '\n')
    if not ok0:
        print(baseline.stdout[-1500:])
        sys.exit(1)
    killed = skipped = survived = 0
    for name, path, old, new in MUTANTS:
        failing, crashed, tail = run(name, path, old, new)
        if failing is None:
            skipped += 1
        elif failing or crashed:
            killed += 1
            print(f'KILLED   {name}')
            print('         ' + (failing[0] if failing else tail)[:150])
        else:
            survived += 1
            print(f'SURVIVED {name}')
    total = len(MUTANTS) + len(SUITE_MUTANTS)
    for name, path, old, new in SUITE_MUTANTS:
        failing, crashed, tail = run_suite(name, path, old, new)
        if failing is None:
            skipped += 1
        elif failing or crashed:
            killed += 1
            print(f'KILLED   {name}  (contract suite)')
            print('         ' + (failing[0] if failing else tail)[:150])
        else:
            survived += 1
            print(f'SURVIVED {name}  (contract suite)')
    print(f'\n{killed}/{total} mutants killed, {survived} survived, {skipped} skipped')
    sys.exit(1 if (survived or skipped) else 0)
finally:
    restore()
    # dist still holds the last mutant's build; put the real component back.
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
