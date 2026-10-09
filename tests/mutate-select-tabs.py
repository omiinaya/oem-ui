#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 21: select / tabs / accordion depth.

Byte-exact patterns, pre-checked with --scan, a build in every window
(the harness drives the page, so dist must match the source under test),
restore verified, rebuild at the end. A crash, timeout or missing FAIL
line is a kill - never a survival: only rc == 0 survives.

The `who` field names the oracle that is EXPECTED to kill the pattern,
after analysis rather than hope. Two of them needed the analysis before
the run, not after:

- selectTab's refusal is belt-and-braces: every door pre-filters, so
  attributes alone cannot witness a mutated refusal - the suite's
  focusNode() asserts exist because a refusal keeps every attribute
  untouched and only the FOCUS betrays a wrong landing.
- the align's bottom clamp is unreachable from the visible fixture
  (a far-offset row fits above the floor), so the harness gained a
  post-browse phase where the checked row sits only ~75px into the
  list and alignment WANTS to push the panel through the floor.

Equivalent mutants are skipped deliberately, not survived: the
`vert &&` in the keydown's nextV line (the horizontal path returns
before it), and a disabled tab's `background: transparent` (the base
rule already paints transparent).
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-select-tabs.py']

JS = 'src/js/cli-mono.js'
CSS = 'src/styles/components.css'
ASTRO = 'src/pages/index.astro'

PATTERNS = [
    # ---- SelectValue: the mirror inside setRadio ----
    ('the trigger never finds the value slot to mirror into',
     JS, "var value = wrap.querySelector('.cm-dropdown__value');",
     "var value = wrap.querySelector('[data-value-slot]');", 'suite+harness'),

    ('the mirror writes an empty string instead of the picked label',
     JS, "value.textContent = (item.textContent || '')",
     "value.textContent = ''", 'harness'),

    ('the value keeps its hidden flag after a pick',
     JS, "value.removeAttribute('hidden');",
     "value.setAttribute('hidden', '');", 'suite+harness'),

    ('the wrap stops reporting itself as picked',
     JS, "wrap.setAttribute('data-cm-picked', 'true');",
     "wrap.removeAttribute('data-cm-picked');", 'suite+harness'),

    ('the placeholder is never retired',
     JS, "if (ph) ph.setAttribute('hidden', '');",
     "if (false) ph.setAttribute('hidden', '');", 'harness'),

    # ---- alignItemWithTrigger ----
    ('the align gate reads a name nothing carries',
     JS, "menu.closest('[data-cm-align-item]')",
     "menu.closest('[data-cm-align-item-never]')", 'suite+harness'),

    ('the align stops moving the BOX by what the ROW needs',
     JS, "var ay = mtop + (t.top - ctop);",
     "var ay = mtop;", 'suite+harness'),

    ('the align can climb above the top pad',
     JS, "if (ay < pad) ay = pad;",
     "if (ay < 0) ay = pad;", 'suite'),

    ("the align's own bottom clamp disappears",
     JS, "if (ay + h > window.innerHeight - pad) {",
     "if (false) {", 'suite+harness'),

    ('the placer stops pinning the bottom when neither side fits',
     JS, "// trigger slides under it, the way every native select does.\n"
         "\t\tif (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;",
     "// trigger slides under it, the way every native select does.\n"
         "\t\tif (false) y = window.innerHeight - h - pad;",
     'suite+harness'),

    # ---- a radio pick retires the menu ----
    ('the radio pick no longer closes its menu',
     JS, "if (item.getAttribute('role') === 'menuitemradio') {\n"
         "\t\t\tvar rm = item.closest('[role=\"menu\"]');\n"
         "\t\t\tif (rm && typeof rm.hidePopover === 'function') rm.hidePopover();",
     "if (false) {\n"
         "\t\t\tvar rm = item.closest('[role=\"menu\"]');\n"
         "\t\t\tif (rm && typeof rm.hidePopover === 'function') rm.hidePopover();",
     'suite+harness'),

    # ---- tabs: disabled is skipped through every door ----
    ('selectTab stops refusing a disabled target',
     JS, "if (next.getAttribute('aria-disabled') === 'true') return;",
     "if (false) return;", 'suite'),

    ('the wrap-around walk steps ONTO a disabled tab',
     JS, "if (tabs[j].getAttribute('aria-disabled') !== 'true') return j;",
     "if (true) return j;", 'suite+harness'),

    ('Home lands on a frozen first row',
     JS, "if (tabs[a].getAttribute('aria-disabled') !== 'true') { next = a; break; }",
     "if (true) { next = a; break; }", 'suite'),

    ('End lands on a frozen last row',
     JS, "if (tabs[b].getAttribute('aria-disabled') !== 'true') { next = b; break; }",
     "if (true) { next = b; break; }", 'suite+harness'),

    ('the click door stops skipping a disabled tab',
     JS, "&& t.getAttribute('aria-disabled') !== 'true') {",
     "&& true) {", 'suite+harness'),

    ('bind-time normalisation filters nothing (author lie wins)',
     JS, "var enabled = tabs.filter(function (t) {\n"
         "\t\t\t\t\treturn t.getAttribute('aria-disabled') !== 'true';\n"
         "\t\t\t\t});",
     "var enabled = tabs;", 'suite'),

    ('the normalisation falls back to a possibly-frozen first tab',
     JS, "})[0] || enabled[0] ||",
     "})[0] || tabs[0] ||", 'suite'),

    # ---- tabs: vertical is one declaration, one read ----
    ('the keydown claims horizontal no matter the declaration',
     JS, "var vert = group.getAttribute('data-orientation') === 'vertical';",
     "var vert = false;", 'suite+harness'),

    ('the axis drops ArrowDown from the vertical pair',
     JS, "|| (vert && (e.key === 'ArrowUp' || e.key === 'ArrowDown'));",
     "|| (vert && (e.key === 'ArrowUp'));", 'suite+harness'),

    ('the vertical DOWN branch stops routing',
     JS, "if (e.key === 'ArrowRight' || (vert && e.key === 'ArrowDown')) {",
     "if (e.key === 'ArrowRight') {", 'suite+harness'),

    # ---- the scrollable menu ----
    ('the menu loses its 60vh cap',
     CSS, "max-height: 60vh;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;",
     "max-height: none;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;",
     'suite+harness'),

    ('the menu stops scrolling inside itself',
     CSS, "max-height: 60vh;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;",
     "max-height: 60vh;\n\toverflow-y: visible;\n\toverscroll-behavior: contain;",
     'suite+harness'),

    ('the menu stops containing its overscroll',
     CSS, "max-height: 60vh;\n\toverflow-y: auto;\n\toverscroll-behavior: contain;",
     "max-height: 60vh;\n\toverflow-y: auto;\n\toverscroll-behavior: auto;",
     'suite+harness'),

    ('the placeholder/value hidden pair stops hiding',
     CSS, ".cm-dropdown__value[hidden],\n"
         ".cm-dropdown__placeholder[hidden] { display: none; }",
     ".cm-dropdown__value[hidden-gone],\n"
         ".cm-dropdown__placeholder[hidden-gone] { display: none; }",
     'suite'),

    ('the placeholder stops reading as a placeholder',
     CSS, ".cm-dropdown__placeholder { color: var(--ink-faint); }",
     ".cm-dropdown__placeholder { color: var(--ink); }",
     'suite+harness'),

    # ---- tabs: vertical CSS ----
    ('the declarative vertical group stops flipping the list',
     CSS, ".cm-tabs[data-orientation='vertical'] .cm-tabs__list {\n"
         "\tflex-direction: column;\n}",
     ".cm-tabs[data-orientation='vertical'] .cm-tabs__list {\n"
         "\tflex-direction: row;\n}",
     'suite+harness'),

    ('the shared 2px marker edge disappears',
     CSS, "\t   and the colour declaration still passes through a token. */\n"
         "\tborder-left: 2px solid transparent;",
     "\t   and the colour declaration still passes through a token. */\n"
         "\tborder-left: 0;",
     'suite+harness'),

    ('the selected vertical row stops lighting its marker from ink',
     CSS, "\tborder-left-color: var(--ink);",
     "\tborder-left-color: transparent;", 'harness'),

    # ---- tabs: disabled reads as disabled ----
    ('a disabled tab invites the click under the finger',
     CSS, ".cm-tabs__tab[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     ".cm-tabs__tab[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: pointer;\n}",
     'suite+harness'),

    ('a disabled tab stops being faint',
     CSS, ".cm-tabs__tab[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     ".cm-tabs__tab[aria-disabled='true'] {\n"
         "\tcolor: var(--ink);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     'suite+harness'),

    ('hover lights a disabled tab like a live one',
     CSS, ".cm-tabs__tab[aria-disabled='true']:hover { background: transparent; }",
     ".cm-tabs__tab[aria-disabled='true']:hover { background: var(--panel); }",
     'suite+harness'),

    # ---- accordion: the freeze ----
    ('a frozen summary stops inviting the click',
     CSS, ".cm-disclosure__summary[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     ".cm-disclosure__summary[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: pointer;\n}",
     'suite+harness'),

    ('a frozen summary stops being faint',
     CSS, ".cm-disclosure__summary[aria-disabled='true'] {\n"
         "\tcolor: var(--ink-faint);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     ".cm-disclosure__summary[aria-disabled='true'] {\n"
         "\tcolor: var(--ink);\n"
         "\tbackground: transparent;\n"
         "\tcursor: not-allowed;\n}",
     'suite+harness'),

    ('hover lights a frozen summary',
     CSS, ".cm-disclosure__summary[aria-disabled='true']:hover { background: transparent; }",
     ".cm-disclosure__summary[aria-disabled='true']:hover { background: var(--bg-3); }",
     'suite+harness'),

    # ---- the specimen ----
    ('the select stops opting into align',
     ASTRO, '<div class="cm-dropdown" data-cm-align-item>',
     '<div class="cm-dropdown">', 'suite+harness'),

    ('the select trigger points at nothing',
     ASTRO, 'popovertarget="select-demo"',
     'popovertarget="select-demo-x"', 'suite+harness'),

    ('the trigger carries no placeholder face',
     ASTRO, '<span class="cm-dropdown__placeholder">pick a timezone</span>',
     '', 'suite+harness'),

    ('the trigger carries no value face',
     ASTRO, '<span class="cm-dropdown__value" hidden></span>',
     '', 'suite+harness'),

    ('the specimen loses its disabled tab',
     ASTRO, 'id="tab-status"\n'
         '\t\t\t\t\t\t\taria-selected="false"\n'
         '\t\t\t\t\t\t\taria-disabled="true"',
     'id="tab-status"\n'
         '\t\t\t\t\t\t\taria-selected="false"\n'
         '\t\t\t\t\t\t\taria-disabled="false"',
     'suite+harness'),

    ('the vertical demo stops declaring itself vertical',
     ASTRO, '<div class="cm-tabs" data-orientation="vertical">',
     '<div class="cm-tabs">', 'suite+harness'),

    ('the frozen summary unfreezes in markup',
     ASTRO, '<summary class="cm-disclosure__summary" aria-disabled="true">',
     '<summary class="cm-disclosure__summary">', 'suite+harness'),

    ('the mirror picks a row the specimen never shows',
     ASTRO, '>america/sao_paulo</span>',
     '>america/la_paz</span>', 'harness'),

    # ---- the ledes (prose is contract here too) ----
    ('the accordion lede stops stating the veto',
     ASTRO, '<code>aria-disabled</code> on a summary vetoes the toggle',
     '<code>aria-disabled</code> on a summary', 'suite'),

    ('the accordion lede stops stating how several may stand open',
     ASTRO, 'drop <code>name</code> and several may stand open together',
     'drop <code>name</code>', 'suite'),
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
