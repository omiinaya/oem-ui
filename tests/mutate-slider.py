#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-slider.py.

Each mutant breaks one claim the harness makes - the inversion, the
framed rail, the square thumb, the fill, the boot paint, the delegated
listener. Files are byte-snapshotted and restored, the build is rerun
because the harness reads dist, and a survivor means the harness would
pass on broken code.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path('/root/projects/oem-ui')
VENV = '/root/.venvs/mau/bin/python'
FILES = ['src/styles/components.css', 'src/js/cli-mono.js']
CSS = 'src/styles/components.css'
JS = 'src/js/cli-mono.js'

MUTANTS = [
    ('outline does not invert', CSS,
     '.cm-btn--outline:hover,\n.cm-btn--outline:focus-visible {\n\tbackground: var(--ink);',
     '.cm-btn--outline:hover,\n.cm-btn--outline:focus-visible {\n\tbackground: var(--bg-2);'),
    ('rail loses its frame', CSS,
     '\tborder: 1px solid var(--line);\n}\ninput.cm-slider::-webkit-slider-thumb {',
     '\tborder: 0;\n}\ninput.cm-slider::-webkit-slider-thumb {'),
    ('thumb is round', CSS,
     '\tborder: 1px solid var(--bg);\n\tborder-radius: 0;\n}\ninput.cm-slider::-moz-range-track {',
     '\tborder: 1px solid var(--bg);\n\tborder-radius: 50%;\n}\ninput.cm-slider::-moz-range-track {'),
    ('fill never paints', CSS,
     'linear-gradient(to right,\n\t\t\tvar(--ink) var(--cm-slider, 0%),\n\t\t\ttransparent var(--cm-slider, 0%)),\n\t\tvar(--bg-3);',
     'var(--bg-3);'),
    ('init never paints the fill', JS,
     '\t\tcmInitSliders(root);', ''),
    ('the fill ignores the input event', JS,
     "\t\tdocument.addEventListener('input', onSliderInput);", ''),
    ('the fill reads a constant', JS,
     "el.style.setProperty('--cm-slider', pct + '%');",
     "el.style.setProperty('--cm-slider', '100%');"),
    ('the readout stops following', JS,
     'if (out) out.textContent = el.value;', 'if (out) out.textContent = out.textContent;'),
]

def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)

snapshots = {f: (ROOT / f).read_bytes() for f in FILES}
survivors = []
try:
    for name, rel, old, new in MUTANTS:
        p = ROOT / rel
        src = p.read_bytes().decode()
        n = src.count(old)
        if n != 1:
            print('SKIP  %-34s pattern occurs %d times' % (name, n))
            survivors.append(name)
            continue
        p.write_bytes(src.replace(old, new, 1).encode())
        run(['npm', 'run', 'build'])
        r = run([VENV, 'tests/verify-slider.py'])
        out = r.stdout + r.stderr
        fails = [l.strip() for l in out.splitlines() if l.startswith('FAIL')]
        print('%s  %-34s %s' % ('killed' if r.returncode else 'SURVIVOR', name,
                                fails[0] if fails else '(no failing check)'))
        if r.returncode == 0:
            survivors.append(name)
        p.write_bytes(snapshots[rel])
finally:
    for f, data in snapshots.items():
        (ROOT / f).write_bytes(data)
    run(['npm', 'run', 'build'])

print('\n%d/%d mutants killed' % (len(MUTANTS) - len(survivors), len(MUTANTS)))
sys.exit(1 if survivors else 0)
