#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-parity-batch.py.

Each mutant breaks one claim the harness makes. The build is rerun because
the harness reads the BUILT page; a mutant that breaks the build is a kill.
Files are snapshotted and restored with a byte copy, never git checkout.
"""
import pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'src/styles/components.css'
PAGE = ROOT / 'src/pages/index.astro'
PY = '/root/.venvs/mau/bin/python'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'

MUTANTS = [
    # Injected at the END of the rule: a declaration placed first loses to the
    # rule's own later border-radius and the mutant is a no-op by construction.
    ('kbd rounds its corners', CSS, 'line-height: 1.6;\n\twhite-space: nowrap;\n}', 'line-height: 1.6;\n\twhite-space: nowrap;\n\tborder-radius: 3px;\n}'),
    ('pager refuses to wrap', CSS, '.cm-pager__list {', '.cm-pager__list {\n\tflex-wrap: nowrap !important;'),
    ('pager drops the tap floor', CSS, '.cm-pager__link {', '.cm-pager__link {\n\tmin-height: 0 !important; height: 30px;'),
    ('avatar is not square', CSS, '.cm-avatar {', '.cm-avatar {\n\tpadding-inline: 9px; width: auto !important;'),
    ('ratio box loses its ratio', CSS, 'aspect-ratio: var(--cm-ratio, 16 / 9);', 'aspect-ratio: auto;'),
    ('accordion is not exclusive', PAGE, 'name="faq"', 'name="faq-x"'),
]


def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True).returncode


snap = {p: p.read_bytes() for p in (CSS, PAGE)}
killed, noop, survived = 0, 0, []
try:
    for name, f, old, new in MUTANTS:
        text = f.read_text()
        if old not in text:
            print(f'  NOOP     {name} (pattern absent)')
            noop += 1
            continue
        f.write_text(text.replace(old, new, 1))
        if build() != 0:
            print(f'  KILLED   {name} (build failed)')
            killed += 1
        else:
            r = subprocess.run([PY, str(ROOT / 'tests/verify-parity-batch.py'), URL], capture_output=True, text=True)
            if r.returncode != 0:
                print(f'  KILLED   {name}')
                killed += 1
            else:
                print(f'  SURVIVED {name}')
                survived.append(name)
        for p, b in snap.items():
            p.write_bytes(b)
finally:
    for p, b in snap.items():
        p.write_bytes(b)
    build()

print(f'\n{killed}/{len(MUTANTS)} killed, {noop} no-op, {len(survived)} survived')
sys.exit(0 if killed == len(MUTANTS) else 1)
