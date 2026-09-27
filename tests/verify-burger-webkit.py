"""Verify the mobile nav disclosure in real WebKit at phone width.

Checks, in order of how badly they break the thing if wrong:
  1. burger is visible only when JS ran        (a dead button is worse than none)
  2. panel is closed and UNREACHABLE by keyboard when closed
  3. open/close, and aria-expanded tracks it
  4. tapping a link closes the panel
  5. Escape closes it and returns focus to the button
  6. rotating to desktop clears the open state
  7. header actually got shorter
"""
import os
import asyncio, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    'OEM_UI_URL', 'http://localhost:4321/')
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844},
                                  has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_timeout(700)

        hdr = await pg.evaluate("""() => {
            const px = n => Math.round(n*10)/10;
            const h = document.querySelector('.cm-header');
            const p = document.querySelector('.cm-header__links');
            const b = document.querySelector('[data-cm-nav-toggle]');
            return {
                h: px(h.getBoundingClientRect().height),
                burgerVisible: b.offsetParent !== null,
                panelDisplay: getComputedStyle(p).display,
                hasJs: document.documentElement.classList.contains('cm-js'),
                burgerH: px(b.getBoundingClientRect().height),
                burgerW: px(b.getBoundingClientRect().width),
                expanded: b.getAttribute('aria-expanded'),
                controls: b.getAttribute('aria-controls'),
                panelId: p.id,
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        }""")
        check('JS booted and set .cm-js', hdr['hasJs'], str(hdr['hasJs']))
        check('burger visible at 390px', hdr['burgerVisible'], str(hdr['burgerVisible']))
        check('panel closed by default', hdr['panelDisplay'] == 'none', hdr['panelDisplay'])
        check('aria-expanded=false when closed', hdr['expanded'] == 'false', str(hdr['expanded']))
        check('aria-controls points at the panel id',
              hdr['controls'] == hdr['panelId'], f"{hdr['controls']} -> {hdr['panelId']}")
        check('burger clears the 44px tap floor', hdr['burgerH'] >= 44 and hdr['burgerW'] >= 44,
              f"{hdr['burgerW']}x{hdr['burgerH']}")
        check('no horizontal overflow', hdr['overflow'] == 0, str(hdr['overflow']))
        closed_h = hdr['h']
        check('header fits one row (under 70px)', closed_h < 70, f"{closed_h}px")

        # Closed panel must not be reachable by keyboard.
        focusable = await pg.evaluate("""() => {
            const p = document.querySelector('.cm-header__links');
            return [...p.querySelectorAll('a')].filter(a => a.offsetParent !== null).length;
        }""")
        check('closed panel has zero focusable links', focusable == 0, str(focusable))

        await pg.click('[data-cm-nav-toggle]')
        await pg.wait_for_timeout(350)
        open_state = await pg.evaluate("""() => {
            const px = n => Math.round(n*10)/10;
            const p = document.querySelector('.cm-header__links');
            const b = document.querySelector('[data-cm-nav-toggle]');
            const vis = [...p.querySelectorAll('a')].filter(a => a.offsetParent !== null);
            return {
                display: getComputedStyle(p).display,
                expanded: b.getAttribute('aria-expanded'),
                visibleLinks: vis.length,
                rowH: vis.length ? px(vis[0].getBoundingClientRect().height) : 0,
                panelH: px(p.getBoundingClientRect().height),
                firstLabel: vis.length ? vis[0].textContent.trim() : '',
            };
        }""")
        check('panel opens on tap', open_state['display'] == 'flex', open_state['display'])
        check('aria-expanded=true when open', open_state['expanded'] == 'true', str(open_state['expanded']))
        check('all nav links visible when open', open_state['visibleLinks'] >= 12,
              str(open_state['visibleLinks']))
        check('every menu row clears 44px', open_state['rowH'] >= 44, f"{open_state['rowH']}px")

        # Tapping a link must close the panel.
        await pg.click('.cm-header__links a[href="#states"]')
        await pg.wait_for_timeout(400)
        after_tap = await pg.evaluate("""() => ({
            d: getComputedStyle(document.querySelector('.cm-header__links')).display,
            e: document.querySelector('[data-cm-nav-toggle]').getAttribute('aria-expanded'),
            scrolled: window.scrollY,
        })""")
        check('tapping a link closes the panel', after_tap['d'] == 'none', after_tap['d'])
        check('tapping a link scrolls to the section', after_tap['scrolled'] > 100,
              f"scrollY={after_tap['scrolled']:.0f}")

        # Escape.
        await pg.click('[data-cm-nav-toggle]')
        await pg.wait_for_timeout(250)
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(250)
        esc = await pg.evaluate("""() => ({
            d: getComputedStyle(document.querySelector('.cm-header__links')).display,
            focused: document.activeElement === document.querySelector('[data-cm-nav-toggle]'),
        })""")
        check('Escape closes the panel', esc['d'] == 'none', esc['d'])
        check('Escape returns focus to the burger', esc['focused'], str(esc['focused']))

        # Rotate to desktop with it open.
        await pg.click('[data-cm-nav-toggle]')
        await pg.wait_for_timeout(200)
        await pg.set_viewport_size({'width': 1280, 'height': 900})
        await pg.wait_for_timeout(500)
        rot = await pg.evaluate("""() => ({
            expanded: document.querySelector('[data-cm-nav-toggle]').getAttribute('aria-expanded'),
            burgerVisible: document.querySelector('[data-cm-nav-toggle]').offsetParent !== null,
            desktopLinks: getComputedStyle(document.querySelector('.cm-header__links')).display,
        })""")
        check('rotating to desktop clears open state', rot['expanded'] == 'false', str(rot['expanded']))
        check('burger hidden on desktop', not rot['burgerVisible'], str(rot['burgerVisible']))
        check('nav links return on desktop', rot['desktopLinks'] == 'flex', rot['desktopLinks'])

        # And the no-JS fallback really shows the links.
        ctx2 = await b.new_context(viewport={'width': 390, 'height': 844},
                                   has_touch=True, is_mobile=True, java_script_enabled=False)
        pg2 = await ctx2.new_page()
        await pg2.goto(URL, wait_until='load')
        vis = await pg2.locator('.cm-header__link').first.is_visible()
        count = await pg2.locator('.cm-header__link').count()
        check('no-JS: nav links are still on screen', vis and count >= 12, f"{count} links, first visible={vis}")
        burger_vis = await pg2.locator('[data-cm-nav-toggle]').is_visible()
        check('no-JS: no dead burger button', not burger_vis, str(burger_vis))
        await ctx2.close()

        await b.close()

    print(f"--- burger @390 WebKit ---")
    for n, ok, d in results:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}" + (f"  [{d}]" if d else ""))
    bad = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    return 1 if bad else 0

raise SystemExit(asyncio.run(main()))
