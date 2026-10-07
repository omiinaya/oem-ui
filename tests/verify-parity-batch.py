#!/root/.venvs/mau/bin/python
"""Parity batch, measured in WebKit: kbd, pager, avatar, accordion, ratio.

Each claim is an effect a reader sees, not a declaration:
 - the pager never scrolls the page sideways at 320, and every link clears
   the 44px floor on a coarse pointer
 - the accordion is exclusive through the platform alone (name=)
 - an avatar stays square and a group overlaps without changing a tile
 - a ratio box holds its shape with no content in it
 - none of it paints a rounded corner
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'
fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


with sync_playwright() as p:
    b = p.webkit.launch()
    for W in (320, 402, 1280):
        ctx = b.new_context(viewport={'width': W, 'height': 874}, has_touch=(W < 800))
        pg = ctx.new_page()
        pg.goto(URL, wait_until='load')
        pg.wait_for_timeout(300)
        sec = '#keys-pages-people'
        pg.locator(sec).scroll_into_view_if_needed()
        r = pg.evaluate("""(sec) => {
          const s = document.querySelector(sec);
          const q = (x) => [...s.querySelectorAll(x)];
          const rect = (e) => e.getBoundingClientRect();
          const links = q('.cm-pager__link');
          const av = q('.cm-avatar');
          const rad = (e) => {const c=getComputedStyle(e); return [c.borderTopLeftRadius,c.borderTopRightRadius,c.borderBottomLeftRadius,c.borderBottomRightRadius].join('|')};
          const ratios = q('.cm-ratio');
          const det = q('details[name="faq"]');
          return {
            sideways: document.documentElement.scrollWidth > innerWidth,
            linkMin: Math.min(...links.map(l => rect(l).height)),
            linkMax: Math.max(...links.map(l => rect(l).right)),
            pagerRight: rect(s.querySelector('.cm-pager')).right,
            vw: innerWidth,
            avSquare: av.every(a => Math.abs(rect(a).width - rect(a).height) < 0.6),
            avSizes: av.map(a => Math.round(rect(a).width)),
            ratios: ratios.map(e => [rect(e).width, rect(e).height]),
            radii: [...q('.cm-kbd'), ...links, ...av, ...ratios, ...q('.cm-disclosure')].map(rad),
            open0: det.map(d => d.open),
          };
        }""", sec)
        print(f'--- {W}px')
        check(not r['sideways'], 'page does not scroll sideways')
        check(r['linkMax'] <= r['vw'] + 0.5, f"pager stays inside the viewport (right={r['linkMax']:.0f}, vw={r['vw']})")
        if W < 800:
            check(r['linkMin'] >= 43.9, f"pager links clear the tap floor on touch ({r['linkMin']:.1f}px)")
        check(r['avSquare'], f"avatars are square {r['avSizes']}")
        w, h = r['ratios'][0]
        check(abs(w / h - 16 / 9) < 0.02, f'16:9 box holds its shape with no content ({w:.0f}x{h:.0f})')
        w, h = r['ratios'][1]
        check(abs(w - h) < 0.6, f'square box is square ({w:.0f}x{h:.0f})')
        check(all(x == '0px|0px|0px|0px' for x in r['radii']), 'no rounded corners in this section')
        check(r['open0'] == [True, False, False], f"accordion starts with only the first open {r['open0']}")
        # exclusivity, through the platform
        pg.locator('details[name="faq"] > summary').nth(1).click()
        pg.wait_for_timeout(100)
        open1 = pg.evaluate("[...document.querySelectorAll('details[name=faq]')].map(d=>d.open)")
        check(open1 == [False, True, False], f'opening one closes the others, no script {open1}')
        ctx.close()
    b.close()

print()
if fails:
    print(f'FAILED {len(fails)}')
    sys.exit(1)
print('PASS')
