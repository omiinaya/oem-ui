#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 10: the tree and the resizable panels."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
results, failures = [], []


def check(name, ok, detail):
    line = f'{"ok  " if ok else "FAIL"} {name} :: {detail}'
    results.append(line)
    print(line, flush=True)
    if not ok:
        failures.append(line)


def focused(pg, sel='.cm-tree__row'):
    return pg.evaluate(
        """(s) => {
        const el = document.activeElement;
        if (!el || !el.matches || !el.matches(s)) return {text: null, tag: el && el.tagName};
        return {text: (el.textContent || '').trim(), tag: el.tagName};
      }""",
        sel,
    )


def row_index(pg, text):
    return pg.evaluate(
        """(t) => [...document.querySelectorAll('[data-cm-tree] .cm-tree__row')]
              .findIndex((r) => (r.textContent || '').trim().endsWith(t) &&
                  (r.checkVisibility ? r.checkVisibility() : true))""",
        text,
    )


def resize_state(pg):
    return pg.evaluate(
        """() => {
        const g = document.querySelector('[data-cm-resize]');
        const h = g.querySelector('.cm-resize__handle');
        const p = g.querySelector('.cm-resize__panel');
        const gr = g.getBoundingClientRect();
        return {
          now: Number(h.getAttribute('aria-valuenow')),
          orient: h.getAttribute('aria-orientation'),
          dir: getComputedStyle(g).flexDirection,
          pct: Math.round((p.getBoundingClientRect().width / gr.width) * 1000) / 10,
          handle: Math.round(h.getBoundingClientRect().width),
          hTop: Math.round(h.getBoundingClientRect().top),
          gTop: Math.round(gr.top),
          style: g.getAttribute('style'),
          basis: getComputedStyle(p).flexBasis,
          gWidth: Math.round(gr.width),
          pWidth: Math.round(p.getBoundingClientRect().width),
        };
      }"""
    )


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function(
        "() => window.cliMono && document.querySelector('[data-cm-tree]')"
        " && document.querySelector('[data-cm-resize]')"
    )

    # --- tree ------------------------------------------------------------
    tree = page.query_selector('[data-cm-tree]')
    tree.scroll_into_view_if_needed()

    # the markup's own state: src/ open, tests/ closed
    visible = page.evaluate(
        """() => {
        const open = [...document.querySelectorAll('[data-cm-tree] details')].map((d) => ({
          name: (d.querySelector('summary').textContent || '').replace(/^\W+/, '').trim(),
          open: d.open,
          kids: [...d.querySelectorAll(':scope > ul > li > *')].map(
            (k) => (k.textContent || '').trim()).filter((t) => t),
          shown: [...d.querySelectorAll(':scope > ul .cm-tree__row')]
            .filter((r) => (r.checkVisibility ? r.checkVisibility() : r.getClientRects().length > 0)).length,
        }));
        return open;
      }"""
    )
    by_name = {v['name']: v for v in visible}
    check('the branch the markup opens shows its rows; the closed one hides them',
          by_name.get('src/', {}).get('shown', 0) >= 3 and by_name.get('tests/', {}).get('shown') == 0,
          {'src-shown': by_name.get('src/', {}).get('shown'),
           'tests-shown': by_name.get('tests/', {}).get('shown')})

    # leaves are real links
    leaves = page.evaluate(
        """() => [...document.querySelectorAll('[data-cm-tree] .cm-tree__row')]
              .filter((r) => r.tagName === 'A' && r.getAttribute('href')).length"""
    )
    check('leaves are real links, not clickable spans', leaves >= 3, {'leaves': leaves})

    # roving: after focus, exactly one visible row is the tab stop
    page.evaluate("() => document.querySelector('[data-cm-tree] summary').focus()")
    stops = page.evaluate(
        """() => [...document.querySelectorAll('[data-cm-tree] .cm-tree__row')]
              .filter((r) => (r.checkVisibility ? r.checkVisibility() : true) && r.tabIndex === 0).length"""
    )
    check('exactly one visible row is the tab stop', stops == 1, {'tabStops': stops})

    f0 = focused(page)
    page.keyboard.press('ArrowDown')
    f1 = focused(page)
    i0, i1 = row_index(page, f0['text']), row_index(page, f1['text'])
    check('ArrowDown steps to the next visible row',
          f1['text'] is not None and i1 == i0 + 1, {'from': f0['text'], 'to': f1['text']})
    page.keyboard.press('ArrowUp')
    f2 = focused(page)
    check('ArrowUp steps back', f2['text'] == f0['text'], {'back': f2['text']})

    # The cursor must step OVER a closed branch's children, never onto them:
    # WebKit LAYS OUT those rows (they report a rect) even though nothing
    # paints and nothing hit-tests, so rects alone walk you into the dark.
    page.evaluate("() => [...document.querySelectorAll('[data-cm-tree] summary')]"
                  ".find((s) => (s.textContent || '').trim().endsWith('tests/')).focus()")
    page.keyboard.press('ArrowDown')
    f_skip = focused(page)
    check('ArrowDown steps over the rows of a closed branch',
          (f_skip['text'] or '').endswith('README.md'), {'skippedTo': f_skip['text']})

    page.keyboard.press('End')
    check('End jumps to the last visible row',
          focused(page)['text'] == 'README.md', {'end': focused(page)['text']})
    page.keyboard.press('Home')
    check('Home jumps to the first visible row',
          (focused(page)['text'] or '').endswith('oem-ui/'), {'home': focused(page)['text']})

    # ArrowRight on a CLOSED branch opens it through the platform's own click
    page.evaluate("() => [...document.querySelectorAll('[data-cm-tree] details')]"
                  ".find((d) => !d.open).querySelector('summary').focus()")
    branch_name = focused(page)['text']
    before_open = page.evaluate(
        "(n) => [...document.querySelectorAll('[data-cm-tree] details')]"
        ".find((d) => (d.querySelector('summary').textContent || '').trim().endsWith(n)).open",
        branch_name,
    )
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(80)
    after_open = page.evaluate(
        "(n) => [...document.querySelectorAll('[data-cm-tree] details')]"
        ".find((d) => (d.querySelector('summary').textContent || '').trim().endsWith(n)).open",
        branch_name,
    )
    f3 = focused(page)
    check('ArrowRight on a closed branch opens it and lands on its first row',
          (not before_open) and after_open and f3['text'] not in (branch_name, None),
          {'branch': branch_name, 'opened': after_open, 'focus': f3['text']})

    # ArrowLeft on that open branch closes it
    page.evaluate(
        "(t) => [...document.querySelectorAll('[data-cm-tree] summary')]"
        ".find((s) => (s.textContent || '').trim().endsWith(t)).focus()",
        branch_name,
    )
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(80)
    closed = page.evaluate(
        "(n) => ![...document.querySelectorAll('[data-cm-tree] details')]"
        ".find((d) => (d.querySelector('summary').textContent || '').trim().endsWith(n)).open",
        branch_name,
    )
    check('ArrowLeft closes it again', closed, {'closed': closed})

    # ArrowRight on an OPEN branch steps inside (no second toggle)
    page.evaluate("() => [...document.querySelectorAll('[data-cm-tree] details')]"
                  ".find((d) => d.open).querySelector('summary').focus()")
    open_name = focused(page)['text']
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(80)
    still_open = page.evaluate(
        "(n) => [...document.querySelectorAll('[data-cm-tree] details')]"
        ".find((d) => (d.querySelector('summary').textContent || '').trim().endsWith(n)).open",
        open_name,
    )
    f4 = focused(page)
    check('ArrowRight on an OPEN branch steps inside instead of collapsing it',
          still_open and f4['text'] not in (open_name, None),
          {'branch': open_name, 'stillOpen': still_open, 'focus': f4['text']})

    # ArrowLeft on a leaf steps OUT to the parent row
    page.evaluate(
        "() => [...document.querySelectorAll('[data-cm-tree] .cm-tree__row')]"
        ".find((r) => (r.textContent || '').trim() === 'tokens.css').focus()"
    )
    page.keyboard.press('ArrowLeft')
    f5 = focused(page)
    check('ArrowLeft on a leaf steps out to its parent row',
          (f5['text'] or '').endswith('src/'), {'parent': f5['text']})

    # a click still opens a branch - the platform's own path
    page.evaluate(
        "(t) => [...document.querySelectorAll('[data-cm-tree] summary')]"
        ".find((s) => (s.textContent || '').trim().endsWith(t)).click()",
        'tests/',
    )
    page.wait_for_timeout(60)
    click_open = page.evaluate(
        "(n) => [...document.querySelectorAll('[data-cm-tree] details')]"
        ".find((d) => (d.querySelector('summary').textContent || '').trim().endsWith(n)).open",
        'tests/',
    )
    check('a plain click still expands a branch (the platform owns it)', click_open, {'open': click_open})

    # --- resizable -------------------------------------------------------
    box = page.query_selector('[data-cm-resize]')
    box.scroll_into_view_if_needed()
    st = resize_state(page)
    check('the reported value, the painted split and the markup agree',
          st['now'] == 58 and abs(st['pct'] - 58) <= 1.5 and st['dir'] == 'row' and st['orient'] == 'vertical',
          {'now': st['now'], 'painted': st['pct'], 'dir': st['dir'], 'orient': st['orient']})

    g = box.bounding_box()
    handle = page.query_selector('.cm-resize__handle')
    hb = handle.bounding_box()
    # the handle spans the group's full height; its centre can sit below the
    # viewport, and a mouse event outside the viewport hits NOTHING - which
    # reads as a drag that did nothing. Work on the part that is on screen.
    grip = min(hb['y'] + hb['height'] / 2, 800 - 30)

    # drag to ~35% of the group
    page.mouse.move(hb['x'] + hb['width'] / 2, grip)
    page.mouse.down()
    page.mouse.move(g['x'] + g['width'] * 0.35, grip, steps=8)
    page.mouse.up()
    # base.css's reduced-motion guard runs every transition at 0.01ms, so a
    # synchronous read still returns the value the property STARTED from.
    # A frame later it is settled; measure the settled state.
    page.wait_for_timeout(80)
    st = resize_state(page)
    check('dragging the seam moves the boundary and reports it',
          abs(st['now'] - 35) <= 2 and abs(st['pct'] - 35) <= 2,
          st)

    # drag past the maximum: it clamps at 80
    hb = handle.bounding_box()
    page.mouse.move(hb['x'] + hb['width'] / 2, grip)
    page.mouse.down()
    page.mouse.move(g['x'] + g['width'] * 1.2, grip, steps=6)
    page.mouse.up()
    page.wait_for_timeout(80)
    st = resize_state(page)
    check('the boundary clamps at aria-valuemax', st['now'] == 80 and abs(st['pct'] - 80) <= 1.5,
          st)

    # keyboard: 16px steps, Home/End to the ends
    handle.focus()
    before = page.evaluate(
        "() => document.querySelector('.cm-resize__panel').getBoundingClientRect().width"
    )
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(80)
    after = page.evaluate(
        "() => document.querySelector('.cm-resize__panel').getBoundingClientRect().width"
    )
    st = resize_state(page)
    moved = before - after
    check('an arrow key moves the boundary by 16px, not a percentage',
          14 <= moved <= 18 and st['now'] < 80,
          dict(st, px=round(moved, 1), beforeW=round(before), afterW=round(after)))
    page.keyboard.press('Home')
    st = resize_state(page)
    check('Home goes to aria-valuemin', st['now'] == 20, {'now': st['now']})
    page.keyboard.press('End')
    st = resize_state(page)
    check('End goes to aria-valuemax', st['now'] == 80, {'now': st['now']})

    check('no page JS errors', not errors, {'errors': errors[:3]})
    page.close()

    # --- the stacked phone layout ---------------------------------------
    phone = browser.new_page(viewport={'width': 402, 'height': 667})
    perr = []
    phone.on('pageerror', lambda e: perr.append(str(e)))
    phone.goto(URL, wait_until='domcontentloaded')
    phone.wait_for_function("() => window.cliMono && document.querySelector('[data-cm-resize]')")
    st = resize_state(phone)
    check('below 640px the group stacks and the separator says horizontal',
          st['dir'] == 'column' and st['orient'] == 'horizontal',
          {'dir': st['dir'], 'orient': st['orient']})
    check('the stacked group still reports its split as a percentage of its height',
          st['now'] == 58, {'now': st['now']})
    check('no sideways scroll at 402px',
          phone.evaluate("() => document.documentElement.scrollWidth") == 402,
          {'vw': 402})
    check('no page JS errors on the phone', not perr, {'errors': perr[:3]})
    browser.close()

print(f'\n{len(results) - len(failures)} passed, {len(failures)} failed')
sys.exit(1 if failures else 0)
