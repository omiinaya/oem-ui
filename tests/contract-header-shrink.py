"""Contract test: a header row's title may wrap, but it may not COLLAPSE.

MEASURED, and this is the regression the suite did not catch: making
`.cm-head-row__text` a flex row (so a badge and a title sit on one line
instead of stacking) turned its children into flex items, and the
`min-width: 0` that belongs to the WRAPPER began applying to the TITLE.
A flex item with `min-width: 0` shrinks to the width of its longest
word rather than its content, so on the showcase 22 headings collapsed -
"nav" to 13px, "Records" to 23px - each wrapping one or two characters
per line. Green suite, correct-looking source, wrecked headings.

So the rule is: the wrapper may shrink; a child must not shrink below a
floor wide enough to read.
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

print('1. the wrapper is a flex row (the badge fix stays)')
m = re.search(r'\.cm-head-row__text \{(.*?)\}', css, re.S)
body = m.group(1) if m else ''
check(m is not None and 'display: flex' in body,
      '.cm-head-row__text is still a flex row')

print('2. its children get a shrink FLOOR, not a free pass to zero')
kids = re.search(
    r'\.cm-head-row__text > \* \{(.*?)\}', css, re.S)
kb = kids.group(1) if kids else ''
check(kids is not None,
      'there is a rule for .cm-head-row__text children')
check('min-width' in kb,
      'children declare a min-width')
floor = re.search(r'min-width:\s*([^;]+);', kb)
if floor:
    val = floor.group(1).strip()
    print(f'   floor: {val}')
    # A floor that collapses to zero is no floor at all. `min-width: 0`
    # and `min(0%, ...)` both DECLARE min-width and both are the bug, so
    # the guard has to evaluate the value, not merely find it - the first
    # version of this test survived both mutations.
    zero_like = re.match(r'\s*(0|0px|0%|auto)\b', val) or \
        re.match(r'\s*min\(\s*0', val)
    check(zero_like is None,
          f'the floor is not zero-like ({val})')
    check(re.search(r'\d+(rem|px|em|ch)', val) is not None,
          f'the floor names a real width ({val})')
    # and it must not be negotiable: `min(100%, 12rem)` is a floor that
    # is only 12rem when the container allows it
    check(re.match(r'\s*min\(\s*0', val) is None,
          'the floor does not start from 0%')
check('flex: 0 1 auto' in kb,
      'children may shrink, but not to nothing (flex-shrink is bounded)')

print('3. the badge is never squashed')
badge = re.search(r'\.cm-head-row__text > \.cm-head__badge \{(.*?)\}', css, re.S)
bb = badge.group(1) if badge else ''
check(badge is not None, 'the badge has its own rule')
check('flex: 0 0 auto' in bb, 'the icon does not shrink at all')
check('min-width: auto' in bb, 'the icon keeps its natural width')

print('4. and the trap is documented where the next edit will see it')
i = css.find('.cm-head-row__text {')
window = css[max(0, i - 1400):i]
check('flex item' in window and 'min-width: 0' in window,
      'the comment explains why min-width: 0 cannot reach the child')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
