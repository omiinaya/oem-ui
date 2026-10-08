#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-popover-combobox.py.
Byte-snapshot restore of CSS and JS, rebuild each time, named failing checks."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/styles/components.css'
JS = ROOT / 'src/js/cli-mono.js'
HARNESS = ROOT / 'tests/verify-popover-combobox.py'
css0, js0 = CSS.read_bytes(), JS.read_bytes()

MUTANTS = [
    ('the card loses its stacking layer',
     CSS, 'z-index: var(--z-popover);\n\tmin-width: 14rem;', 'min-width: 14rem;'),
    ('the listbox keeps a box while hidden',
     CSS, '.cm-combobox__list[hidden],\n.cm-combobox__option[hidden] { display: none; }',
     '.cm-combobox__option[hidden] { display: none; }'),
    ('the card stops joining the anchor selector',
     JS, "POP_SEL = '.cm-dropdown__menu[popover], .cm-popover[popover]';",
     "POP_SEL = '.cm-dropdown__menu[popover]';"),
    ('the card right-aligns like a menu',
     JS, 'var x = card ? t.left : t.right - w;', 'var x = t.right - w;'),
    ('the value takes the whole row, hint and all',
     JS, 'input.value = optionLabel(o);', 'input.value = o.textContent.trim();'),
    ('focusing after a choice reopens the list',
     JS, "input.addEventListener('focus', function () { if (!choosing) filter(); });",
     "input.addEventListener('focus', function () { filter(); });"),
    ('clicking outside no longer closes the list',
     JS, 'if (!wrap.contains(e.target)) setOpen(false);', 'if (false) setOpen(false);'),
    ('a query matches nothing at all',
     JS, 'var hit = !q || o.textContent.toLowerCase().indexOf(q) !== -1;',
     'var hit = !q;'),
    ('the card stops following its trigger on scroll',
     JS, "window.addEventListener('scroll', popPin, { passive: true });\n"
         "\t\twindow.addEventListener('scrollend', popPin);\n",
     ''),
]

SUITE_MUTANTS = [
    ('the active option is only classed, never painted',
     CSS, '.cm-combobox__option:hover,\n.cm-combobox__option.is-active { background: var(--bg-3);',
     '.cm-combobox__option:hover,\n.cm-combobox__option.is-active { background: var(--bg-3); color: var(--ink); }\n.cm-combobox__option.is-active { background: transparent;'),
]


def restore():
    CSS.write_bytes(css0)
    JS.write_bytes(js0)


def harness_run(name, path, old, new):
    src = path.read_text()
    if src.count(old) == 0:
        print(f'SKIP     {name}  (pattern x0)')
        return None, False, ''
    path.write_text(src.replace(old, new, 1))
    subprocess.run(['node', '--check', str(JS)], cwd=ROOT, capture_output=True)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
    r = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                       cwd=ROOT, capture_output=True, text=True, timeout=300)
    restore()
    out = r.stdout + r.stderr
    failing = [l.strip() for l in out.splitlines() if l.startswith('  FAIL')]
    crashed = r.returncode != 0 or 'Traceback' in out
    tail = ''
    if crashed and not failing:
        tb = [l for l in out.splitlines() if 'Error' in l or 'Timeout' in l]
        tail = 'CRASH ' + (tb[-1] if tb else out.strip().splitlines()[-1])
    return failing, crashed, tail


def suite_run(name, path, old, new):
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
    return failing, crashed, ('CRASH ' + out.strip().splitlines()[-1] if crashed else '')


def report(name, outcome, tag=''):
    failing, crashed, tail = outcome
    if failing is None:
        return 'skip'
    if failing or crashed:
        print(f'KILLED   {name}{tag}')
        print('         ' + (failing[0] if failing else tail)[:150])
        return 'killed'
    print(f'SURVIVED {name}{tag}')
    return 'survived'


try:
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
    base = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                          cwd=ROOT, capture_output=True, text=True, timeout=300)
    print('baseline GREEN\n' if base.returncode == 0 else 'baseline RED\n')
    if base.returncode != 0:
        print(base.stdout[-1500:])
        sys.exit(1)

    counts = {'killed': 0, 'survived': 0, 'skip': 0}
    for name, path, old, new in MUTANTS:
        counts[report(name, harness_run(name, path, old, new))] += 1
    total = len(MUTANTS) + len(SUITE_MUTANTS)
    for name, path, old, new in SUITE_MUTANTS:
        counts[report(name, suite_run(name, path, old, new), '  (contract suite)')] += 1

    print(f"\n{counts['killed']}/{total} mutants killed, "
          f"{counts['survived']} survived, {counts['skip']} skipped")
    sys.exit(1 if (counts['survived'] or counts['skip']) else 0)
finally:
    restore()
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
