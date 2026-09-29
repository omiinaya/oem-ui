#!/usr/bin/env python3
"""
WebKit proof that the oem-portfolio migration did not break the page.

The migration deleted five consumer rules and three class names. Deleting
CSS never fails a build, so the only question that matters is whether the
certs list still renders as TWO COLUMNS from the library's own
`display: contents` pair wrapper - and it has to be checked at a DESKTOP
width, because below 520px `.cm-kv` stacks to one column and the two
layouts are pixel-identical there.

This is the consumer-side twin of verify-kv-link-webkit.py: that one
proves the new variant works, this one proves the cleanup did not cost
the existing page its layout.
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4391/certs/"

JS = """
() => {
  const dl = document.querySelector('.certs-notes .cm-kv');
  if (!dl) return { error: 'no .certs-notes .cm-kv on the page' };

  const pairs = [...dl.querySelectorAll('div')];
  const rows = pairs.map((d) => {
    const dt = d.querySelector('dt');
    const dd = d.querySelector('dd');
    const dr = dt.getBoundingClientRect();
    const vr = dd.getBoundingClientRect();
    return {
      term: dt.textContent.trim().slice(0, 22),
      // the wrapper must have generated NO box, or the grid collapsed to
      // one column of stacked pairs
      wrapperWidth: +d.getBoundingClientRect().width.toFixed(2),
      indent: +(vr.left - dr.left).toFixed(2),
      sameRow: Math.abs(dr.top - vr.top) < 2,
      // the wrapper carries no class of its own any more
      wrapperClasses: d.className,
    };
  });

  // and the retired names must be gone from the MARKUP, not just the CSS
  const used = new Set();
  for (const el of document.querySelectorAll('[class]')) {
    for (const c of el.className.split(/\\s+/)) if (c) used.add(c);
  }
  return {
    rows,
    count: rows.length,
    retiredInMarkup: [...used].filter((c) => c.startsWith('cm-kv__')),
  };
}
"""


def main() -> int:
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        fails = []

        # --- desktop: the ONLY width that can see a collapsed grid -----
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(URL, wait_until="networkidle")
        print("page title:", pg.title())
        # A server answering on the right port is NOT proof of the right
        # server: a stale preview was squatting on 4390 this cycle and
        # the probe would have measured a neighbour. The title is the
        # cheapest proof that what is on the wire is the site under test.
        if "oem/work" not in pg.title():
            print("FAIL: this is not oem-portfolio, so every measurement "
                  "below would describe a different site")
            return 1

        d = pg.evaluate(JS)
        if "error" in d:
            print("FAIL:", d["error"])
            return 1
        print(f"\n  desktop 1280x900 - {d['count']} pairs")
        for r in d["rows"]:
            print("   ", json.dumps(r))
            if not r["sameRow"]:
                fails.append(f"'{r['term']}': term and value are stacked - the two-column grid collapsed")
            if r["indent"] <= 0:
                fails.append(f"'{r['term']}': value starts at the term's left edge - one column, not two")
            if r["wrapperClasses"].strip():
                fails.append(f"'{r['term']}': wrapper still carries a class ({r['wrapperClasses']}) - the display:contents rule keys off the element, not the class")
        ctx.close()

        # --- phone: the two shapes are identical here, so this only
        #     proves the list did not disappear in the stack ----------
        ctx2 = b.new_context(viewport={"width": 390, "height": 844},
                             device_scale_factor=3, is_mobile=True, has_touch=True)
        pg2 = ctx2.new_page()
        pg2.goto(URL, wait_until="networkidle")
        d2 = pg2.evaluate(JS)
        print(f"\n  iPhone 390x844 - {d2['count']} pairs")
        if d2["count"] != d["count"]:
            fails.append(f"pair count changed between widths: {d['count']} desktop vs {d2['count']} phone")
        if d2["retiredInMarkup"]:
            fails.append(f"retired classes still in the BUILT markup: {', '.join(d2['retiredInMarkup'])}")
        ctx2.close()
        b.close()

    print()
    if fails:
        print("FAIL:")
        for f in sorted(set(fails)):
            print("  -", f)
        return 1
    print("PASS: two columns hold at 1280 from the library's own pair "
          "wrapper, and the retired classes are gone from the built page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
