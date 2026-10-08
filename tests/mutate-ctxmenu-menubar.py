#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 9: context menu + menubar.

Logs each result to stdout AND /root/.hermes/cache/scratch/mut9.txt so a
long run that outlives its caller still reports."""
import pathlib, subprocess, sys, time

ROOT = pathlib.Path('/root/projects/oem-ui')
CSS = ROOT / 'src/styles/components.css'
JS = ROOT / 'src/js/cli-mono.js'
PAGE = ROOT / 'src/pages/index.astro'
CLI = ROOT / 'tests/verify-ctxmenu-menubar.py'
LOG = pathlib.Path('/root/.hermes/cache/scratch/mut9.txt')

HARNESS = [str(ROOT / 'tests/verify-ctxmenu-menubar.py')]
PY = '/root/.venvs/mau/bin/python'

MUTANTS = [
    # --- context menu (WebKit) ---
    ('the OS menu is not suppressed', JS,
     "\t\t// The OS menu is the thing being replaced. Without this the panel\n"
     "\t\t// opens underneath the browser's own, which nobody can see.\n"
     "\t\te.preventDefault();\n",
     "\t\t// The OS menu is the thing being replaced. Without this the panel\n"
     "\t\t// opens underneath the browser's own, which nobody can see.\n"),
    ('the keyboard has no way in', JS,
     "\t\tvar x = e.clientX, y = e.clientY;\n"
     "\t\tif (!x && !y && typeof trg.getBoundingClientRect === 'function') {\n"
     "\t\t\tvar r = trg.getBoundingClientRect();\n"
     "\t\t\tx = r.left;\n"
     "\t\t\ty = r.bottom + 4;\n"
     "\t\t}\n"
     "\t\tmenu.__cmCtx = { x: x, y: y };\n",
     "\t\tmenu.__cmCtx = { x: e.clientX, y: e.clientY };\n"),
    ('the pointer is never stashed', JS,
     "\t\tmenu.__cmCtx = { x: x, y: y };\n", ""),
    ('the anchor refuses a pointer-only menu', JS,
     "if (!trigger && !at) return;", "if (!trigger) return;"),
    ('the panel is never put at the point', JS,
     "\t\t\t\t// ...and it still has to be PUT there: pinPopover() is what\n"
     "\t\t\t\t// anchored every other panel, and this branch replaces it.\n"
     "\t\t\t\tanchorPopover(menu);\n", ""),
    ('the point is not clamped inside the viewport', JS,
     "if (cx + w > window.innerWidth - pad) cx = window.innerWidth - w - pad;", ""),
    ('the panel never closes on scroll', JS,
     "\t\t\t\twindow.addEventListener('scroll', popPin, { passive: true });\n", ""),
    ('Escape does not dismiss it', JS,
     "\t\tdocument.addEventListener('keydown', onCtxEscape, true);", ""),
    ('an outside press does not dismiss it', JS,
     "\t\tdocument.addEventListener('pointerdown', onCtxOutside, true);", ""),
    ('focus is never returned', JS,
     "if (inside && back && typeof back.focus === 'function') back.focus();", ""),
    # --- menubar (WebKit) ---
    ('aria-expanded never flips', JS,
     "trig.setAttribute('aria-expanded', menu.matches(':popover-open') ? 'true' : 'false');", ""),
    ('the words do not walk', JS,
     "\t\tnext.focus();\n\t\tvar nid = next.getAttribute('popovertarget');", ""),
    ('ArrowDown does not open the focused word', JS,
     "if (trg && e.key === 'ArrowDown') {", "if (trg && e.key === 'F15') {"),
    ('the panel right-aligns like a chevron menu', JS,
     "\t\tvar start = menu.classList && (menu.classList.contains('cm-popover') ||\n"
     "\t\t\t\tmenu.classList.contains('cm-menubar__menu'));",
     "\t\tvar start = menu.classList && menu.classList.contains('cm-popover');"),
    # --- stylesheet (contract suite) ---
    ('cells are divided by a hairline', CSS,
     "\tborder-right: 1px solid var(--line);\n", ""),
    ('the panel is left in the flow', CSS,
     ".cm-menubar__menu {\n\tposition: fixed;\n\tinset: auto;\n\tmin-width: 12rem;\n}",
     ".cm-menubar__menu {\n\tmin-width: 12rem;\n}"),
]

log = []


def w(msg):
    log.append(msg)
    with LOG.open('a') as f:
        f.write(msg + '\n')
    print(msg, flush=True)


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                          errors='replace', **kw)


def baseline():
    r = run([PY] + HARNESS)
    return r.returncode == 0, r.stdout[-400:]


LOG.write_text('')

# Every pattern is checked BEFORE anything is mutated: a skip discovered
# mid-run is a hole in the proof that reports as if it were one. Two of
# these were already written against what the code *should* have said.
missing = [n for n, path, old_, _ in MUTANTS if old_ not in path.read_text()]
if missing:
    w('PATTERN ABSENT, refusing to run a proof with holes: ' + ', '.join(missing))
    sys.exit(3)

t0 = time.time()
ok, tail = baseline()
if not ok:
    w('baseline is RED - not a fault, refusing to start\n' + tail)
    sys.exit(2)
w('baseline GREEN\n')

killed = survived = 0
for name, path, old, new in MUTANTS:
    src = path.read_text()
    if old not in src:
        w(f'SKIPPED (pattern absent) {name}')
        continue
    path.write_text(src.replace(old, new, 1))
    try:
        if path == JS:
            assert run(['node', '--check', 'src/js/cli-mono.js']).returncode == 0, 'mutant is invalid JS'
            run(['npm', 'run', 'build'])
        if path in (CSS, PAGE):
            run(['npm', 'run', 'build'])
        is_suite = path == CSS
        cmd = ['node', 'tests/run.mjs'] if is_suite else [PY] + HARNESS
        r = run(cmd, timeout=240)
        failed = [ln for ln in r.stdout.splitlines()
                  if ln.startswith('FAIL') or 'FAIL  ' in ln]
        if r.returncode != 0 or failed:
            killed += 1
            w(f'KILLED   {name}')
            for ln in failed[:2]:
                w('         ' + ln.strip()[:170])
        else:
            survived += 1
            w(f'SURVIVED {name}')
    except subprocess.TimeoutExpired:
        survived += 1
        w(f'SURVIVED {name} (harness timeout)')
    finally:
        path.write_text(src)

run(['npm', 'run', 'build'])
w(f'\n{killed}/{killed + survived} mutants killed, {survived} survived')
w(f'elapsed {time.time() - t0:.0f}s')
sys.exit(0 if survived == 0 else 1)
