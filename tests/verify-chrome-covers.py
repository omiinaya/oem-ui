#!/usr/bin/env python
"""
No sticky or fixed chrome may cover a control, at ANY scroll position.

Omar: "sections are mashed together and there's no padding or margins or
anything to divide them" led to the stack primitive, and this is the check
that keeps a page from being *readable* at the cost of being *usable*.

A `position: sticky; bottom: 0` bar in a document with no bounded
containing block parks on the viewport bottom for the entire page. On the
showcase that was measured: `.cm-toolbar` sat over the "spacing" prose and
every section after it, for all 48,260px of scroll. Nothing about that
failure is visible in a static screenshot of the top of the page, and
`position: sticky` is CORRECT for the component - the specimen was what was
wrong, because a sticky bar needs a bounded parent to demonstrate
anything.

So this walks the whole document in viewport-height steps and asks, at each
step, whether any sticky/fixed element overlaps a control the reader needs
to click. It is deliberately a scroll walk rather than a screenshot: the
defect only exists partway down.

  python tests/verify-chrome-covers.py            # local showcase
  BASE_URL=https://ui.mrx.sh/ python tests/verify-chrome-covers.py
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")

# (width, height) - 320 is the narrowest phone the showcase supports, 402
# is Omar's iPhone in Safari, 1440 is the desktop rail.
VIEWPORTS = ((320, 700), (402, 874), (1440, 900))

PROBE = """
() => {
  const chrome = [...document.querySelectorAll('body *')].filter(e => {
    const s = getComputedStyle(e);
    return (s.position === 'sticky' || s.position === 'fixed')
      && e.getBoundingClientRect().height > 0;
  }).filter(e => {
    const c = (e.className || '').toString();
    // The scrim is invisible when closed and the HEADER is supposed to
    // overlap content while the page scrolls - that is what a sticky bar
    // IS. Neither is a defect. This check is for chrome that is neither:
    // an action bar parked over the page instead of over its own surface.
    if (/scrim|cm-header/.test(c)) return false;
    // Sticky table headers and sticky COLUMNS overlap each other by
    // design - that is the entire point of a frozen column: the header
    // row and the frozen first column share one corner cell. Measured
    // `num` over `TH` and `cm-table__sortcol` over `cm-table__sortcol`
    // across the table sections, all of it correct. Only chrome that is
    // not table furniture is in scope here.
    if (/cm-table|^num$|sortcol/.test(c)) return false;
    if (e.tagName === 'TH' || e.tagName === 'TD') return false;
    // A sticky element only covers content while it is pinned. If its
    // sticky offset never engaged (it is at rest in flow), it covers
    // nothing and is not the subject here.
    return true;
  });

  const H = window.innerHeight;
  const STEP = 400;
  const docH = document.documentElement.scrollHeight;
  const covered = [];

  // `html` sets `scroll-behavior: smooth`, so `scrollTo` RETURNS while
  // window.scrollY is still where it was - the first version of this walk
  // read the same rect on every step and reported 0 covered on a page
  // where the toolbar demonstrably covered a paragraph. Disable smooth
  // scrolling for the walk so each sample is the position asked for.
  const prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  for (let y = 0; y < docH; y += STEP) {
    window.scrollTo(0, y);
    for (const c of chrome) {
      const cr = c.getBoundingClientRect();
      if (cr.bottom < 0 || cr.top > H) continue;
      // READABLE TEXT, not just controls. Measured on the showcase: with
      // the toolbar's bounded container removed, `.cm-toolbar` still
      // covered no button or link - the first version of this probe
      // passed on the broken page and reported 0. What it covered was
      // PROSE (a `.cm-head__sub` paragraph), which is just as much a
      // failure: the reader cannot read a sentence under a bar. So the
      // question is "is readable text or an interactive control hidden",
      // and both count.
      const hidden = [...document.querySelectorAll(
        'main a, main button, main input, main select, main [role=button], '
        + 'main p, main li, main h1, main h2, main h3, main h4, main td, main th')]
        .filter(e => {
          const r = e.getBoundingClientRect();
          if (r.height === 0 || r.width === 0) return false;
          if (r.top < 0 || r.bottom > H) return false;
          if (r.top < cr.bottom - 2 && r.bottom > cr.top + 2) {
            // A chrome element ALWAYS overlaps the elements inside it -
            // the bar's own buttons sit inside the bar. Measuring that
            // reports every sticky bar on every page as covering its own
            // controls (measured: `.cm-toolbar` "over" `enable all`,
            // where the button is 13px below the bar's own top edge and
            // moves with it at every scroll position). Only an element
            // that is NOT a descendant of the chrome can be hidden by it.
            if (c.contains(e)) return false;
            return true;
          }
          return false;
        });
      for (const h of hidden) {
        covered.push({
          y,
          chrome: (c.className || '').toString().slice(0, 30),
          under: (h.className || '').toString().slice(0, 34),
        });
      }
    }
  }
  document.documentElement.style.scrollBehavior = prev;
  window.scrollTo(0, 0);
  const seen = new Set();
  const uniq = [];
  for (const c of covered) {
    const k = c.chrome + '|' + c.under;
    if (!seen.has(k)) { seen.add(k); uniq.push(c); }
  }
  return { docH, chromeCount: chrome.length, coveredCount: covered.length, uniq: uniq.slice(0, 6) };
}
"""


async def main() -> int:
    failures = []
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        for w, h in VIEWPORTS:
            ctx = await browser.new_context(viewport={"width": w, "height": h})
            page = await ctx.new_page()
            try:
                await page.goto(BASE, wait_until="networkidle", timeout=60000)
                # The runtime binds on DOMContentLoaded plus a
                # MutationObserver pass; a probe that runs before the
                # library has bound measures the pre-runtime page.
                await page.wait_for_timeout(1500)
                r = await page.evaluate(PROBE)
            except Exception as exc:  # noqa: BLE001 - report, do not raise
                failures.append(f"{w}x{h}: could not measure - {str(exc)[:70]}")
                await ctx.close()
                continue

            print(f"  {w}x{h}: doc {r['docH']}px, {r['chromeCount']} sticky/fixed element(s), "
                  f"{r['coveredCount']} control(s) covered")
            if r["coveredCount"]:
                failures.append(
                    f"{w}x{h}: {r['coveredCount']} control(s) sit under sticky chrome"
                    + ("; e.g. " + "; ".join(f"{u['chrome']} over {u['under']}" for u in r["uniq"]))
                )
            await ctx.close()
        await browser.close()

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        print(f"\nFAIL: {len(failures)} viewport(s) with chrome covering controls")
        return 1
    print("PASS: no sticky or fixed chrome covers a control at any scroll position")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
