#!/root/.venvs/mau/bin/python
"""Verify the button/sheet parity variants in the live WebKit cascade.
A real showModal() is mandatory: the static gallery specimen has no top layer.
"""
from playwright.sync_api import sync_playwright
import sys

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4460/'
failures = []

def check(ok, message):
    print(('  ok   ' if ok else '  FAIL ') + message)
    if not ok:
        failures.append(message)

with sync_playwright() as p:
    browser = p.webkit.launch()
    for width in (320, 402, 1280):
        context = browser.new_context(viewport={'width': width, 'height': 874}, has_touch=width < 800)
        page = context.new_page()
        page.goto(URL, wait_until='load')
        page.locator('#buttons').scroll_into_view_if_needed()
        button = page.locator('#buttons .cm-btn--danger')
        group = page.locator('#buttons .cm-btn-group--joined > .cm-btn')
        state = page.evaluate('''() => {
          const b = document.querySelector('#buttons .cm-btn--danger');
          const g = [...document.querySelectorAll('#buttons .cm-btn-group--joined > .cm-btn')];
          const rect = e => e.getBoundingClientRect();
          return {
            buttonHeight: rect(b).height,
            buttonRadius: getComputedStyle(b).borderTopLeftRadius,
            marker: getComputedStyle(b, '::before').content,
            shadow: getComputedStyle(b).boxShadow,
            groupGap: getComputedStyle(g[0].parentNode).gap,
            seams: g.slice(1).map((e,i) => ({
              width: parseFloat(getComputedStyle(e).borderLeftWidth),
              delta: rect(e).left - rect(g[i]).right
            })),
            scrollWidth: document.documentElement.scrollWidth
          }
        }''')
        print(f'--- {width}px')
        check(state['marker'].lower() not in ('none', 'normal', '""'), 'danger has a visible cross marker')
        check(state['shadow'] != 'none', 'danger has a reinforced border')
        check(state['buttonRadius'] == '0px', 'danger has sharp corners')
        if width < 800:
            check(state['buttonHeight'] >= 43.9, f'danger clears touch floor ({state["buttonHeight"]:.1f}px)')
        check(state['groupGap'] == '0px', 'joined group has no gap')
        check(all(x['width'] == 0 and abs(x['delta']) < 0.6 for x in state['seams']),
              f'joined seams have one rule with no visual gap {state["seams"]}')
        check(state['scrollWidth'] <= width, 'button group does not scroll page sideways')

        for side in ('right', 'left', 'top', 'bottom'):
            page.evaluate('''side => {
              const d = document.createElement('dialog');
              d.className = 'cm-dialog cm-dialog--sheet' + (side === 'right' ? '' : ' cm-dialog--sheet-' + side);
              d.innerHTML = '<div class="cm-dialog__head"><span class="cm-dialog__title">Panel</span></div>' +
                '<div class="cm-dialog__body">Sheet content</div>';
              d.id = 'sheet-probe';
              document.body.appendChild(d);
              d.showModal();
            }''', side)
            r = page.evaluate('''() => {
              const d = document.querySelector('#sheet-probe');
              const r = d.getBoundingClientRect(), s = getComputedStyle(d);
              return {x:r.x, y:r.y, right:r.right, bottom:r.bottom,
                width:r.width, height:r.height, vw:innerWidth, vh:innerHeight,
                open:d.open, border:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],
                radius:s.borderTopLeftRadius, modal:d.matches(':modal')};
            }''')
            check(r['open'] and r['modal'], f'{side} sheet is a native modal (:modal, top layer)')
            if side == 'left':
                check(abs(r['x']) < 1 and abs(r['height'] - r['vh']) < 2, f'left sheet hugs left edge ({r})')
            if side == 'right':
                check(abs(r['right'] - width) < 1 and abs(r['height'] - r['vh']) < 2, f'right sheet hugs right edge ({r})')
            if side == 'top':
                check(abs(r['y']) < 1 and abs(r['width'] - width) < 2 and r['height'] < r['vh'], f'top sheet hugs top edge ({r})')
            if side == 'bottom':
                check(abs(r['bottom'] - r['vh']) < 1 and abs(r['width'] - width) < 2 and r['height'] < r['vh'], f'bottom sheet hugs bottom edge ({r})')
            check(r['radius'] == '0px', f'{side} sheet has sharp corners')
            page.evaluate("document.querySelector('#sheet-probe').remove()")
        context.close()
    browser.close()

print(f'{len(failures)} failures')
sys.exit(1 if failures else 0)
