'''

Why this file exists
--------------------
Omar: "some items don't appear to be spaced correctly... many cases where
sections are mashed together and there's no padding or margins or anything
to divide them."

Measured across every consumer at 390px, ALL FIVE put content flush against
the page head at exactly 0.0px:

    oem-ui          .cm-head      -> .cm-status        0.0px
    oem-portfolio   .cm-head      -> p.lede            0.0px
    dev-blog        .cm-head      -> .cm-status        0.0px
    links           .cm-head      -> .cm-status        0.0px
    log.oem.ngo     .cm-head      -> .cm-status        0.0px

One cause, five sites: `.cm-head` set no bottom margin, and no component
owned the space between two top-level blocks. The --space-N scale was
enforced everywhere and still produced this, because a scale says which
sizes EXIST. Nothing said which one goes WHERE, so each project invented
its own number. That is the mismatch.

The fix is `.cm-stack`: a column whose `gap` applies BETWEEN siblings, so
one declaration sets the rhythm and adding a child can never produce a
0px join. This file is what keeps it honest - it fails if any two direct
children of <main> are separated by anything other than the stack gap.

Env: BASE_URL, WIDTHS
'''

import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://192.168.1.68:4321/")
WIDTHS = [
    int(x) for x in os.environ.get("WIDTHS", "320,390,402,768,1280").split(",")
]
# Half a pixel of slack: layout is subpixel, and a rounding hair is not a
# second rhythm value.
TOL = 0.5

PROBE = r"""() => {
  const de = document.documentElement;
  de.style.scrollBehavior = 'auto';
  const main = document.querySelector('main');
  if (!main) return { error: 'no <main>' };
  const cs = getComputedStyle(main);
  const isStack = cs.display === 'flex' && cs.gap !== 'normal' && parseFloat(cs.gap) > 0;

  const visible = (e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    // sticky counts as out of flow too. A sticky child's box is pinned to
    // the viewport while its slot in the document is 12000px away, so
    // measuring the gap between it and its neighbour produced -14238px and
    // read as a rhythm failure. It is not one: the showcase has a sticky
    // cm-toolbar on purpose, and excluding `sticky` alongside absolute and
    // fixed is what "participates in the document flow" actually means.
    if (s.position === 'absolute' || s.position === 'fixed' ||
        s.position === 'sticky') return false;
    return e.getBoundingClientRect().height > 0;
  };

  // Only children that are ADJACENT in the DOM can be measured against
  // each other. Skipping a sticky child makes its neighbours adjacent in
  // the filtered list but not in the document, and the gap between them
  // then includes the sticky child's whole height (measured 102-222px).
  const all = [...main.children];
  const joins = [];
  for (let i = 1; i < all.length; i++) {
    if (!visible(all[i - 1]) || !visible(all[i])) continue;
    const a = all[i - 1].getBoundingClientRect();
    const b = all[i].getBoundingClientRect();
    joins.push({
      from: all[i - 1].tagName.toLowerCase() + '.' +
            String(all[i - 1].className || '').trim().split(/\s+/)[0],
      to: all[i].tagName.toLowerCase() + '.' +
         String(all[i].className || '').trim().split(/\s+/)[0],
      // a negative value means the children OVERLAP, which is worse than
      // a 0 gap and must fail too.
      gap: Math.round((b.top - a.bottom) * 10) / 10,
      inline: all[i - 1].getAttribute('style') || '',
    });
  }
  return {
    isStack,
    display: cs.display,
    gap: cs.gap,
    stackSection: getComputedStyle(de).getPropertyValue('--stack-section').trim(),
    children: all.filter(visible).length,
    joins,
  };
}"""


async def run(p, url, width):
    # NOTE: do NOT pass is_mobile=True. Measured: with is_mobile the page's
    # stylesheet loads (643 rules present in document.styleSheets) but NONE
    # of it applies - computed body font falls back to `-webkit-standard`
    # and body background to transparent, i.e. the UA default. That is a
    # WebKit-under-Playwright emulation defect, not a page defect, and it
    # silently turns every assertion here into a measurement of nothing.
    #
    # has_touch and device_scale_factor are both fine and are kept: the
    # phone behaviour this file cares about (widths, stacking) does not
    # depend on the mobile viewport flag.
    ctx = await p.new_context(
        viewport={"width": width, "height": 900},
        device_scale_factor=2,
        has_touch=width < 700,
    )
    pg = await ctx.new_page()
    await pg.goto(url, wait_until="networkidle", timeout=60000)
    d = await pg.evaluate(PROBE)
    await ctx.close()
    return d


async def main():
    fails = []
    async with async_playwright() as pw:
        b = await pw.webkit.launch()
        for w in WIDTHS:
            d = await run(b, BASE, w)
            if "error" in d:
                fails.append(f"  {w}px: {d['error']}")
                continue
            if not d["isStack"]:
                fails.append(
                    f"  {w}px: <main> is not a stack (display={d['display']}, "
                    f"gap={d['gap']}). The page has no owner for the space "
                    f"between its blocks, so any project can drift again."
                )
                continue
            want = float(d["gap"].replace("px", ""))
            bad = [j for j in d["joins"] if abs(j["gap"] - want) > TOL]
            if bad:
                fails.append(
                    f"  {w}px: {len(bad)}/{len(d['joins'])} joins are not the "
                    f"{want}px rhythm: "
                    + "; ".join(f"{j['gap']}px {j['from']}->{j['to']}"
                                + (f" [inline {j['inline'][:40]}]"
                                   if j["inline"] else "")
                                for j in bad[:4])
                )
            else:
                print(f"  ok   {w}px  {len(d['joins'])} joins, all {want}px")
        await b.close()

    if fails:
        print("\n".join(fails))
        print(f"\nFAIL: {len(fails)} vertical-rhythm failures")
        return 1
    print(f"\nPASS: every top-level block is separated by the stack gap "
          f"({', '.join(str(w) + 'px' for w in WIDTHS)})")
    return 0


sys.exit(asyncio.run(main()))
