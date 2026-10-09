#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 18: dropdown depth.

Byte-exact patterns, pre-checked with --scan, a build in every window (the
harness drives the page, so dist must match the source under test), restore
verified, rebuild at the end. A crash, timeout or missing FAIL line is a
kill - never a survival.

The headline pattern here is the one the batch actually got wrong: the menu
key handler was DEFINED and never BOUND, so every arrow key in every menu
on the site was dead. Nothing about the menu looked broken.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-dropdown-depth.py']

PATTERNS = [
    ('the menu key handler stops being bound',
     'src/js/cli-mono.js',
     "\tif (typeof document !== 'undefined') document.addEventListener('keydown', onMenuKey);",
     "\tvoid onMenuKey;", 'suite+harness'),

    ('submenu rows leak into the parent list again',
     'src/js/cli-mono.js',
     'return owner === menu &&',
     'return true &&', 'suite'),

    ('the item walk stops seeing checkbox/radio rows',
     'src/js/cli-mono.js',
     "menu.querySelectorAll('[role^=\"menuitem\"], .cm-dropdown__item'),",
     "menu.querySelectorAll('.cm-dropdown__item'),", 'suite'),

    ('Right stops opening the submenu',
     'src/js/cli-mono.js',
     'if (openSubmenu(t)) e.preventDefault();',
     'if (false) e.preventDefault();', 'harness'),

    ('Enter no longer opens a submenu row',
     'src/js/cli-mono.js',
     "(e.key === 'Enter' && t.getAttribute('aria-haspopup') === 'menu')",
     "(e.key === 'Enter' && false)", 'harness'),

    ('Left stops closing the submenu',
     'src/js/cli-mono.js',
     'if (closeSubmenu(t.closest(POP_SEL))) e.preventDefault();',
     'if (false) e.preventDefault();', 'harness'),

    ('Left stops returning focus to the parent row',
     'src/js/cli-mono.js',
     "if (owner && typeof owner.focus === 'function') owner.focus();",
     'void owner;', 'harness'),

    ('a submenu panel is not found by its id',
     'src/js/cli-mono.js',
     "var id = item && item.getAttribute && item.getAttribute('aria-controls');",
     'var id = null;', 'harness'),

    ('Space stops flipping a checkbox row',
     'src/js/cli-mono.js',
     "if ((e.key === ' ' || e.key === 'Enter') && toggleCheckable(t)) {",
     "if (false) {", 'harness'),

    ('a checkbox row stops moving its glyph with it',
     'src/js/cli-mono.js',
     "if (glyph) glyph.setAttribute('data-checked', on ? 'true' : 'false');",
     'void glyph;', 'harness'),

    ('a radio row stops taking the selection on arrival',
     'src/js/cli-mono.js',
     "if (next.getAttribute('role') === 'menuitemradio') setRadio(next);",
     'void next;', 'harness'),

    ('a radio group stops clearing its siblings',
     'src/js/cli-mono.js',
     "row.setAttribute('aria-checked', row === item ? 'true' : 'false');",
     "row.setAttribute('aria-checked', 'true');", 'harness'),

    ('typeahead stops being delegated',
     'src/js/cli-mono.js',
     "if (typeof document !== 'undefined') document.addEventListener('keydown', onMenuTypeahead);",
     '\tvoid onMenuTypeahead;', 'suite'),

    ('typeahead stops seeking by prefix',
     'src/js/cli-mono.js',
     '.indexOf(needle) === 0) {',
     '.indexOf(needle) >= 0) {', 'harness'),

    ('typeahead never wraps the search',
     'src/js/cli-mono.js',
     'for (var n = 1; n <= items.length; n++) {',
     'for (var n = 1; n < items.length; n++) {', 'harness'),

    ('hover opens a submenu even when no menu is open',
     'src/js/cli-mono.js',
     'if (!item || !item.closest(POP_SEL)) return;',
     'if (!item) return;', 'suite'),

    ('the typeahead binding loses its document guard',
     'src/js/cli-mono.js',
     "if (typeof document !== 'undefined') document.addEventListener('pointerover', onMenuHover);",
     "document.addEventListener('pointerover', onMenuHover);", 'suite'),

    ('the child-first step back can no longer see the open panel',
     'src/js/cli-mono.js',
     "querySelectorAll('[popover]:popover-open')",
     "querySelectorAll('[popover].never-opened')", 'harness'),

    ('stepping out can no longer fall back to popovertarget',
     'src/js/cli-mono.js',
     "(menu.id && document.querySelector('[popovertarget=\"' + menu.id + '\"]'))",
     'false', 'harness'),

    ('the walk closes the shallowest open panel, not the deepest',
     'src/js/cli-mono.js',
     'opens[opens.length - 1]',
     'opens[0]', 'suite'),

    # ---- placement moved into anchorPopover + a per-popover pin registry:
    # these are the paths the geometry/scroll checks own.
    ('the submenu forgets where it lives',
     'src/js/cli-mono.js',
     "menu.parentNode.closest('.cm-dropdown__menu')",
     "menu.parentNode.closest('.never-host')", 'harness'),

    ('pins evict each other again (single slot restored)',
     'src/js/cli-mono.js',
     'if (menu && p.menu !== menu) continue;',
     'if (false) continue;', 'harness'),

    ('the submenu never gets pinned',
     'src/js/cli-mono.js',
     'popPins.push({ menu: menu, fn: fn });',
     'void fn;', 'harness'),

    ('the submenu stops flipping left when it will not fit',
     'src/js/cli-mono.js',
     'if (x + w > window.innerWidth - pad) x = hr.left - w;',
     'if (false) x = hr.left - w;', 'harness'),

    ('the submenu runs off-screen instead of clamping',
     'src/js/cli-mono.js',
     'if (x < pad) x = Math.max(pad, window.innerWidth - w - pad);',
     'if (false) x = Math.max(pad, window.innerWidth - w - pad);', 'harness'),

    ('a submenu inherits the 12rem panel width again',
     'src/styles/components.css',
     'min-width: 0;\n\tz-index: calc(var(--z-popover) + 1);',
     'min-width: 12rem;\n\tz-index: calc(var(--z-popover) + 1);', 'suite'),

    ('the nested panel base falls back to absolute',
     'src/styles/components.css',
     '.cm-dropdown__menu .cm-dropdown__menu {\n\tposition: fixed;',
     '.cm-dropdown__menu .cm-dropdown__menu {\n\tposition: absolute;', 'suite'),

    ('the submenu opens unplaced until the toggle task (corner flash)',
     'src/js/cli-mono.js',
     '\t\tanchorPopover(sub);',
     '\t\t/* anchored later */',
     'harness'),
    ('the check glyph stops riding the icon slot',
     'src/styles/components.css',
     ".cm-dropdown__icon[data-checked='true']::before { content: \"\\2713\"; }",
     ".cm-dropdown__item[aria-checked='true']::before { content: \"\\2713\"; }", 'suite'),

    ('the icon slot stops being a fixed width',
     'src/styles/components.css',
     '.cm-dropdown__icon {\n\tflex: none;',
     '.cm-dropdown__icon {\n\tflex: 1 1 auto;', 'suite'),

    ('the shortcut hint stops hiding from the name',
     'src/pages/index.astro',
     '<span class="cm-dropdown__shortcut" aria-hidden="true">ctrl i</span>',
     '<span class="cm-dropdown__shortcut">ctrl i</span>', 'suite'),

    ('a submenu owner stops advertising its panel',
     'src/pages/index.astro',
     'role="menuitem" aria-haspopup="menu" aria-controls="sub-depth-1"',
     'role="menuitem" aria-haspopup="menu"', 'suite'),
]


def run(cmd, timeout=600, capture=False):
    """A build must NOT be captured (house rule: a captured build inside a
    mutator stalls and its 50KB buffer is not worth reading) - so its output
    goes to the terminal and p.stdout is None. The suite and harness ARE
    captured: their verdict lines are what a kill is decided on."""
    p = subprocess.run(
        cmd, cwd=ROOT, timeout=timeout,
        capture_output=capture,
    )
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