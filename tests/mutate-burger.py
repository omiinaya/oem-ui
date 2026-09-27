#!/usr/bin/env python3
"""Mutation runner for the mobile nav disclosure tests.

Every mutation must be CAUGHT. A mutation that still passes is a no-op (the
pattern never applied) or a wrong-test (some other assertion went red for an
unrelated reason) - both are failures of this runner, not passes.
"""
import subprocess, shutil, sys, re, os

REPO = '/root/projects/oem-ui'
CSS = os.path.join(REPO, 'src/styles/components.css')
JS = os.path.join(REPO, 'src/js/cli-mono.js')
HDR = os.path.join(REPO, 'src/astro/Header.astro')
TOK = os.path.join(REPO, 'src/styles/tokens.css')
BASE = os.path.join(REPO, 'src/styles/base.css')

MUTATIONS = [
    ('re-introduce the nth-child bug that drew two bars', CSS,
     '.cm-nav-toggle__bar {\n\tposition: absolute;',
     '.cm-nav-toggle__bars .cm-nav-toggle__bar:nth-child(2) {\n\tposition: absolute;'),
    ('pin the middle bar to the top edge, on top of ::before', CSS,
     '\ttop: 50%;\n\ttransform: translateY(-50%);\n\tbackground: currentColor;',
     '\ttop: 0;\n\tbackground: currentColor;'),
    ('remove the X morph on ::before', CSS,
     "transform: translateY(5px) rotate(45deg);", 'transform: none;'),
    ('remove the X morph on ::after', CSS,
     "transform: translateY(-5px) rotate(-45deg);", 'transform: none;'),
    ('stop hiding the middle bar when open', CSS,
     ".cm-nav-toggle[aria-expanded='true'] .cm-nav-toggle__bar {\n\topacity: 0;\n}",
     ".cm-nav-toggle[aria-expanded='true'] .cm-nav-toggle__bar {\n\topacity: 0.4;\n}"),
    ('reveal the burger at EVERY width', CSS,
     '@media (max-width: 640px) {\n\t.cm-js .cm-nav-toggle { display: inline-flex; }\n}',
     '.cm-js .cm-nav-toggle { display: inline-flex; }'),
    # Scope the panel mutations to the ONE that hides it, by including the
    # following `[data-open]` rule: the base layer has a
    # `.cm-js .cm-header__links` too, and a bare replace hit that one
    # first, which no panel test can see.
    ('collapse the panel unconditionally, stranding no-JS readers', CSS,
     '.cm-js .cm-header__links { display: none; }',
     '.cm-header__links { display: none; }'),
    ('open the panel without the .cm-js gate', CSS,
     '.cm-js .cm-header__links[data-open] {', '.cm-header__links[data-open] {'),
    ('drop the icon-btn tap floor override', CSS,
     '.cm-icon-btn { width: var(--tap); height: var(--tap); }',
     '.cm-icon-btn { width: 32px; height: 32px; }'),
    ('drop Escape handling', JS,
     "if (e.key === 'Escape' && isOpen()) {", "if (false) {"),
    ('stop returning focus to the button on Escape', JS,
     'setOpen(false);\n\t\t\t\tbtn.focus();', 'setOpen(false);'),
    ('stop closing the panel when a link is tapped', JS,
     "e.target.closest('a')) setOpen(false);", "e.target.closest('a')) { /* left open */ };"),
    ('stop closing the panel on an outside click', JS,
     "e.target.closest('[data-cm-header]')) return;\n\t\t\tsetOpen(false);",
     "e.target.closest('[data-cm-header]')) return;\n\t\t\t/* left open */;"),
    ('drop the rotate-to-desktop reset', JS,
     "if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);",
     "if (typeof mq.addEventListener === 'function') mq.addEventListener('change', function () {});"),
    ('remove aria-expanded from the button', HDR,
     'aria-expanded="false"', 'data-expanded="false"'),
    ('remove aria-controls from the button', HDR,
     'aria-controls="cm-header-links"', 'data-controls="cm-header-links"'),
    ('remove the accessible name from the button', HDR,
     'aria-label="Menu"', 'aria-hidden="true"'),
    ('remove the panel id aria-controls points at', HDR,
     'id="cm-header-links"', 'data-panel="cm-header-links"'),
    ('render the burger with nothing behind it', HDR,
     'links.length > 0 && (\n\t\t\t\t<button\n\t\t\t\t\tclass="cm-icon-btn cm-nav-toggle"',
     'true && (\n\t\t\t\t<button\n\t\t\t\t\tclass="cm-icon-btn cm-nav-toggle"'),
    ('unguard the bar transition against reduced motion', CSS,
     '.cm-nav-toggle__bars::before,\n\t.cm-nav-toggle__bars::after,\n\t.cm-nav-toggle__bar { transition: none; }',
     '.cm-nav-toggle__bars::before { transition: none; }'),
    # The three defects the drawer work introduced.
    ('re-add the header blur that traps the fixed drawer', CSS,
     '/* NO backdrop-filter on .cm-header, and none on .cm-header__nav either.',
     '.cm-header__nav {\n\tbackdrop-filter: blur(8px);\n\t-webkit-backdrop-filter: blur(8px);\n}\n/* NO backdrop-filter on .cm-header, and none on .cm-header__nav either.'),
    ('make the header background translucent again', TOK,
     '--header-bg: #0a0a0a;', '--header-bg: rgba(10, 10, 10, 0.92);'),
    ('stop locking page scroll behind the drawer', JS,
     "body.style.overflow = 'hidden';", '/* no lock */'),
    ('never restore page scroll after closing the drawer', JS,
     "body.style.overflow = '';", '/* no unlock */'),
    ('drop the scroll-spy active state from the mobile panel', CSS,
     '\t.cm-header__link.is-active,\n\t.cm-header__link[aria-current=\'page\'] {',
     '\t.cm-header__link[aria-current=\'page\'] {'),
]

def run():
    r = subprocess.run(['node', 'tests/run.mjs'], cwd=REPO,
                       capture_output=True, text=True, timeout=300)
    return r.returncode, r.stdout + r.stderr

def failing_tests(out):
    return set(re.findall(r'^\s*FAIL (.+)$', out, re.M)) | \
           set(re.findall(r'^FAIL (.+)$', out, re.M))

def main():
    backups = {}
    for _, path, *_ in MUTATIONS:
        if path not in backups:
            backups[path] = open(path).read()

    code, out = run()
    if code != 0:
        print('BASELINE IS RED - fix that first'); print(out[-2500:]); return 1
    base_fail = failing_tests(out)
    print(f'baseline green ({len(backups)} files)\n')

    survived, noop, wrongtest, caught = [], [], [], 0
    for mut in MUTATIONS:
        name, path, old, new = mut[0], mut[1], mut[2], mut[3]
        idx = mut[4] if len(mut) > 4 else 0
        src = backups[path]
        hay = src
        if idx:
            parts = src.split(old)
            hay = parts[idx]
        if old not in hay:
            noop.append(name); print(f'  NO-OP  {name}  (pattern not found)')
            open(path, 'w').write(src); continue
        # for idx>0, rebuild by replacing only that occurrence
        if idx:
            parts = src.split(old)
            open(path, 'w').write(old.join(parts[:idx]) + new + old.join(parts[idx:]))
        else:
            open(path, 'w').write(src.replace(old, new, 1))
        code, out = run()
        fails = failing_tests(out) - base_fail
        if code == 0:
            survived.append(name); print(f'  SURVIVED  {name}')
        else:
            caught += 1
            hit = sorted(fails)
            ok = any(k in name for k in hit) or bool(hits_related(name, hit))
            tag = 'caught ' if ok else 'wrong-test'
            if not ok: wrongtest.append((name, hit))
            print(f'  {tag}  {name}  -> {hit[:3]}')
        open(path, 'w').write(src)

    code, out = run()
    print(f"\nrestored: {'green' if code==0 else 'RED'}")
    print(f'caught {caught} | survived {len(survived)} | no-op {len(noop)} | wrong-test {len(wrongtest)}')
    for n in survived: print('  SURVIVED:', n)
    for n in noop: print('  NO-OP:', n)
    for n, h in wrongtest: print(f'  WRONG-TEST: {n} (killed by {h})')
    return 1 if (survived or noop or wrongtest) else 0

# Maps a mutation name to the test that SHOULD die with it. Getting this
# wrong produces a "wrong-test" label for a perfectly good kill, which is
# worse than no label: it trains you to ignore the signal.
RELATED = [
    ('nth-child',            'positional selector'),
    ('pin the middle bar',   'edge'),
    ('X morph',              'X'),
    ('hides the middle bar', 'hides the middle bar'),
    ('EVERY width',          'revealed only under'),
    ('unconditionally',      'ships a burger toggle'),
    ('without the .cm-js gate', 'data-open] under .cm-js'),
    ('tap floor',            'clears the tap floor'),
    ('Escape',               'Escape'),
    ('outside click',        'outside the header'),
    ('rotate-to-desktop',    'clears the open state'),
    ('aria-expanded',        'aria-expanded'),
    ('aria-controls',        'aria-controls'),
    ('accessible name',      'accessible name'),
    ('panel id',             'panel has the id'),
    ('nothing behind it',    'only renders when'),
    ('reduced motion',       'guarded against motion'),
    ('scroll-spy active',    'active link stays visible'),
    ('tapped',               'tapping a link'),
    ('two bars',             'exactly one rule block'),
    ('bound once',           'bound once'),
    ('adds .cm-js',          '.cm-js only when'),
    ('starts closed',        'starts closed'),
]

def hits_related(name, hits):
    for a, b in RELATED:
        if a in name:
            return any(b in h for h in hits)
    return True

sys.exit(main())
