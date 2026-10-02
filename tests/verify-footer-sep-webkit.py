#!/root/.venvs/mau/bin/python
"""
Prove the footer meta row never ends a visual line with a separator.

The defect this guards: the `·` between footer fragments used to be its own
`<span class="cm-footer__bar">`, a flex item like any other.
`.cm-footer__meta` is `flex-wrap: wrap`, so when the row wrapped a
separator could be the last thing on a line with nothing after it -
"© 2026 @omiinaya ·" on line one, the fragments on line two. MEASURED in
WebKit on the showcase before the fix: stranded at 320, 390, 402 and 430.

The fix puts the separator in a `::before` on the item it PRECEDES, so a
wrapped line can only ever START with a separator.

Two directions are asserted, and the second one is the one a naive check
misses:

  1. NO LINE ENDS WITH A SEPARATOR - measured from the rendered geometry,
     grouping items by their `top` and looking at the LAST item per line.
     A bare `.cm-footer__bar` element is what a first probe looked for and
     it is not sufficient: the intermediate `::after` fix also had no
     separator elements, and it still stranded the dot at the end of the
     line because the dot stayed attached to the PRECEDING item.

  2. THE SEPARATOR IS STILL THERE - read from `getComputedStyle(el,
     '::before')`. Without this the whole check passes free if the
     separator is deleted, and a `content: none` mutant is invisible to
     an element-based probe.

Note the fixture: the showcase's footer wraps at every phone width, so the
sticky path IS exercised. A footer that fits on one line proves nothing.

Run: tests/verify-footer-sep-webkit.py
Env: BASE_URL, WIDTHS
"""

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")
WIDTHS = [int(x) for x in os.environ.get("WIDTHS", "320,360,390,402,430").split(",")]

PROBE = """
() => {
  const meta = document.querySelector('.cm-footer__meta');
  if (!meta) return {skip: 'no .cm-footer__meta'};
  // Filter to RENDERED children. A collapsed element reports width 0 and
  // would otherwise join a line group and be read as a separator.
  const items = [...meta.children].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
  const rows = items.map((el) => {
    const r = el.getBoundingClientRect();
    const before = getComputedStyle(el, '::before');
    return {
      text: el.textContent.trim().slice(0, 30),
      top: Math.round(r.top),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      // A separator ELEMENT: any child whose whole text is punctuation.
      isBareSep: /^[·\\u00b7|]+$/.test(el.textContent.trim()),
      beforeContent: before.content,
    };
  });
  // Group by visual line, then ask each line what its LAST item is.
  const byLine = new Map();
  for (const r of rows) {
    if (!byLine.has(r.top)) byLine.set(r.top, []);
    byLine.get(r.top).push(r);
  }
  const lines = [...byLine.entries()].map(([top, rs]) => {
    rs.sort((a, b) => a.left - b.left);
    const last = rs[rs.length - 1];
    return {
      top,
      count: rs.length,
      lastText: last.text,
      lastIsBareSep: last.isBareSep,
      // The separator generated on the LAST item of the row. If it is not
      // the first item, it is the dot between it and its predecessor -
      // and that dot sits at this line's right edge.
      lastHasBefore: last.beforeContent !== 'none' && last.beforeContent !== 'normal',
    };
  });
  return {
    lines,
    items: rows,
    wrapped: lines.length > 1,
  };
}
"""


async def main() -> int:
    async with async_playwright() as p:
        browser = await p.webkit.launch()
        bad = 0
        for w in WIDTHS:
            page = await browser.new_page(viewport={"width": w, "height": 844})
            await page.goto(BASE, wait_until="load")
            await page.wait_for_timeout(250)
            res = await page.evaluate(PROBE)
            if "skip" in res:
                print(f"skip  {w}px  {res['skip']}")
                await page.close()
                continue
            errs = []
            if not res["wrapped"]:
                # A footer that fits on one line never exercises the wrap.
                errs.append("fixture does not wrap - the path is untested")
            for line in res["lines"]:
                if line["lastIsBareSep"]:
                    errs.append(
                        f"line at top={line['top']} ENDS with a bare separator element "
                        f"({line['lastText']!r})"
                    )
            # Direction 2: exactly one item (the first) has no ::before,
            # and every other item has one. Fewer separators than gaps
            # means the separator was deleted, not merely moved.
            with_before = [r for r in res["items"] if r["beforeContent"] not in ("none", "normal")]
            expected = len(res["items"]) - 1
            if len(with_before) != expected:
                errs.append(
                    f"{len(with_before)} separators for {len(res['items'])} items "
                    f"(expected {expected})"
                )
            if with_before and with_before[0] is res["items"][0]:
                errs.append("the FIRST item carries a separator - it leads the row")

            if errs:
                bad += 1
            print(f"{'FAIL' if errs else 'ok  '}  {w}px  lines={len(res['lines'])}")
            for e in errs:
                print(f"        ! {e}")
            for line in res["lines"]:
                print(
                    f"        top={line['top']} n={line['count']} "
                    f"last={line['lastText']!r} lastHasBefore={line['lastHasBefore']}"
                )
            await page.close()
        await browser.close()
    print(f"\n{'FAILURES: ' + str(bad) if bad else 'all widths clean'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
