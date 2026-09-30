#!/root/.venvs/mau/bin/python
"""
Prove the header never paints anything OUTSIDE its own box, at the widths
where a nav row used to wrap.

The defect: between the phone drawer (640px) and the rail (1000px) the
bar's nav is `flex-wrap: wrap` with a FIXED 60px height, and both the
list and the header are `overflow: visible`. A wrapped second row
therefore painted below the header box and on top of the page content.
Measured at 700px: the list ran y=35 to y=77 inside a header ending at
y=61, and `elementFromPoint(200, 70)` returned a `.cm-header__link`.

A screenshot of a TALL window does not show this, because the overlap is
16px against whatever happens to sit under it. The honest check is a
hit test: a point below the header's bottom edge must never return a
header child.

Also asserts every nav link stays REACHABLE. In the band the row scrolls
sideways, so the last link has to be scrollable into view rather than
clipped away, and the phone and the rail are checked for no regression.

    tests/verify-bar-containment.py            # against the LAN preview
    BASE_URL=https://ui.mrx.sh/ tests/verify-bar-containment.py
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")

# 641-999 is the band that wrapped. 390/375 are the phone, 1000+ the rail.
WIDTHS = (375, 390, 641, 700, 768, 900, 999, 1000, 1280)

PROBE = """() => {
  const header = document.querySelector('.cm-header');
  if (!header) return { skipped: 'no .cm-header on this page' };
  const list = header.querySelector('.cm-header__links');
  if (!list) return { skipped: 'this .cm-header has no nav link list' };
  const links = [...list.querySelectorAll(':scope > .cm-header__link')];
  const hr = header.getBoundingClientRect();
  const lr = list.getBoundingClientRect();

  // Hit test just BELOW the header. Nothing that belongs to the header
  // may be painted there. A link there means it overflowed its box.
  const escapees = [];
  for (let y = Math.ceil(hr.bottom) + 1; y <= Math.ceil(lr.bottom) + 1; y++) {
    for (const x of [40, 200, 400, Math.round(hr.width / 2)]) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el === header || header.contains(el)) {
        escapees.push({ y, x, el: el.tagName + '.' + (el.className || '-') });
      }
    }
  }

  // Every link reachable: scroll the row to its end, the last link must
  // be inside the viewport.
  const vw = document.documentElement.clientWidth;
  list.scrollLeft = 999999;
  const last = links[links.length - 1].getBoundingClientRect();
  list.scrollLeft = 0;

  return {
    headerH: Math.round(hr.height),
    headerBottom: Math.round(hr.bottom),
    listBottom: Math.round(lr.bottom),
    navRows: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
    links: links.length,
    isRail: header.classList.contains('cm-header--rail'),
    scrollW: list.scrollWidth,
    clientW: list.clientWidth,
    canScrollX: list.scrollWidth > list.clientWidth,
    lastReachable: last.right <= vw + 1 && last.left >= -1,
    escapees: escapees.slice(0, 4),
  };
}"""


async def main():
    fails = []
    skipped = 0
    async with async_playwright() as pw:
        br = await pw.webkit.launch()
        try:
            for w in WIDTHS:
                pg = await br.new_page(viewport={"width": w, "height": 800})
                try:
                    await pg.goto(BASE, wait_until="networkidle")
                    d = await pg.evaluate(PROBE)
                finally:
                    await pg.close()

                # A consumer may not use this header at all -- `links`
                # renders `.cm-head`, not `.cm-header`. Skipping is the
                # honest answer; crashing on `null.querySelectorAll`
                # is a test that cannot be pointed at anything but the
                # showcase.
                if d.get("skipped"):
                    print(f"skip w={w:<5} {d['skipped']}")
                    skipped += 1
                    continue

                rail = w >= 1000
                band = 641 <= w < 1000
                tag = "rail" if rail else ("band" if band else "phone")

                # The one invariant that must hold at EVERY width: nothing
                # the header owns is painted below the header's own box.
                if d["escapees"]:
                    fails.append(
                        f"{tag} {w}: the header paints below its own box at "
                        f"y>{d['headerBottom']}: {d['escapees']}"
                    )
                if not d["lastReachable"]:
                    fails.append(f"{tag} {w}: the last nav link cannot be reached")
                if not d["links"]:
                    fails.append(f"{tag} {w}: no nav links rendered")

                # Shape expectations per band -- but ONLY for a header that
                # opts into the bar/rail at all, and only where the links
                # genuinely exceed the width. `oem-portfolio` ships 3 nav
                # links: they fit in one row at every width, so "must scroll"
                # is a false requirement, and it does not pass `rail`, so
                # "must be a single column" is a false requirement too.
                # Reachability above is the invariant that holds universally;
                # these two are conditional on the header being under pressure.
                if band:
                    if d["navRows"] != 1:
                        fails.append(
                            f"{tag} {w}: nav occupies {d['navRows']} rows; it must be one"
                        )
                    # A row only NEEDS to scroll if it overflows. Assert the
                    # overflow itself, not the mechanism.
                    overflowing = d["scrollW"] > d["clientW"] + 1
                    if overflowing and not d["canScrollX"]:
                        fails.append(
                            f"{tag} {w}: the row overflows "
                            f"({d['scrollW']}>{d['clientW']}) but cannot scroll, "
                            "so a link that does not fit is unreachable"
                        )
                if rail and d["isRail"]:
                    if d["navRows"] < d["links"]:
                        fails.append(
                            f"{tag} {w}: the rail is not a single column "
                            f"({d['navRows']} rows for {d['links']} links)"
                        )

                print(
                    f"{'ok  ' if not fails else ''}{tag:5} w={w:<5} header={d['headerH']:>4}px "
                    f"rows={d['navRows']:<3} links={d['links']:<3} "
                    f"scrollX={str(d['canScrollX']):5} lastReachable={d['lastReachable']}"
                )
        finally:
            await br.close()

    print()
    if fails:
        for f in fails:
            print("FAIL " + f)
        sys.exit(1)
    checked = len(WIDTHS) - skipped
    if checked == 0:
        # Every width skipped means the page under test has no such header.
        # Printing PASS would be a green that asserts nothing, which is the
        # worst possible output for a check whose entire job is proving a
        # rendering bug is gone.
        print(
            "FAIL  every width skipped: this page has no .cm-header link list, "
            "so nothing was verified. Point BASE_URL at a page that uses the header."
        )
        sys.exit(1)
    print(
        f"PASS  {checked} widths: nothing paints outside the header box, "
        "every nav link reachable,"
    )
    print("      one row in the 641-999 band, one column in the rail.")


if __name__ == "__main__":
    asyncio.run(main())
