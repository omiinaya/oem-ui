#!/usr/bin/env python3
"""
Final WebKit verification of the sideways-scroll fix.

Omar reads these on an iPhone in Safari, so the engine is WebKit and the
widths that matter are 390 and 375. Chromium is measured too, only to
record that the two agree here.

The question is behavioural, not a metric: can the user actually scroll
the page sideways? `documentElement.scrollWidth` can read wider than the
viewport without that being reachable, so each width scrolls to the far
right and reads scrollX back.
"""
import os
import tempfile

SCRATCH = os.environ.get('OEM_UI_SCRATCH', tempfile.gettempdir())
import json
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('OEM_UI_URL', 'http://localhost:4321/')
WIDTHS = (390, 375, 320, 1440)

PROBE = """
async () => {
  const de = document.documentElement;
  const before = window.scrollX;
  window.scrollTo(9999, 0);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = window.scrollX;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 150));

  // the header must still stick: `overflow-x: clip` not `hidden`
  const h = document.querySelector('.cm-header');
  window.scrollTo(0, 1500);
  await new Promise(r => setTimeout(r, 250));
  const headerSticks = h ? Math.abs(h.getBoundingClientRect().top) < 2 : null;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 150));

  // every tooltip tip, forced visible, inside the viewport?
  let tipsOutside = 0, tallest = 0;
  document.querySelectorAll('.cm-tooltip__tip').forEach(t => {
    const was = t.style.cssText;
    t.style.opacity = '1'; t.style.visibility = 'visible'; t.style.pointerEvents = 'none';
    const r = t.getBoundingClientRect();
    if (r.right > window.innerWidth + 1 || r.left < -1) tipsOutside++;
    tallest = Math.max(tallest, Math.round(r.height));
    t.style.cssText = was;
  });

  const ph = document.querySelector('.cm-post-head');
  const pr = ph ? ph.getBoundingClientRect() : null;

  let subFloor = 0;
  document.querySelectorAll('main *').forEach(e => {
    if (parseFloat(getComputedStyle(e).fontSize) < 12) subFloor++;
  });

  return {
    sidewaysScroll: after - before,
    scrollW: de.scrollWidth, clientW: de.clientWidth,
    headerSticks, tipsOutside, tallestTip: tallest,
    postHeadH: pr ? Math.round(pr.height) : null,
    postHeadRule: ph ? getComputedStyle(ph).borderBottomWidth : null,
    subFloor,
  };
}
"""


def run(engine, width, mobile):
    b = engine.launch()
    ctx = b.new_context(
        viewport={"width": width, "height": 844},
        device_scale_factor=3,
        is_mobile=mobile,
        has_touch=mobile,
    )
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    d = pg.evaluate(PROBE)
    d["jsErrors"] = errs
    if width == 390:
        # DSF 3 on an ~11000px page exceeds WebKit's 32767px limit
        pg.screenshot(path=f"{SCRATCH}/final-390.png", full_page=True, scale="css")
    ctx.close()
    b.close()
    return d


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        out = {}
        for w in WIDTHS:
            out[f"webkit-{w}"] = run(p.webkit, w, w < 500)
        for w in (390, 375):
            out[f"chromium-{w}"] = run(p.chromium, w, w < 500)
    print(json.dumps(out, indent=1))

    # The 12px floor is a MOBILE floor: --min-font is 12px and the
    # flooring rule is inside a coarse-pointer / narrow-viewport media
    # query, so at desktop widths a .cm-kicker measuring 11.5px is by
    # design, not a violation. Only the phone widths are asserted.
    #
    # 320 IS asserted now. It used to be a printed KNOWN: a tip is
    # `width: max-content`, and whether it fits depends on where its
    # TRIGGER sits, which CSS cannot read — so the edge-anchored
    # variants ran past the viewport and scrolled the page sideways
    # (measured 52px at 360, 92px at 320). The runtime now clamps a tip
    # to the room its anchor leaves, and the check below is what stops
    # that regressing. A KNOWN line that is never asserted is a silent
    # skip, which is worse than a failing test.
    fails = []
    for w in (390, 375, 320):
        d = out[f"webkit-{w}"]
        if d["sidewaysScroll"] != 0:
            fails.append(f"webkit {w} still scrolls sideways by {d['sidewaysScroll']}px")
        if d["tipsOutside"]:
            fails.append(f"webkit {w}: {d['tipsOutside']} tip(s) outside the viewport")
        if not d["headerSticks"]:
            fails.append(f"webkit {w}: the sticky header stopped sticking")
        if d["subFloor"]:
            fails.append(f"webkit {w}: {d['subFloor']} element(s) under the 12px floor")
        if d["jsErrors"]:
            fails.append(f"webkit {w}: {len(d['jsErrors'])} JS error(s)")
    d = out["webkit-1440"]
    if d["sidewaysScroll"] != 0:
        fails.append(f"desktop 1440 scrolls sideways by {d['sidewaysScroll']}px")

    print()
    if fails:
        for f in fails:
            print("FAIL " + f)
        sys.exit(1)
    print("PASS  0 sideways scroll at 390/375/320/1440, 0 tips outside, header")
    print("      sticky, 0 sub-12px on the phone widths, 0 JS errors")
    print("      (desktop shows %d sub-12px elements, which is the floor being" % out["webkit-1440"]["subFloor"])
    print("       mobile-scoped by design: --min-font is 12px, not 16px)")



if __name__ == "__main__":
    main()
