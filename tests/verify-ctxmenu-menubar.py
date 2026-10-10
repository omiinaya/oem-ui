#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 9: the context menu and the menubar."""
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


def snap(pg, menu_id, trig_sel=None):
    return pg.evaluate(
        """([mid, tsel]) => {
        const m = document.getElementById(mid);
        const r = m.getBoundingClientRect();
        const out = {
          open: m.matches(':popover-open'),
          visible: getComputedStyle(m).display !== 'none' && r.width > 0,
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          radius: getComputedStyle(m).borderRadius,
          focused: (document.activeElement && document.activeElement.textContent || '').trim().slice(0, 24),
          vw: innerWidth, vh: innerHeight,
        };
        if (tsel) {
          const t = document.querySelector(tsel).getBoundingClientRect();
          out.tLeft = Math.round(t.left); out.tTop = Math.round(t.top);
          out.tRight = Math.round(t.right); out.tBottom = Math.round(t.bottom);
        }
        return out;
      }""",
        [menu_id, trig_sel],
    )


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 402, 'height': 667})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function(
        "() => window.cliMono && document.getElementById('ctx-demo')"
        " && document.querySelector('[data-cm-menubar]')"
    )

    row = page.query_selector('[data-cm-ctx="ctx-demo"]')
    row.scroll_into_view_if_needed()
    box = row.bounding_box()
    # a point inside the row, 60px from its left edge
    px = round(box['x'] + 60)
    py = round(box['y'] + box['height'] / 2)

    # --- context menu opens AT THE POINTER ------------------------------
    page.click('[data-cm-ctx="ctx-demo"]', button='right', position={'x': 60, 'y': box['height'] / 2})
    page.wait_for_function("() => document.getElementById('ctx-demo').matches(':popover-open')")
    st = snap(page, 'ctx-demo')
    # the same clamp the runtime applies: panel keeps 8px inside the edge
    exp_left = min(px, st['vw'] - st['w'] - 8)
    exp_top = min(py, st['vh'] - st['h'] - 8)
    exp_left = max(8, exp_left)
    exp_top = max(8, exp_top)
    check('the panel opens at the pointer, clamped inside the viewport',
          st['open'] and st['visible']
          and abs(st['left'] - exp_left) <= 2 and abs(st['top'] - exp_top) <= 2,
          {'left': st['left'], 'expect': exp_left, 'top': st['top'], 'expectTop': exp_top})
    check('the panel is sharp', st['radius'] in ('0px', ''), {'radius': st['radius']})
    check('opening moves focus into the menu',
          st['focused'] in ('rename', 'duplicate'), {'focused': st['focused']})

    # the first item really has focus (not just textContent in the readout)
    focused = page.evaluate(
        "() => (document.activeElement.textContent || '').trim()"
    )
    check('the FIRST item holds focus, so ArrowDown has a start', focused == 'rename',
          {'focused': focused})

    # Escape closes (the platform's job)
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.getElementById('ctx-demo').matches(':popover-open')")
    check('Escape closes it', True, 'closed')

    # the OS menu is suppressed by preventDefault in OUR handler
    prevented = page.evaluate(
        """() => {
        const row = document.querySelector('[data-cm-ctx="ctx-demo"]');
        const ev = new Event('contextmenu', { bubbles: true, cancelable: true });
        row.dispatchEvent(ev);
        return ev.defaultPrevented;
      }"""
    )
    # the synthetic event re-opened the menu; close it again
    page.keyboard.press('Escape')
    check('the browser menu is suppressed by preventDefault in the handler',
          prevented is True, {'defaultPrevented': prevented})

    # a second right-click MOVES it instead of throwing
    page.click('[data-cm-ctx="ctx-demo"]', button='right', position={'x': 60, 'y': box['height'] / 2})
    page.wait_for_function("() => document.getElementById('ctx-demo').matches(':popover-open')")
    st1 = snap(page, 'ctx-demo')
    far_x = max(8, st1['vw'] - 40)
    page.click('[data-cm-ctx="ctx-demo"]', button='right',
               position={'x': box['width'] - 10, 'y': box['height'] / 2})
    page.wait_for_timeout(150)
    st2 = snap(page, 'ctx-demo')
    check('a second right-click moves the panel instead of throwing',
          st2['open'] and (st2['left'] != st1['left'] or st2['top'] != st1['top']),
          {'before': (st1['left'], st1['top']), 'after': (st2['left'], st2['top'])})
    check('the moved panel still fits inside the viewport',
          st2['left'] >= 8 and st2['left'] + st2['w'] <= st2['vw'],
          {'left': st2['left'], 'right': st2['left'] + st2['w'], 'vw': st2['vw']})

    # a page that moves invalidates a POINT anchor: it closes, not drifts
    page.evaluate("() => window.scrollBy(0, 120)")
    page.wait_for_timeout(200)
    closed = page.evaluate("() => !document.getElementById('ctx-demo').matches(':popover-open')")
    check('scrolling closes it - there is no trigger to re-follow', closed, {'closed': closed})

    # an OUTSIDE press dismisses it - manual mode's half of light dismiss
    page.click('[data-cm-ctx="ctx-demo"]', button='right',
               position={'x': 60, 'y': box['height'] / 2})
    page.wait_for_function("() => document.getElementById('ctx-demo').matches(':popover-open')")
    page.mouse.click(10, 620)  # below the panel, well outside it
    page.wait_for_timeout(150)
    outside_closed = page.evaluate("() => !document.getElementById('ctx-demo').matches(':popover-open')")
    check('an outside press dismisses it (the half light dismiss used to own)',
          outside_closed, {'closed': outside_closed})

    # the keyboard has a way in: Shift+F10 / the context-menu key fires the
    # SAME event with no pointer, so the panel must anchor to the element
    row = page.query_selector('[data-cm-ctx="ctx-demo"]')
    row.focus()
    rect = page.evaluate(
        "() => { const r = document.querySelector('[data-cm-ctx]').getBoundingClientRect(); return { left: Math.round(r.left), bottom: Math.round(r.bottom) }; }"
    )
    # Playwright's WebKit driver cannot deliver the ContextMenu/Shift+F10
    # key, so dispatch the SAME event the UA would fire for it: no pointer,
    # cancelable, bubbling from the focused row. The coordinate fallback is
    # what is under test; the key itself is the browser's.
    page.evaluate(
        "() => document.querySelector('[data-cm-ctx]').dispatchEvent("
        "new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))"
    )
    page.wait_for_function("() => document.getElementById('ctx-demo').matches(':popover-open')")
    st = snap(page, 'ctx-demo')
    exp_l = max(8, min(rect['left'], st['vw'] - st['w'] - 8))
    exp_t = max(8, min(rect['bottom'] + 4, st['vh'] - st['h'] - 8))
    check('the context-menu KEY opens it at the focused element, not at 0,0',
          abs(st['left'] - exp_l) <= 2 and abs(st['top'] - exp_t) <= 2,
          {'left': st['left'], 'expect': exp_l, 'top': st['top'], 'expectTop': exp_t})
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.getElementById('ctx-demo').matches(':popover-open')")
    back = page.evaluate("() => document.activeElement.getAttribute('data-cm-ctx')")
    check('closing returns focus to what the menu interrupted',
          back == 'ctx-demo', {'activeElement': back})

    # --- menubar --------------------------------------------------------

    trig = '.cm-menubar__trigger'
    file_btn = page.query_selector(f'{trig}:has-text("file")')
    edit_btn = page.query_selector(f'{trig}:has-text("edit")')
    file_btn.scroll_into_view_if_needed()

    file_btn.click()
    page.wait_for_function("() => document.getElementById('mb-file').matches(':popover-open')")
    st = snap(page, 'mb-file', '.cm-menubar__trigger')
    # left-aligned to its word, clamped like everything else
    exp = max(8, min(st['tLeft'], st['vw'] - st['w'] - 8))
    check('the panel hangs from the LEFT edge of its word',
          abs(st['left'] - exp) <= 2, {'left': st['left'], 'expect': exp,
                                       'wordLeft': st['tLeft']})
    exp_top = max(8, min(st['tBottom'] + 4, st['vh'] - st['h'] - 8))
    check('and directly below it', abs(st['top'] - exp_top) <= 2,
          {'top': st['top'], 'expectTop': exp_top})
    check('opening a word reports itself expanded',
          page.evaluate("() => document.querySelector('[popovertarget=\"mb-file\"]').getAttribute('aria-expanded')")
          == 'true', 'aria-expanded=true')
    focused = page.evaluate("() => (document.activeElement.textContent || '').trim()")
    check('and puts focus in its panel', focused == 'new', {'focused': focused})

    # ArrowRight on a trigger moves the WORD (nothing open)
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.getElementById('mb-file').matches(':popover-open')")
    # Focus the word WITHOUT clicking it: a click would open the panel and
    # the walk below would then be the open-menu walk, not this one.
    page.evaluate("() => document.querySelector('[popovertarget=\"mb-file\"]').focus()")
    page.keyboard.press('ArrowRight')
    active = page.evaluate("() => (document.activeElement.textContent || '').trim()")
    check('ArrowRight walks the words when nothing is open', active == 'edit',
          {'focused': active})

    # ArrowDown opens the focused word (the platform does not map it)
    page.keyboard.press('ArrowDown')
    page.wait_for_function("() => document.getElementById('mb-edit').matches(':popover-open')")
    st = snap(page, 'mb-edit', '.cm-menubar__trigger')
    focused = page.evaluate("() => (document.activeElement.textContent || '').trim()")
    check('ArrowDown opens the focused word',
          st['open'] and focused == 'undo', {'focused': focused})

    # ...and WHILE open, ArrowRight walks to the NEIGHBOURING MENU
    page.keyboard.press('ArrowRight')
    page.wait_for_function("() => document.getElementById('mb-view').matches(':popover-open')")
    src_closed = page.evaluate("() => !document.getElementById('mb-edit').matches(':popover-open')")
    focused = page.evaluate("() => (document.activeElement.textContent || '').trim()")
    check('ArrowRight with a menu open walks to the neighbouring menu',
          src_closed and focused == 'zoom in',
          {'previous_closed': src_closed, 'focused': focused})
    check('the word that moved reports itself expanded',
          page.evaluate("() => document.querySelector('[popovertarget=\"mb-view\"]').getAttribute('aria-expanded')")
          == 'true', 'aria-expanded=true')

    # Escape closes and reports it collapsed
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.getElementById('mb-view').matches(':popover-open')")
    page.wait_for_timeout(80)
    collapsed = page.evaluate(
        "() => document.querySelector('[popovertarget=\"mb-view\"]').getAttribute('aria-expanded')"
    )
    check('closing flips aria-expanded back', collapsed == 'false', {'aria-expanded': collapsed})

    check('no sideways scroll at 402px',
          page.evaluate("() => document.documentElement.scrollWidth") == 402,
          {'vw': 402})
    check('no page JS errors', not errors, {'errors': errors[:3]})
    browser.close()

print(f'\n{len(results) - len(failures)} passed, {len(failures)} failed')
sys.exit(1 if failures else 0)
