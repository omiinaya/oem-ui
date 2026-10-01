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
# The heading scale is a TOKEN question, so resolve tokens rather than
# reading a literal: `--head-h2` lives in tokens.css, and a guard that
# parsed `font-size: 1.15rem` went red for a change that made the scale
# MORE coherent, not less.
tokens = (LIB_DIR / 'tokens.css').read_text()

def token_px(name, _src=None, _depth=0):
    """Resolve a token to px, following a token that points at a token.

    `--head-h2: var(--text-md)` is how the section heading is declared
    now: the heading scale is the text scale's top end. A guard that
    only reads a literal goes red on that, and the tempting 'fix' is to
    inline the number again - which is how two sources for one step
    came to exist in the first place.
    """
    src = _src if _src is not None else tokens
    if _depth > 8:
        return None
    m = re.search(rf'(?m)^\s*{re.escape(name)}\s*:\s*([^;]+);', src)
    if not m:
        return None
    v = m.group(1).strip()
    inner = re.match(r'var\(\s*(--[a-z0-9-]+)\s*\)$', v)
    if inner:
        return token_px(inner.group(1), src, _depth + 1)
    lit = re.fullmatch(r'([\d.]+)rem', v)
    if lit:
        return float(lit.group(1)) * 16
    px = re.fullmatch(r'([\d.]+)px', v)
    return float(px.group(1)) if px else None
# `--head-h2` may declare a rem directly OR point at the text scale
# (`var(--text-md)`), which is how it is declared now: the heading
# scale is the text scale's top end, not a parallel set of numbers.
# The check is "the token EXISTS", not "it holds a literal".
_sec_tok = re.search(r'--head-h2:\s*([^;]+);', tokens)
check(_sec_tok is not None, '--head-h2 is a token in tokens.css')
if _sec_tok:
    _v = _sec_tok.group(1).strip()
    check(re.fullmatch(r'[\d.]+rem|var\(--[a-z0-9-]+\)', _v) is not None,
          f'--head-h2 holds a size or a scale token, not prose (got: {_v})')
check(re.search(r'font-size:\s*var\(--head-h2\)', css) is not None,
      'the section title reads that token, not a raw rem')
m = re.search(r'\.cm-section__title \{(.*?)\}', css, re.S)
check(bool(m), '.cm-section__title has a rule body')
size = re.search(r'font-size: ([^;]+);', m.group(1)) if m else None
check(bool(size), '.cm-section__title declares a font-size')

print('2. the scale steps: page head > section > card > legible floor')
head_px = token_px('--head-h1')
sec_px = token_px('--head-h2')
check(head_px is not None, '--head-h1 is a token in tokens.css')
if head_px is not None and sec_px is not None:
    print(f'   page head = {head_px:.1f}px   section = {sec_px:.1f}px')
    # STRICTLY smaller. `sec < head` alone passes when the two are
    # EQUAL, which is the exact regression: setting --head-h2 to
    # --head-h1 reproduced the 32px-everywhere defect this guard exists
    # to catch, and the mutation survived. The gap has to be real.
    check(sec_px < head_px,
          f'section ({sec_px:.1f}px) < page head ({head_px:.1f}px)')
    # The section heading must also sit ABOVE body text. A mutation
    # that pointed --head-h2 at --text (16px) still satisfied
    # "section < page head" and survived - but a panel heading at the
    # same size as the copy under it is the flatness the whole scale
    # exists to prevent, so the guard has to see it.
    body_px = token_px('--text')
    if body_px is not None:
        print(f'   body = {body_px:.1f}px')
        check(sec_px > body_px,
              f'section ({sec_px:.1f}px) must sit above body text '
              f'({body_px:.1f}px) - a heading at body size is not a heading')
    check(head_px - sec_px >= 8,
          f'the step is a visible gap, not a hairline '
          f'({head_px:.1f} - {sec_px:.1f} = {head_px - sec_px:.1f}px)')
    check(sec_px != head_px,
          f'the two steps are not the same size ({sec_px:.1f} vs {head_px:.1f})')
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
