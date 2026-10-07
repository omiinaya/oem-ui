#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-otp-palette.py. Byte-snapshot restore
of both source files, rebuild each time, named failing checks only."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'src/js/cli-mono.js'
CSS = ROOT / 'src/styles/components.css'
PY = '/root/.venvs/mau/bin/python'

MUTANTS = [
    (JS, 'a typed digit stops advancing focus',
     "\t\t\t\t\tel.value = e.key;\n\t\t\t\t\tfocusAt(i + 1);",
     "\t\t\t\t\tel.value = e.key;"),
    (JS, 'backspace retreats straight through a filled cell',
     "if (el.value) el.value = '';\n\t\t\t\t\telse if (i > 0)",
     "if (false) el.value = '';\n\t\t\t\t\telse if (i > 0)"),
    (JS, 'the paste path goes dead',
     "group.addEventListener('paste'", "group.addEventListener('nope'"),
    (JS, 'the query only matches at the start of a row',
     "it.textContent.toLowerCase().indexOf(q) !== -1",
     "it.textContent.toLowerCase().indexOf(q) === 0"),
    (JS, 'the active row is never marked',
     "it.classList.toggle('is-active', on);",
     "it.classList.toggle('is-active', false);"),
    (JS, 'the keyboard loses ArrowDown',
     "if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp'",
     "if (e.key !== 'ArrowDownX' && e.key !== 'ArrowUp'"),
    (JS, 'reopening remembers the last query',
     "dlg.addEventListener('close', function () {",
     "dlg.addEventListener('closeX', function () {"),
    (CSS, 'a filtered row keeps its box (the [hidden] rule)',
     ".cm-command .cm-command__item[hidden],",
     ".cm-command .cm-command__item[data-nope],"),
    (CSS, 'the list stops owning the scroll',
     "max-height: min(16rem, 45vh);\n\toverflow: auto;", "max-height: none;"),
]


def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True).returncode


snaps = {f: f.read_bytes() for f in (JS, CSS)}
killed, survived, skipped = 0, [], 0
try:
    for path, name, old, new in MUTANTS:
        text = path.read_text()
        if text.count(old) != 1:
            print('SKIP     %-52s (pattern x%d)' % (name, text.count(old)))
            skipped += 1
            continue
        path.write_text(text.replace(old, new, 1))
        build()
        r = subprocess.run([PY, str(ROOT / 'tests/verify-otp-palette.py')],
                           capture_output=True, text=True)
        fails = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith('FAIL')]
        if r.returncode != 0:
            print('KILLED   %-52s %s' % (name, (fails[0] if fails else '(no named failing check)')[:70]))
            killed += 1
        else:
            print('SURVIVED %s' % name)
            survived.append(name)
        path.write_bytes(snaps[path])
finally:
    for f, b in snaps.items():
        f.write_bytes(b)
    build()

total = len(MUTANTS) - skipped
print('\n%d/%d mutants killed, %d skipped' % (killed, total, skipped))
sys.exit(1 if survived or skipped else 0)
