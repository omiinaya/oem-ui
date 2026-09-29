#!/root/.venvs/mau/bin/python
"""
Mutation check for the desktop nav rail contract tests.

A rail test that cannot fail is worse than no rail test, because it reads
as coverage. Every mutation below breaks ONE thing the rail depends on and
the suite must go red. A mutation that leaves the suite green is a hole in
the contract, and the point of this file is to find those, not to declare
victory.

Two rules learned the hard way here and applied below:

  1. A mutation that leaves the file syntactically broken is a FALSE kill.
     The whole suite goes red before the target test can report, so the
     "catch" is attributable to nothing. Every mutation must leave valid
     CSS/JS behind.
  2. An anchor that `throw`s at module scope takes the entire suite down
     instead of failing one test, which looks identical to a kill. The
     guard below reports and skips rather than throwing.

Run: ./mau/bin/python tests/mutate-rail.py
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(REPO, 'src/styles/components.css')
HDR = os.path.join(REPO, 'src/astro/Header.astro')
TOK = os.path.join(REPO, 'src/styles/tokens.css')
PAGE = os.path.join(REPO, 'src/pages/index.astro')
SUITE = os.path.join(REPO, 'tests/run.mjs')

MUTATIONS = [
    # --- the rail must not become a two-column grid ---------------------
    # `flex-wrap: wrap` is inherited from the bar. In a column it wraps
    # ACROSS once the children outgrow the viewport height, which is the
    # bleed Omar reported.
    ('the rail column starts wrapping again',
     CSS, '\t\tflex-wrap: nowrap;\n\t}\n\t.cm-header--rail .cm-header__brand', '\t\tflex-wrap: wrap;\n\t}\n\t.cm-header--rail .cm-header__brand',
     'the rail and its link list are both a single unwrapped column'),
    ('the link list starts wrapping again',
     CSS, '\t\tflex-wrap: nowrap;\n\t\t/* Vertical scroll only.', '\t\tflex-wrap: wrap;\n\t\t/* Vertical scroll only.',
     'the rail and its link list are both a single unwrapped column'),
    ('the link list shrink-wraps again',
     CSS, '\t\talign-self: stretch;\n', '\t',
     'the rail link list fills the rail instead of shrink-wrapping'),
    ('the list loses its width backstop',
     CSS, '\t\twidth: 100%;\n', '',
     'the rail link list fills the rail instead of shrink-wrapping'),
    ('the list can no longer scroll in a short window',
     CSS, '\t\tgap: var(--space-0);\n\t\toverflow-y: auto;', '\t\tgap: var(--space-0);\n\t\toverflow-y: visible;',
     'a short window scrolls the rail rather than hiding links'),
    # --- the section index must track the document ----------------------
    # The bug this pins: the nav listed `forms` last, the page rendered it
    # right after `lists`, so the rail highlighted `forms` while you were
    # near the top and then jumped back up to `states`.
    ('a section is reordered out of the index order',
     PAGE, "'states', 'surface',", "'surface', 'states',",
     'the section index is in the order the sections actually appear'),

    ('a section is dropped from the index',
     PAGE, "'states', 'surface',\n", "'surface',\n",
     'the section index is in the order the sections actually appear'),

    ('a section is dropped from the page but stays in the index',
     PAGE, '<section id="surface" class="cm-section cm-section--pad"',
     '<section id="renamed-surface" class="cm-section cm-section--pad"',
     'every id in the section index is a real section in the markup'),

    ('the nav stops deriving from the index',
     PAGE, 'links={SECTION_ORDER.map', "links={[{'href': '#foundation', label: 'foundation'}]}",
     'the showcase declares one section index, and the nav is built from it'),

    ('the section index is inlined back into the nav',
     PAGE, "const SECTION_ORDER = [", "const LEGACY_ORDER = [",
     'the showcase declares one section index, and the nav is built from it'),
    # --- the rail must stay opt-in -------------------------------------
    ('a consumer without the modifier gets the rail anyway',
     CSS, '.cm-header--rail { padding: 0; }', '.cm-header { padding: 0; }',
     'the rail is opt-in, so a consumer that did not ask for it is unaffected'),

    ('the rail rules stop being scoped to wide viewports',
     CSS, '@media (min-width: 1000px) {', '@media (min-width: 1px) {',
     'the rail ships as a block scoped above the rail breakpoint'),

    # --- geometry: the two bugs that actually shipped -------------------
    ('main re-centres on the viewport and slides under the rail',
     CSS, '\t\tmargin-inline: 0;\n', '\t\tmargin-inline: auto;\n',
     'the rail clears the content, and the measure stays centred beside it'),

    ('the content is not offset clear of the rail at all',
     CSS, 'padding-left: calc(var(--rail-w) + var(--gutter));', 'padding-left: 0;',
     'the rail clears the content, and the measure stays centred beside it'),

    ('the rail offset stops being derived from the token',
     CSS, 'padding-left: calc(var(--rail-w) + var(--gutter));',
     'padding-left: calc(232px + var(--gutter));',
     'the rail clears the content, and the measure stays centred beside it'),

    # --- the specimen bug: a descendant selector -----------------------
    ('the rail link rule goes back to styling the demo specimens',
     CSS, '.cm-header--rail .cm-header__links > .cm-header__link {',
     '.cm-header--rail .cm-header__link {',
     'the rail link rules are scoped to direct children of the list'),

    # --- the tap floor --------------------------------------------------
    ('a rail link keeps the tap floor',
     CSS, '.cm-header--rail .cm-header__links > .cm-header__link {\n\t\tdisplay: flex;\n\t\talign-items: center;\n\t\tmin-height: var(--tap);', '.cm-header--rail .cm-header__links > .cm-header__link {\n\t\tdisplay: flex;\n\t\talign-items: center;\n\t\tmin-height: 20px;',
     'a rail link keeps the tap floor'),

    # --- the unbounded column ------------------------------------------
    ('the rail is no longer bounded to the viewport',
     CSS, '\t\theight: 100vh;\n\t\toverflow: hidden;', '\t\theight: auto;\n\t\toverflow: hidden;',
     'the rail is a bounded column, so a long list scrolls instead of escaping'),

        ('the rail width becomes a hardcoded px literal',
     CSS, 'width: var(--rail-w);', 'width: 232px;',
     'the rail width is a token, not a literal'),

    ('the --rail-w token is deleted outright',
     TOK, '\t--rail-w: 232px;\n', '',
     'the rail width is a token, not a literal'),

    # --- the component contract ----------------------------------------
    ('the rail prop is removed from Header',
     HDR, '\trail = false,', '// rail default removed',
     'the header opts in through a documented rail prop'),

    ('the rail prop is no longer declared',
     HDR, '\trail?: boolean;', '\t_rail?: boolean;',
     'the header opts in through a documented rail prop'),

    ('the rail modifier class is applied unconditionally',
     HDR, "class:list={['cm-header', rail && 'cm-header--rail']}",
     "class:list={['cm-header', 'cm-header--rail']}",
     'the header opts in through a documented rail prop'),

    # --- the burger is a phone control ----------------------------------
    ('the burger is left on screen beside a permanent rail',
     CSS, '.cm-header--rail .cm-nav-toggle { display: none; }',
     '.cm-header--rail .cm-nav-toggle { display: inline-flex; }',
     'the showcase opts in, and a mobile reader still gets the burger'),

    # --- the showcase opts in ------------------------------------------
    ('the showcase stops opting in',
     PAGE, '\t\trail\n', '\t\t{/* rail */}\n',
     'the showcase opts in, and a mobile reader still gets the burger'),

    ('the showcase stops offsetting its own content',
     PAGE, 'class="cm-shell cm-shell--rail"', 'class="cm-shell"',
     'the showcase opts in, and a mobile reader still gets the burger'),
]


def run_suite():
    r = subprocess.run(['node', SUITE], cwd=REPO,
                       capture_output=True, text=True, timeout=600)
    return r.returncode, r.stdout + r.stderr


def main():
    if not os.path.exists(REPO):
        print("not an oem-ui checkout: %s" % REPO)
        sys.exit(1)

    orig = {}
    for f in (CSS, HDR, TOK, PAGE):
        orig[f] = open(f).read()

    base_code, base_out = run_suite()
    if base_code != 0:
        print("baseline suite is RED; fix that before mutating:")
        print("\n".join(l for l in base_out.splitlines() if l.startswith('FAIL')))
        sys.exit(1)
    base_passed = re.search(r'(\d+) passed', base_out)
    print("baseline: %s, 0 failed" % (base_passed.group(1) if base_passed else '?'))

    caught = survived = noop = wrongtest = 0
    problems = []

    for name, path, old, new, expect in MUTATIONS:
        src = orig[path]
        if old not in src:
            noop += 1
            print("  NO-OP    %s  (pattern not found)" % name)
            problems.append("NO-OP: " + name)
            continue

        try:
            open(path, 'w').write(src.replace(old, new, 1))
        except OSError as e:
            survived += 1
            print("  ERROR    %s  (%s)" % (name, e))
            problems.append("ERROR: " + name)
            continue

        code, out = run_suite()
        open(path, 'w').write(src)

        if code == 0:
            survived += 1
            print("  SURVIVED %s" % name)
            problems.append("SURVIVED: " + name)
            continue

        # The suite prints `FAIL <test name>: <assert message>`. Matching
        # on the assert message alone mis-attributed kills: three of them
        # named a message that a DIFFERENT rail test also throws, so the
        # mutation looked like a wrong-test kill. The test NAME is unique
        # and is the honest key; the message is only used to confirm.
        hits = [l for l in out.splitlines()
                if l.startswith('FAIL ') and expect in l]
        if not hits:
            # Red for some other reason: a false kill, not a contract.
            wrongtest += 1
            print("  WRONG    %s  (red, but not on: %s)" % (name, expect))
            problems.append("WRONG-TEST: %s -> red for another reason" % name)
            continue

        caught += 1
        print("  caught   %s  -> %s" % (name, hits[0].strip()[:96]))

    # Every file must be byte-identical to where it started.
    for f, src in orig.items():
        if open(f).read() != src:
            print("  !! %s was not restored" % f)
            problems.append("NOT RESTORED: " + f)
            sys.exit(1)

    code, out = run_suite()
    if code != 0:
        print("\nrestore check FAILED")
        sys.exit(1)
    print("\nrestored: green")
    print("caught %d | survived %d | no-op %d | wrong-test %d"
          % (caught, survived, noop, wrongtest))

    if problems:
        print("\nproblems:")
        for p in problems:
            print("  " + p)
        sys.exit(1)


if __name__ == '__main__':
    main()
