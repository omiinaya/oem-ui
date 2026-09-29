#!/usr/bin/env python3
"""
WebKit measurement of .cm-kv--link, at the viewport Omar actually uses.

The contract is a TAP TARGET, so this measures the box. A source-level
assertion cannot see a 14px-tall row, and Chromium is not the engine
Omar reads on - it has lied about layout in this repo before.

Three things have to hold, and each is a different way to be wrong:

  1. the row reaches --tap (44px) in BOTH dimensions, from the token
  2. the term and the value are still TWO COLUMNS at a desktop width -
     a block link collapses them, and at 390px the base media query
     already stacks the grid, so the phone proves nothing here. This is
     the same "the check that catches it is DESKTOP" trap as .cm-kv.
  3. tapping the GAP between term and value hits the ROW, not a hole -
     elementFromPoint is the behavioural question, and it is the only
     one that distinguishes "the row is 44px" from "the row is 44px and
     so is the gap beside it".
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"

JS = """
() => {
  const rows = [...document.querySelectorAll('.cm-kv--link a')];
  if (!rows.length) return { error: 'no .cm-kv--link row on the page' };

  // elementFromPoint resolves against the VIEWPORT, so a row at y=12908
  // on a 900px-tall window returns null for every sample and the probe
  // reports a hole where there is only off-screen geometry. The first
  // version did exactly that and looked like a real failure.
  //
  // `scroll-behavior: smooth` makes scrollIntoView ANIMATE, so measuring
  // in the same tick as the scroll reads the pre-scroll geometry - the
  // rows came back at exactly their old offsets and `inView` was false
  // for all three. The second version fixed that and then reported PASS
  // while having measured nothing, because the gap assertion was guarded
  // by `inView &&` and so silently never ran. So the scroll is forced to
  // be instant, AND the caller is required to prove it measured
  // something before it is allowed to pass.
  document.documentElement.style.scrollBehavior = 'auto';
  const first = rows[0];
  first.scrollIntoView({ block: 'center', behavior: 'instant' });
  // `block: 'center'` is a REQUEST. When the document cannot scroll far
  // enough to centre the element, the browser clamps - and here it
  // clamped to put the row's top exactly at the viewport edge (900.5 on
  // a 900px window), so the row was off-screen and the gap probe
  // measured nothing. The honesty gate caught it, which is what the gate
  // is for. Scroll by an explicit amount and clamp it instead.
  const r0 = first.getBoundingClientRect();
  if (r0.top < 0 || r0.bottom > window.innerHeight) {
    window.scrollBy({ top: r0.top - (window.innerHeight - r0.height) / 2, behavior: 'instant' });
  }

  const out = rows.map((a) => {
    const r = a.getBoundingClientRect();
    const dt = a.querySelector('dt');
    const dd = a.querySelector('dd');
    const dr = dt.getBoundingClientRect();
    const vr = dd.getBoundingClientRect();

    // the behavioural question: is the GAP between the two columns a
    // target? Sample a point midway across, at the row's vertical centre.
    const gapX = (dr.right + vr.left) / 2;
    const gapY = (r.top + r.bottom) / 2;
    const inView = gapY >= 0 && gapY <= window.innerHeight;
    const hit = inView ? document.elementFromPoint(gapX, gapY) : null;
    const hitIsRow = !!hit && (hit === a || a.contains(hit));

    return {
      w: +r.width.toFixed(2),
      h: +r.height.toFixed(2),
      // two columns => the value does NOT start where the term starts
      columns: +(vr.left - dr.left).toFixed(2),
      dtTop: +dr.top.toFixed(2), ddTop: +vr.top.toFixed(2),
      // a single-column stack puts them on different rows; a broken
      // grid (wrapper left as a grid item) does the same
      sameRow: Math.abs(dr.top - vr.top) < 2,
      gapHitRow: hitIsRow,
      gapHitTag: hit ? (hit.tagName + '.' + (hit.className || '')) : null,
      inView,
    };
  });
  return { rows: out, count: rows.length };
}
"""


def main() -> int:
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        fails = []
        measured = []
        phone_rows = []
        desk_rows = []

        # --- the phone: the tap floor, which is the whole point -------
        ctx = b.new_context(viewport={"width": 390, "height": 844},
                            device_scale_factor=3, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.goto(URL, wait_until="networkidle")
        print("page title:", pg.title())

        d = pg.evaluate(JS)
        if "error" in d:
            print("FAIL:", d["error"])
            return 1
        phone_rows = d["rows"]
        print(f"\n  iPhone 390x844 - {d['count']} rows")
        for r in d["rows"]:
            print("   ", json.dumps(r))
            measured.append(r)
            # 1. the floor, in BOTH dimensions
            if r["h"] < 44:
                fails.append(f"row is {r['h']}px tall - under the 44px floor")
            if r["w"] < 44:
                fails.append(f"row is {r['w']}px wide - under the 44px floor")
            # 3. the gap is part of the target - but ONLY where the row
            #    is on screen. elementFromPoint has no answer for a row
            #    below the fold, and demanding one turns an off-screen
            #    row into a phantom failure. `inView` is recorded so the
            #    difference between "no target" and "not measurable" is
            #    visible in the output rather than guessed at.
            if r["inView"] and not r["gapHitRow"]:
                fails.append(f"the gap between term and value is a hole (hit {r['gapHitTag']})")
        ctx.close()

        # --- the desktop: the two columns, which a phone cannot see ---
        ctx2 = b.new_context(viewport={"width": 1280, "height": 900})
        pg2 = ctx2.new_page()
        pg2.goto(URL, wait_until="networkidle")
        d2 = pg2.evaluate(JS)
        desk_rows = d2["rows"]
        print(f"\n  desktop 1280x900 - {d2['count']} rows")
        for r in d2["rows"]:
            print("   ", json.dumps(r))
            measured.append(r)
            # 2. the columns must be side by side here
            if not r["sameRow"]:
                fails.append(f"at 1280 the term and value are stacked (dt top {r['dtTop']}, dd top {r['ddTop']}) - the grid collapsed")
            if r["columns"] <= 0:
                fails.append(f"at 1280 the value starts at the term's left edge - one column, not two")
        ctx2.close()
        b.close()

    print()
    # HONESTY GATE. Three claims are made in the PASS line and each needs
    # evidence. A guard that skips its own assertion when a condition is
    # unmet reports green while measuring nothing, which is worse than a
    # red suite: it reads as coverage. So the run FAILS unless at least
    # one row was actually on screen in each context.
    phone_measurable = any(r["inView"] for r in phone_rows)
    desk_measurable = any(r["inView"] for r in desk_rows)
    if not phone_measurable:
        fails.append("iPhone: no row was on screen, so the gap was never probed - "
                     "a PASS here would be measuring nothing")
    if not desk_measurable:
        fails.append("desktop: no row was on screen, so the gap was never probed - "
                     "a PASS here would be measuring nothing")

    if fails:
        print("FAIL:")
        for f in sorted(set(fails)):
            print("  -", f)
        return 1
    print("PASS: floor reached in both dimensions, gap is a target, "
          "two columns hold at 1280")
    return 0


if __name__ == "__main__":
    sys.exit(main())
