#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 11: the calendar, plus the hover-card clamp
this batch's 320px check depends on.

Byte-exact restore before every mutant; every pattern is PRE-CHECKED for
existence and uniqueness - a pattern that does not match reports PATTERN
ABSENT instead of dying silently, and a pattern that matches twice refuses
to guess. A crashed or timed-out harness counts as a KILL (it cannot pass),
but a killed run without a FAIL line is reported separately so a harness
that dies for its own reasons is never mistaken for a proof.

Logs to stdout AND the scratch file, so a run that outlives this session
still reports its numbers.
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
JS = ROOT / 'src/js/cli-mono.js'
CSS = ROOT / 'src/styles/components.css'
HARNESS = ROOT / 'tests/verify-calendar.py'
LOG = Path('/root/.hermes/cache/scratch/mut11.txt')

MUTANTS = [
    # ---- js: the keys ------------------------------------------------
    ('js', "\t\telse if (e.key === 'ArrowRight') next = calShift(iso, 1);",
     "\t\telse if (e.key === 'ArrowRight') next = iso;",
     'ArrowRight walks no further'),
    ('js', "\t\telse if (e.key === 'ArrowDown') next = calShift(iso, 7);",
     "\t\telse if (e.key === 'ArrowDown') next = calShift(iso, 1);",
     'ArrowDown walks one day instead of one week'),
    ('js', "\t\telse if (e.key === 'Home') next = calShift(iso, -calParse(iso).getUTCDay());",
     "\t\telse if (e.key === 'Home') next = iso;",
     'Home stays where it is'),
    ('js', "\t\telse if (e.key === 'End') next = calShift(iso, 6 - calParse(iso).getUTCDay());",
     "\t\telse if (e.key === 'End') next = iso;",
     'End stays where it is'),
    ('js', "\t\telse if (e.key === 'PageDown') next = calMonthShift(iso, e.shiftKey ? 12 : 1);",
     "\t\telse if (e.key === 'PageDown') next = calMonthShift(iso, e.shiftKey ? 12 : 7);",
     'PageDown steps a week, not a month'),
    ('js', "\t\telse if (e.key === 'PageUp') next = calMonthShift(iso, e.shiftKey ? -12 : -1);",
     "\t\telse if (e.key === 'PageUp') next = calMonthShift(iso, e.shiftKey ? -12 : -7);",
     'PageUp steps a week, not a month'),
    # ---- js: picking -------------------------------------------------
    ('js', "\t\t\t\tcal.removeAttribute('data-cm-cal-selected');\n\t\t\t} else {\n\t\t\t\tcal.setAttribute('data-cm-cal-selected', iso);",
     "\t\t\t\tcal.setAttribute('data-cm-cal-selected', iso);\n\t\t\t} else {\n\t\t\t\tcal.setAttribute('data-cm-cal-selected', iso);",
     'the selected day cannot be unselected any more'),
    ('js', "\t\tif (day && day.getAttribute('aria-disabled') === 'true') return;",
     "\t\tif (false) return;",
     'a disabled date accepts the pick'),
    ('js', "\t\t\tif (!start || end) {",
     "\t\t\tif (!start) {",
     'a complete range gets EDITED instead of restarted'),
    ('js', "\t\t\t} else if (iso < start) {",
     "\t\t\t} else if (false) {",
     'a click before the start cannot re-anchor'),
    ('js', "\t\t// The picked button just got REPLACED by the re-render, so without\n\t\t// this the click leaves focus on <body> and the next arrow key\n\t\t// lands nowhere. Focus follows the pick.\n\t\tcalFocus(cal, iso);",
     "\t\t// The picked button just got REPLACED by the re-render, so without\n\t\t// this the click leaves focus on <body> and the next arrow key\n\t\t// lands nowhere. Focus follows the pick.\n\t\tvoid 0;",
     'focus is dropped to <body> after a pick'),
    ('js', "\t\telse if (e.key === 'Escape') {",
     "\t\telse if (false) {",
     'Escape clears nothing'),
    # ---- js: the render ----------------------------------------------
    ('js', "\t\t\tif (isSel) attrs += ' aria-selected=\"true\"';",
     "\t\t\tif (false) attrs += ' aria-selected=\"true\"';",
     'the render stops writing aria-selected'),
    ('js', "\t\t\t\tattrs + ' tabindex=\"' + (day === active ? 0 : -1) + '\">' +",
     "\t\t\t\tattrs + ' tabindex=\"' + (-1) + '\">' +",
     'no day is ever the roving tab stop'),
    ('js', "\t\t\tif (d > lo && d < hi) b.setAttribute('data-preview', 'true');",
     "\t\t\tif (false) b.setAttribute('data-preview', 'true');",
     'the hover preview never draws'),
    # ---- js: the hover-card clamp (this batch's 320px check) ---------
    ('js', "\t\tcmClampHovercards(root);",
     "\t\tvoid 0;",
     'the hover card is never clamped'),
    # ---- css ----------------------------------------------------------
    ('css', "\twidth: min(calc(var(--tap) * 7), 100%);",
     "\twidth: auto;",
     'the grid sizes itself again (columns drift off --tap)'),
    ('css', "\t.cm-cal__grid th { width: calc(100% / 7); }\n",
     "",
     'the tiny viewport loses its shrinking columns (320px overflows again)'),
    ('css', "\t.cm-cal__day { width: min(var(--tap), 100%); }\n",
     "",
     'the tiny viewport days stop following their columns'),
    ('css', ".cm-cal__day[aria-selected='true'] {\n\tborder-color: var(--ink);\n\tbackground: var(--ink);\n\tcolor: var(--bg);\n}",
     ".cm-cal__day[aria-selected='true'] {\n\tborder-color: var(--ink);\n\tbackground: transparent;\n\tcolor: var(--bg);\n}",
     'selection stops being inversion'),
    ('css', ".cm-cal__day[aria-current='date'] {\n\tborder-color: var(--ink-dim);",
     ".cm-cal__day[aria-current='date'] {\n\tborder-color: transparent;",
     'today loses its ring'),
    ('css', ".cm-cal__day[data-outside] { color: var(--ink-faint); }",
     ".cm-cal__day[data-outside] { color: inherit; }",
     'outside days stop dimming'),
    ('css', "\tbackground: var(--panel);\n\toverflow-x: auto;\n}",
     "\tbackground: var(--panel);\n}",
     'the card stops scrolling its grid'),
]


def log(line):
    print(line, flush=True)
    with LOG.open('a') as f:
        f.write(line + '\n')


def apply(kind, old, new):
    path = JS if kind == 'js' else CSS
    src = path.read_text()
    n = src.count(old)
    if n == 0:
        return None, 'PATTERN ABSENT'
    if n > 1:
        return None, f'PATTERN AMBIGUOUS ({n} matches)'
    path.write_text(src.replace(old, new, 1))
    return src, None


def build():
    r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        log('BUILD FAILED:\n' + r.stdout[-1500:])
    return r.returncode == 0


def run_harness():
    t0 = time.time()
    try:
        r = subprocess.run(['/root/.venvs/mau/bin/python', str(HARNESS)],
                           cwd=ROOT, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'')
        if isinstance(out, bytes):
            out = out.decode('utf-8', 'replace')
        return 'KILLED', 'HARNESS TIMEOUT: ' + out[-600:], time.time() - t0
    out = (r.stdout or '') + (r.stderr or '')
    tail = [ln for ln in out.splitlines() if ln.startswith('FAIL') or 'passed,' in ln]
    if r.returncode == 0:
        return 'SURVIVED', '\n'.join(tail[-6:]) or 'no verdict', time.time() - t0
    return 'KILLED', '\n'.join(tail[-8:]) or 'exit!=0 without FAIL lines', time.time() - t0


def main():
    js0, css0 = JS.read_bytes(), CSS.read_bytes()
    LOG.write_text('')
    log(f'snapshot js={len(js0)} css={len(css0)}')
    killed = survived = absent = ambiguous = nofail = 0
    try:
        for i, (kind, old, new, name) in enumerate(MUTANTS, 1):
            JS.write_bytes(js0)
            CSS.write_bytes(css0)
            src, err = apply(kind, old, new)
            if err:
                log(f'{i:2d} {err} - {name}')
                if err == 'PATTERN ABSENT':
                    absent += 1
                else:
                    ambiguous += 1
                continue
            if not build():
                JS.write_bytes(js0)
                CSS.write_bytes(css0)
                log(f'{i:2d} KILLED(build) - {name}')
                killed += 1
                continue
            verdict, detail, secs = run_harness()
            if verdict == 'SURVIVED':
                survived += 1
            elif verdict == 'KILLED':
                killed += 1
                if 'without FAIL lines' in detail or 'TIMEOUT' in detail:
                    nofail += 1
            log(f'{i:2d} {verdict} - {name} :: {detail} ({secs:.0f}s)')
    finally:
        JS.write_bytes(js0)
        CSS.write_bytes(css0)
        build()
    log('')
    log(f'killed={killed} survived={survived} absent={absent} ambiguous={ambiguous} '
        f'killed-without-fail-line={nofail}')
    if survived or absent or ambiguous:
        log('MUTATION PROOF FAIL')
        sys.exit(1)
    log('MUTATION PROOF PASS')


if __name__ == '__main__':
    main()
