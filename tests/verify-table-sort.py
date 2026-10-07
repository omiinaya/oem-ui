#!/root/.venvs/mau/bin/python
"""Table sort, driven like a reader in WebKit.

The CSS has always drawn a sort glyph from `aria-sort`, and the showcase
declares `descending` on Method and `ascending` on Client - with no code
that ever sorted anything. Nothing here inspects the runtime; each check
is an effect a reader would notice:

 - a click sorts, the state moves to that column, the others go back to
   `none`, focus stays on the button that was pressed
 - numbers order as numbers (7 < 99 < 1,024), not as text
 - a table that declares a sorted state on load is actually IN it
 - no row is lost, none is duplicated, and the page still does not scroll
   sideways
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'
fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)



def js_order(vals, reverse=False):
    """Human order, stated independently of the runtime: numeric collation
    in the page. Python's sorted() is lexicographic and would order
    '2s ago' after '1m ago', which no reader means."""
    return pg.evaluate("""([vals, rev]) => [...vals].sort((a, b) =>
        (rev ? -1 : 1) * a.localeCompare(b, undefined,
            { numeric: true, sensitivity: 'base' }))""", [vals, reverse])

COL = """([sel, i]) => [...document.querySelectorAll(sel + ' tbody tr')]
    .map(tr => (tr.cells[i] ? tr.cells[i].textContent : '').trim())"""

STATE = """(sel) => {
  const out = {};
  document.querySelectorAll(sel + ' th').forEach(th => {
    if (th.hasAttribute('aria-sort')) out[th.textContent.trim()] = th.getAttribute('aria-sort');
  });
  return out;
}"""

with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    pg = ctx.new_page()
    pg.goto(URL, wait_until='load')
    pg.wait_for_timeout(300)

    T = 'table.cm-table[data-cm-sort]'
    check(pg.evaluate("() => !!document.querySelector('table.cm-table[data-cm-sort]')"),
          'the showcase table opts in with data-cm-sort')

    ROWCOUNT = "() => document.querySelectorAll('table.cm-table[data-cm-sort] tbody tr').length"
    before_rows = pg.evaluate(ROWCOUNT)
    t0 = pg.evaluate(COL, [T, 0])
    check(len(t0) > 3, f'the table has rows to sort ({len(t0)})')

    # 1. a sort the markup DECLARES must already be true on screen
    declared = pg.evaluate(STATE, T)
    check(declared.get('Method') == 'descending',
          f'Method declares descending on load ({declared.get("Method")})')
    method_is_desc = pg.evaluate("""() => {
      const vals = [...document.querySelectorAll('table.cm-table[data-cm-sort] tbody tr')]
        .map(r => r.cells[1].textContent.trim());
      const want = [...vals].sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      return JSON.stringify(vals) === JSON.stringify(want);
    }""")
    check(method_is_desc, 'Method rows are actually in descending order on load')

    def glyph(sel):
        return pg.evaluate("""(s) => {
          const btn = document.querySelector(s);
          if (!btn) return null;
          const a = getComputedStyle(btn, '::after');
          return { bg: a.backgroundColor, clip: a.clipPath };
        }""", sel)

    g = glyph('th[aria-sort="descending"] button.cm-table__sort')
    check(g and g['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent') and g['clip'] != 'none',
          f'the descending header paints its direction mark ({g})')

    # 2. click Time: ascending, aria-sort moves, focus stays put
    time_btn = pg.locator(f'{T} .cm-table__sort').filter(has_text='Time').first
    time_btn.click()
    pg.wait_for_timeout(120)
    order = pg.evaluate(COL, [T, 0])
    check(order == js_order(order), f'Time column is ascending after one click ({order[:3]})')
    state = pg.evaluate(STATE, T)
    check(state.get('Time') == 'ascending', f'Time announces ascending ({state})')
    g = glyph('th[aria-sort="ascending"] button.cm-table__sort')
    check(g and g['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent') and g['clip'] != 'none',
          f'the newly ascending header paints its mark ({g})')
    others = {k: v for k, v in state.items() if k != 'Time'}
    check(all(v == 'none' for v in others.values()),
          f'every other column went back to none ({others})')
    focused = pg.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
    check(focused == 'Time', f'focus stayed on the pressed button ({focused})')

    # 3. second click reverses
    time_btn.click()
    pg.wait_for_timeout(120)
    order = pg.evaluate(COL, [T, 0])
    check(order == js_order(order, reverse=True), f'second click is descending ({order[:3]})')

    # 4. rows neither lost nor duplicated
    after_rows = pg.evaluate(ROWCOUNT)
    check(after_rows == before_rows, f'no row lost or duplicated ({before_rows} -> {after_rows})')

    # 5. a table the page never saw at load: numbers must order as numbers
    pg.evaluate("""() => {
      const host = document.createElement('div');
      host.id = 'sort-fixture';
      host.innerHTML = '<table data-cm-sort><thead><tr>' +
        '<th scope="col" aria-sort="none"><button type="button" class="cm-table__sort">Size</button></th>' +
        '<th scope="col" aria-sort="none"><button type="button" class="cm-table__sort">Name</button></th>' +
        '</tr></thead><tbody>' +
        '<tr><td>1,024</td><td>zeta</td></tr>' +
        '<tr><td>99</td><td>alpha</td></tr>' +
        '<tr><td>7</td><td>mid</td></tr>' +
        '</tbody></table>';
      document.body.appendChild(host);
    }""")
    pg.locator('#sort-fixture .cm-table__sort').filter(has_text='Size').click()
    pg.wait_for_timeout(120)
    sizes = pg.evaluate("() => [...document.querySelectorAll('#sort-fixture tbody td:first-child')].map(td => td.textContent.trim())")
    check(sizes == ['7', '99', '1,024'],
          f'a late-added table sorts numerically, not as text ({sizes})')
    st = pg.evaluate("""() => document.querySelector('#sort-fixture th[aria-sort]').getAttribute('aria-sort')""")
    check(st == 'ascending', f'the new table announces its own state ({st})')

    # 6. still no sideways scroll
    check(pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"),
          'page still does not scroll sideways')

    ctx.close()
    b.close()

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
