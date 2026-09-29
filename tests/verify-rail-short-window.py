#!/root/.venvs/mau/bin/python
"""
Prove the desktop rail stays ONE column in a real browser, at window
heights that do not fit the index.

The defect this catches is not visible in a screenshot at a tall window and
is not visible in a CSS assertion either: `flex-wrap: wrap`, inherited from
the bar's nav, turns the rail's COLUMN into a two-column grid once its
children stop fitting the viewport HEIGHT. The rail's own `overflow: hidden`
then clips the second column away, so the index appears to lose links.

Measured before the fix, at 1280x500: links 1-7 at x=8, links 8-14 at
x=143, list running to x=389 inside a 231px rail. At 1280x700 the nav itself
stopped being a column and ran to 493px. So the checks are:

  1. every rail link shares the SAME left edge (one column, not two)
  2. no rail link crosses the rail's right edge
  3. the nav and the list never overflow horizontally
  4. every link is REACHABLE, by scrolling the list if not already visible

Run from the repo root. Exits non-zero on the first failure.
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

URL = os.environ.get("RAIL_URL", "http://192.168.1.68:4321/")

# Heights chosen around the measured failure: 800 was the last height that
# stacked, 760 the first that moved the controls, 700 the first that put the
# list and controls on one row.
HEIGHTS = (900, 800, 760, 700, 600, 500, 400)

PROBE = """() => {
  const rail = document.querySelector('.cm-header');
  const nav = document.querySelector('.cm-header--rail .cm-header__nav');
  const list = document.querySelector('.cm-header--rail .cm-header__links');
  if (!rail || !nav || !list) return { error: 'the rail is not on the page' };

  const rr = rail.getBoundingClientRect();
  const links = [...list.querySelectorAll(':scope > .cm-header__link')];
  const boxes = links.map((a) => {
    const r = a.getBoundingClientRect();
    return { text: a.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right) };
  });

  // Reachability: visible now, or reachable by scrolling the list.
  const lr = list.getBoundingClientRect();
  const inView = () => boxes.every((b, i) => {
    const r = links[i].getBoundingClientRect();
    return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
  });
  list.scrollTop = 0;
  const atTop = inView();
  list.scrollTop = list.scrollHeight;
  const atEnd = inView();
  list.scrollTop = 0;

  return {
    vh: window.innerHeight,
    railW: Math.round(rr.width),
    railRight: Math.round(rr.right),
    navScrollW: nav.scrollWidth,
    navClientW: nav.clientWidth,
    listScrollW: list.scrollWidth,
    listClientW: list.clientWidth,
    listClientH: list.clientHeight,
    listScrollH: list.scrollHeight,
    linkCount: boxes.length,
    lefts: [...new Set(boxes.map((b) => b.left))],
    pastRail: boxes.filter((b) => b.right > rr.right + 0.5).map((b) => b.text),
    navOverflowsX: nav.scrollWidth > nav.clientWidth + 1,
    listOverflowsX: list.scrollWidth > list.clientWidth + 1,
    allVisibleAtTop: atTop,
    allVisibleAtEnd: atEnd,
    scrolls: list.scrollHeight > list.clientHeight,
  };
}"""


async def main() -> int:
    failures = []
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        for h in HEIGHTS:
            page = await browser.new_page(viewport={'width': 1280, 'height': h})
            await page.goto(URL, wait_until='networkidle')
            d = await page.evaluate(PROBE)
            await page.close()

            if d.get('error'):
                failures.append(f"vh={h}: {d['error']}")
                continue

            checks = [
                (len(d['lefts']) == 1,
                 f"vh={h}: links occupy {len(d['lefts'])} columns (lefts={d['lefts']}) "
                 f"instead of one; the rail wrapped"),
                (not d['pastRail'],
                 f"vh={h}: {len(d['pastRail'])} links cross the rail's right edge: "
                 f"{d['pastRail'][:4]}"),
                (not d['navOverflowsX'],
                 f"vh={h}: the nav overflows sideways "
                 f"({d['navScrollW']} in {d['navClientW']})"),
                (not d['listOverflowsX'],
                 f"vh={h}: the link list overflows sideways "
                 f"({d['listScrollW']} in {d['listClientW']})"),
                (d['allVisibleAtTop'] or d['allVisibleAtEnd'] or d['scrolls'],
                 f"vh={h}: {d['linkCount']} links but no way to reach them all"),
                (d['linkCount'] >= 15,
                 f"vh={h}: found only {d['linkCount']} rail links; the index lost one"),
            ]

            bad = [msg for ok, msg in checks if not ok]
            if bad:
                failures.extend(bad)
                print(f"FAIL vh={h:<4} {d['linkCount']} links, lefts={d['lefts']}")
                for m in bad:
                    print(f"       {m}")
            else:
                print(f"ok   vh={h:<4} one column at x={d['lefts'][0]}, rail={d['railW']}px, "
                      f"list {d['listClientH']}px{' (scrolls)' if d['scrolls'] else ' (all fit)'}")

        await browser.close()

    print()
    if failures:
        print(f"{len(failures)} failure(s)")
        return 1
    print(f"all {len(HEIGHTS)} window heights: one column, nothing crosses the rail, "
          f"every link reachable")
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
