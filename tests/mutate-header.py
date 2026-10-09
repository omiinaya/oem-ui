#!/root/.venvs/mau/bin/python
"""Mutation proof for the header-geometry checks (bar vs rail).

Byte-exact patterns, pre-checked with --scan, a build in EVERY window
(the harness drives the page, so dist must match the source under test),
snapshot restored with cp (never `git checkout --` on a file other
work may be touching), and the restore itself verified. A crash, a
timeout, a failed build or a missing-green run is a KILL, never a
survival: only rc == 0 survives, and the summary is printed from the
same two counters the loop increments.

Why these mutants, and what each one is for:

- `the bar is sized to the window` is the DECISIVE one. It reintroduces
  the reported defect literally - `height: 100vh` on the base
  `.cm-header` - and it is the mutant the new checks exist to kill. If
  that one ever survives, the harness is measuring something else.
- `the rail spans the full viewport` drops `width: var(--rail-w)` from
  the fixed rule. Same 232x900 box becomes 1280x900: the exact "900px
  header" a height-only probe would report as broken, without touching a
  single height. It is the mutant that proves the width assertion is
  doing work the height assertions cannot.
- `the rail scrolls with the page` turns `position: fixed` into
  `sticky`: a rail that leaves the viewport is not a rail, and no height
  read can see it.
- `the phone nav row becomes the viewport` puts `height: 100vh` inside
  `max-width: 640px` - the same defect wearing the phone's clothes, and
  the guard that keeps the phone path (63px sticky) from ever being the
  thing that breaks.
- `the rail's bound is a hardcoded 900px` is deliberately SUITE-ONLY:
  at 1280x900 a hardcoded 900 measures identical to 100vh, so the
  browser cannot see it. Only the source assertion can, which is the
  layering claim - and the survivor analysis below is where it is
  recorded rather than hidden.
- `the content stops clearing the rail` removes the shell's padding-left
  offset: the page then slides UNDER the rail, which both layers see
  (geometry: padLeft < railW; source: the offset declaration).
- `the harness forgets the desktop width` drops 1280 from WIDTHS in the
  harness itself. Nothing in the browser can catch a check that no
  longer runs - the suite's pin on the harness's own width list is the
  only oracle, which is why that pin exists.

Deliberately NOT here: `flex-wrap: nowrap` on the rail's column and the
drawer's own nowrap. Those are the wrap-across-height family and are
already mutation-proved by tests/mutate-rail.py against
tests/verify-rail-short-window.py; re-proving them here would claim a
kill for an oracle this file does not run.
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-header-geometry.py']

CSS = 'src/styles/components.css'
GEO = 'tests/verify-header-geometry.py'

PATTERNS = [
    # ---- the reported defect, reintroduced literally ----
    ('the bar is sized to the window',
     CSS,
     ".cm-header {\n"
     "\tposition: sticky;\n"
     "\ttop: 0;\n"
     "\tz-index: var(--z-header);",
     ".cm-header {\n"
     "\tposition: sticky;\n"
     "\ttop: 0;\n"
     "\theight: 100vh;\n"
     "\tz-index: var(--z-header);",
     'suite+harness'),

    # ---- the rail keeps the height and loses the bound ----
    ('the rail spans the full viewport',
     CSS,
     "\t.cm-header--rail {\n"
     "\t\tposition: fixed;\n"
     "\t\tinset-block: 0;\n"
     "\t\tinset-inline-start: 0;\n"
     "\t\twidth: var(--rail-w);\n",
     "\t.cm-header--rail {\n"
     "\t\tposition: fixed;\n"
     "\t\tinset-block: 0;\n"
     "\t\tinset-inline-start: 0;\n",
     'suite+harness'),

    ('the rail scrolls with the page',
     CSS,
     "\t.cm-header--rail {\n"
     "\t\tposition: fixed;\n",
     "\t.cm-header--rail {\n"
     "\t\tposition: sticky;\n",
     'suite+harness'),

    # ---- the phone path ----
    ('the phone nav row becomes the viewport',
     CSS,
     "\t.cm-header__nav {\n"
     "\t\theight: auto;\n"
     "\t\tmin-height: 60px;",
     "\t.cm-header__nav {\n"
     "\t\theight: 100vh;\n"
     "\t\tmin-height: 60px;",
     'suite+harness'),

    # ---- the bound that only the SOURCE can see ----
    ("the rail's bound is a hardcoded 900px",
     CSS,
     "\t\theight: 100vh;\n"
     "\t\toverflow: hidden;\n"
     "\t}",
     "\t\theight: 900px;\n"
     "\t\toverflow: hidden;\n"
     "\t}",
     'suite'),

    # ---- the content must clear the rail ----
    ('the content stops clearing the rail',
     CSS,
     "\t.cm-shell--rail {\n"
     "\t\tpadding-left: calc(var(--rail-w) + var(--gutter));\n",
     "\t.cm-shell--rail {\n"
     "\t\tpadding-left: 0;\n",
     'suite+harness'),

    # ---- the harness's own coverage ----
    ('the harness forgets the desktop width',
     GEO,
     "WIDTHS = [(320, 667), (390, 667), (402, 667), (768, 900), (1280, 900)]",
     "WIDTHS = [(320, 667), (390, 667), (402, 667), (768, 900)]",
     'suite'),
]


def run(cmd, timeout=600, capture=True):
    """capture_output must NOT be used on the build: npm's inherited stdio
    lives in pytest's capture machinery and crashes it."""
    p = subprocess.run(cmd, cwd=ROOT, timeout=timeout, capture_output=capture)
    out = p.stdout.decode('utf8', 'replace') if capture else ''
    return p.returncode, out


def main():
    if '--scan' in sys.argv:
        bad = 0
        for name, rel, pat, _mut, _who in PATTERNS:
            n = (ROOT / rel).read_text().count(pat)
            if n != 1:
                print(f'PATTERN AMBIGUOUS/ABSENT ({n}) - {name}')
                bad += 1
        print(f'{len(PATTERNS) - bad}/{len(PATTERNS)} patterns present')
        return 1 if bad else 0

    rc, _ = run(BUILD)
    assert rc == 0, 'baseline build failed'
    rc, out = run(SUITE)
    assert rc == 0 and ' 0 failed' in out, f'baseline suite not green:\n{out[-2000:]}'
    rc, out = run(HARNESS)
    assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
    print('baseline suite green | baseline harness green', flush=True)

    killed = survived = 0
    for name, rel, pat, mut, who in PATTERNS:
        target = ROOT / rel
        snapshot = target.with_suffix(target.suffix + '.mutate-header.bak')
        original = target.read_text()
        assert original.count(pat) == 1, f'PATTERN ABSENT for {name}'
        shutil.copy2(target, snapshot)
        target.write_text(original.replace(pat, mut, 1))
        try:
            rc_build, _ = run(BUILD)
            if rc_build != 0:
                raise AssertionError('mutant build broke')
            verdicts = []
            if 'suite' in who:
                rc_s, _out_s = run(SUITE)
                verdicts.append(rc_s)
            if 'harness' in who:
                rc_h, _out_h = run(HARNESS)
                verdicts.append(rc_h)
            # rc != 0 is a kill WHETHER or not a FAIL line was printed: a
            # crash mid-run is a kill, never a survival. Only rc == 0 survives.
            if verdicts and all(v == 0 for v in verdicts):
                print(f'  SURVIVED - {name}', flush=True)
                survived += 1
            else:
                print(f'  killed - {name}', flush=True)
                killed += 1
        except subprocess.TimeoutExpired:
            print(f'  killed (timeout) - {name}', flush=True)
            killed += 1
        except Exception as e:
            print(f'  killed (BUILD/CRASH) - {name}: {e}', flush=True)
            killed += 1
        finally:
            shutil.copy2(snapshot, target)
            snapshot.unlink()
            assert target.read_text() == original, f'RESTORE FAILED for {name}'

    print(f'killed={killed} survived={survived} of {len(PATTERNS)}', flush=True)
    run(BUILD)
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
