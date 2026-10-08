#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 12: the drawer (handle, threshold, clamps,
handle-only gesture, close cleanup) and the field wiring (ids, for,
aria-describedby MERGE, aria-required), plus one contract-suite mutant
for the safe-area rule a WebKit harness cannot see (env() resolves to
zero there, so the rule is indistinguishable from no rule).

Byte-exact restore, PATTERN ABSENT pre-check, crash counts as kill."""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
HARNESS = [str(ROOT / 'tests/verify-drawer-field.py')]
JS = ROOT / 'src/js/cli-mono.js'
CSS = ROOT / 'src/styles/components.css'
SUITE = ['node', 'tests/run.mjs']


def run(cmd, timeout=480):
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (counts as kill)'


MUTANTS = [
    # --- field wiring -----------------------------------------------------
    ('drop the generated id', 'src/js/cli-mono.js',
     "\t\t\tif (!control.id) control.id = 'cm-field-' + (++n);\n", '', 1, 'harness'),
    ('drop the generated label[for]', 'src/js/cli-mono.js',
     '\t\t\tif (!label.htmlFor) label.htmlFor = control.id;\n', '', 1, 'harness'),
    ('describedby overwrites instead of merging', 'src/js/cli-mono.js',
     "keep.concat(generated).join(' ')", "generated.join(' ')", 1, 'harness'),
    ('describedby never set', 'src/js/cli-mono.js',
     "\t\t\t\tcontrol.setAttribute('aria-describedby', keep.concat(generated).join(' '));\n",
     '', 1, 'harness'),
    ('help/error ids never generated', 'src/js/cli-mono.js',
     '\t\t\t\tif (!node.id) node.id = control.id + pair[1];\n', '', 1, 'harness'),
    ('aria-required fires even on native required', 'src/js/cli-mono.js',
     " && !control.hasAttribute('required')", '', 1, 'harness'),
    ('aria-required removed entirely', 'src/js/cli-mono.js',
     "\t\t\tif (field.querySelector('.cm-field__req') && !control.hasAttribute('required'))\n"
     "\t\t\t\tcontrol.setAttribute('aria-required', 'true');\n", '', 1, 'harness'),
    # --- drawer -----------------------------------------------------------
    ('threshold made unreachable', 'src/js/cli-mono.js',
     'if (dy >= 96 || dy >= tall * 0.4) {', 'if (dy >= 9999 && dy >= tall * 9) {', 1, 'harness'),
    ('upward drag no longer clamped', 'src/js/cli-mono.js',
     'dy = Math.max(0, e.clientY - startY);', 'dy = e.clientY - startY;', 1, 'harness'),
    ('drag no longer follows the pointer', 'src/js/cli-mono.js',
     "\t\t\t\tdlg.style.transform = 'translateY(' + dy + 'px)';\n", '', 1, 'harness'),
    ('a press anywhere starts a drag, not just the handle', 'src/js/cli-mono.js',
     "handle.addEventListener('pointerdown', function (e) {\n"
     "\t\t\t\tif (typeof dlg.showModal !== 'function' || !dlg.open) return;",
     "dlg.addEventListener('pointerdown', function (e) {\n"
     "\t\t\t\tif (typeof dlg.showModal !== 'function' || !dlg.open) return;", 1, 'harness'),
    ('no snap home after a half-pull', 'src/js/cli-mono.js',
     "\t\t\t\tdlg.classList.remove('cm-drawer--dragging');\n\t\t\t\tdlg.style.transform = '';\n\t\t\t\tvar tall = dlg.getBoundingClientRect().height;",
     "\t\t\t\tdlg.classList.remove('cm-drawer--dragging');\n\t\t\t\tvar tall = dlg.getBoundingClientRect().height;",
     1, 'harness'),
    ('close handler stops cleaning up the drag', 'src/js/cli-mono.js',
     "\t\t\t/* Escape (or a programmatic close) mid-drag would otherwise\n"
     "\t\t\t   leave an inline transform behind for the next open */\n"
     "\t\t\tdlg.addEventListener('close', function () {\n"
     "\t\t\t\tdragging = false;\n"
     "\t\t\t\tdlg.classList.remove('cm-drawer--dragging');\n"
     "\t\t\t\tdlg.style.transform = '';\n"
     "\t\t\t});\n", '', 1, 'harness'),
    ('dragging class never applied', 'src/js/cli-mono.js',
     "\t\t\t\tdlg.classList.add('cm-drawer--dragging');\n", '', 1, 'harness'),
    # --- css --------------------------------------------------------------
    ('spec preview loses its side borders', 'src/styles/components.css',
     "\tborder-width: 1px;\n\tbox-shadow: var(--shadow-card);",
     "\tbox-shadow: var(--shadow-card);", 1, 'harness'),
    ('spec preview goes full-bleed again', 'src/styles/components.css',
     "dialog.cm-dialog--spec:not([open]) {\n\twidth: min(24rem, 100%);",
     "dialog.cm-dialog--spec:not([open]) {", 1, 'harness'),
    ('a fixed height crops the preview again', 'src/pages/index.astro',
     'class="cm-dialog--spec cm-dialog cm-dialog--sheet cm-dialog--sheet-bottom cm-drawer" style="position:static;margin-top:var(--space-4)"',
     'class="cm-dialog--spec cm-dialog cm-dialog--sheet cm-dialog--sheet-bottom cm-drawer" style="position:static;margin-top:var(--space-4);max-height:96px"', 1, 'harness'),
    ('spec dialogs hidden again by the UA', 'src/styles/components.css',
     'dialog.cm-dialog--spec:not([open]) { display: block; }\n', '', 1, 'harness'),
    ('grab strip no longer tap-sized', 'src/styles/components.css',
     "\t/* a tap-sized grab strip: 44px tall, the 4px bar centred in it */\n"
     "\theight: var(--tap);",
     "\t/* a tap-sized grab strip: 44px tall, the 4px bar centred in it */\n"
     "\theight: 1.5rem;", 1, 'harness'),
    ('the bar gets rounded (house rule: pointy)', 'src/styles/components.css',
     ".cm-drawer__handle::after {\n\tcontent: '';\n\tdisplay: block;\n\twidth: 3rem;\n\theight: 4px;",
     ".cm-drawer__handle::after {\n\tcontent: '';\n\tdisplay: block;\n\twidth: 3rem;\n\theight: 4px;\n\tborder-radius: 9999px;", 1, 'harness'),
    ('safe-area rule dropped (contract-suite kill only)', 'src/styles/components.css',
     '\tpadding-bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));\n', '', 1, 'suite'),
]

results = []
only = sys.argv[1] if len(sys.argv) > 1 else None

for name, rel, pattern, replacement, count, validator in MUTANTS:
    if only and only not in name:
        continue
    path = ROOT / rel
    original = path.read_text()
    found = original.count(pattern)
    if found == 0:
        results.append((name, 'PATTERN ABSENT'))
        continue
    if found != count:
        results.append((name, f'AMBIGUOUS x{found}'))
        continue
    path.write_text(original.replace(pattern, replacement))
    try:
        b = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, text=True,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=180)
        if b.returncode != 0 or 'Complete!' not in (b.stdout or ''):
            results.append((name, 'KILL (build broke)'))
            continue
        cmd = SUITE if validator == 'suite' else HARNESS
        code, out = run(cmd)
        if code == 0 and 'FAIL' not in out:
            results.append((name, 'SURVIVED'))
        else:
            why = 'FAIL-line' if 'FAIL' in out else f'rc={code}'
            results.append((name, f'killed ({why})'))
    finally:
        path.write_text(original)

# every mutant restores itself in `finally`; rebuild once for green
subprocess.run(['npm', 'run', 'build'], cwd=ROOT, text=True,
               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)

print()
killed = sum(1 for _, r in results if r.startswith('killed') or r.startswith('KILL'))
survived = sum(1 for _, r in results if r == 'SURVIVED')
absent = sum(1 for _, r in results if 'ABSENT' in r or 'AMBIG' in r)
for name, r in results:
    print(f'  {r:22s} {name}')
print(f'\nkilled={killed} survived={survived} absent/ambiguous={absent} '
      f'of {len(results)}')
ok = survived == 0 and absent == 0 and killed == len(MUTANTS)
print('MUTATION PROOF ' + ('PASS' if ok else 'FAIL'))
sys.exit(0 if ok else 1)
