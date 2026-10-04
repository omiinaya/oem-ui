#!/usr/bin/env python
"""
Measure the LIVE showcase section `#proselists` in WebKit, at the widths
Omar's iPhone actually uses.

The fixture verifiers prove the DECLARATION survives a reset. This proves the
SECTION renders: that the article body the library documents is actually
present in dist/index.html, that its bullets are rendered as boxes by
WebKit (not just a computed keyword), and that the new bare-element defaults
did not leak into the library's own markerless components.

Run: /root/.venvs/mau/bin/python tests/measure-article-body-webkit.py [url]
"""
import asyncio
import sys

from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4321/"
WIDTHS = [(390, 844), (375, 812), (430, 932)]

PROBE = """() => {
  const sec = document.getElementById('proselists');
  if (!sec) return { error: 'no #proselists section in the built page' };
  const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);

  const ul = sec.querySelector('ul:not([class])');
  const ol = sec.querySelector('ol:not([class])');
  const th = sec.querySelector('table th');
  const td = sec.querySelector('table td');
  const cmRows = document.querySelector('.cm-rows');

  // Is a bullet actually PAINTED? ::marker has no box of its own in WebKit,
  // so the marker cannot be measured directly - and a computed
  // `list-style-type: disc` is a keyword, not a painted dot.
  //
  // The falsifiable measure is a DIFFERENTIAL against the one control that
  // changes the geometry. `list-style-position: outside` (the default) hangs
  // the marker in the ul's own padding, so the li's text NEVER shifts and a
  // naive "text starts right of the content edge" probe reads 0 both when
  // the bullet is painted and when it is not. Switching the list to
  // `inside` moves the marker INTO the line box, which pushes the text
  // right by exactly the marker's width - and only if there is a marker.
  //
  // So: delta = (text inset with position:inside) - (text inset with
  // position:outside). A painted bullet gives a positive delta; an absent
  // one gives 0. This cannot pass for free, which the first two attempts at
  // this assertion both did.
  const markerDelta = (() => {
    if (!ul) return null;
    const li = ul.querySelector('li');
    if (!li || !li.firstChild) return null;
    const textLeft = () => {
      const rng = document.createRange();
      rng.setStart(li.firstChild, 0);
      rng.setEnd(li.firstChild, Math.min(1, li.firstChild.length || 1));
      return rng.getBoundingClientRect().left - li.getBoundingClientRect().left;
    };
    const prev = ul.style.listStylePosition;
    ul.style.listStylePosition = 'outside';
    const outside = textLeft();
    ul.style.listStylePosition = 'inside';
    const inside = textLeft();
    ul.style.listStylePosition = prev;
    return Math.round((inside - outside) * 10) / 10;
  })();

  return {
    sectionFound: true,
    ulStyle: ul ? cs(ul, 'list-style-type') : 'n/a',
    olStyle: ol ? cs(ol, 'list-style-type') : 'n/a',
    ulIndent: ul ? cs(ul, 'padding-left') : 'n/a',
    markerDelta: markerDelta,
    thWeight: th ? cs(th, 'font-weight') : 'n/a',
    tdWeight: td ? cs(td, 'font-weight') : 'n/a',
    cmRowsMarker: cmRows ? cs(cmRows, 'list-style-type') : 'no .cm-rows on page',
  };
}"""


async def main():
    failures = 0
    measured = 0
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        for w, h in WIDTHS:
            page = await browser.new_page(viewport={"width": w, "height": h})
            await page.goto(URL, wait_until="networkidle")
            r = await page.evaluate(PROBE)
            print("=" * 72)
            print(f"WebKit {w}x{h}")
            print("=" * 72)
            if r.get("error"):
                print("  ERROR:", r["error"])
                failures += 1
                await page.close()
                continue

            for k, v in r.items():
                if k == "sectionFound":
                    continue
                print(f"  {k}: {v}")
            measured += 9

            def bad(cond, msg):
                nonlocal failures, measured
                measured += 1
                if not cond:
                    print(f"FAIL  {w}px {msg}")
                    failures += 1

            bad(r["ulStyle"] == "disc", f"section ul list-style-type is {r['ulStyle']!r}, want 'disc'")
            bad(r["olStyle"] == "decimal", f"section ol list-style-type is {r['olStyle']!r}, want 'decimal'")
            bad(r["thWeight"] == "700", f"section th font-weight is {r['thWeight']!r}, want '700'")
            bad(
                r["thWeight"] != r["tdWeight"],
                f"th and td weigh the same ({r['tdWeight']}) - the header row is not a header",
            )
            bad(
                r["cmRowsMarker"] in ("none", "no .cm-rows on page"),
                f".cm-rows picked up {r['cmRowsMarker']!r} from the bare-list default",
            )
            # Scoped to the section under test: the showcase as a whole
            # carries a PRE-EXISTING sideways scroll in other sections
            # (measured at HEAD without this cycle's change: 128px at
            # 390px, in `lists`/`states`/`tblaction`), so asserting on the
            # whole document here would fail for a defect this section
            # does not have. What matters is that the article body itself
            # does not add one, so this walks only the section's boxes.
            # (Whole-page: tests/verify-no-sideways-scroll.py.)
            wide = await page.evaluate(
                """() => {
                  const sec = document.getElementById('proselists');
                  if (!sec) return null;
                  const r = sec.getBoundingClientRect();
                  let worst = 0;
                  sec.querySelectorAll('*').forEach(el => {
                    const b = el.getBoundingClientRect();
                    if (b.right > r.right + 1) worst = Math.max(worst, b.right - r.right);
                  });
                  return Math.round(worst);
                }"""
            )
            print(f"  section overflow beyond its own box: {wide}px")
            measured += 1
            bad(wide is not None and wide <= 0, f"the section overflows its own box by {wide}px")
            # A painted bullet is the positive differential described in
            # the probe. Zero means nothing is being drawn there, whatever
            # the computed keyword says.
            bad(
                r["markerDelta"] is not None and r["markerDelta"] > 0.5,
                f"markerDelta is {r['markerDelta']}px - no bullet is painted on the li",
            )
            bad(
                r["ulIndent"] not in (None, "n/a", "0px"),
                f"the ul indent collapsed to {r['ulIndent']!r}",
            )
            await page.close()
        await browser.close()

    print("-" * 72)
    print(f"{measured} measured, {failures} failed")
    print("0 failed" if not failures else "MEASURED FAILURES ABOVE")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))