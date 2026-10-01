"""Contract test: the type scale must have a real second step.

The failure this pins: `.cm-head` and `.cm-head-row` both size
`cm-head__title` to `--head-h1`. That is right for a PAGE title and wrong
for anything else. rpm put `h2` panel headings inside `.cm-head-row` and
gave the 2FA prompt the page-title class, so "Dashboard" and "Certificate
Expiry Summary" both computed 32px / w700 and the scale was invisible.

Reads the real library CSS and the real rpm source - never a copy.
"""
import glob
import pathlib
import re
import sys

LIB_DIR = pathlib.Path('/root/projects/oem-ui/src/styles')
APP = pathlib.Path('/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src')

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


css = (LIB_DIR / 'components.css').read_text()
base = (LIB_DIR / 'base.css').read_text()
tsx = sorted(glob.glob(str(APP / '**' / '*.tsx'), recursive=True))

print('1. the library defines a section heading, separate from the page head')
check('.cm-section__title {' in css, '.cm-section__title is defined in the library')
_anchor = '.cm-head-row__action { margin-left: auto; flex: 0 0 auto; }'
_after = css.split(_anchor, 1)
check(len(_after) == 2 and '.cm-section__title' in _after[1][:1200],
      'it is anchored beside the head block, not appended loose')
m = re.search(r'\.cm-section__title \{(.*?)\}', css, re.S)
check(bool(m), '.cm-section__title has a rule body')
size = re.search(r'font-size: ([^;]+);', m.group(1)) if m else None
check(bool(size), '.cm-section__title declares a font-size')

print('2. the scale steps: page head > section > card > legible floor')
tok = re.search(r'--head-h1: ([\d.]+)rem', base)
check(tok is not None, '--head-h1 token exists')
if tok and size:
    head_px = float(tok.group(1)) * 16
    sec_px = float(re.match(r'([\d.]+)', size.group(1)).group(1)) * 16
    print(f'   page head = {head_px:.1f}px   section = {sec_px:.1f}px')
    check(sec_px < head_px, f'section ({sec_px:.1f}px) < page head ({head_px:.1f}px)')
    check(sec_px >= 14, f'section ({sec_px:.1f}px) still legible (>= 14px)')
    card = re.search(r'\.cm-card__title \{(.*?)\}', css, re.S)
    cps = re.search(r'font-size: ([\d.]+)rem', card.group(1)) if card else None
    if cps:
        cpx = float(cps.group(1)) * 16
        check(cpx < sec_px, f'card title ({cpx:.1f}px) sits below section ({sec_px:.1f}px)')

print('3. the page-title class is only ever on a real page title')
# Honest rule: `cm-head__title` is the PAGE title. That is either an <h1>
# (login's brand lockup is an h1 in a card, not in a .cm-head block) or a
# div/p title sitting inside .cm-head. Anything else - a panel h2 inside
# .cm-head-row, a 2FA prompt <p> in a form - is the regression.
bad = []
for f in tsx:
    src = pathlib.Path(f).read_text()
    for mm in re.finditer(r'<(h[1-6]|div|p) className="cm-head__title"', src):
        tag = mm.group(1)
        if tag == 'h1':
            continue
        pre = src[:mm.start()]
        last = pre.rfind('<div className="cm-head"')
        inside = last != -1 and not pre[last:].count('</div>')
        if not inside:
            bad.append(f'{f.split("/src/")[-1]}:<{tag}> outside .cm-head')
check(not bad, f'page-title class is on a real page title only (offenders: {bad or "none"})')

sec_used = sum(len(re.findall(r'className="cm-section__title"', pathlib.Path(f).read_text()))
               for f in tsx)
check(sec_used >= 10, f'the app really uses the section title ({sec_used} headings)')
h1_used = sum(len(re.findall(r'<h1 className="cm-head__title"', pathlib.Path(f).read_text()))
              for f in tsx)
check(h1_used >= 1, f'pages declare a real page h1 ({h1_used} found)')
# and no panel heading was left wearing the page title
panels = sum(len(re.findall(r'<h2 className="cm-head__title"', pathlib.Path(f).read_text()))
             for f in tsx)
check(panels == 0, f'zero <h2> wearing the page-title class ({panels} found)')

print('4. the two doors are open at page scale - this is why misuse is easy')
group = re.search(r'\.cm-head h1,[^{]*?\{([^}]*)\}', css, re.S)
check(group is not None and '--head-h1' in group.group(1),
      '.cm-head and .cm-head-row titles share one rule sizing to --head-h1')
check('.cm-head-row .cm-head__title' in (group.group(0) if group else ''),
      '.cm-head-row is one of those selectors - the second door')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
