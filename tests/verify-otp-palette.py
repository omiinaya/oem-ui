#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 6: the OTP group and the command palette."""
import sys
from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4461/'
results = []


def check(name, cond, detail=''):
    ok = bool(cond)
    results.append((name, ok, detail if not ok else ''))
    print(('  ok  ' if ok else 'FAIL  ') + name + ('' if ok else ' :: ' + str(detail)[:120]))


with sync_playwright() as p:
    browser = p.webkit.launch()
    page = browser.new_page(viewport={'width': 402, 'height': 667})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => window.cliMono && document.querySelector('.cm-otp__cell')")

    # ---------------- OTP ----------------
    cells = page.locator('.cm-otp__cell')
    n = cells.count()
    check('six OTP cells render', n == 6, 'got %d' % n)

    geo = page.evaluate("""() => {
      const g = document.querySelector('.cm-otp');
      const c = g.querySelectorAll('.cm-otp__cell');
      const s = getComputedStyle(c[0]);
      return { cells: c.length, w: c[0].getBoundingClientRect().width,
               grp: g.getBoundingClientRect().width,
               radius: s.borderRadius, display: s.display,
               align: getComputedStyle(g).alignItems };
    }""")
    check('a cell is a fixed box, not a full-width field',
          0 < geo['w'] < geo['grp'] / 2, geo)
    check('the OTP is sharp', geo['radius'] in ('0px', ''), geo)

    # type a digit: value lands and focus advances
    page.click('#f-otp-0')
    page.keyboard.type('4')
    st = page.evaluate("""() => {
      const c = [...document.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement) };
    }""")
    check('a typed digit lands in cell 1 and advances to cell 2',
          st['v'] == '4' and st['focus'] == 1, st)

    page.keyboard.type('8')
    st = page.evaluate("""() => {
      const c = [...document.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement) };
    }""")
    check('the second digit lands in cell 2 and advances again',
          st['v'] == '48' and st['focus'] == 2, st)

    # Two digits are in, and focus is on the third (empty) cell - so the
    # keyboard has to walk back onto a FILLED cell before backspace can
    # be tested in both of its modes. ArrowLeft is the walk, and it is
    # itself under test: no move would leave focus on cell 3.
    page.keyboard.press('ArrowLeft')
    st = page.evaluate("""() => {
      const c = [...document.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement) };
    }""")
    check('arrow-left walks back onto the filled cell',
          st['v'] == '48' and st['focus'] == 1, st)

    # backspace on a FILLED cell clears it and stays put
    page.keyboard.press('Backspace')
    st = page.evaluate("""() => {
      const c = [...document.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement) };
    }""")
    check('backspace on a filled cell clears it and stays',
          st['v'] == '4' and st['focus'] == 1, st)

    # backspace on an EMPTY cell retreats and clears the one before it
    page.keyboard.press('Backspace')
    st = page.evaluate("""() => {
      const c = [...document.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement) };
    }""")
    check('backspace on an empty cell retreats and clears the previous one',
          st['v'] == '' and st['focus'] == 0, st)

    # paste fills every cell at once
    st = page.evaluate("""() => {
      const g = document.querySelector('.cm-otp');
      const dt = { _t: '', getData() { return this._t; }, setData(k, v) { this._t = v; } };
      dt._t = '481902';
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      ev.clipboardData = dt;
      g.dispatchEvent(ev);
      const c = [...g.querySelectorAll('.cm-otp__cell')];
      return { v: c.map(x => x.value).join(''),
               focus: c.indexOf(document.activeElement),
               prevented: ev.defaultPrevented };
    }""")
    check('a pasted code fills all six cells',
          st['v'] == '481902' and st['prevented'], st)
    check('after a paste the caret sits in the last filled cell',
          st['focus'] == 5, st)

    # ---------------- command palette ----------------
    page.click('button[data-cm-open="cmd-demo"]')
    open1 = page.evaluate("() => document.getElementById('cmd-demo').open")
    check('the palette opens as a modal dialog', open1 is True, open1)

    modal = page.evaluate("() => document.getElementById('cmd-demo').matches(':modal')")
    check('and it is really :modal (top layer, trapped focus)', modal is True, modal)

    r = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      const s = getComputedStyle(d);
      return { radius: s.borderRadius, scrollable: d.scrollHeight > d.clientHeight,
               inputW: d.querySelector('.cm-command__input').getBoundingClientRect().width };
    }""")
    check('the palette frame is sharp', r['radius'] in ('0px', ''), r)
    check('the frame itself is not the scrollport',
          r['inputW'] > 0 and r['scrollable'] is False, r)

    # Who scrolls matters: with the frame on overflow:auto and the list
    # unbounded, the palette's own header scrolls away mid-query.
    r = page.evaluate("""() => {
      const l = document.querySelector('#cmd-demo .cm-command__list');
      const s = getComputedStyle(l);
      return { overflow: s.overflow, max: s.maxHeight };
    }""")
    check('the list is the scrollport (max-height + overflow, not the frame)',
          r['overflow'] in ('auto', 'scroll') and r['max'] != 'none', r)

    # a query that matches rows in only one group
    page.fill('.cm-command__input', 'inst')
    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      const items = [...d.querySelectorAll('.cm-command__item')];
      const shown = items.filter(i => getComputedStyle(i).display !== 'none');
      const groups = [...d.querySelectorAll('.cm-command__group')];
      const empty = d.querySelector('.cm-command__empty');
      return {
        shown: shown.map(i => i.id),
        hiddenText: items.filter(i => getComputedStyle(i).display !== 'none' && i.hidden)
                         .map(i => i.id),
        shownNotHidden: shown.filter(i => i.hidden).map(i => i.id),
        groups: groups.map(g => [g.getAttribute('aria-label'), g.hidden]),
        empty: empty.hidden,
      };
    }""")
    check('the query narrows the list to the matching row',
          st['shown'] == ['cmd-copy'], st)
    check('a hidden row keeps no box at all (the display:flex trap)',
          not st['hiddenText'] and not st['shownNotHidden'], st)
    check('the group with no matches is hidden, the other stays',
          st['groups'] == [['go to', True], ['actions', False]], st)
    check('the empty state stays hidden while there are matches',
          st['empty'] is True, st)

    # a query that matches nothing
    page.fill('.cm-command__input', 'zzzz')
    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      const empty = d.querySelector('.cm-command__empty');
      return { shown: [...d.querySelectorAll('.cm-command__item')]
                        .filter(i => getComputedStyle(i).display !== 'none').length,
               emptyHidden: empty.hidden,
               emptyDisplay: getComputedStyle(empty).display,
               groupsHidden: [...d.querySelectorAll('.cm-command__group')].every(g => g.hidden),
               active: d.querySelector('.cm-command__item.is-active') };
    }""")
    check('a dead query empties the list and reveals the empty state',
          st['shown'] == 0 and st['emptyHidden'] is False and
          st['emptyDisplay'] != 'none' and st['groupsHidden'], st)
    check('with nothing to run, no row is active', st['active'] is None, st)

    # back to full list, walk down
    page.fill('.cm-command__input', '')
    st = page.evaluate("""() => [...document.querySelectorAll('.cm-command__item')]
        .filter(i => getComputedStyle(i).display !== 'none').length""")
    check('clearing the query restores every row', st == 5, st)

    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      const vis = [...d.querySelectorAll('.cm-command__item')]
        .filter(i => getComputedStyle(i).display !== 'none');
      return { first: vis.findIndex(i => i.classList.contains('is-active')),
               activedesc: d.querySelector('.cm-command__input').getAttribute('aria-activedescendant') };
    }""")
    check('the list opens with the first row active',
          st['first'] == 0 and st['activedesc'] == 'cmd-dash', st)

    page.keyboard.press('ArrowDown')
    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      const vis = [...d.querySelectorAll('.cm-command__item')]
        .filter(i => getComputedStyle(i).display !== 'none');
      const act = vis.findIndex(i => i.classList.contains('is-active'));
      return { act,
               id: vis[act] && vis[act].id,
               activedesc: d.querySelector('.cm-command__input').getAttribute('aria-activedescendant'),
               selected: vis.filter(i => i.getAttribute('aria-selected') === 'true').map(i => i.id) };
    }""")
    check('arrow down moves the active row and mirrors it to aria',
          st['act'] == 1 and st['id'] == 'cmd-theme' and
          st['activedesc'] == 'cmd-theme' and st['selected'] == ['cmd-theme'], st)

    # Enter runs the highlighted row and dismisses the palette
    page.keyboard.press('Enter')
    st = page.evaluate("() => document.getElementById('cmd-demo').open")
    check('Enter runs the active row and closes the palette', st is False, st)

    # reopening starts clean
    page.click('button[data-cm-open="cmd-demo"]')
    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      return { q: d.querySelector('.cm-command__input').value,
               shown: [...d.querySelectorAll('.cm-command__item')]
                        .filter(i => getComputedStyle(i).display !== 'none').length };
    }""")
    check('reopening starts from an empty query',
          st['q'] == '' and st['shown'] == 5, st)

    # selecting by click also dismisses
    page.click('.cm-command__item#cmd-dash')
    st = page.evaluate("() => document.getElementById('cmd-demo').open")
    check('clicking a row runs it and closes the palette', st is False, st)

    # Escape is the platform's half and still works
    page.click('button[data-cm-open="cmd-demo"]')
    page.keyboard.press('Escape')
    st = page.evaluate("() => document.getElementById('cmd-demo').open")
    check('Escape still closes it (platform behaviour kept)', st is False, st)

    # and the query must not survive the reopen: a palette that comes
    # back pre-filtered to yesterday's half-typed word opens looking
    # broken, with rows missing and no obvious way to get them back.
    page.click('button[data-cm-open="cmd-demo"]')
    page.fill('.cm-command__input', 'inst')
    page.keyboard.press('Escape')
    page.click('button[data-cm-open="cmd-demo"]')
    st = page.evaluate("""() => {
      const d = document.getElementById('cmd-demo');
      return { q: d.querySelector('.cm-command__input').value,
               shown: [...d.querySelectorAll('.cm-command__item')]
                        .filter(i => getComputedStyle(i).display !== 'none').length };
    }""")
    check('a query does not survive a reopen',
          st['q'] == '' and st['shown'] == 5, st)

    check('no sideways scroll at 402px',
          page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    check('no page JS errors', not errors, errors)

    browser.close()

failed = [r for r in results if not r[1]]
print('\n%d passed, %d failed' % (len(results) - len(failed), len(failed)))
for name, _, detail in failed:
    print('  FAIL %s :: %s' % (name, detail))
sys.exit(1 if failed else 0)
