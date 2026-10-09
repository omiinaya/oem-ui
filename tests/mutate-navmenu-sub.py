#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 24: the navigation menu SUBMENU path.

Byte-exact patterns, pre-checked with --scan, a build in every window
(the harness drives the page, so dist must match the source under test),
restore verified, rebuild at the end. A crash, timeout or missing FAIL
line is a kill - never a survival: only rc == 0 survives.

The first run of this mutator killed 7 and SURVIVED 5, and the survivors
were the useful part. Recorded here because a proof file that shows only
the clean run is a proof of nothing:

- Three survivors named `navSubOut` - a function this batch had added.
  Not a weak oracle: DEAD CODE. Disabling it changed nothing a reader
  could see, because the dropdown's own menu keydown (`closeSubmenu`)
  already closes an open submenu and returns focus to the owning row.
  Two owners for one rule. It was deleted rather than documented as a
  survivor, and ArrowLeft out is now asserted as the dropdown's own
  behaviour that the harness reads.
- The idle gate's own-bar filter survived because it is not observable
  through the keyboard at all: the dropdown's capture-phase handler
  closes the parent panel first, so focus lands on the parent word
  either way. Cut as undriven, with the reason here, rather than left as
  a live mutation with nothing watching it.
- The panel-width mutant survived on a closed-popover measurement - a
  closed panel is display:none and reads zero. The assertion now opens
  both panels and reads them, and kills it.

The `who` field names the oracle EXPECTED to kill each pattern, decided by
reading which layer can SEE the change rather than by hoping:

- navOwn's own-bar filter is the whole point of the batch. A descendant-
  wide query is indistinguishable from it on a bar with no nested root,
  so every bar still passes either way: the harness is the only oracle
  that reads a bar with a nested root inside it.
- The hover-record heal and the already-acted-on guard are TIMED
  behaviour - the harness hovers, leaves onto a non-trigger surface and
  comes back. No suite read sees it.
- The submenu owner lookup is a placement contract: without it the panel
  lands on the parent's top-left corner, which is the one geometry the
  harness's placement checks were written for and mutation-proved
  against.
- The keyboard patterns are driven by real key presses, so harness-only.
- The specimen markup and the subpanel width are STRUCTURE: the suite
  pins the specimen (a nested root that vanished is a dropped surface)
  and the harness reads the width through geometry.

- The THREE hover-record patterns are all `suite+harness`: the harness
  drives the sequence that distinguishes them, and the suite pins the
  shape so a guard cannot move elsewhere. The first run of this mutator
  is what found the second and third - both were real survivors, and the
  second was a genuine permanent-death bug in the shipped code, not a
  test weakness. The `arrival is answered twice` mutant is suite-only by
  construction: it re-adds a guard in a spot the harness cannot observe
  because the early return short-circuits before any behaviour differs.

Deliberately NOT in this list:

- `.cm-navmenu--sub`'s border-top: the nested root's rule above it is
  what separates it from the parent's links, and the divider is a
  declaration of intent the harness cannot measure independently of the
  border box it shares with the submenu panel.
- `navSubIn`'s aria-expanded guard: CUT as an equivalent mutant, not
  survived. A shut submenu fails the `:popover-open` check below it
  whatever its word's aria-expanded says, so mutating the aria form to
  `return true` leaves focus in exactly the same place - measured on both
  builds. A redundant guard is not a kill, it is a second owner of a
  question the platform already answered, so it was removed and this note
  is where the claim lives.
- The chevron glyph's border construction: it is a drawn square-corner
  caret, and every mutation of it that keeps it painted is
  indistinguishable - the equivalent-mutant case, cut rather than
  claimed as a kill.
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
    # ---- own-bar scoping: the batch's load-bearing filter ----
    ('a descendant-wide query lets the sub bar answer for its parent',
     JS,
     "return Array.prototype.filter.call(\n"
     "\t\t\tbar.querySelectorAll(selector),\n"
     "\t\t\tfunction (el) { return el.closest('[data-cm-navmenu]') === bar; });",
     "return Array.prototype.filter.call(\n"
     "\t\t\tbar.querySelectorAll(selector),\n"
     "\t\t\tfunction (el) { return true; });",
     'harness'),

    ('the indicator reads whichever bar\'s mark it finds first',
     JS,
     "var ind = navOwn(bar, '.cm-navmenu__indicator')[0];",
     "var ind = bar.querySelector('.cm-navmenu__indicator');",
     'harness'),

    # ---- the hover record must heal ----
    # Three separate ways to answer the arrival with a memory instead of
    # with the platform's state. Each is the same permanent-death bug in
    # its own clothes, and each was a real survivor the first run found.
    ('the arrival guard trusts the record instead of what the hover did',
     JS,
     "if (bar.__cmNavHoverLast === trigger &&\n"
     "\t\t\t(bar.__cmNavHoverT || navHoverPanel(bar, trigger) &&\n"
     "\t\t\t\tnavHoverPanel(bar, trigger).matches(':popover-open'))) return;",
     "if (bar.__cmNavHoverLast === trigger) return;",
     'suite+harness'),

    ('a click holds its word even after its panel closed',
     JS,
     "\t\tif (bar.__cmNavHoverLast === trigger &&\n"
     "\t\t\tbar.__cmNavClickOwned &&\n"
     "\t\t\tnavHoverPanel(bar, trigger) &&\n"
     "\t\t\tnavHoverPanel(bar, trigger).matches(':popover-open')) return;",
     "\t\tif (bar.__cmNavHoverLast === trigger && bar.__cmNavClickOwned) return;",
     'suite+harness'),

    ('the arrival is answered twice, once on the bare record',
     JS,
     "\t\tbar.__cmNavClickOwned = 0;",
     "\t\tif (bar.__cmNavHoverLast === trigger) return;\n"
     "\t\tbar.__cmNavClickOwned = 0;",
     'suite'),

    # ---- placement: the submenu must open at its OWN word ----
    ('placement asks for the owner by aria-controls the trigger lacks',
     JS,
     "if (!owner && menu.classList &&\n"
     "\t\t\t\tmenu.classList.contains('cm-navmenu__subpanel') &&\n"
     "\t\t\t\ttypeof menu.getAttribute === 'function') {",
     "if (!owner && menu.classList &&\n"
     "\t\t\t\tmenu.classList.contains('cm-dropdown__never') &&\n"
     "\t\t\t\ttypeof menu.getAttribute === 'function') {",
     'harness'),

    # ---- the keyboard path IN ----
    ('ArrowRight steals the rove on an outer word',
     JS,
     "var nested = trigger.closest('[data-cm-navmenu-sub]');\n"
     "\t\tif (!nested) return false;",
     "var nested = trigger.closest('[data-cm-navmenu]');\n"
     "\t\tif (!nested) return false;",
     'harness'),

    ('ArrowRight focuses the panel instead of its first item',
     JS,
     "items[0].focus();\n\t\treturn true;",
     "panel.focus();\n\t\treturn true;",
     'harness'),

    # ---- structure: a dropped surface is a hole, not a mutation ----
    ('the nested root stops declaring itself a submenu',
     ASTRO, 'data-cm-navmenu-sub data-cm-navmenu-viewport="nav-sub-viewport"',
     'data-cm-navmenu-viewport="nav-sub-viewport"', 'suite+harness'),

    ('the nested root loses its sub modifier class',
     ASTRO, '<div class="cm-navmenu cm-navmenu--sub"',
     '<div class="cm-navmenu"', 'suite+harness'),

    # ---- geometry ----
    ('the submenu panel widens into a second wall over the page',
     CSS,
     ".cm-navmenu__subpanel {\n"
     "\twidth: min(16rem, calc(100vw - (2 * var(--gutter))));\n"
     "}",
     ".cm-navmenu__subpanel {\n"
     "\twidth: min(20rem, calc(100vw - (2 * var(--gutter))));\n"
     "}",
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
