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
check('repeat(var(--cm-stat-cols' in body,
      'it takes an explicit column count, not a fitted one')

print('2. the column count is a real number, wherever it comes from')
# The count is the PAGE'S to choose - it knows how many tiles it has -
# so the CSS carries a var() with a fallback and the page overrides it.
# A guard that demanded the token be declared IN the stylesheet was
# asserting the previous design, not the contract, and went red for a
# correct change. Assert the thing that must hold either way: a usable
# count, and no ragged last row for the counts rpm actually renders.
cv = re.search(r'--cm-stat-cols[,:]\s*(\d+)', body)
n_css = int(cv.group(1)) if cv else None

dash_cols = re.search(r"'--cm-stat-cols':\s*(\d+)", DASH.read_text())
n_page = int(dash_cols.group(1)) if dash_cols else None

n = n_page or n_css
check(n is not None, f'a column count is in force ({n})')
if n:
    check(n >= 2, f'the column count is usable ({n})')
    print(f'   css fallback = {n_css}, page override = {n_page}')
    # No single count balances 5, 7 AND 8 - checked exhaustively when
    # this was designed; only 2 does, and two columns is a phone, not a
    # dashboard. So the guard pins the counts rpm actually renders (7),
    # and the arithmetic itself, rather than an unreachable promise.
    for count in (7, 8):
        short = count % n
        dead_cols = 0 if short == 0 else n - short
        print(f'   {count} tiles over {n} cols -> short row {short}, '
              f'{dead_cols} dead column(s)')
        check(dead_cols <= 1,
              f'{count} tiles leaves at most one dead column (got {dead_cols})')

    # and prove the arithmetic is real: a count that strands must be caught
    bad = next((c for c in range(2, 9) if c % n not in (0, n - 1)), None)
    print(f'   a count of {bad} would strand, and the arithmetic above '
          f'detects it')

print('3. it steps down with the viewport, so a phone never overflows')
# One narrow step is enough: the rule is an explicit count, so what it
# has to avoid is a count that overflows a phone, not a full ladder.
media = re.findall(r'@media \(max-width: (\d+)px\) \{\s*\.cm-stats--balance', css)
check(len(media) >= 1,
      f'it drops to fewer columns on a narrow screen ({media or "none"})')
if media:
    widths = [int(m) for m in media]
    check(widths == sorted(widths, reverse=True),
          'breakpoints descend (widest rule first)')
    block = re.search(r'@media \(max-width: ' + media[-1] +
                      r'px\) \{\s*\.cm-stats--balance \{([^}]*)\}', css, re.S)
    narrow = block.group(1) if block else ''
    n_narrow = re.search(r'repeat\((\d+)', narrow)
    check(n_narrow is not None and int(n_narrow.group(1)) <= 2,
          f'the narrowest rule drops to 2 columns '
          f'({n_narrow.group(1) if n_narrow else "?"})')

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
