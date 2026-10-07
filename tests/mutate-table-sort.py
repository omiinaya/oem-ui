#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-table-sort.py.

Each mutant breaks one claim the harness makes. Files are byte
snapshotted and restored; the build is rerun because the harness reads
the BUILT page.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'src/js/cli-mono.js'
CSS = ROOT / 'src/styles/components.css'
PAGE = ROOT / 'src/pages/index.astro'
PY = '/root/.venvs/mau/bin/python'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'

MUTANTS = [
    ('no click path at all', JS,
     "\tdocument.addEventListener('click', onTableSort);", ''),
    ('declared order never applied at load', JS,
     "\t\tcmInitSort(root);", ''),
    ('descending sorts like ascending', JS,
     "var sign = dir === 'descending' ? -1 : 1;", "var sign = 1;"),
    ('numbers compared as text', JS,
     "if (!/^[+-]?[\\d\\u00a0,\\s]+%?$/.test(v)) return null;",
     "return null;"),
    ('other columns keep their old state', JS,
     "other.setAttribute('aria-sort', other === th ? dir : 'none');",
     "other.setAttribute('aria-sort', other === th ? dir : other.getAttribute('aria-sort'));"),
    ('direction glyph never painted', CSS,
     "th[aria-sort='ascending'] button.cm-table__sort::after,\n"
     "th[aria-sort='descending'] button.cm-table__sort::after,\n",
     ''),
    ('showcase table does not opt in', PAGE, ' data-cm-sort>', '>'),
]


def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                          capture_output=True).returncode


snap = {p: p.read_bytes() for p in (JS, CSS, PAGE)}
killed, noop, survived = 0, 0, []
try:
    for name, f, old, new in MUTANTS:
        text = f.read_text()
        n = text.count(old)
        if n != 1:
            print(f'  NOOP     {name} (pattern count {n})')
            noop += 1
            continue
        f.write_text(text.replace(old, new, 1))
        if build() != 0:
            print(f'  KILLED   {name} (build failed)')
            killed += 1
        else:
            r = subprocess.run([PY, str(ROOT / 'tests/verify-table-sort.py'), URL],
                               capture_output=True, text=True)
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
