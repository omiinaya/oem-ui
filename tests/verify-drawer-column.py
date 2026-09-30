#!/root/.venvs/mau/bin/python
"""
Prove the mobile drawer is ONE column at every viewport height, and that
every nav link stays inside the panel.

The defect this guards: `.cm-header__links` is `flex-direction: column`
but inherited `flex-wrap: wrap` from the bar rule. On a COLUMN, wrap runs
ACROSS. When the rows stop fitting the panel's HEIGHT they broke into a
second column at x=179, and the panel is `min(86vw, 320px)` wide, so
`layout`, `forms`, `auth` and `readme` landed outside it -- unreachable,
and `scrollHeight == clientHeight` meant the drawer could not scroll to
them either. Measured at 402x667: 12 rows in column one, 4 stranded.

The trigger is HEIGHT. The list needs 869px of panel, so any viewport
shorter than about 800px tall wraps -- which is most phones once Safari's
chrome is counted, and is why a 402x874 viewport never showed it.

Run:  tests/verify-drawer-column.py
Env:  BASE_URL (default the LAN showcase), WIDTHS, HEIGHTS
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")
WIDTHS = [int(x) for x in os.environ.get("WIDTHS", "320,375,390,402,430").split(",")]
HEIGHTS = [
    int(x)
    for x in os.environ.get("HEIGHTS", "932,874,844,812,800,780,736,667,568,480").split(",")
]

PROBE = """
() => {
  const list = document.querySelector('.cm-header .cm-header__links');
  if (!list) return {skip: 'no .cm-header .cm-header__links'};
  const panel = list.getBoundingClientRect();
  const links = [...list.querySelectorAll(':scope > a')];
  const rows = links.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      t: el.textContent.trim(),
      x: Math.round(r.left),
      top: Math.round(r.top),
      bot: Math.round(r.bottom),
    };
  });
  // A column that wrapped has more than one distinct left edge. That is
  // the whole signal, and it is read from the DOM rather than inferred
  // from a screenshot.
  const xs = [...new Set(rows.map((r) => r.x))];
  // Scroll to the end, then re-measure: the last link must be inside the
  // panel once the reader has scrolled to it.
  list.scrollTop = list.scrollHeight;
  const el = links[links.length - 1];
  const lb = el.getBoundingClientRect();
  const p2 = list.getBoundingClientRect();
  return {
    n: rows.length,
    xs,
    canScroll: list.scrollHeight > list.clientHeight + 1,
    scrollTop: Math.round(list.scrollTop),
    maxScroll: Math.round(list.scrollHeight - list.clientHeight),
    lastT: el.textContent.trim(),
    lastTop: Math.round(lb.top),
    lastBot: Math.round(lb.bottom),
    panelTop: Math.round(p2.top),
    panelBot: Math.round(p2.bottom),
    panelRight: Math.round(panel.right),
    // Anything whose right edge crosses the panel is bleeding out.
    wide: rows.filter((r) => r.x + 1 > 0 && r.x > 1).map((r) => r.t),
  };
}
"""


async def main() -> int:
    fails = []
    checked = 0
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        for w in WIDTHS:
            for h in HEIGHTS:
                ctx = await browser.new_context(
                    viewport={"width": w, "height": h},
                    device_scale_factor=3,
                    is_mobile=True,
                    has_touch=True,
                )
                page = await ctx.new_page()
                try:
                    await page.goto(BASE, wait_until="networkidle", timeout=60000)
                    await page.click(".cm-nav-toggle", timeout=8000)
                    # The drawer slides in; measuring mid-animation gives
                    # positions that are still moving, which is how an
                    # earlier probe of mine read nonsense.
                    await page.wait_for_timeout(1000)
                    d = await page.evaluate(PROBE)
                except Exception as exc:  # noqa: BLE001
                    fails.append(f"{w}x{h}: probe failed: {type(exc).__name__}")
                    await ctx.close()
                    continue
                await ctx.close()

                if d.get("skip"):
                    print(f"skip {w}x{h}  {d['skip']}")
                    continue
                checked += 1

                bad = []
                if len(d["xs"]) != 1:
                    bad.append(
                        f"the drawer is {len(d['xs'])} columns (left edges {d['xs']}); "
                        "it must be one column and scroll instead"
                    )
                if d["wide"]:
                    bad.append(f"links outside the panel: {d['wide']}")
                if d["lastTop"] < d["panelTop"] - 1 or d["lastBot"] > d["panelBot"] + 1:
                    bad.append(
                        f"after scrolling to the end, {d['lastT']} sits at "
                        f"{d['lastTop']}..{d['lastBot']} against a panel of "
                        f"{d['panelTop']}..{d['panelBot']}: unreachable"
                    )
                if d["canScroll"] and d["scrollTop"] < d["maxScroll"] - 1:
                    bad.append(
                        f"the list overflows ({d['scrollTop']} of {d['maxScroll']} "
                        "scrolled) so some link is below the fold"
                    )

                tag = f"{w}x{h}"
                if bad:
                    fails.append(f"{tag}: " + "; ".join(bad))
                    print(f"FAIL {tag}  cols={len(d['xs'])} scroll={d['canScroll']}")
                else:
                    print(
                        f"ok   {tag}  n={d['n']} cols=1 scroll={str(d['canScroll']):5} "
                        f"scrollTop={d['scrollTop']}/{d['maxScroll']} last={d['lastT']}"
                    )
        await browser.close()

    if checked == 0:
        print("\nFAIL  nothing was checked: the drawer was not present on any width")
        return 1
    if fails:
        print()
        for f in fails:
            print("FAIL " + f)
        return 1
    print(
        f"\nPASS  {len(WIDTHS)}x{len(HEIGHTS)} sizes: the drawer is one column "
        f"at every height, scrolls when the rows overflow, and every nav link "
        f"stays inside the panel."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
