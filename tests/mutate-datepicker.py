#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 13: the date picker's composition glue
(pick -> input, close-on-pick, wrapper lookup), the field-click open,
the popover wiring, and the scrollarea's three declarations.

Byte-exact restore, PATTERN ABSENT pre-check, crash counts as kill."""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
HARNESS = [str(ROOT / 'tests/verify-datepicker.py')]

MUTANTS = [
    # --- the composition glue (calPick) -----------------------------------
    ('the input is written unconditionally', 'src/js/cli-mono.js',
     "dpInput.value = cal.getAttribute('data-cm-cal-selected') || '';",
     'dpInput.value = iso;', 1),
    ('a pick no longer closes the panel', 'src/js/cli-mono.js',
     'dpPanel.hidePopover();', '', 1),
    ('the glue never finds the wrapper', 'src/js/cli-mono.js',
     "var dp = cal.closest('.cm-datepicker');", 'var dp = null;', 1),
    # --- the field-click open ----------------------------------------------
    ('the field-click guard inverted', 'src/js/cli-mono.js',
     "if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open'))",
     "if (typeof panel.showPopover === 'function' && panel.matches(':popover-open'))", 1),
    ('the bound guard flips', 'src/js/cli-mono.js',
     'if (wrap.dataset.cmDpBound) return;',
     'if (!wrap.dataset.cmDpBound) return;', 1),
    ('the init call dropped', 'src/js/cli-mono.js',
     '\t\tcmInitDatepickers(root);\n', '', 1),
    # --- the popover wiring (markup) ---------------------------------------
    ('the panel loses its popover attribute', 'src/pages/index.astro',
     'id="dp-panel" popover class="cm-popover cm-datepicker__panel"',
     'id="dp-panel" class="cm-popover cm-datepicker__panel"', 1),
    ('the panel loses the popover frame (and its anchor)', 'src/pages/index.astro',
     'class="cm-popover cm-datepicker__panel"',
     'class="cm-datepicker__panel"', 1),
    ('the trigger stops declaring haspopup', 'src/pages/index.astro',
     'aria-haspopup="dialog" popovertarget="dp-panel"',
     'popovertarget="dp-panel"', 1),
    ('the caret loses its target', 'src/pages/index.astro',
     'aria-label="pick a date"\n\t\t\t\t\t\t\tpopovertarget="dp-panel"',
     'aria-label="pick a date"', 1),
    # --- the scrollarea ------------------------------------------------------
    ('the scrollarea cap dropped', 'src/styles/components.css',
     '\tmax-height: var(--scroll-h, 18rem);\n', '', 1),
    ('the scrollarea stops being a scrollport', 'src/styles/components.css',
     '\tmax-height: var(--scroll-h, 18rem);\n\toverflow-y: auto;',
     '\tmax-height: var(--scroll-h, 18rem);', 1),
    ('the scrollarea lets its gesture escape', 'src/styles/components.css',
     '\toverflow-y: auto;\n\toverscroll-behavior: contain;',
     '\toverflow-y: auto;', 1),
]


def run(cmd, timeout=480):
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (counts as kill)'


def build():
    p = subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, timeout=180)
    return p.returncode


# --- preflight: every pattern must be present EXACTLY where it claims ------
only = sys.argv[1:] or None
problems = []
for name, rel, pattern, replacement, count in MUTANTS:
    if only and name not in only:
        continue
    text = (ROOT / rel).read_text()
    n = text.count(pattern)
    if n != count:
        problems.append(f'{rel}: {name!r} pattern count {n} (expected {count})')
if problems:
    print('PATTERN PRE-CHECK FAILED:')
    for p in problems:
        print('  ' + p)
    sys.exit(2)

rc = build()
if rc != 0:
    print(f'baseline build failed rc={rc}')
    sys.exit(2)
print(f'baseline green: {len(MUTANTS)} mutants pre-checked')

killed = survived = 0
rows = []
for name, rel, pattern, replacement, count in MUTANTS:
    if only and name not in only:
        continue
    path = ROOT / rel
    original = path.read_text()
    assert original.count(pattern) == count
    try:
        path.write_text(original.replace(pattern, replacement))
        b = build()
        if b != 0:
            killed += 1
            rows.append(('killed (build broke)', name))
            continue
        rc, out = run(HARNESS)
        if rc != 0 or 'FAIL' in out:
            killed += 1
            rows.append(('killed (FAIL-line)', name))
        else:
            survived += 1
            rows.append(('SURVIVED', name))
    finally:
        path.write_text(original)

build()
total = killed + survived
for verdict, name in rows:
    print(f'  {verdict:22} {name}')
print(f'\nkilled={killed} survived={survived} of {total}')
print('MUTATION PROOF ' + ('PASS' if survived == 0 and total else 'FAIL'))
sys.exit(0 if survived == 0 and total else 1)
