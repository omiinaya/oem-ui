#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-hovercard.py. Byte-snapshot restore,
rebuild each time because the harness reads dist."""
import sys
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/styles/components.css'
PY = '/root/.venvs/mau/bin/python'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'

MUTANTS = [
    ('panel visible at rest (visibility gate gone)',
     '\topacity: 0;\n\tvisibility: hidden;', '\topacity: 0;'),
    ('keyboard path dropped',
     '.cm-hovercard:focus-within .cm-hovercard__panel {',
     '.cm-hovercard__panel--unused {'),
    ('hover path dropped',
     '.cm-hovercard:hover .cm-hovercard__panel,\n', ''),
    ('seam doubles up (addon keeps its right border)',
     '\tborder-right-width: 0;\n}\n.cm-input-group > .cm-input-group__addon:last-child {',
     '\n}\n.cm-input-group > .cm-input-group__addon:last-child {'),
    ('panel rounds its corners',
     '\tmin-width: 18rem;\n\topacity: 0;', '\tmin-width: 18rem;\n\tborder-radius: 50%;\n\topacity: 0;'),
]


def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True).returncode


snap = CSS.read_bytes()
killed, survived, skipped = 0, [], 0
try:
    for name, old, new in MUTANTS:
        text = CSS.read_text()
        if text.count(old) != 1:
            print('SKIP     %-46s (pattern x%d)' % (name, text.count(old)))
            skipped += 1
            continue
        CSS.write_text(text.replace(old, new, 1))
        build()
        r = subprocess.run([PY, str(ROOT / 'tests/verify-hovercard.py')],
                           capture_output=True, text=True, env=None)
        fails = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith('FAIL')]
        if r.returncode != 0:
            print('KILLED   %-46s %s' % (name, (fails[0] if fails else '(crashed)')[:80]))
            killed += 1
        else:
            print('SURVIVED %s' % name)
            survived.append(name)
        CSS.write_bytes(snap)
finally:
    CSS.write_bytes(snap)
    build()

total = len(MUTANTS) - skipped
print('\n%d/%d mutants killed, %d skipped' % (killed, total, skipped))
sys.exit(1 if survived or skipped else 0)
