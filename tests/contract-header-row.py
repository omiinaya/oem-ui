"""Contract test: a card header is one honest row.

MEASURED on rpm before this fix: all six of the dashboard's card headers
had the `.cm-head__badge` icon and the title STACKED - the icon alone on
its row, the title 32px below it at the same x - and the `.cm-tag` chip
sat 623px from the card's right edge, stranded mid-card.

Both were LIBRARY gaps, not rpm mistakes: `.cm-head-row__text` carried
only `min-width: 0`, and nothing on the row pushed a trailing chip.
"""
import pathlib
import re
import sys

LIB = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
APP = pathlib.Path('/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src')

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


css = LIB.read_text()

print('1. .cm-head-row__text lays its badge and title out on one line')
m = re.search(r'\.cm-head-row__text \{(.*?)\}', css, re.S)
body = m.group(1) if m else ''
check(m is not None, '.cm-head-row__text has a block rule (not a one-liner)')
check('display: flex' in body,
      'it is a flex row - otherwise the badge stacks above the title')
check('align-items: center' in body,
      'the badge and title are centred on the same baseline')
check('min-width: 0' in body,
      'it still lets a long title shrink instead of pushing the action off')
# The old single-line declaration must be gone, or it fights the block.
# This used to be `count('.cm-head-row__text {') == 1`, which went stale
# the moment the library needed a second block rule (the shrink floor) --
# and a literal-count assertion fails the day the CSS gets BETTER, which
# is the worst possible time for a guard to go red. Assert the actual
# defect instead: a leftover ONE-LINER declaration of this selector.
_text_css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
_blocks = re.findall(r'\.cm-head-row__text \{([^}]*)\}', _text_css)
# A one-liner is a single declaration. Block rules here carry two or
# more. Measuring bytes would have been another invented threshold.
_one_liners = [b for b in _blocks
               if len([d for d in b.split(';') if d.strip()]) <= 1]
check(not _one_liners,
      'no leftover one-line .cm-head-row__text declaration')
check(len(_blocks) >= 1,
      '.cm-head-row__text still declares its own block rule')

print('2. a trailing chip is pushed to the row\'s far end')
meta = re.search(r'\.cm-head-row__meta \{(.*?)\}', css, re.S)
mb = meta.group(1) if meta else ''
check(meta is not None, '.cm-head-row__meta exists (the stranded chip)')
check('margin-left: auto' in mb, 'the chip is pushed to the far end')
check('flex: 0 0 auto' in mb, 'the chip does not stretch or shrink')
check('align-self: center' in mb, 'the chip is centred on the header row')

print('3. rpm asks for it - every trailing chip on a header row')
# The first version of this check used a non-greedy regex to find the
# head-row's body. That stops at the FIRST inner </div> - the text
# wrapper's - so it never reached the chip at all, and removing a chip
# left the guard green. Both mutation survivors came from here. Bracket
# matching is the honest way to find where an element actually ends.
import glob


def element_at(src, i):
    """The element whose opening tag starts at src[i]."""
    depth = 0
    for m in re.finditer(r'<div\b|</div>', src[i:]):
        depth += 1 if m.group(0) == '<div' else -1
        if depth == 0:
            return src[i:i + m.end()]
    return ''


stranded = []
total = 0
for f in sorted(glob.glob(str(APP / 'pages' / '*.tsx'))):
    src = pathlib.Path(f).read_text()
    for m in re.finditer(r'<div className="cm-head-row">', src):
        blk = element_at(src, m.start())
        for t in re.finditer(r'<span className="cm-tag([^"]*)"', blk):
            total += 1
            if 'cm-head-row__meta' not in t.group(1):
                line = src[:m.start()].count('\n') + 1
                stranded.append(f'{pathlib.Path(f).name}:{line}')

check(not stranded,
      f'every chip inside a header row is pushed (offenders: {stranded or "none"})')
check(total >= 5,
      f'the check actually finds the chips it claims to ({total} found)')

# a head-row holding a badge must use the row's own text wrapper,
# not a bare div - a bare div is what stacked in the first place
bare = 0
for f in sorted(APP.glob('pages/*.tsx')):
    src = f.read_text()
    for mm in re.finditer(r'<div>\s*<span className="cm-head__badge"', src):
        bare += 1
check(bare == 0,
      f'no header wraps a badge in a bare <div> ({bare} found) - it needs cm-head-row__text')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
