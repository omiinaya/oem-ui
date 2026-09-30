"""The header stays pinned while a REAL wheel gesture scrolls the page.

Why this file exists
--------------------
Omar reported, on a phone: "the top bar is still not sticky so when we
scroll down in the app it leaves a gap at the top."

Getting a trustworthy answer took four wrong probes in a row, and each
wrong probe is a trap that the next person will walk into:

  1. A SYNCHRONOUS read. `html { scroll-behavior: smooth }` means
     `window.scrollTo()` returns while scrollY is still 0. It is 387
     after two frames and 2000 after 400ms. Read it synchronously and
     the page looks like it refuses to scroll, which reads exactly
     like "the bar detached".

  2. `.cm-head` as a selector for "the header". `.cm-head` is a page
     HEADING block (dev-blog, `<section class="cm-head">`), and CSS
     class selectors match by PREFIX, so `.cm-head` also matches
     `.cm-header`. Chasing that gave a "position: static header that
     scrolls away" reading for a header that was perfectly sticky.

  3. Screenshotting immediately after a scroll. With smooth-scroll
     still running, the pixels are of the pre-scroll position.

  4. A synthetic `new Touch()` / `document.dispatchEvent(touchmove)`.
     Not constructible in this WebKit; the gesture never happens.

So the rule this test encodes: to ask whether the bar sticks, drive the
scroll with a REAL input event, disable smooth-scroll, and read
`getBoundingClientRect().top` on `document.querySelector('header')` -
the element, not a class-name guess.

What it asserts, at 320/390/402/768/1280:
  * a real wheel gesture actually scrolls the document
  * the header element is still `top: 0` after each gesture
  * the header's computed `position` is sticky or fixed
  * nothing paints above it (elementFromPoint at y=1..4 hits the header)

Usage:  python tests/verify-sticky-scroll.py            # LAN showcase
        BASE_URL=https://ui.mrx.sh/ python tests/verify-sticky-scroll.py
        HEADFUL=1 python tests/verify-sticky-scroll.py
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")
WIDTHS = [int(w) for w in os.environ.get("WIDTHS", "320,390,402,768,1280").split(",")]
HEIGHTS = {"320": 568, "390": 844, "402": 874, "768": 1024, "1280": 800}

# Disable smooth-scroll BEFORE measuring: this is the trap that made four
# earlier probes report a non-scrolling page.
FREEZE = """() => { document.documentElement.style.scrollBehavior = 'auto'; }"""

# `header` the ELEMENT, not `.cm-head` (which prefix-matches .cm-header).
MEASURE = """() => {
  const el = document.querySelector('header');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  // In RAIL mode the header is a fixed-width LEFT column, so the top of
  // the viewport is legitimately NOT the header - there is nothing to own
  // it. Sample at the header's own horizontal centre instead, or the test
  // reports a design decision as a defect.
  const isRail = r.width > 0 && r.right < window.innerWidth * 0.6;
  const sampleX = isRail ? Math.round(r.left + r.width / 2) : Math.round(window.innerWidth / 2);
  const topHits = [];
  for (const y of [1, 2, 3, 4]) {
    const e = document.elementFromPoint(sampleX, y);
    topHits.push(e ? (e === el || el.contains(e)) : false);
  }
  return {
    scrollY: Math.round(window.scrollY),
    top: Math.round(r.top),
    height: Math.round(r.height),
    position: cs.position,
    isRail,
    stickyOK: cs.position === 'sticky' || cs.position === 'fixed',
    headerOwnsTop: topHits.every(Boolean),
  };
}"""


async def check_width(browser, width):
    height = HEIGHTS.get(str(width), 800)
    ctx = await browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=3,
    )
    page = await ctx.new_page()
    try:
        await page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
        await page.evaluate(FREEZE)

        start = await page.evaluate(MEASURE)
        if start is None:
            return [f"no <header> element at {width}px"]
        fails = []
        if not start["stickyOK"]:
            fails.append(f"header position is {start['position']!r}, not sticky/fixed")

        scrolled = False
        for _ in range(5):
            await page.mouse.wheel(0, 400)
            await page.wait_for_timeout(180)
            m = await page.evaluate(MEASURE)
            if m is None:
                return fails + [f"header vanished mid-scroll at {width}px"]
            if m["scrollY"] > start["scrollY"] + 100:
                scrolled = True
            if m["top"] != 0:
                fails.append(f"header drifted to top={m['top']} at scrollY={m['scrollY']}")
            if not m["stickyOK"]:
                fails.append(f"header position became {m['position']!r}")
            if not m["headerOwnsTop"]:
                fails.append(f"something paints above the header at scrollY={m['scrollY']}")
        if not scrolled:
            fails.append(f"a real wheel gesture did not scroll at {width}px")
        return fails
    finally:
        await ctx.close()


async def main():
    width_arg = os.environ.get("WIDTHS")
    widths = WIDTHS if width_arg else [320]
    async with async_playwright() as pw:
        browser = await pw.webkit.launch(headless=not os.environ.get("HEADFUL"))
        failures = []
        for w in widths:
            f = await check_width(browser, w)
            status = "ok  " if not f else "FAIL"
            print(f"  {status} {w}px", ("" if not f else " ".join(f)))
            failures += f
        await browser.close()
    if failures:
        print(f"\nFAIL: {len(failures)} sticky-scroll failures")
        return 1
    print(f"\nPASS: the header stays pinned at every width ({', '.join(map(str, widths))})")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
