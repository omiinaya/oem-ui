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


raw = CSS.read_text()
css = raw

print('1. the wrapper is a flex row (the badge fix stays)')
m = re.search(r'\.cm-head-row__text \{(.*?)\}', css, re.S)
body = m.group(1) if m else ''
check(m is not None and 'display: flex' in body,
      '.cm-head-row__text is still a flex row')

print('2. its children get a shrink FLOOR, not a free pass to zero')
# The floor lives on the TITLE selectors, not on a bare `> *`. The rule
# set grew more specific -- the title is floored, the sub and any other
# child may take the remainder, and the badge never shrinks -- and this
# guard still looked for the old shape, so it went red while the CSS was
# correct. Two earlier guards failed the same way: a guard asserting a
# selector LITERAL goes stale the moment the selector gets better, and
# the cost is that it stops describing the invariant.
#
# So: resolve the FLOOR from whichever child rule declares a min-width
# that is not a free pass to zero, wherever it sits.
# Walk every .cm-head-row__text child rule and take the one that actually
# declares the FLOOR -- the min-width that is NOT a free pass to zero.
# Two of the four child rules legitimately say `min-width: 0` (the sub
# and any other child may take the remainder), so "first rule with a
# min-width" finds the wrong one and reports a correct library as broken.
# Comments first. A comment that explains why `min-width: 0` must not
# reach the child LITERALLY contains `min-width: 0`, and a selector regex
# happily matches a comment as if it were a rule -- which is how this
# guard came to read a prose note as the child's floor.
css = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)),
             raw, flags=re.S)

# Only CHILD rules (the `>` combinator), and take the one whose min-width
# is a real floor rather than a free pass to zero.
ZEROISH = {'0', '0px', '0%', 'auto'}
kb, floor_sel = '', None
for _sel, _body in re.findall(
        r'(\.cm-head-row__text[^{}]*)\{([^}]*)\}', css, re.S):
    if '>' not in _sel.split('{')[0]:
        continue
    for _v in re.findall(r'min-width:\s*([^;]+);', _body):
        _v = _v.strip()
        if _v not in ZEROISH and not _v.startswith('0'):
            kb, floor_sel = _body, ' '.join(_sel.split())
            break
    if kb:
        break
check(kb != '',
      'a .cm-head-row__text child rule declares a non-zero min-width floor')
# The VALUE only -- `min(100%, 12rem)`, not `min-width: min(100%, 12rem)`.
# An earlier version prefixed the property back on, so the `min(\s*0`
# pattern could never match and that assertion was vacuous.
floor_val = None
for _v in re.findall(r'min-width:\s*([^;]+);', kb):
    _v = _v.strip()
    if _v not in ZEROISH and not _v.startswith('0'):
        floor_val = _v
        break
floor = re.match(r'(.+)$', floor_val) if floor_val else None
print(f'   on: {floor_sel}')
if floor:
    val = floor.group(1).strip()
    print(f'   floor: {floor.group(1).strip() if floor else None}')
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
    # `min(0%, 12rem)` DECLARES a floor and collapses to nothing: the
    # percentage resolves to 0 whenever the container is narrow, which is
    # exactly the case the floor exists for. Read the value the guard
    # actually extracted -- an earlier version read a variable it had
    # stopped assigning, so this assertion was passing vacuously.
    _fv = floor.group(1).strip()
    check(re.match(r'\s*min\(\s*0', _fv) is None,
          f'the floor does not start from 0% (got {_fv})')
check('flex: 0 1 auto' in kb,
      'children may shrink, but not to nothing (flex-shrink is bounded)')

print('3. the badge is never squashed')
badge = re.search(r'\.cm-head-row__text > \.cm-head__badge \{(.*?)\}', css, re.S)
bb = badge.group(1) if badge else ''
check(badge is not None, 'the badge has its own rule')
check('flex: 0 0 auto' in bb, 'the icon does not shrink at all')
check('min-width: auto' in bb, 'the icon keeps its natural width')

# The badge must also WIN. It used not to, and every check above still
# passed while it was broken.
#
# MEASURED: the catch-all `> *:not(title):not(title)` ALSO matches
# .cm-head__badge. Both rules weigh (0,2,0), so source order decided, the
# badge inherited `flex: 1 1 auto`, and six badges rendered 297..417px
# wide and 32px tall -- empty frames around a 16px glyph, each one
# pushing its panel title to a different x. A guard that reads the badge's
# own declarations passes no matter what the cascade does to it.
# Capture the WHOLE selector list, not just the first :not(...): the
# exclusion chain is `*:not(a):not(b):not(c)` and a regex that stops at the
# first paren reads a list that does not exist.
_catchall = None
for _sel, _body in re.findall(
        r'([^{}]+)\{([^}]*)\}', css, re.S):
    if '> *:not(' in _sel:
        _catchall = (_sel, _body)
        break
_catchall_sels = _catchall[0] if _catchall else ''
_catchall_body = _catchall[1] if _catchall else ''
check('.cm-head__badge' in _catchall_sels,
      'the catch-all child rule EXCLUDES the badge (else it wins on order)')
check('flex: 1 1 auto' not in bb or 'flex: 0 0 auto' in bb,
      'the badge is not given slack by its own rule')
# And the badge's rule must come AFTER the catch-all, since they tie.
# Tie on specificity is decided by ORDER, so the order is part of the rule.
if _catchall:
    _at_catch = css.index('> *:not(')
    _at_badge = css.index('> .cm-head__badge {')
    check(_at_badge > _at_catch,
          'the badge rule comes after the catch-all it must beat')

print('4. and the trap is documented where the next edit will see it')
# Read the RAW file here: this check is about the PROSE, and the parsed
# `css` above has had its comments blanked out on purpose.
i = raw.find('.cm-head-row__text {')
window = raw[max(0, i - 1400):i]
check('flex item' in window and 'min-width: 0' in window,
      'the comment explains why min-width: 0 cannot reach the child')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
