"""Contract test: a balanced stat band has no stranded tile.

MEASURED on the live rpm dashboard at 1280px: seven `.cm-stat` tiles in a
1008px band resolved to six columns of 158px with the seventh alone on
row two and 850px of dead space beside it. `auto-fit` removes a FIXED
column count; it cannot remove a ragged last row, because it always fits
as many columns as the width allows. That is arithmetic - the first fix
attempted here capped it with a computed minmax and measured the same
158px back, which is what proved it.

So the balanced band takes an EXPLICIT column count.
"""
import pathlib
import re
import sys

CSS = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
DASH = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/pages/Dashboard.tsx')

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


css = CSS.read_text()

print('1. the library defines a balanced stat band')
check('.cm-stats--balance {' in css, '.cm-stats--balance exists')

# THE regression: auto-fit inside the modifier. It cannot balance a
# ragged last row, so it must not be what the modifier relies on.
m = re.search(r'\.cm-stats--balance \{(.*?)\}', css, re.S)
body = m.group(1) if m else ''
check('auto-fit' not in body,
      'the modifier does NOT rely on auto-fit (it cannot balance a row)')
check('repeat(var(--cm-stat-cols)' in body,
      'it takes an explicit column count')

print('2. the column count is a real number, not zero')
cv = re.search(r'--cm-stat-cols:\s*(\d+)', body)
check(cv is not None, '--cm-stat-cols is declared')
if cv:
    n = int(cv.group(1))
    check(n >= 2, f'--cm-stat-cols is usable ({n})')
    # The data rpm has is 7 tiles. With n columns the short row holds
    # 7 % n tiles and the dead space is (n - 7 % n) columns wide.
    for count in (5, 7, 8):
        short = count % n
        dead_cols = 0 if short == 0 else n - short
        print(f'   {count} tiles over {n} cols -> short row {short}, '
              f'{dead_cols} dead column(s)')
        check(dead_cols <= 1,
              f'{count} tiles leaves at most one dead column (got {dead_cols})')

print('3. it steps down with the viewport, so a phone never overflows')
media = re.findall(r'@media \(max-width: (\d+)px\) \{\s*\.cm-stats--balance', css)
check(len(media) >= 2,
      f'it has narrow breakpoints ({media or "none"})')
if len(media) >= 2:
    widths = [int(m) for m in media]
    check(widths == sorted(widths, reverse=True),
          'breakpoints descend (widest rule first)')
    last = re.search(r'@media \(max-width: ' + media[-1] +
                     r'px\) \{\s*\.cm-stats--balance \{[^}]*--cm-stat-cols:\s*(\d+)',
                     css, re.S)
    check(last is not None and int(last.group(1)) == 2,
          'the narrowest rule drops to 2 columns')

print('4. the dashboard actually asks for it')
dash = DASH.read_text()
check('cm-stats--balance' in dash, 'Dashboard uses the balanced band')
# and only on the stat band - a stray modifier on a 3-tile showcase
# would balance 3 into 2+1, which is worse than the ragged row
check(dash.count('cm-stats--balance') == 1,
      'exactly one balanced band on the page')

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
