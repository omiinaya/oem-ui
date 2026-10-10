#!/root/.venvs/mau/bin/python
"""WebKit proof for the calendar's `multiple` mode (shadcn / rdp parity).

Run: /root/.venvs/mau/bin/python tests/verify-calendar-multiple.py [url]

The contract is a STATE invariant, not a string in a file: the selection
lives on `data-cm-cal-selected`, and the rendered grid must agree with it
after every step - including a month step away and back, which is what
separates an attribute-borne set from one stamped onto cells that
`calRender` rebuilds. Every check reads ARIA and geometry, never source.

A connection failure is a HARNESS error and prints as such; it is never a
product verdict.
"""
import sys
from playwright.sync_api import sync_playwright
from harness_wait import boot_timeout

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4471/'
SEL = '#cal-multiple'
results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok), detail))
    print(('ok   ' if ok else 'FAIL ') + name +
          ((' :: ' + repr(detail)) if detail is not None else ''))


STATE = """(sel) => {
  const c = document.querySelector(sel);
  if (!c) return null;
  const days = [...c.querySelectorAll('.cm-cal__day')];
  const shown = days.filter(d => !d.hasAttribute('data-outside'));
  return {
    mode: c.getAttribute('data-cm-cal-mode'),
    month: c.getAttribute('data-cm-cal-month'),
    attr: (c.getAttribute('data-cm-cal-selected') || ''),
    selected: days.filter(d => d.getAttribute('aria-selected') === 'true')
                   .map(d => d.dataset.cmDay).sort(),
    roving: days.filter(d => d.tabIndex === 0).map(d => d.dataset.cmDay),
    // "The state a reader hears is the state a reader sees": a day that
    // reads aria-selected must also be PAINTED as selected. Compared
    // against an unselected sibling in the same grid, so the check is a
    // difference rather than a hard-coded colour.
    inkMismatch: (() => {
      const on = days.find(d => d.getAttribute('aria-selected') === 'true');
      const off = days.find(d => d.getAttribute('aria-selected') !== 'true'
                               && !d.hasAttribute('data-outside'));
      if (!on || !off) return null;
      const a = getComputedStyle(on), b = getComputedStyle(off);
      return { onBg: a.backgroundColor, offBg: b.backgroundColor,
               onFg: a.color, offFg: b.color };
    })(),
    pageScrollW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    // The POLICY and the CONTAINMENT, not a raw width. A component
    // gallery scrolls sideways on purpose (176 specimens here: the
    // carousel's off-screen slides reach x=993), so `scrollW <= winW` is
    // an assertion about the fixture, not about the calendar - it fails
    // on the carousel and would pass on a calendar that pushed the page.
    // What a reader can feel is (a) the html clips x, so the page never
    // pans, and (b) the grid's own overflow is taken by its wrapper.
    htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
    gridWrap: (() => {
      const g = c.querySelector('.cm-cal__grid');
      if (!g) return null;
      const w = g.parentElement;
      return {right: Math.round(w.getBoundingClientRect().right),
              scrolls: w.scrollWidth > w.clientWidth + 1,
              contained: w.getBoundingClientRect().right <= window.innerWidth + 1};
    })(),
  };
}"""


def state(page, sel=SEL):
    return page.evaluate(STATE, sel)


def click_day(page, iso):
    page.evaluate("""(iso) => {
        const b = document.querySelector('#cal-multiple .cm-cal__day[data-cm-day="' + iso + '"]');
        b.scrollIntoView({block: 'center', behavior: 'instant'});
    }""", iso)
    page.wait_for_timeout(60)
    page.click('#cal-multiple .cm-cal__day[data-cm-day="%s"]' % iso)
    page.wait_for_timeout(120)


def main():
    errors = []
    with sync_playwright() as ph:
        b = ph.webkit.launch()
        page = b.new_page(viewport={'width': 390, 'height': 844},
                          device_scale_factor=2)
        page.on('pageerror', lambda e: errors.append(str(e)))
        try:
            page.goto(URL, wait_until='load', timeout=30000)
        except Exception as e:
            print('ERROR: server down / unreachable at %s :: %r' % (URL, e))
            b.close()
            return 2
        # `html { scroll-behavior: smooth }` animates every programmatic
        # scroll, so a click lands on a cell that has moved away.
        page.add_style_tag(content='html { scroll-behavior: auto !important; }')
        page.wait_for_function("() => !!window.cliMono", timeout=boot_timeout())
        page.wait_for_timeout(200)

        s = state(page)
        check('the multiple specimen is on the page and is the mode it says',
              s is not None and s['mode'] == 'multiple', s)

        # --- the declared state is two days, and the grid agrees ---------
        check('the shipped set is the two days the attribute names',
              s['attr'] == '2026-10-05 2026-10-27', s['attr'])
        check('exactly the two named days read as selected',
              s['selected'] == ['2026-10-05', '2026-10-27'], s['selected'])
        check('a set still has exactly ONE tab stop',
              len(s['roving']) == 1, s['roving'])
        check('the tab stop sits on the earliest picked day this month',
              s['roving'] == ['2026-10-05'], s['roving'])
        # The state a reader HEARS must be the state a reader SEES. A
        # day that reads aria-selected while painting like its neighbours
        # is exactly how a dead calendar and a live one look identical.
        im = s['inkMismatch']
        check('a selected day is painted, not merely announced',
              im is not None and im['onBg'] != im['offBg'] and
              im['onFg'] != im['offFg'], im)

        # --- a pick ADDS, and writes the set back to the attribute ------
        click_day(page, '2026-10-13')
        a = state(page)
        check('a pick adds its day to the set',
              a['selected'] == ['2026-10-05', '2026-10-13', '2026-10-27'],
              a['selected'])
        check('the attribute is rewritten with the whole set',
              a['attr'] == '2026-10-05 2026-10-13 2026-10-27', a['attr'])
        check('the tab stop followed the pick',
              a['roving'] == ['2026-10-13'], a['roving'])

        # --- a second press REMOVES it: it is a toggle, like single ----
        click_day(page, '2026-10-13')
        t = state(page)
        check('a second press on the same day removes it (a toggle)',
              t['selected'] == ['2026-10-05', '2026-10-27'], t['selected'])
        check('the attribute dropped it too',
              t['attr'] == '2026-10-05 2026-10-27', t['attr'])

        # --- THE INVARIANT: a month step away and back ----------------
        # This is the whole reason the set lives on the attribute. A
        # selection stamped onto day cells dies here, because calRender
        # replaces the cells and there is nothing to read the old ones.
        page.focus('#cal-multiple .cm-cal__day[tabindex="0"]')
        page.keyboard.press('PageDown')
        page.wait_for_timeout(150)
        nxt = state(page)
        check('PageDown moves the month off october',
              nxt['month'] == '2026-11', nxt['month'])
        check('no day in november reads as selected',
              nxt['selected'] == [], nxt['selected'])
        page.keyboard.press('PageUp')
        page.wait_for_timeout(150)
        back = state(page)
        check('stepping back to october RESTORES the whole set',
              back['selected'] == ['2026-10-05', '2026-10-27'], back['selected'])
        check('and the attribute still carries it',
              back['attr'] == '2026-10-05 2026-10-27', back['attr'])
        check('and the grid still has exactly one tab stop',
              len(back['roving']) == 1, back['roving'])

        # --- Escape clears the set, the verb the other modes answer ---
        page.focus('#cal-multiple .cm-cal__day[tabindex="0"]')
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        esc = state(page)
        check('Escape clears the whole set',
              esc['selected'] == [] and esc['attr'] == '', esc)
        check('and the grid keeps a tab stop rather than losing one',
              len(esc['roving']) >= 1, esc['roving'])

        # --- the other two modes are untouched by the third ------------
        one = state(page, '#cal-single')
        check('single still carries exactly its one day',
              one['selected'] == ['2026-10-15'], one['selected'])
        rng = state(page, '#cal-range')
        check('range still carries its two ends',
              rng['selected'] == ['2026-10-12', '2026-10-16'], rng['selected'])
        check('and range still paints the days between them',
              page.evaluate("""() => [...document.querySelectorAll('#cal-range .cm-cal__day')]
                  .filter(d => d.hasAttribute('data-in-range')).length""") == 3)

        # The page must never PAN sideways. The showcase's own document
        # is 466 wide at 390 because a component gallery scrolls on
        # purpose — that is the fixture, and `html { overflow-x: hidden }`
        # is the policy that keeps it off the page. Assert BOTH halves:
        # the policy holds, and the calendar's own grid contains itself.
        end = state(page)
        check('the html clips x, so the page never pans sideways',
              end['htmlOverflowX'] == 'hidden', end['htmlOverflowX'])
        check('the calendar grid stays inside the viewport',
              end['gridWrap'] is not None and end['gridWrap']['contained'],
              end['gridWrap'])
        check('no uncaught page errors', errors == [], errors[:2])

        b.close()

    bad = [r for r in results if not r[1]]
    print('\n%d/%d checks passed' % (len(results) - len(bad), len(results)))
    return 1 if bad else 0


sys.exit(main())
