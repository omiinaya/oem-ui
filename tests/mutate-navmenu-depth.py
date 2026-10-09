#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 23: navigation menu depth.

Byte-exact patterns, pre-checked with --scan, a build in every window
(the harness drives the page, so dist must match the source under test),
restore verified, rebuild at the end. A crash, timeout or missing FAIL
line is a kill - never a survival: only rc == 0 survives.

The `who` field names the oracle EXPECTED to kill the pattern, after
analysis rather than hope:

- the media-gate string, the two delay constants, the absolute rail box,
  the swap animation and the reduced-motion listing are CONTRACTS the
  behaviour cannot see (the harness runs on a fine pointer that matches
  any weaker gate; a wider delay still opens within its own wait), so
  they are suite pins.
- the click-release mutant is suite-invisible on purpose: the suite
  pins `bar.__cmNavHoverOwned = 0;` and the grace timer carries the
  same line, so the pin survives a killed release - only the harness's
  sticky read sees it.
- the hover-open claim, the timer guard and the grace close are driven
  only by the harness's timed phases.

Equivalent mutants are skipped deliberately, not survived: the
width:100% on a vertical trigger (a column flex with align-items:
stretch renders width:auto identically - the declaration is intent,
not behaviour).

Skipped as undriven rather than survived: navHoverOpen's viewport
trigger assignment (the harness opens the viewport bar by click, and
the fill's popTrigger fallback lands the same word), and the two
specimen lede sentences (the suite pins them; a harness read would be
prose duplicated as behaviour).
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-navmenu.py']

JS = 'src/js/cli-mono.js'
CSS = 'src/styles/components.css'
ASTRO = 'src/pages/index.astro'

PATTERNS = [
    # ---- delayed hover: the two constants and the gate ----
    ('the open delay outlives every hover the harness performs',
     JS, "var NAV_HOVER_OPEN_MS = 200;",
     "var NAV_HOVER_OPEN_MS = 600;", 'suite+harness'),

    ('the grace outlives the leave window the harness reads',
     JS, "var NAV_HOVER_LEAVE_MS = 300;",
     "var NAV_HOVER_LEAVE_MS = 700;", 'suite+harness'),

    ('the gate drops the coarse-pointer clause',
     JS, "window.matchMedia('(hover: hover) and (pointer: fine)').matches",
     "window.matchMedia('(hover: hover)').matches", 'suite'),

    ('the timer opens even after the pointer has left',
     JS, "if (bar.__cmNavHoverLast !== trigger || !navFine()) return;",
     "if (bar.__cmNavHoverLast === trigger && navFine()) return;",
     'harness'),

    ('the hover stops owning what it opened',
     JS, "bar.__cmNavHoverOwned = 1;",
     "bar.__cmNavHoverOwned = 0;", 'suite+harness'),

    ('a click leaves the panel hover-owned (sticky dies)',
     JS, "if (!bar) return;\n\t\tbar.__cmNavHoverOwned = 0;",
     "if (!bar) return;\n\t\tbar.__cmNavHoverOwned = 1;", 'harness'),

    # ---- the shared viewport ----
    ('the second word toggles instead of swapping',
     JS, "if (viewport.matches(':popover-open') && viewport.__cmNavTrigger !== trigger) {\n"
         "\t\t\te.preventDefault();",
     "if (viewport.matches(':popover-open') && viewport.__cmNavTrigger !== trigger) {\n"
         "\t\t\tvoid 0;", 'harness'),

    ('the toggle task opens an empty viewport',
     JS, "navViewportFill(menu);\n"
         "\t\t\t\tmenu.setAttribute('data-state', 'open');",
     "menu.setAttribute('data-state', 'open');", 'harness'),

    ('data-state never announces open',
     JS, "menu.setAttribute('data-state', 'open');",
     "menu.setAttribute('data-state', 'closed');", 'suite+harness'),

    ('closing leaves the other word claiming open',
     JS, "navViewportExpand(menu, null);",
     "void menu;", 'suite+harness'),

    ('the arrow walk keeps the old word in the trigger slot',
     JS, "shared.__cmNavTrigger = next;",
     "shared.__cmNavTrigger = null;", 'suite+harness'),

    ('the walk leaves the panel at the old coordinates',
     JS, "anchorPopover(shared);",
     "void shared;", 'suite+harness'),

    ('the fill resolves the trigger without the recorded door',
     JS, "var trigger = viewport.__cmNavTrigger || popTrigger(viewport);",
     "var trigger = popTrigger(viewport);", 'suite+harness'),

    ('the fill clones nothing into the panel',
     JS, "viewport.appendChild(src.content.cloneNode(true));",
     "viewport.appendChild(src.content.cloneNode(false));", 'harness'),

    # ---- the painter's second axis ----
    ('the painter stops writing the height knob',
     JS, "ind.style.setProperty('--cm-navmenu-h', Math.round(r.height) + 'px');",
     "ind.style.setProperty('--cm-navmenu-hh', Math.round(r.height) + 'px');",
     'suite+harness'),

    ('the painter stops writing the top knob',
     JS, "ind.style.setProperty('--cm-navmenu-y', Math.round(r.top - b.top) + 'px');",
     "ind.style.setProperty('--cm-navmenu-yy', Math.round(r.top - b.top) + 'px');",
     'suite+harness'),

    ('a cleared mark keeps its stale height',
     JS, "ind.style.removeProperty('--cm-navmenu-h');",
     "ind.style.removeProperty('--cm-navmenu-hh');", 'suite'),

    # ---- hover binding and the grace itself ----
    ('the bar never hears the pointer arrive',
     JS, "document.addEventListener('pointerover', onNavmenuOver);",
     "void onNavmenuOver;", 'harness'),

    ('the grace runs but closes nothing',
     JS, "if (bar.__cmNavHoverOwned) navHoverClose(bar);",
     "if (false) navHoverClose(bar);", 'harness'),

    # ---- CSS ----
    ('the hover recolor returns to every pointer',
     CSS, "@media (hover: hover) and (pointer: fine) {\n"
          "\t.cm-navmenu__trigger:hover {",
     "@media (pointer: fine) {\n"
          "\t.cm-navmenu__trigger:hover {", 'suite'),

    ('the vertical bar stops stacking',
     CSS, ".cm-navmenu[data-orientation='vertical'] {\n"
          "\tposition: relative;\n"
          "\tflex-direction: column;",
     ".cm-navmenu[data-orientation='vertical'] {\n"
          "\tposition: relative;\n"
          "\tflex-direction: row;", 'suite+harness'),

    # (the width:100% mutant was cut as EQUIVALENT: in a column flex
    #  with align-items: stretch, width:auto and width:100% render
    #  identically - nothing can distinguish them, so nothing should
    #  claim to.)

    ('the rail re-enters the flex column',
     CSS, ".cm-navmenu[data-orientation='vertical'] .cm-navmenu__indicator {\n"
          "\tposition: absolute;",
     ".cm-navmenu[data-orientation='vertical'] .cm-navmenu__indicator {\n"
          "\tposition: relative;", 'suite'),

    ('the rail paints the ROW knob instead of the height',
     CSS, ".cm-navmenu[data-orientation='vertical'] .cm-navmenu__indicator::after {\n"
          "\twidth: 100%;\n"
          "\theight: var(--cm-navmenu-h, 0);",
     ".cm-navmenu[data-orientation='vertical'] .cm-navmenu__indicator::after {\n"
          "\twidth: 100%;\n"
          "\theight: var(--cm-navmenu-w, 0);", 'suite+harness'),

    ('the incoming list stops painting',
     CSS, "\tanimation: cm-navmenu-swap 120ms var(--cm-ease) both;",
     "\tanimation: none;", 'suite'),

    ('the swap animation vanishes from reduced motion',
     CSS, "\t.cm-navmenu__panel[data-state='open'] > *,\n",
     "", 'suite'),

    # ---- the specimen ----
    ('the bar stops naming its shared panel',
     ASTRO, 'data-cm-navmenu-viewport="nav-viewport"',
     'data-cm-navmenu-viewport="nav-viewport-x"', 'suite+harness'),

    ('the first word names a template nothing carries',
     ASTRO, 'data-cm-navmenu-content="#nav-tpl-product"',
     'data-cm-navmenu-content="#nav-tpl-none"', 'suite+harness'),

    ('the second word names a template nothing carries',
     ASTRO, 'data-cm-navmenu-content="#nav-tpl-reference"',
     'data-cm-navmenu-content="#nav-tpl-none"', 'suite+harness'),

    ('the panel stops declaring itself the viewport',
     ASTRO, 'popover data-cm-viewport data-state="closed"',
     'popover data-state="closed"', 'suite+harness'),

    ('the vertical bar stops declaring itself vertical',
     ASTRO, 'data-cm-navmenu data-orientation="vertical"',
     'data-cm-navmenu data-orientation="horizontal"', 'suite+harness'),

    ('the template links at nothing the page has',
     ASTRO, '<template id="nav-tpl-product">\n'
         '\t\t\t\t\t\t\t<a class="cm-navmenu__link" href="#buttons"',
     '<template id="nav-tpl-product">\n'
         '\t\t\t\t\t\t\t<a class="cm-navmenu__link" href="#buttons-x"',
     'harness'),
]


def run(cmd, timeout=600, capture=True):
    """capture_output must NOT be used on the build: npm's inherited
    stdio lives in pytest's capture machinery and crashes it."""
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
    rc, out = run(SUITE, capture=True)
    assert rc == 0 and ' 0 failed' in out, f'baseline suite not green:\n{out[-2000:]}'
    rc, out = run(HARNESS, capture=True)
    assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
    print('baseline suite green | baseline harness green', flush=True)

    killed = survived = 0
    for name, rel, pat, mut, who in PATTERNS:
        target = ROOT / rel
        original = target.read_text()
        assert original.count(pat) == 1, f'PATTERN ABSENT for {name}'
        target.write_text(original.replace(pat, mut, 1))
        try:
            rc_build, _ = run(BUILD)
            assert rc_build == 0, 'mutant build broke'
            verdicts = []
            if 'suite' in who:
                rc_s, out_s = run(SUITE, capture=True)
                verdicts.append(rc_s)
            if 'harness' in who:
                rc_h, out_h = run(HARNESS, capture=True)
                verdicts.append(rc_h)
            # rc != 0 is a kill WHETHER the output has a FAIL line or the
            # run crashed midway - a crash/timeout is a kill, never a
            # survival. Only rc == 0 survives.
            if all(rc == 0 for rc in verdicts):
                print(f'  SURVIVED - {name}', flush=True)
                survived += 1
            else:
                print(f'  killed - {name}', flush=True)
                killed += 1
        except subprocess.TimeoutExpired:
            print(f'  killed (timeout) - {name}', flush=True)
            killed += 1
        except Exception as e:
            print(f'  killed (BUILD/ASSERT) - {name}: {e}', flush=True)
            killed += 1
        target.write_text(original)
        assert target.read_text() == original, f'RESTORE FAILED for {name}'

    print(f'killed={killed} survived={survived} of {len(PATTERNS)}', flush=True)
    run(BUILD)
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
