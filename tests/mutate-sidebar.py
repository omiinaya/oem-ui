#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 20: sidebar.

Byte-exact patterns, pre-checked with --scan, a build in every window
(the harness drives the page, so dist must match the source under test),
restore verified, rebuild at the end. A crash, timeout or missing FAIL
line is a kill - never a survival: only rc == 0 survives.

The headline pattern is the one this batch actually got wrong: the rail
drag GROWS the panel under the pointer, so the cursor crosses a menu <a>
mid-gesture, WebKit starts a native link-drag, and the pointer stream
dies with no pointerup and no pointercancel - the resize froze at
whatever width the last delivered move computed (measured: +40 of an
intended +80). The dragstart veto is load-bearing, and this runner
proves the harness would notice if it left.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-sidebar.py']

JS = 'src/js/cli-mono.js'
CSS = 'src/styles/components.css'
ASTRO = 'src/pages/index.astro'

PATTERNS = [
    # ---- THE bug this batch found: the gesture it must not lose ----
    ('the dragstart veto disappears and the stream dies mid-gesture again',
     JS, 'if (railDrag) e.preventDefault();',
     'if (false) e.preventDefault();', 'harness'),

    ('the veto stops being bound to the document',
     JS, "document.addEventListener('dragstart', onSidebarDragStart);",
     "void onSidebarDragStart;", 'harness'),

    # ---- the rail pointer session ----
    ('the drag no longer anchors at the press (chases the transition)',
     JS, 'startW: panel.getBoundingClientRect().width,',
     'startW: 0,', 'harness'),

    ('the drag signs the wrong way for side=right',
     JS, "railDrag.scope.getAttribute('data-side') === 'right' ? -1 : 1",
     "railDrag.scope.getAttribute('data-side') === 'right' ? 1 : -1",
     'harness'),

    ('the resize loses its 12rem..32rem rails',
     JS, 'var min = 12 * 16, max = 32 * 16; // 12rem..32rem, in px',
     'var min = 0, max = 1e9; // no rails', 'harness'),

    ('the resize stops writing the token onto the scope',
     JS, "railDrag.scope.style.setProperty('--sidebar-width', w + 'px');",
     "railDrag.scope.style.setProperty('--sidebar-width', '16rem');",
     'harness'),

    ('an unmoved press stops being the click that toggles',
     JS, 'if (!drag.moved) sidebarToggle(drag.scope);',
     'if (false) sidebarToggle(drag.scope);', 'harness'),

    ('a drag reports itself as unmoved and toggles while resizing',
     JS, '\trailDrag.moved = true;',
     '\trailDrag.moved = false;', 'harness'),

    ('the wobble threshold swallows every drag',
     JS, 'if (Math.abs(dx) < 3) return;',
     'if (Math.abs(dx) < 1e9) return;', 'harness'),

    ('pointerdown stops arming the session',
     JS, "document.addEventListener('pointerdown', onSidebarPointerDown);",
     "void onSidebarPointerDown;", 'harness'),

    ('pointermove stops delivering',
     JS, "document.addEventListener('pointermove', onSidebarPointerMove);",
     "void onSidebarPointerMove;", 'harness'),

    ('pointerup stops releasing (no toggle, session leaks)',
     JS, "document.addEventListener('pointerup', onSidebarPointerUp);",
     "void onSidebarPointerUp;", 'harness'),

    # ---- the viewport truth: state read/write ----
    ('the phone read falls back to the desktop attribute',
     JS, "? scope.getAttribute('data-mobile-open') === 'true'",
     "? scope.getAttribute('data-state') === 'expanded'", 'suite+harness'),

    ('the phone toggle writes the desktop attribute instead',
     JS, "scope.setAttribute('data-mobile-open',\n"
         "\t\t\t\tsidebarOpen(scope) ? 'false' : 'true');",
     "scope.setAttribute('data-state',\n"
     "\t\t\t\tsidebarOpen(scope) ? 'collapsed' : 'expanded');",
     'suite+harness'),

    ('the trigger mirror lies about the phone (always expanded)',
     JS, 'var open = sidebarOpen(scope);',
     'var open = true;', 'harness'),

    ('init stops syncing triggers (phone aria starts as a desktop fact)',
     JS, 'cmInitSidebars(root);',
     'void cmInitSidebars;', 'suite+harness'),

    ('the sheet boundary in JS drifts away from the CSS 767px',
     JS, "window.matchMedia('(max-width: 767px)')",
     "window.matchMedia('(max-width: 640px)')", 'suite'),

    # ---- routing: trigger / disclosures / scrim / keys ----
    ('the trigger stops finding its panel through aria-controls',
     JS, 'var id = btn && btn.getAttribute(\'aria-controls\');',
     'var id = null;', 'harness'),

    ('the click router is never bound',
     JS, "document.addEventListener('click', onSidebarClick);",
     "void onSidebarClick;", 'harness'),

    ('the disclosure flips aria but never hides the content',
     JS, "if (open) panel.setAttribute('hidden', '');",
     "if (false) panel.setAttribute('hidden', '');", 'harness'),

    ('the disclosure hides but stops telling assistive tech',
     JS, "btn.setAttribute('aria-expanded', open ? 'false' : 'true');",
     "void open;", 'harness'),

    ('the scrim stops closing the sheet',
     JS, "\t\t\t\tscope.setAttribute('data-mobile-open', 'false');\n"
         "\t\t\t\tsidebarSyncTriggers(scope);",
     "\t\t\t\tvoid scope;", 'harness'),

    ('the keyboard path is never bound',
     JS, "document.addEventListener('keydown', onSidebarKeydown);",
     "void onSidebarKeydown;", 'harness'),

    ('CMD-B drifts to another letter',
     JS, "if ((e.key === 'b' || e.key === 'B') &&",
     "if ((e.key === 'x' || e.key === 'X') &&", 'suite+harness'),

    ('editors lose their B',
     JS, 'if (sidebarEditable(e.target)) return;',
     'if (false) return;', 'suite'),

    # ---- CSS derives from the attributes ----
    ('collapsed width forgets the icon token',
     CSS, ".cm-sidebar[data-state='collapsed'] .cm-sidebar__panel {\n"
          "\twidth: var(--sidebar-icon-width);",
     ".cm-sidebar[data-state='collapsed'] .cm-sidebar__panel {\n"
     "\twidth: var(--sidebar-width);", 'harness'),

    ('offcanvas parks in the flow again (no reflow)',
     CSS, ".cm-sidebar[data-collapsible='offcanvas'][data-state='collapsed']\n"
          "\t.cm-sidebar__panel {\n\tposition: fixed;",
     ".cm-sidebar[data-collapsible='offcanvas'][data-state='collapsed']\n"
     "\t.cm-sidebar__panel {\n\tposition: sticky;", 'suite'),

    ('offcanvas stops sliding off its left edge',
     CSS, "\tinset-inline-start: 0;\n\ttransform: translateX(-100%);",
     "\tinset-inline-start: 0;\n\ttransform: translateX(0);", 'suite+harness'),

    ('offcanvas on the right parks at the wrong edge',
     CSS, "\tinset-inline-start: auto;\n\tinset-inline-end: 0;\n"
          "\ttransform: translateX(100%);",
     "\tinset-inline-start: 0;\n\tinset-inline-end: 0;\n"
     "\ttransform: translateX(100%);", 'suite'),

    ('collapsible=none collapses anyway',
     CSS, ".cm-sidebar[data-collapsible='none'] .cm-sidebar__panel {\n"
          "\twidth: var(--sidebar-width);",
     ".cm-sidebar[data-collapsible='none'] .cm-sidebar__panel {\n"
     "\twidth: var(--sidebar-icon-width);", 'harness'),

    ('the rail returns under collapsible=none',
     CSS, ".cm-sidebar[data-collapsible='none'] .cm-sidebar__rail { display: none; }",
     ".cm-sidebar[data-collapsible='none'] .cm-sidebar__rail { display: block; }",
     'harness'),

    ('icon mode stops stepping the labels aside',
     CSS, ".cm-sidebar[data-collapsible='icon'][data-state='collapsed']\n"
          "\t.cm-sidebar__grouphead {\n\tjustify-content: center;",
     ".cm-sidebar[data-collapsible='icon'][data-state='collapsed']\n"
     "\t.cm-sidebar__grouphead {\n\tjustify-content: flex-start;", 'harness'),

    ('variant=floating stops framing the panel',
     CSS, ".cm-sidebar[data-variant='floating'] .cm-sidebar__panel {\n"
          "\tmargin: var(--space-3);",
     ".cm-sidebar[data-variant='floating'] .cm-sidebar__panel {\n"
     "\tmargin: 0;", 'harness'),

    ('variant=inset stops carding the content',
     CSS, ".cm-sidebar[data-variant='inset'] .cm-sidebar__inset {\n"
          "\tmargin: var(--space-3);",
     ".cm-sidebar[data-variant='inset'] .cm-sidebar__inset {\n"
     "\tmargin: 0;", 'harness'),

    ('the sheet loses the engine-margin zero and inherits the 20px',
     CSS, "\t/* UA stylesheets give <main> a 20px margin in WebKit - MEASURED on a\n"
          "\t   freshly created element. The inset aligns to the panel, not to the\n"
          "\t   engine's opinion about the main element. */\n\tmargin: 0;",
     "\t/* UA stylesheets give <main> a 20px margin in WebKit. */", 'harness'),

    ('the sheet keeps the desktop width at phone size',
     CSS, "\t.cm-sidebar .cm-sidebar__panel { width: var(--sidebar-width-mobile); }",
     "\t.cm-sidebar .cm-sidebar__panel { width: var(--sidebar-width); }",
     'harness'),

    ('the sheet boundary in CSS drifts from the JS',
     CSS, '@media (max-width: 767px) {',
     '@media (max-width: 640px) {', 'suite'),

    ('side=right stops mirroring the panel',
     CSS, ".cm-sidebar[data-side='right'] .cm-sidebar__panel {\n\torder: 2;",
     ".cm-sidebar[data-side='right'] .cm-sidebar__panel {\n\torder: 0;",
     'harness'),

    # ---- the specimen is half the component ----
    ('the trigger stops being the trigger',
     ASTRO, 'data-cm-sidebar-trigger',
     'data-cm-sb-trigger', 'suite+harness'),

    ('the rail stops being findable',
     ASTRO, 'data-cm-sidebar-rail',
     'data-cm-sb-rail', 'suite+harness'),

    ('the group disclosure stops being declarative',
     ASTRO, 'data-cm-sidebar-group\n\t\t\t\t\t\t\t\t\t\t'
            'aria-expanded="true" aria-controls="sb-group-1">',
     'data-cm-sb-group\n\t\t\t\t\t\t\t\t\t\t'
     'aria-expanded="true" aria-controls="sb-group-1">', 'suite+harness'),

    ('the submenu stops being declarative',
     ASTRO, 'data-cm-sidebar-sub',
     'data-cm-sb-sub', 'suite+harness'),

    ('the scrim stops being findable',
     ASTRO, 'data-cm-sidebar-scrim',
     'data-cm-sb-scrim', 'suite+harness'),

    ('the specimen leaves SECTION_ORDER',
     ASTRO, "'sidebar',",
     "'sidebar-x',", 'suite'),
]


def run(cmd, timeout=600, capture=False):
    """A build must NOT be captured (house rule: a captured build inside
    a mutator stalls and its 50KB buffer is not worth reading) - so its
    output goes to the terminal and p.stdout is None. The suite and
    harness ARE captured: their verdict is what a kill is decided on."""
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
        except Exception as e:  # build broke or an assert tripped
            print(f'  killed (BUILD/ASSERT) - {name}: {e}', flush=True)
            killed += 1
        target.write_text(original)
        assert target.read_text() == original, f'RESTORE FAILED for {name}'

    print(f'killed={killed} survived={survived} of {len(PATTERNS)}', flush=True)
    run(BUILD)
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
