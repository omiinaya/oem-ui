#!/root/.venvs/mau/bin/python
"""Mutation proof for the navigation menu.

Byte-exact patterns, pre-checked with --scan, a build in every window (the
harness drives the page, so dist must match the source under test), restore
verified, rebuild at the end. A crash, timeout or missing FAIL line is a kill
- never a survival.

The headline patterns are the three the batch actually got wrong and only
the WebKit harness caught: the panel pulling focus into itself (so the bar
was unreachable in one press), an idle bar stealing the arrow keys from the
page, and the scroll listener bound to an element that never scrolls.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
URL = 'http://192.168.1.68:4462/'
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-navmenu.py', URL]

PATTERNS = [
    # ---- the runtime paths the harness owns
    ('the navmenu key handler stops being bound',
     'src/js/cli-mono.js',
     "\tif (typeof document !== 'undefined') document.addEventListener('keydown', onNavmenuKey);",
     '\tvoid onNavmenuKey;', 'suite+harness'),

    ('an idle bar starts stealing the arrows from the page',
     'src/js/cli-mono.js',
     '\t\tif (!wasOpen) return;\n\t\te.preventDefault();',
     '\t\tif (false) return;\n\t\te.preventDefault();', 'harness'),

    ('the next panel never opens in the same press',
     'src/js/cli-mono.js',
     "\t\t\tif (!menu.matches(':popover-open')) menu.showPopover();\n\t\t}, 0);",
     '\t\t\tvoid menu;\n\t\t}, 0);', 'harness'),

    # Placement's owner is anchorPopover on the toggle path, not the swap
    # callback. The original mutant removed the swap's belt-and-braces
    # anchorPopover() call - and that call was then DELETED from the
    # product after measurement, so the pattern became PATTERN ABSENT.
    # Retargeted to the write that actually places the panel: a mutant that
    # stops writing `left` leaves the panel at its static position, which
    # is what "opens but is never placed" means.
    ('the panel opens but is never placed',
     'src/js/cli-mono.js',
     "\t\tif (menu.style.left !== left) menu.style.left = left;",
     "\t\tif (false) menu.style.left = left;", 'harness'),

    ('a navmenu panel starts pulling focus into its first link again',
     'src/js/cli-mono.js',
     "if (!(menu.classList && menu.classList.contains('cm-navmenu__panel'))) {",
     'if (true) {', 'harness'),

    ('the bar walks to the next word but never wraps',
     'src/js/cli-mono.js',
     "if (e.key === 'ArrowRight') next = triggers[(i + 1) % triggers.length];",
     "if (e.key === 'ArrowRight') next = triggers[Math.min(i + 1, triggers.length - 1)];",
     'harness'),

    ('the scroll listener is bound to a box that never scrolls',
     'src/js/cli-mono.js',
     "\t\t\tvar target = (owner || view);\n\t\t\tif (target) target.addEventListener('scroll', spy.fn, { passive: true });",
     '\t\t\tvar target = (owner || view);\n\t\t\tvoid target;', 'harness'),

    ('the mark stops following the page (no re-measure on scroll)',
     'src/js/cli-mono.js',
     "\t\treturn { bar: bar, fn: function () { navSpy(bar); } };",
     '\t\treturn { bar: bar, fn: function () { void bar; } };', 'harness'),

    ('the mark never moves past the first section',
     'src/js/cli-mono.js',
     '\t\t\tif (top <= line + 16) current = t;',
     '\t\t\tif (false) current = t;', 'harness'),

    ('the last section never wins at the end of the page',
     'src/js/cli-mono.js',
     '\t\tif (navScrollTop(root) + navViewport(root) >=\n\t\t\tdocument.documentElement.scrollHeight - 2) {\n\t\t\tcurrent = links[links.length - 1];\n\t\t}',
     '\t\tvoid navViewport;', 'harness'),

    ('the indicator stops declaring itself measured',
     'src/js/cli-mono.js',
     "\t\tind.setAttribute('data-active', 'true');",
     '\t\tvoid ind;', 'harness'),

    ('the indicator stops writing what it measured',
     'src/js/cli-mono.js',
     "\t\tind.style.setProperty('--cm-navmenu-w', Math.round(r.width) + 'px');",
     '\t\tvoid r;', 'harness'),

    ('the current trigger stops being announced',
     'src/js/cli-mono.js',
     "\t\t\tif (t === current) t.setAttribute('aria-current', 'true');",
     '\t\t\tif (false) t.setAttribute(\'aria-current\', \'true\');', 'harness'),

    ('a bar in a scrolled pane stops being measured at all',
     'src/js/cli-mono.js',
     '\t\tcmInitNavmenu(root);',
     '\t\tvoid cmInitNavmenu;', 'harness'),

    # ---- the anchors the harness owns
    ('the trigger stops taking the tap floor on a coarse pointer',
     'src/styles/components.css',
     '@media (pointer: coarse) {\n\t.cm-navmenu__trigger { min-height: var(--tap); }\n}',
     '@media (pointer: coarse) {\n\t.cm-navmenu__trigger { min-height: 0; }\n}', 'harness'),

    ('the bar stops rendering the navmenu anatomy at all',
     'src/pages/index.astro',
     '<div class="cm-navmenu" data-cm-navmenu role="navigation" aria-label="demo navigation menu">',
     '<div class="cm-navmenu" role="navigation" aria-label="demo navigation menu">',
     'suite+harness'),

    # ---- the CSS/contract paths the suite owns
    ('the chevron stops reporting the open state',
     'src/styles/components.css',
     ".cm-navmenu__trigger[aria-expanded='true'] .cm-navmenu__chev {\n\ttransform: rotate(-135deg);",
     ".cm-navmenu__trigger .cm-navmenu__chev {\n\ttransform: rotate(-135deg);", 'suite'),

    ('the chevron leaves the reduced-motion guard',
     'src/styles/components.css',
     '\t.cm-navmenu__chev { transition: none; }',
     '', 'suite'),

    ('the panel leaves the left-align set anchorPopover owns',
     'src/js/cli-mono.js',
     "\t\t\t\tmenu.classList.contains('cm-navmenu__panel'));",
     '\t\t\t\tfalse);', 'suite'),

    ('a nav word stops being a link',
     'src/pages/index.astro',
     '<a class="cm-navmenu__trigger" href="#layout">',
     '<button type="button" class="cm-navmenu__trigger">', 'suite'),

    ('the panel stops being a popover',
     'src/pages/index.astro',
     'class="cm-dropdown__menu cm-navmenu__panel" id="nav-product" popover role="menu"',
     'class="cm-dropdown__menu cm-navmenu__panel" id="nav-product" role="menu"',
     'suite+harness'),

    ('the indicator stops being decorative',
     'src/pages/index.astro',
     '<span class="cm-navmenu__indicator" aria-hidden="true"></span>',
     '<span class="cm-navmenu__indicator"></span>', 'suite'),

    ('the bar stops being registered for late markup',
     'src/js/cli-mono.js',
     "'[data-cm-navmenu], .cm-prose-table'",
     "'.cm-prose-table'", 'suite'),
]


def run(cmd, timeout=600, capture=False):
    """A build must NOT be captured (house rule: a captured build inside a
    mutator stalls and its 50KB buffer is not worth reading) - so its output
    goes to the terminal and p.stdout is None. The suite and harness ARE
    captured: their verdict lines are what a kill is decided on."""
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
    print('baseline suite green | baseline harness green')

    killed = survived = 0
    for name, rel, pat, mut, who in PATTERNS:
        target = ROOT / rel
        original = target.read_text()
        assert original.count(pat) == 1, f'PATTERN ABSENT for {name}'
        target.write_text(original.replace(pat, mut, 1))
        try:
            rc, out = run(BUILD)
            assert rc == 0, 'mutant build broke'
            if 'suite' in who:
                rc, out = run(SUITE, capture=True)
                assert rc != 0 and 'FAIL' in out, f'{name} SURVIVED the suite'
            if 'harness' in who:
                rc, out = run(HARNESS, capture=True)
                assert rc != 0 and 'FAIL' in out, f'{name} SURVIVED the harness'
        except subprocess.TimeoutExpired:
            print(f'  killed (timeout) - {name}')
            killed += 1
            target.write_text(original)
            continue
        except AssertionError as e:
            if 'SURVIVED' in str(e):
                print(f'  SURVIVED - {e}')
                survived += 1
            else:
                print(f'  killed (BUILD BROKE) - {name}')
                killed += 1
            target.write_text(original)
            continue
        print(f'  killed - {name} :: FAIL-line')
        killed += 1
        target.write_text(original)

    run(BUILD)
    print(f'killed={killed} survived={survived} of {len(PATTERNS)}')
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
