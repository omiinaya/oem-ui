"""Contract test: a page title's weight comes from the rule, not the tag.

MEASURED walking rpm's 24 routes: pages whose title is an `<h1>` rendered
32px w700, while Redirections, Access Lists and Audit Log - titles that
are a `<div class="cm-head__title">` inside the same `.cm-head` -
rendered 32px w400. Same size, half the presence, on three of seventeen
pages.

The cause was that the rule declared `font-size` and no `font-weight`, so
the bold was inherited from the UA stylesheet for `<h1>` and there was
nothing to set it for the div. A page's title weight therefore depended
on which element the author happened to reach for.
"""
import pathlib
import re
import sys

CSS = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


css = CSS.read_text()

print('1. the rule that sizes the page title also declares its weight')
m = re.search(
    r'\.cm-head h1,\s*\.cm-head \.cm-head__title,\s*'
    r'\.cm-head-row \.cm-head__title \{(.*?)\}', css, re.S)
check(m is not None, 'the page-title rule is findable')
body = m.group(1) if m else ''

check('font-size: var(--head-h1)' in body, 'it declares the size')
check(re.search(r'font-weight:\s*700', body) is not None,
      'it declares the weight (the regression: it used to omit it)')

# If the weight is declared, a div and an h1 in the same .cm-head
# cannot differ. Guard the ordering too: the weight must sit in the SAME
# rule block as the size, not in a separate h1-only rule further down.
check(body.count('font-weight') == 1,
      'exactly one weight declaration, inside the shared rule')

print('2. every head-title selector in that rule can reach it')
sels = re.findall(r'([^\n{]*cm-head__title[^\n{]*)\{', css)
# any rule that sizes a title must also weight it
for sel in sels:
    seg = css.split(sel + '{', 1)
    if len(seg) < 2:
        continue
    block = seg[1].split('}', 1)[0]
    if 'font-size' in block:
        check('font-weight' in block,
              f'"{sel.strip()}" sizes a title and also weights it')

print('3. the section title keeps its own weight, so the scale steps')
sm = re.search(r'\.cm-section__title \{(.*?)\}', css, re.S)
check(sm is not None, '.cm-section__title exists')
if sm:
    sbody = sm.group(1)
    sw = re.search(r'font-weight:\s*(\d+)', sbody)
    check(sw is not None, 'the section title declares a weight')
    if sw and re.search(r'font-weight:\s*700', body):
        check(sw.group(1) == '700',
              'page and section titles share one weight, and differ by size')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
