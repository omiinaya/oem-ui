#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 11: the calendar (single + range)."""
import sys
from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4461/'
results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok), detail))
    print(('ok   ' if ok else 'FAIL ') + name +
          ((' :: ' + repr(detail)) if detail is not None else ''))


def attrs(page, sel, names):
    return page.evaluate(
        """([sel, names]) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const out = {};
            for (const n of names) out[n] = el.getAttribute(n);
            return out;
        }""", [sel, names])


def grid_state(page, sel):
    return page.evaluate(
        """(sel) => {
            const c = document.querySelector(sel);
            const rows = [...c.querySelectorAll('tbody tr')];
            const days = [...c.querySelectorAll('.cm-cal__day')];
            return {
                month: c.getAttribute('data-cm-cal-month'),
                title: c.querySelector('[data-cm-cal-title]').textContent,
                label: c.querySelector('.cm-cal__grid').getAttribute('aria-label'),
                heads: c.querySelectorAll('thead th').length,
                rows: rows.length,
                perRow: rows.map(r => r.children.length),
                first: days[0] && days[0].dataset.cmDay,
                last: days[days.length - 1] && days[days.length - 1].dataset.cmDay,
                selected: [...days].filter(d => d.getAttribute('aria-selected') === 'true')
                                    .map(d => d.dataset.cmDay),
                inRange: [...days].filter(d => d.hasAttribute('data-in-range'))
                                   .map(d => d.dataset.cmDay),
                today: [...days].filter(d => d.hasAttribute('aria-current'))
                                .map(d => d.dataset.cmDay),
                roving: days.filter(d => d.tabIndex === 0).map(d => d.dataset.cmDay),
                focused: document.activeElement && document.activeElement.dataset
                    ? document.activeElement.dataset.cmDay : null,
                preview: [...days].filter(d => d.hasAttribute('data-preview'))
                                  .map(d => d.dataset.cmDay),
                pageScrollW: document.documentElement.scrollWidth
            };
        }""", sel)


def press(page, key):
    page.keyboard.press(key)
    page.wait_for_timeout(80)


def kill_smooth(page):
    # `html { scroll-behavior: smooth }` (base.css) makes every
    # scroll-into-view ANIMATE, so Playwright can measure a day, have the
    # page still be scrolling when the click lands, and press the cell
    # that moved away - measured: a click on 2026-10-20 that changed
    # nothing while the next one worked. Scrolling is not what is under
    # test, so the animation is off for the run; the scroll still happens.
    page.add_style_tag(content='html { scroll-behavior: auto !important; }')


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='load')
    kill_smooth(page)
    page.wait_for_timeout(400)

    # --- structure -------------------------------------------------
    st = grid_state(page, '#cal-single')
    check('a month renders five whole weeks of seven cells',
          st['heads'] == 7 and st['rows'] == 5 and
          all(n == 7 for n in st['perRow']) and len(st['perRow']) * 7 == 35,
          {'heads': st['heads'], 'rows': st['rows'], 'perRow': st['perRow']})
    check('the grid spans whole weeks either side of the month',
          st['first'] == '2026-09-27' and st['last'] == '2026-10-31',
          {'first': st['first'], 'last': st['last']})

    metrics = page.evaluate("""() => {
        const rows = [...document.querySelectorAll('#cal-single tbody tr')];
        const cellsOf = r => [...r.children].map(td => {
            const b = td.getBoundingClientRect();
            const btn = td.firstElementChild.getBoundingClientRect();
            return [Math.round(b.left * 10) / 10, Math.round(b.width * 10) / 10,
                    Math.round(btn.width * 10) / 10, Math.round(btn.height * 10) / 10];
        });
        const first = cellsOf(rows[0]);
        const uniform = rows.every(r => JSON.stringify(cellsOf(r)) === JSON.stringify(first));
        const pitch = first.slice(1).map((c, i) => Math.round((c[0] - first[i][0]) * 10) / 10);
        const cs = getComputedStyle(document.querySelector('#cal-single .cm-cal__day'));
        return {
            uniform, pitch, cellW: first[0][1], dayW: first[0][2], dayH: first[0][3],
            radius: cs.borderRadius,
            nav: getComputedStyle(document.querySelector('.cm-cal__nav')).width
        };
    }""")
    # every row the same column positions, every pitch the same number, the
    # day itself exactly --tap: a table that stretches to fill hands the
    # remainder to the columns, and the day drifts inside its cell
    check('every row shares one column pattern and the day fills a --tap cell',
          metrics['uniform'] and len(set(metrics['pitch'])) == 1 and
          metrics['pitch'][0] == metrics['cellW'] and
          metrics['dayW'] == 44 and metrics['dayH'] == 44 and
          metrics['radius'] == '0px' and metrics['nav'] == '44px', metrics)

    check('today, the selection and the roving stop sit where the markup said',
          st['today'] == ['2026-10-08'] and st['selected'] == ['2026-10-15'] and
          st['roving'] == ['2026-10-15'],
          {'today': st['today'], 'selected': st['selected'], 'roving': st['roving']})

    paint = page.evaluate("""() => {
        const c = document.querySelector('#cal-single');
        const sel = c.querySelector('.cm-cal__day[aria-selected="true"]');
        const today = c.querySelector('.cm-cal__day[aria-current="date"]');
        const out = c.querySelector('.cm-cal__day[data-outside]');
        const plain = c.querySelector('.cm-cal__day:not([data-outside])');
        // resolve the TOKENS the same way, so the claim survives a retheme
        const probe = (v) => {
            const s = document.createElement('span');
            s.style.color = v;
            document.body.appendChild(s);
            const col = getComputedStyle(s).color;
            s.remove();
            return col;
        };
        return {
            selBg: sel && getComputedStyle(sel).backgroundColor,
            selInk: sel && getComputedStyle(sel).color,
            todayRing: today && getComputedStyle(today).borderTopColor,
            outsideInk: out && getComputedStyle(out).color,
            plainInk: plain && getComputedStyle(plain).color,
            faint: probe('var(--ink-faint)'),
            dim: probe('var(--ink-dim)')
        };
    }""")
    check('selection is inversion, today wears a ring, outside days read faint',
          paint['selBg'] == 'rgb(232, 232, 232)' and
          paint['selInk'] != paint['plainInk'] and
          paint['todayRing'] not in ('rgba(0, 0, 0, 0)', 'transparent') and
          paint['outsideInk'] == paint['faint'] and
          paint['plainInk'] == paint['dim'], paint)

    # the table names its own width, so a card drawn WIDER than the grid
    # must not stretch the columns: `width: auto` would fill it
    forced = page.evaluate("""() => {
        const c = document.querySelector('#cal-single');
        const saved = c.style.width;
        c.style.width = '420px';
        const xs = [...c.querySelector('tbody tr').children]
            .map(td => td.getBoundingClientRect().left);
        const uniq = [...new Set(xs.slice(1).map((x, i) => Math.round((x - xs[i]) * 10) / 10))];
        c.style.width = saved;
        return {uniq};
    }""")
    check('the grid keeps its --tap pitch when the card is drawn wider',
          forced['uniq'] == [44], forced)

    # --- single selection -----------------------------------------
    page.click('#cal-single .cm-cal__day[data-cm-day="2026-10-20"]')
    page.wait_for_timeout(120)
    st = grid_state(page, '#cal-single')
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    check('clicking a day selects it, reports it and takes the tab stop',
          a and a['data-cm-cal-selected'] == '2026-10-20' and
          st['selected'] == ['2026-10-20'] and st['roving'] == ['2026-10-20'],
          {'attr': a, 'selected': st['selected'], 'roving': st['roving']})

    page.click('#cal-single .cm-cal__day[data-cm-day="2026-10-20"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    st = grid_state(page, '#cal-single')
    check('clicking the selected day unselects it again',
          (a and a['data-cm-cal-selected'] is None) and not st['selected'],
          {'attr': a, 'selected': st['selected']})

    page.click('#cal-single .cm-cal__day[data-cm-day="2026-10-15"]')
    page.wait_for_timeout(80)
    # aria-disabled is deliberately NOT the disabled property: the reader
    # must be able to REACH the date. Playwright refuses such a target as
    # "not enabled" (and force-clicking it lands outside the viewport), so
    # the click is dispatched on the element itself - same event path,
    # same bubbling to the container; the runtime must decline it.
    page.eval_on_selector('#cal-single .cm-cal__day[data-cm-day="2026-10-22"]',
                          'el => el.click()')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    check('a disabled date refuses the pick without losing the old one',
          a and a['data-cm-cal-selected'] == '2026-10-15', a)

    # --- month navigation -----------------------------------------
    page.click('#cal-single [data-cm-cal-next]')
    page.wait_for_timeout(120)
    st = grid_state(page, '#cal-single')
    check('the next arrow turns the month and keeps every row whole',
          st['month'] == '2026-11' and st['title'] == 'november 2026' and
          st['label'] == 'november 2026' and st['first'] == '2026-11-01' and
          st['last'] == '2026-12-05' and all(n == 7 for n in st['perRow']),
          {'month': st['month'], 'title': st['title'], 'first': st['first'],
           'last': st['last']})
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    check('the selection survives the month it is not in',
          a and a['data-cm-cal-selected'] == '2026-10-15', a)

    page.click('#cal-single [data-cm-cal-prev]')
    page.wait_for_timeout(120)
    st = grid_state(page, '#cal-single')
    check('the previous arrow returns to the original month',
          st['month'] == '2026-10' and st['first'] == '2026-09-27', st)

    # --- keyboard walking -----------------------------------------
    page.eval_on_selector('#cal-single .cm-cal__day[data-cm-day="2026-10-15"]',
                          'el => el.focus()')
    press(page, 'ArrowRight')
    st = grid_state(page, '#cal-single')
    check('ArrowRight walks one day forward',
          st['focused'] == '2026-10-16' and st['roving'] == ['2026-10-16'],
          {'focused': st['focused'], 'roving': st['roving']})
    press(page, 'ArrowDown')
    st = grid_state(page, '#cal-single')
    check('ArrowDown walks one week down', st['focused'] == '2026-10-23',
          st['focused'])
    press(page, 'ArrowUp')
    press(page, 'ArrowLeft')
    st = grid_state(page, '#cal-single')
    check('the pair of them walks back to where it started',
          st['focused'] == '2026-10-15', st['focused'])

    press(page, 'Home')
    st = grid_state(page, '#cal-single')
    check('Home jumps to the Sunday of that week', st['focused'] == '2026-10-11',
          st['focused'])
    press(page, 'End')
    st = grid_state(page, '#cal-single')
    check('End jumps to the Saturday of that week', st['focused'] == '2026-10-17',
          st['focused'])

    press(page, 'PageDown')
    st = grid_state(page, '#cal-single')
    check('PageDown moves a month under the same date',
          st['month'] == '2026-11' and st['focused'] == '2026-11-17',
          {'month': st['month'], 'focused': st['focused']})
    press(page, 'PageUp')
    st = grid_state(page, '#cal-single')
    check('PageUp comes back a month', st['month'] == '2026-10' and
          st['focused'] == '2026-10-17', {'month': st['month'],
                                          'focused': st['focused']})

    # Enter is the platform's: the native button click does the picking
    press(page, 'Enter')
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    check('Enter picks the day through the platform click, not our code',
          a and a['data-cm-cal-selected'] == '2026-10-17', a)
    st = grid_state(page, '#cal-single')
    check('the pick that rebuilt the grid kept the focus on the day',
          st['focused'] == '2026-10-17' and st['roving'] == ['2026-10-17'],
          {'focused': st['focused'], 'roving': st['roving']})

    press(page, 'Escape')
    a = attrs(page, '#cal-single', ['data-cm-cal-selected'])
    st = grid_state(page, '#cal-single')
    check('Escape clears the selection and stays on the day',
          (a and a['data-cm-cal-selected'] is None) and
          st['focused'] == '2026-10-17', {'attr': a, 'focused': st['focused']})

    # --- range ------------------------------------------------------
    r0 = grid_state(page, '#cal-range')
    check('a declared range fills its middle and marks its two ends',
          r0['selected'] == ['2026-10-12', '2026-10-16'] and
          r0['inRange'] == ['2026-10-13', '2026-10-14', '2026-10-15'],
          {'selected': r0['selected'], 'inRange': r0['inRange']})

    # the state machine, in order: a COMPLETE range is finished business
    # (the next pick starts a new one), an OPEN start takes the next pick
    # as its end, and a pick BEFORE that open start re-anchors - the three
    # transitions DayPicker makes.
    page.click('#cal-range .cm-cal__day[data-cm-day="2026-10-20"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    check('a pick on a complete range starts a new one instead of editing it',
          a['data-cm-cal-start'] == '2026-10-20' and a['data-cm-cal-end'] is None, a)

    page.click('#cal-range .cm-cal__day[data-cm-day="2026-10-25"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    r1 = grid_state(page, '#cal-range')
    check('the next click stretches the end, not the start',
          a['data-cm-cal-start'] == '2026-10-20' and
          a['data-cm-cal-end'] == '2026-10-25' and r1['inRange'] == [
              '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
          {'attrs': a, 'inRange': r1['inRange']})

    page.click('#cal-range .cm-cal__day[data-cm-day="2026-10-10"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    check('the pick after THAT complete range opens a start again',
          a['data-cm-cal-start'] == '2026-10-10' and a['data-cm-cal-end'] is None, a)

    page.click('#cal-range .cm-cal__day[data-cm-day="2026-10-03"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    r2 = grid_state(page, '#cal-range')
    check('a click before the start re-anchors instead of going backwards',
          a['data-cm-cal-start'] == '2026-10-03' and
          a['data-cm-cal-end'] == '2026-10-10' and r2['inRange'] == [
              '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
              '2026-10-08', '2026-10-09'],
          {'attrs': a, 'inRange': r2['inRange']})

    # 03-10 is complete again, so this pick must NOT edit it
    page.click('#cal-range .cm-cal__day[data-cm-day="2026-10-22"]')
    page.wait_for_timeout(120)
    a = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    check('picking with an end already set starts a new range',
          a['data-cm-cal-start'] == '2026-10-22' and a['data-cm-cal-end'] is None, a)

    # start-only, then hover: the tentative range draws itself
    # park the pointer first: the click before this left it ON a day, and
    # a hover whose travel starts from another cell has two paths to test
    page.mouse.move(6, 6)
    page.wait_for_timeout(80)
    page.hover('#cal-range .cm-cal__day[data-cm-day="2026-10-25"]')
    page.wait_for_timeout(120)
    st = grid_state(page, '#cal-range')
    ha = attrs(page, '#cal-range', ['data-cm-cal-start', 'data-cm-cal-end'])
    check('hovering past an open start previews the days in between',
          st['preview'] == ['2026-10-23', '2026-10-24'],
          {'preview': st['preview'], 'attrs': ha})

    page.mouse.move(6, 6)
    page.wait_for_timeout(120)
    st = grid_state(page, '#cal-range')
    check('the preview dies when the pointer leaves', not st['preview'],
          st['preview'])

    # --- the phone --------------------------------------------------
    ph = browser.new_page(viewport={'width': 402, 'height': 667})
    perr = []
    ph.on('pageerror', lambda e: perr.append(str(e)))
    ph.goto(URL, wait_until='load')
    kill_smooth(ph)
    ph.wait_for_timeout(400)
    ph.eval_on_selector('#cal-single', 'el => el.scrollIntoView({block: "start"})')
    ph.wait_for_timeout(200)
    ph_state = ph.evaluate("""() => {
        const c = document.querySelector('#cal-single');
        const d = document.querySelector('#cal-single .cm-cal__day');
        return {
            docW: document.documentElement.scrollWidth,
            vw: window.innerWidth,
            cardScroll: c.scrollWidth > c.clientWidth,
            cardOx: getComputedStyle(c).overflowX,
            heads: c.querySelectorAll('thead th').length,
            day: getComputedStyle(d).width,
            navVisible: !!c.querySelector('[data-cm-cal-next]').getClientRects().length
        };
    }""")
    check('at 402px the grid scrolls INSIDE the card, never the page',
          ph_state['docW'] <= ph_state['vw'] and ph_state['cardScroll'] and
          # scrollWidth > clientWidth happens for an overflow:visible box
          # too - only a scroll CONTAINER actually contains it
          ph_state['cardOx'] == 'auto' and
          ph_state['heads'] == 7 and ph_state['day'] == '44px' and
          ph_state['navVisible'], ph_state)

    tiny = browser.new_page(viewport={'width': 320, 'height': 667})
    tiny.goto(URL, wait_until='load')
    kill_smooth(tiny)
    tiny.wait_for_timeout(400)
    # Settle the page's pre-existing phantom first (the overlays head-row
    # lays out +8px wide on a fresh load; one invalidation of that subtree
    # collapses it and never comes back) - then the width is a fact again.
    tiny.evaluate("""async () => {
        await document.fonts.ready;
        const hr = document.querySelector('#overlays .cm-head-row');
        if (hr) { hr.style.display = 'none'; void document.body.offsetHeight;
                  hr.style.display = ''; }
        void document.body.offsetHeight;
    }""")
    t = tiny.evaluate("() => ({docW: document.documentElement.scrollWidth, vw: window.innerWidth})")
    # the PAGE carried a pre-existing ~8px sideways scroll at 320 (an older
    # section, layout-fragile, unrelated to this batch - hiding almost any
    # section clears it). What this component owes is narrower and is
    # measured the only honest way: same load, calendars shown vs hidden.
    diff = tiny.evaluate("""() => {
        const base = document.documentElement.scrollWidth;
        const cals = [...document.querySelectorAll('.cm-cal')];
        const prev = cals.map(e => e.style.display);
        cals.forEach(e => e.style.display = 'none');
        const without = document.documentElement.scrollWidth;
        cals.forEach((e, i) => e.style.display = prev[i]);
        const card = document.querySelector('.cm-cal');
        return {base, without, cardClient: card.clientWidth,
                cardScroll: card.scrollWidth, vw: document.documentElement.clientWidth};
    }""")
    # At 360px and below the columns follow the box (the media rule), so
    # the honest claim is the strongest one: the page has NO sideways
    # scroll at all (the hovercard clamp phantom was found and fixed the
    # same batch), and the card - now able to hold its grid - does not
    # scroll either.
    check('at 320px the calendar fits: no page scroll, no card scroll',
          diff['base'] <= diff['vw'] and
          diff['base'] <= diff['without'] and
          diff['cardScroll'] <= diff['cardClient'], diff)

    hc = tiny.evaluate("""() => {
        const p = document.querySelector('.cm-hovercard__panel');
        const r = p.getBoundingClientRect();
        return {left: Math.round(r.left), right: Math.round(r.right),
                inlineLeft: p.style.left,
                vw: window.innerWidth};
    }""")
    # the tiny-viewport width cap contains the panel on its own now, so
    # the clamp must be observed by its FINGERPRINT: it rewrites style.left
    check('the hover card is clamped inside the viewport at 320px',
          hc['right'] <= hc['vw'] - 8 and hc['left'] >= 8 and
          hc['inlineLeft'] != '', hc)

    check('no page JS errors', not errors and not perr,
          {'desktop': errors, 'phone': perr})

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
