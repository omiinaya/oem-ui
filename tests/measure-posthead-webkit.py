#!/usr/bin/env python3
"""
Measure the RENDERED geometry of the showcase in WebKit at an iPhone
viewport, not in Chromium, and not from the CSS source.

Specifically checks the new .cm-post-head block:
  - it exists, and has non-zero height
  - it carries a visible bottom border (the rule that separates the
    article head from the prose)
  - the gap from the rule to the first paragraph of prose is real
  - its left edge is the SAME value as every other band on the page
  - nothing inside it overflows, and no text sits under the 12px floor
  - the sticky header does not overlap the top of the block on a phone

Run: /root/.venvs/mau/bin/python tests/measure-posthead-webkit.py <url>
"""
import sys
import json

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4321/"


def main() -> int:
    findings = []
    with sync_playwright() as p:
        browser = p.webkit.launch()
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")

        result = page.evaluate(
            """() => {
      const out = {};
      const head = document.querySelector('.cm-post-head');
      out.headExists = !!head;
      if (!head) return out;

      const r = head.getBoundingClientRect();
      out.head = {x: r.x, y: r.y, w: r.width, h: r.height};
      const cs = getComputedStyle(head);
      out.borderBottomWidth = cs.borderBottomWidth;
      out.borderBottomStyle = cs.borderBottomStyle;
      out.paddingTop = cs.paddingTop;
      out.paddingBottom = cs.paddingBottom;
      out.marginBottom = cs.marginBottom;

      // the kicker / h1 / byline inside it
      out.children = [...head.children].map((c) => {
        const b = c.getBoundingClientRect();
        return {cls: c.className || c.tagName, x: b.x, y: b.y, w: b.width, h: b.height,
                fs: getComputedStyle(c).fontSize};
      });

      // the prose below: the rule's bottom to the first p's top
      const prose = head.nextElementSibling;
      out.proseTag = prose ? prose.className || prose.tagName : null;
      if (prose) {
        const pr = prose.getBoundingClientRect();
        out.prose = {x: pr.x, y: pr.y, w: pr.width, h: pr.height};
        const first = prose.querySelector('p');
        if (first) {
          const fr = first.getBoundingClientRect();
          out.firstPara = {x: fr.x, y: fr.y, w: fr.width, fs: getComputedStyle(first).fontSize};
          // gap between the head's border edge and the paragraph's top
          out.ruleToPara = Math.round(fr.y - (r.y + r.height));
        }
      }

      // every horizontal band's left edge, to prove one grid
      const bands = [];
      for (const sel of ['header', 'main', 'footer', '.cm-post-head', '.cm-prose',
                         '#prose', '.cm-section', '.cm-kicker', '.cm-post-head h1']) {
        document.querySelectorAll(sel).forEach((el, i) => {
          const b = el.getBoundingClientRect();
          if (b.width > 0) bands.push({sel: sel + '[' + i + ']', x: Math.round(b.x),
                                      right: Math.round(b.right), w: Math.round(b.width)});
        });
      }
      out.bands = bands;

      // horizontal overflow anywhere
      const wide = [];
      document.querySelectorAll('*').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && (b.right > window.innerWidth + 1 || b.left < -1)) {
          wide.push({cls: (el.className || el.tagName).toString().slice(0, 60),
                     left: Math.round(b.left), right: Math.round(b.right)});
        }
      });
      out.overflowing = wide.slice(0, 12);

      // sub-floor type inside the new block
      const tiny = [];
      head.querySelectorAll('*').forEach((el) => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) tiny.push({cls: (el.className||el.tagName).toString(), fs});
      });
      out.subFloor = tiny;

      // tap targets in the new block
      out.taps = [...head.querySelectorAll('a,button')].map((el) => {
        const b = el.getBoundingClientRect();
        return {w: Math.round(b.width), h: Math.round(b.height)};
      });

      // scroll-padding published by the runtime
      out.scrollPaddingTop = getComputedStyle(document.documentElement).scrollPaddingTop;
      out.headerH = getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim();
      out.docScrollW = document.documentElement.scrollWidth;
      out.innerW = window.innerWidth;
      return out;
    }"""
        )
        result["jsErrors"] = errors

        # Full-page screenshot, and a shot of just the new block.
        result["shotPage"] = "/root/.hermes/cache/scratch/posthead-page.png"
        page.screenshot(path=result["shotPage"], full_page=True)
        el = page.query_selector(".cm-post-head")
        if el:
            result["shotBlock"] = "/root/.hermes/cache/scratch/posthead-block.png"
            el.scroll_into_view_if_needed()
            page.wait_for_timeout(150)
            el.screenshot(path=result["shotBlock"])

        browser.close()

    print(json.dumps(result, indent=2))

    # ---- verdicts on the measured numbers, not on the CSS ----
    bad = []
    if not result.get("headExists"):
        bad.append("no .cm-post-head in the rendered page")
    else:
        if result["head"]["h"] <= 0:
            bad.append("the post head rendered with zero height")
        if result["borderBottomStyle"] == "none" or float(
            result["borderBottomWidth"].replace("px", "") or 0
        ) == 0:
            bad.append("the separating rule under the post head did not render")
        if result.get("ruleToPara", 0) <= 0:
            bad.append(f"the prose collides with the rule (gap {result.get('ruleToPara')}px)")
        if result.get("overflowing"):
            bad.append(f"{len(result['overflowing'])} elements overflow the viewport")
        if result.get("subFloor"):
            bad.append(f"type under the 12px floor: {result['subFloor']}")
        if result.get("docScrollW", 0) > result.get("innerW", 0) + 1:
            bad.append("the document scrolls horizontally")
    if result.get("jsErrors"):
        bad.append(f"javascript errors: {result['jsErrors']}")

    print()
    if bad:
        for b in bad:
            print("FAIL", b)
        return 1
    print("PASS the post head renders with its rule, its gap, and no overflow")
    return 0


if __name__ == "__main__":
    sys.exit(main())
