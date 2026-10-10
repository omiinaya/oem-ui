#!/usr/bin/env python3
"""Pin the --header-h / scroll-padding contract that made text selection scroll.

Regression for: initHeader published the header's measured height inline as
`--header-h`, and a fixed RAIL measures the whole VIEWPORT (900px at
1280x900). `html { scroll-padding-top: calc(var(--header-h) + 1.5rem) }`
then resolved to ~924px, and because scroll-padding governs EVERY
browser-initiated scroll-into-view, dragging a text selection overshot by
~900px a pass and the page ran away upward (measured: -2945px over six
moves, selection inflated to 2,991 chars).

Two layouts must both hold:
  rail   (>=1000px, fixed, inline-start): covers no block-axis space, so
         padding must stay small and a selection drag must not scroll.
  bar    (<1000px, top): padding must reserve the REAL bar height so
         anchors land under the bar, not beneath it.

Usage: python tests/verify-header-offset.py [URL]
Exit: 0 all pass, 1 otherwise. Unpiped by design - never check its status
through `| tail`, which reports tail's exit code instead of this one.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4471/'

passed, failed = 0, 0


def check(label, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1
        print(f'ok   {label} :: {detail}')
    else:
        failed += 1
        print(f'FAIL {label} :: {detail}')


def find_text_target(pg, sel):
    return pg.evaluate("""(sel) => {
      for (const p of document.querySelectorAll(sel)) {
        const r = p.getBoundingClientRect();
        if (r.y > 80 && r.y < 700 && r.height > 20 && r.width > 300) {
          const x = r.x + 12, y = r.y + Math.min(10, r.height / 2);
          const cr = document.caretRangeFromPoint(x, y);
          if (cr && cr.startContainer.nodeType === 3) return {x, y, ok: true};
        }
      }
      return {ok: false};
    }""", sel)


def park(pg, sel):
    pg.evaluate("""(sel) => {
        const ps = [...document.querySelectorAll(sel)];
        const t = ps.find(p => p.textContent.trim().length > 40);
        if (t) window.scrollTo({top: t.getBoundingClientRect().top + window.scrollY - 300,
                               behavior: 'instant'});
    }""", sel)
    pg.wait_for_timeout(400)


def drag(pg, t):
    pg.mouse.move(t['x'], t['y']); pg.mouse.down()
    for i in range(1, 7):
        pg.mouse.move(t['x'] + i * 55, t['y']); pg.wait_for_timeout(40)
    pg.mouse.up(); pg.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.webkit.launch()

    # ---- the RAIL layout: selection must not scroll the page away ----
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.goto(URL, wait_until='domcontentloaded', timeout=120000)
    pg.wait_for_timeout(2500)

    is_rail = pg.evaluate("() => document.querySelector('[data-cm-header]').classList.contains('cm-header--rail')")
    check('the desktop showcase header is the fixed rail', is_rail)

    pad = pg.evaluate("() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)")
    check('the rail reserves almost no block-axis scroll padding',
          pad < 48, f'scroll-padding-top={pad}px')

    park(pg, '#charts p')
    t = find_text_target(pg, '#charts p')
    check('a draggable text paragraph is parked in view', t.get('ok'))
    if t.get('ok'):
        y0 = pg.evaluate("() => Math.round(window.scrollY)")
        drag(pg, t)
        delta = pg.evaluate("() => Math.round(window.scrollY)") - y0
        sel_len = pg.evaluate("() => String(window.getSelection()).length")
        check('dragging a selection no longer scrolls the page',
              abs(delta) <= 2, f'delta={delta}px (was -2945)')
        check('the selection stays the size of the drag, not the page',
              5 <= sel_len <= 300, f'selLen={sel_len} (was 2991)')
    pg.close()

    # ---- the BAR layout: padding must reserve the REAL bar height ----
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    pg.goto(URL, wait_until='domcontentloaded', timeout=120000)
    pg.wait_for_timeout(2500)

    hdr = pg.evaluate("() => { const r = document.querySelector('[data-cm-header]').getBoundingClientRect();"
                      " return {h: Math.round(r.height), bottom: Math.round(r.bottom)}; }")
    pad = pg.evaluate("() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)")
    check('the phone header is a bar the padding must clear',
          hdr['h'] > 0, f"bar height={hdr['h']}px")
    check('the phone padding reserves the real bar height',
          pad >= hdr['bottom'] - 1, f'padding={pad}px vs bar bottom={hdr["bottom"]}px')

    pg.evaluate("() => { location.hash = '#surface'; }")
    pg.wait_for_timeout(900)
    top = pg.evaluate("() => { const e = document.getElementById('surface');"
                      " return e ? Math.round(e.getBoundingClientRect().top) : null; }")
    check('an anchor jump lands the heading below the bar',
          top is not None and top >= hdr['bottom'] - 1, f'anchorTop={top} vs bar bottom={hdr["bottom"]}')
    pg.close()
    b.close()

print(f'\npassed {passed}/{passed + failed}')
sys.exit(1 if failed else 0)
