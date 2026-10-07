#!/root/.venvs/mau/bin/python
"""Runtime parity, driven like a user in WebKit: keyboard and pointer only.

 - dropdown: opening focuses the first enabled item; ArrowDown/ArrowUp wrap,
   Home/End jump, aria-disabled items are skipped
 - toggle group [data-cm-seg="single"]: a press is exclusive
 - toggle group [data-cm-seg="multi"]: each press toggles itself only
 - an un-opted .cm-seg is left alone (consumers that own their state)
 - search clear: empties the field, fires a bubbling `input`, refocuses it
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'
fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


def focused(pg):
    return pg.evaluate("document.activeElement && document.activeElement.textContent.trim()")


def pressed(pg, sel):
    return pg.evaluate(f"[...document.querySelectorAll('{sel} .cm-seg__opt')].map(b => b.getAttribute('aria-pressed'))")


with sync_playwright() as p:
    b = p.webkit.launch()
    for W in (402, 1280):
        ctx = b.new_context(viewport={'width': W, 'height': 874}, has_touch=(W < 800))
        pg = ctx.new_page()
        pg.goto(URL, wait_until='load')
        pg.wait_for_timeout(300)
        print(f'--- {W}px')

        # dropdown
        trig = pg.locator('[popovertarget="menu-demo"]')
        trig.scroll_into_view_if_needed()
        trig.focus()
        pg.keyboard.press('Enter')
        pg.wait_for_timeout(150)
        check(focused(pg) == 'rename', f'opening focuses the first item ({focused(pg)!r})')
        pg.keyboard.press('ArrowDown')
        check(focused(pg) == 'duplicate', f'ArrowDown moves to the next item ({focused(pg)!r})')
        pg.keyboard.press('ArrowDown')
        check(focused(pg) == 'rename', f'ArrowDown skips the disabled item and wraps ({focused(pg)!r})')
        pg.keyboard.press('ArrowUp')
        check(focused(pg) == 'duplicate', f'ArrowUp wraps to the last enabled item ({focused(pg)!r})')
        pg.keyboard.press('Home')
        check(focused(pg) == 'rename', f'Home jumps to the first item ({focused(pg)!r})')
        pg.keyboard.press('End')
        check(focused(pg) == 'duplicate', f'End jumps to the last enabled item ({focused(pg)!r})')
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(100)
        open_ = pg.evaluate("document.getElementById('menu-demo').matches(':popover-open')")
        check(not open_, 'Escape closes the menu')

        # single toggle group
        single = '[data-cm-seg="single"]'
        pg.locator(single).first.scroll_into_view_if_needed()
        before = pressed(pg, single)
        check(before.count('true') == 1, f'single group starts with exactly one pressed {before}')
        pg.locator(f'{single} .cm-seg__opt').nth(1).click()
        after = pressed(pg, single)
        check(after == ['false', 'true'], f'a press in a single group is exclusive {after}')
        pg.locator(f'{single} .cm-seg__opt').nth(1).click()
        again = pressed(pg, single)
        check(again == ['false', 'true'], f'pressing the pressed option keeps one selected {again}')

        # multi toggle group
        multi = '[data-cm-seg="multi"]'
        m0 = pressed(pg, multi)
        pg.locator(f'{multi} .cm-seg__opt').nth(0).click()
        pg.locator(f'{multi} .cm-seg__opt').nth(2).click()
        m1 = pressed(pg, multi)
        flip = {'true': 'false', 'false': 'true'}
        want = [flip[m0[0]], m0[1], flip[m0[2]]]
        check(m1 == want, f'multi presses toggle independently {m0} -> {m1}')

        # un-opted group is untouched
        plain = pg.evaluate("""() => {
          const g = [...document.querySelectorAll('.cm-seg:not([data-cm-seg])')][0];
          if (!g) return null;
          const opts = [...g.querySelectorAll('.cm-seg__opt')];
          const before = opts.map(o => o.getAttribute('aria-pressed'));
          const target = opts.find(o => o.getAttribute('aria-pressed') !== 'true');
          if (target) target.click();
          return [before, opts.map(o => o.getAttribute('aria-pressed'))];
        }""")
        check(plain is not None and plain[0] == plain[1], f'an un-opted .cm-seg keeps its own state {plain}')

        # search clear
        inp = pg.locator('#q-filled')
        inp.scroll_into_view_if_needed()
        pg.evaluate("""() => { window.__inputs = 0;
          document.addEventListener('input', e => { if (e.target.id === 'q-filled') window.__inputs++; }); }""")
        pg.locator('#q-filled ~ .cm-search__clear').click()
        st = pg.evaluate("({v: document.getElementById('q-filled').value, n: window.__inputs, f: document.activeElement.id})")
        check(st['v'] == '', f"clear empties the field ({st['v']!r})")
        check(st['n'] >= 1, f"clear fires a bubbling input event (n={st['n']})")
        check(st['f'] == 'q-filled', f"clear returns focus to the field ({st['f']!r})")
        ctx.close()
    b.close()

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
