"""The sticky header survives the mobile drawer being open, and the page
does not jump when it opens or closes.

Why this file exists
--------------------
Omar: "the issue is still there. scroll the background with sidebar open...
the gap is at the top."

The reproduction is specific and it is the ONLY state in which the bar ever
failed. The runtime used to set `body.style.overflow = 'hidden'` when the
drawer opened, to scroll-lock the page behind the panel. That was wrong
twice, and the second wrongness is this bug:

  * `body` is not the scrolling element in this layout - <html> is, because
    body's scrollHeight equals its clientHeight. So the lock never locked
    anything; a real wheel gesture over the scrim still moved the document.
  * A box with `overflow: hidden` BECOMES A SCROLL CONTAINER. That made
    `body` the containing block for the sticky header, so the header stuck
    to a body that never scrolls and rode the document out of the viewport:
    measured headerTop -1200 with the drawer open at scrollY 1200, i.e. the
    bar was entirely off-screen. That is the gap.

The fix is to not lock at all: the drawer is position:fixed over a
position:fixed scrim, so the page is covered from the first frame, opening
causes no reflow, and the panel scrolls internally on its own.

How to actually drive this
--------------------------
Two traps, both of which produce a confident WRONG answer:

  * `html { scroll-behavior: smooth }`. `scrollTo` returns while scrollY is
    still the old value. Force `scroll-behavior: auto` before measuring, or
    every reading races the animation.
  * `mouse.wheel` is NOT supported in mobile WebKit. Use a desktop-shaped
    context at a phone width so real wheel input works; the property under
    test is engine behaviour, not viewport behaviour.

Usage:  python tests/verify-drawer-sticky.py
        BASE_URL=https://ui.mrx.sh/ python tests/verify-drawer-sticky.py
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")
WIDTHS = [int(w) for w in os.environ.get("WIDTHS", "320,375,390,402,430").split(",")]
HEIGHT = int(os.environ.get("HEIGHT", "667"))

FREEZE = """() => { document.documentElement.style.scrollBehavior = 'auto'; }"""

MEASURE = """() => {
  const el = document.querySelector('header');
  const de = document.documentElement;
  const drawer = document.querySelector('.cm-header .cm-header__links');
  const r = el.getBoundingClientRect();
  // Sampled at the DRAWER's own x: with the drawer open the top-left of the
  // viewport is the panel, and with it closed that is the header's brand.
  const hits = [2, 4, 8].map((y) => {
    const e = document.elementFromPoint(Math.round(r.left + 40), y);
    return !!(e && (e === el || el.contains(e)));
  });
  return {
    scrollY: Math.round(window.scrollY),
    headerTop: Math.round(r.top),
    headerPosition: getComputedStyle(el).position,
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyInlineStyle: document.body.getAttribute('style') || '',
    navOpen: de.hasAttribute('data-cm-nav-open'),
    drawerOpen: !!drawer && drawer.hasAttribute('data-open'),
    drawerScrolls: !!drawer && drawer.scrollHeight > drawer.clientHeight + 1,
    headerOwnsTop: hits.every(Boolean),
  };
}"""


async def check(browser, width):
    ctx = await browser.new_context(viewport={"width": width, "height": HEIGHT},
                                    device_scale_factor=3)
    page = await ctx.new_page()
    fails = []
    try:
        await page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        await page.evaluate(FREEZE)

        toggle = await page.query_selector(".cm-nav-toggle")
        if not toggle:
            return [f"no .cm-nav-toggle at {width}px, nothing to test"]
        if await page.evaluate("()=>!document.querySelector('.cm-header .cm-header__links')"):
            return []  # a consumer with no drawer at this width: vacuously fine

        # --- 1. opening the drawer must not scroll-lock the page via body ---
        await page.evaluate("()=>window.scrollTo(0,1200)")
        await page.wait_for_timeout(250)
        before = await page.evaluate(MEASURE)
        # Coordinate clicks throughout: page.click() scrolls the target into
        # view as part of its actionability check, which is the harness moving
        # the document and would make the scroll-jump assertions meaningless.
        ob = await page.evaluate(
            """()=>{const b=document.querySelector('.cm-nav-toggle').getBoundingClientRect();
            return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)};}"""
        )
        await page.mouse.click(ob["x"], ob["y"])
        await page.wait_for_timeout(800)
        opened = await page.evaluate(MEASURE)

        if opened["navOpen"] is not True:
            return [f"the drawer did not open at {width}px"]

        # The load-bearing assertion: an `overflow: hidden` BODY makes the
        # sticky header stick to a body that never scrolls.
        if opened["bodyOverflow"] in ("hidden", "clip", "scroll", "auto"):
            fails.append(
                f"opening the drawer set body overflow:{opened['bodyOverflow']}, "
                "which makes body a scroll container and unpins the header"
            )
        if "overflow" in opened["bodyInlineStyle"]:
            fails.append(f"body carries an inline overflow on open: {opened['bodyInlineStyle']!r}")

        # --- 2. the header must still be pinned with the drawer open ---
        if opened["headerTop"] != 0:
            fails.append(f"header top={opened['headerTop']} with the drawer open (expected 0)")
        if not opened["headerOwnsTop"]:
            fails.append("something paints above the header with the drawer open")
        if opened["headerPosition"] not in ("sticky", "fixed"):
            fails.append(f"header position became {opened['headerPosition']!r}")

        # --- 3. scrolling the background must not move the header (the repro) ---
        await page.evaluate("()=>window.scrollTo(0,1800)")
        await page.wait_for_timeout(300)
        scrolled = await page.evaluate(MEASURE)
        if scrolled["headerTop"] != 0:
            fails.append(
                f"scrolling the background with the drawer open moved the header to "
                f"top={scrolled['headerTop']} at scrollY={scrolled['scrollY']}"
            )

        # --- 4. opening must not shift the page sideways ---
        sideways = await page.evaluate(
            "()=>{const d=document.documentElement;"
            "return d.scrollWidth>d.clientWidth+1? d.scrollWidth-d.clientWidth : 0;}"
        )
        if sideways:
            fails.append(f"opening the drawer introduced {sideways}px of sideways scroll")

        # --- 5. the panel itself must still scroll internally ---
        if not scrolled["drawerScrolls"] and scrolled["drawerOpen"]:
            fails.append("the drawer does not scroll its own overflow")

        # --- 6. closing must not restore a scroll jump ---
        # NOT page.click(): Playwright's actionability check scrolls the
        # target into view first, and that scroll is the harness moving the
        # document, not the page. A real tap does not do that. Click the
        # element's own coordinates instead.
        tb = await page.evaluate(
            """()=>{const b=document.querySelector('.cm-nav-toggle').getBoundingClientRect();
            return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)};}"""
        )
        await page.mouse.click(tb["x"], tb["y"])
        await page.wait_for_timeout(700)
        closed = await page.evaluate(MEASURE)
        if closed["headerTop"] != 0:
            fails.append(f"header top={closed['headerTop']} after closing the drawer")
        if abs(closed["scrollY"] - scrolled["scrollY"]) > 2:
            fails.append(
                f"closing the drawer jumped the scroll position: "
                f"{scrolled['scrollY']} -> {closed['scrollY']}"
            )
        _ = before
        return fails
    finally:
        await ctx.close()


async def main():
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        all_fails = []
        for w in WIDTHS:
            f = await check(browser, w)
            print(f"  {'ok  ' if not f else 'FAIL'} {w}px", ("" if not f else ""))
            for line in f:
                print(f"        - {line}")
            all_fails += f
        await browser.close()
    if all_fails:
        print(f"\nFAIL: {len(all_fails)} drawer-sticky failures")
        return 1
    print(f"\nPASS: the header stays pinned with the drawer open and scrolled "
          f"({', '.join(map(str, WIDTHS))})")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
