#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 13: the date picker (composition over the
existing popover + calendar machinery) and the scroll area."""
import sys
from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4461/'
results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name + ('' if ok and detail is None else f'  -> {detail}'))


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => document.documentElement.classList.contains('cm-js')")
    page.add_style_tag(content='html { scroll-behavior: auto !important; }')

    # ------------------------------------------------ specimen shape ----
    shape = page.evaluate("""() => {
        const wrap = document.querySelector('.cm-datepicker');
        const input = document.querySelector('#dp-input');
        const panel = document.getElementById('dp-panel');
        const cal = panel && panel.querySelector('[data-cm-cal]');
        return {
            wrap: !!wrap,
            readonly: input ? input.readOnly : null,
            haspopup: input ? input.getAttribute('aria-haspopup') : null,
            target: input ? input.getAttribute('popovertarget') : null,
            panelPopover: panel ? panel.hasAttribute('popover') : null,
            frame: panel ? panel.classList.contains('cm-popover') : null,
            mode: cal ? cal.getAttribute('data-cm-cal-mode') : null,
            preValue: input ? input.value : null
        };
    }""")
    check('the specimen is a field, a caret, and a [popover] panel in the popover frame',
          shape['wrap'] and shape['readonly'] and shape['haspopup'] == 'dialog'
          and shape['target'] == 'dp-panel' and shape['panelPopover'] and shape['frame']
          and shape['mode'] == 'single' and shape['preValue'] == '', shape)

    # ------------------------------------------------ the FIELD opens ----
    page.click('#dp-input')
    page.wait_for_timeout(150)
    a = page.evaluate("""() => {
        const open = document.getElementById('dp-panel').matches(':popover-open');
        const pan = document.getElementById('dp-panel').getBoundingClientRect();
        const inp = document.getElementById('dp-input').getBoundingClientRect();
        return {
            open,
            aboveGap: Math.round(pan.bottom - inp.top),
            belowGap: Math.round(pan.top - inp.bottom),
            right: Math.round(pan.right),
            left: Math.round(pan.left),
            vw: innerWidth,
            expanded: document.getElementById('dp-input').getAttribute('aria-expanded')
        };
    }""")
    check('pressing the FIELD opens the panel (the UA only invokes from activatable elements)',
          a['open'], a)
    # adjacency: 4px either side, and inside the viewport
    near = abs(a['aboveGap'] + 4) <= 2 or abs(a['belowGap'] - 4) <= 2
    check('the panel anchors to the field (a 4px seam on whichever side fits)',
          near and 8 <= a['left'] and a['right'] <= a['vw'] - 8, a)
    check('the trigger reports aria-expanded while the panel is open',
          a['expanded'] == 'true', a)

    # ------------------------------------------------ light dismiss -----
    page.mouse.click(60, 300)
    page.wait_for_timeout(150)
    closed = page.evaluate("() => document.getElementById('dp-panel').matches(':popover-open')")
    check('a press OUTSIDE closes the panel (the auto popover owns light dismiss)',
          not closed, {'open': closed})

    # ------------------------------------------------ the CARET opens ---
    page.click('#dp-input + .cm-icon-btn')
    page.wait_for_timeout(150)
    check('the caret button opens the same panel (declarative popovertarget)',
          page.evaluate("() => document.getElementById('dp-panel').matches(':popover-open')"))

    # ------------------------------------------------ pick --------------
    page.click('#dp-panel .cm-cal__day[data-cm-day="2026-10-14"]')
    page.wait_for_timeout(150)
    pick = page.evaluate("""() => ({
        val: document.getElementById('dp-input').value,
        open: document.getElementById('dp-panel').matches(':popover-open'),
        active: document.activeElement ? document.activeElement.className : null
    })""")
    check('a pick writes the ISO day into the input', pick['val'] == '2026-10-14', pick)
    check('and a completed pick closes the panel', not pick['open'], pick)
    check('focus returns to the invoker, not to <body>', 'cm-icon-btn' in (pick['active'] or '')
          or pick['active'] == 'cm-input', pick)

    # ------------------------------------------------ persistence -------
    page.click('#dp-input + .cm-icon-btn')
    page.wait_for_timeout(150)
    persisted = page.evaluate("""() => {
        const cal = document.querySelector('#dp-panel [data-cm-cal]');
        const cell = cal.querySelector('[aria-selected="true"]');
        return {
            open: document.getElementById('dp-panel').matches(':popover-open'),
            sel: cal.getAttribute('data-cm-cal-selected'),
            cell: cell ? cell.getAttribute('data-cm-day') : null
        };
    }""")
    check('the reopened panel still shows the picked day',
          persisted['open'] and persisted['sel'] == '2026-10-14'
          and persisted['cell'] == '2026-10-14', persisted)

    # ------------------------------------------------ month nav ---------
    page.click('#dp-panel [data-cm-cal-next]')
    page.wait_for_timeout(150)
    nav = page.evaluate("""() => ({
        open: document.getElementById('dp-panel').matches(':popover-open'),
        title: document.querySelector('#dp-panel [data-cm-cal-title]').textContent
    })""")
    check('paging the month keeps the panel open (navigation is not a choice)',
          nav['open'] and nav['title'] == 'november 2026', nav)
    page.click('#dp-panel [data-cm-cal-prev]')
    page.wait_for_timeout(150)

    # ------------------------------------------------ deselect ----------
    page.click('#dp-panel .cm-cal__day[data-cm-day="2026-10-14"]')
    page.wait_for_timeout(150)
    deselect = page.evaluate("""() => ({
        val: document.getElementById('dp-input').value,
        open: document.getElementById('dp-panel').matches(':popover-open')
    })""")
    check('re-picking the selected day clears the input (the value is read back, not rewritten)',
          deselect['val'] == '' and not deselect['open'], deselect)

    # ------------------------------------------------ Escape ------------
    page.click('#dp-input')
    page.wait_for_timeout(120)
    page.keyboard.press('Escape')
    page.wait_for_timeout(120)
    esc = page.evaluate("() => document.getElementById('dp-panel').matches(':popover-open')")
    check('Escape closes the panel', not esc, {'open': esc})

    # ------------------------------------------------ scroll area -------
    sa = page.evaluate("""() => {
        const box = document.querySelector('.cm-scrollarea');
        if (!box) return null;
        const s = getComputedStyle(box);
        box.scrollTop = 60;
        const st = box.scrollTop;
        box.scrollTop = 0;
        return {
            overflowY: s.overflowY,
            maxH: s.maxHeight,
            scroll: box.scrollHeight > box.clientHeight + 4,
            scrolled: st >= 59,
            contain: s.overscrollBehaviorY
        };
    }""")
    check('the scrollarea is a real scrollport (capped, overflow-y auto, scrolls its own content)',
          sa and sa['overflowY'] == 'auto' and sa['scroll'] and sa['scrolled']
          and sa['maxH'] == '224px' and sa['contain'] == 'contain', sa)

    # ------------------------------------------------ 320px -------------
    tiny = browser.new_page(viewport={'width': 320, 'height': 667})
    tiny.goto(URL, wait_until='networkidle')
    tiny.wait_for_function("() => document.documentElement.classList.contains('cm-js')")
    tiny.add_style_tag(content='html { scroll-behavior: auto !important; }')
    tiny.click('#dp-input')
    tiny.wait_for_timeout(200)
    t = tiny.evaluate("""() => {
        const pan = document.getElementById('dp-panel').getBoundingClientRect();
        return {left: Math.round(pan.left), right: Math.round(pan.right), vw: innerWidth};
    }""")
    check('the panel stays inside a 320px viewport', 8 <= t['left'] and t['right'] <= t['vw'] - 8, t)
    tiny.keyboard.press('Escape')
    t2 = tiny.evaluate("""() => {
        const box = document.querySelector('.cm-scrollarea');
        box.scrollTop = 40;
        return {scrolled: box.scrollTop >= 39};
    }""")
    check('and the scrollarea scrolls at 320px too', t2['scrolled'], t2)

    check('no page JS errors', not errors, errors[:3])
    browser.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
for n in failed:
    print('FAIL ' + n)
sys.exit(1 if failed else 0)
