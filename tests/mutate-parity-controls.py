#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-parity-controls.py. Each mutant is
injected at the END of its rule so it wins the cascade (a first-position
injection is a no-op by construction). Byte-snapshot restore, never git."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/styles/components.css'
PY = '/root/.venvs/mau/bin/python'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'

MUTANTS = [
    ('danger loses its cross', '.cm-btn--danger::before { content: \'\\2715\\00a0\'; }', '.cm-btn--danger::before { content: none; }'),
    ('danger loses its heavier rule', "\tbox-shadow: inset 0 0 0 1px var(--ink);\n}\n.cm-btn--danger::before", "\tbox-shadow: none;\n}\n.cm-btn--danger::before"),
    ('danger rounds', "\tbox-shadow: inset 0 0 0 1px var(--ink);\n}\n.cm-btn--danger::before", "\tbox-shadow: inset 0 0 0 1px var(--ink);\n\tborder-radius: 4px;\n}\n.cm-btn--danger::before"),
    ('joined group keeps a gap', '.cm-btn-group--joined { gap: 0;', '.cm-btn-group--joined { gap: 8px;'),
    ('joined seam stays double', '.cm-btn-group--joined > .cm-btn + .cm-btn { border-left-width: 0; }', '.cm-btn-group--joined > .cm-btn + .cm-btn { border-left-width: 1px; }'),
    ('left sheet sticks to the right', '.cm-dialog--sheet-left {\n\tmargin: 0 auto 0 0;', '.cm-dialog--sheet-left {\n\tmargin: 0 0 0 auto;'),
    ('top sheet fills the viewport', '\theight: auto;\n\tmax-height: min(24rem, 100%);', '\theight: 100%;\n\tmax-height: 100%;'),
    ('bottom sheet sticks to the top', '.cm-dialog--sheet-bottom {\n\tmargin: auto 0 0 0;', '.cm-dialog--sheet-bottom {\n\tmargin: 0 0 auto 0;'),
]

def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True).returncode

snap = CSS.read_bytes()
killed, noop, survived = 0, 0, []
try:
    for name, old, new in MUTANTS:
        text = CSS.read_text()
        if text.count(old) != 1:
            print(f'  NOOP     {name} (pattern count {text.count(old)})')
            noop += 1
            continue
        CSS.write_text(text.replace(old, new, 1))
        if build() != 0:
            print(f'  KILLED   {name} (build failed)')
            killed += 1
        else:
            r = subprocess.run([PY, str(ROOT / 'tests/verify-parity-controls.py'), URL], capture_output=True, text=True)
            if r.returncode != 0:
                print(f'  KILLED   {name}')
                killed += 1
            else:
                print(f'  SURVIVED {name}')
                survived.append(name)
        CSS.write_bytes(snap)
finally:
    CSS.write_bytes(snap)
    build()

print(f'\n{killed}/{len(MUTANTS)} killed, {noop} no-op, {len(survived)} survived')
sys.exit(0 if killed == len(MUTANTS) else 1)
