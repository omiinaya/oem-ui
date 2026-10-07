#!/root/.venvs/mau/bin/python
"""Mutation proof for tests/verify-runtime-parity.py. Each mutant disables
one runtime behaviour; the WebKit harness must fail on every one.
Byte-snapshot restore, never git checkout."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'src/js/cli-mono.js'
PY = '/root/.venvs/mau/bin/python'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'

MUTANTS = [
    ('opening does not focus the menu', "if (first && typeof first.focus === 'function') first.focus();", ''),
    ('arrow keys unbound', "document.addEventListener('keydown', onMenuKey);", ''),
    ('disabled items not skipped', "return el.getAttribute('aria-disabled') !== 'true' && !el.disabled;", 'return true;'),
    ('ArrowDown does not wrap', "next = items[(i + 1) % items.length];", "next = items[Math.min(i + 1, items.length - 1)];"),
    ('single mode not exclusive', "o.setAttribute('aria-pressed', o === opt ? 'true' : 'false');", "if (o === opt) o.setAttribute('aria-pressed', 'true');"),
    ('multi mode behaves as single', "if (mode === 'multi') {", "if (mode === 'multi-x') {"),
    ('opt-in ignored (every seg managed)', "var group = opt.closest('[data-cm-seg]');", "var group = opt.closest('.cm-seg'); if (group && !group.hasAttribute('data-cm-seg')) group.setAttribute('data-cm-seg', 'single');"),
    ('clear fires no input event', "input.dispatchEvent(new Event('input', { bubbles: true }));", ''),
    ('clear does not refocus', "if (typeof input.focus === 'function') input.focus();\n\t}", '\n\t}'),
    ('clear does not empty', "if (desc && desc.set) desc.set.call(input, '');\n\t\telse input.value = '';", ''),
]


def build():
    return subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True).returncode


snap = JS.read_bytes()
killed, noop, survived = 0, 0, []
try:
    for name, old, new in MUTANTS:
        text = JS.read_text()
        if text.count(old) != 1:
            print(f'  NOOP     {name} (pattern count {text.count(old)})')
            noop += 1
            continue
        JS.write_text(text.replace(old, new, 1))
        if build() != 0:
            print(f'  KILLED   {name} (build failed)')
            killed += 1
        else:
            r = subprocess.run([PY, str(ROOT / 'tests/verify-runtime-parity.py'), URL], capture_output=True, text=True)
            if r.returncode != 0:
                print(f'  KILLED   {name}')
                killed += 1
            else:
                print(f'  SURVIVED {name}')
                survived.append(name)
        JS.write_bytes(snap)
finally:
    JS.write_bytes(snap)
    build()

print(f'\n{killed}/{len(MUTANTS)} killed, {noop} no-op, {len(survived)} survived')
sys.exit(0 if killed == len(MUTANTS) else 1)
