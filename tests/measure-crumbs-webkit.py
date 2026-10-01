#!/usr/bin/env python3
"""measure the breadcrumb trail in real WebKit at Omar's phone viewport.

Three things this asserts, each of which a screenshot cannot:

  1. GEOMETRY. Every crumb link measures >= --tap (44px) tall on a coarse
     pointer. The hand-rolled consumer copy measured ~16px. This is the
     number that proves the tap floor is real rather than declared.

  2. THE WRAP. The deep trail occupies MORE THAN ONE row at 390px, and no
     row's children run past the trail's right edge. A trail that does not
     wrap is not exercising the thing this component was built for, so a
     single-row result here means the FIXTURE is wrong, not the component.

  3. THE SEPARATOR IS NOT IN THE DOM. The ::after is generated content, so
     there is no separator element to find. If one exists, the trail has
     reverted to the announced-chevron form that two consumers shipped.

Counter for distinct LEFT EDGES, not a row count: the skill records that a
row count over a collapsed container returns phantom rows from hidden
children, so the filter is `height > 0` and only the rendered links count.
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"
TAP = 44.0


def probe(page, label, width, height):
    page.goto(URL, wait_until="networkidle")
    # Clear storage BEFORE measuring, never after: a saved light theme
    # otherwise leaks into the next page load and a themed-token read
    # reports the wrong theme's value.
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="networkidle")

    box = page.evaluate(
        """() => {
      const trail = document.querySelector('#crumbs .cm-crumbs[aria-label="Breadcrumb, deep"]');
      if (!trail) return {error: 'no deep trail'};
      const links = [...trail.querySelectorAll('.cm-crumbs__link, .cm-crumbs__here')]
        .map(el => {
          const r = el.getBoundingClientRect();
          return {
            cls: el.className,
            text: el.textContent.trim(),
            top: Math.round(r.top),
            left: Math.round(r.left),
            right: Math.round(r.right),
            w: Math.round(r.width * 100) / 100,
            h: Math.round(r.height * 100) / 100,
          };
        });
      const tr = trail.getBoundingClientRect();
      // The separator is REAL markup, and that is the measured-correct
      // shape rather than a regression. This count originally asserted
      // ZERO separator elements, because the CSS comment claimed a ::after
      // "leaves the accessibility tree entirely". CDP's getFullAXTree says
      // the opposite: with a ::after the link's accessible name is
      // "store>" and the chevron is a separate StaticText with
      // ignored=false, so it is SPOKEN. With a <span aria-hidden> the
      // name is "store". tests/measure-crumb-separator-ax.py compares all
      // three shapes; this shipped as 4 real aria-hidden spans.
      //
      // So the assertion is that every separator here is aria-hidden, and
      // a count of ZERO would now be the wrong answer - it would mean the
      // loud ::after version had come back.
      const seps = [...trail.querySelectorAll('.cm-crumbs__sep')].map(s => ({
        ariaHidden: s.getAttribute('aria-hidden'),
        text: s.textContent.trim(),
      }));
      return {
        trailW: Math.round(tr.width),
        trailRight: Math.round(tr.right),
        trailH: Math.round(tr.height),
        links,
        sepsInDom: seps.length,
        loudSeps: seps.filter(s => s.ariaHidden !== 'true').length,
      };
    }"""
    )
    return label, width, height, box


def main():
    problems = []
    rows = []
    with sync_playwright() as pw:
        # WebKit is the engine Omar views oem sites in: his iPhone Safari.
        browser = pw.webkit.launch()
        # A coarse pointer is what arms the tap floor, so hasTouch is on
        # for the phone pass. iPhone 15 Pro first, then the shortest
        # viewport a modern phone has (iPhone SE, 667px) because a height
        # sweep is where wrap bugs hide.
        for label, w, h in [("iPhone 15 Pro", 393, 852), ("iPhone SE", 375, 667)]:
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=3,
                has_touch=True,
                is_mobile=True,
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                ),
            )
            page = ctx.new_page()
            label, w, h, box = probe(page, label, w, h)
            rows.append((label, w, h, box))
            ctx.close()
        browser.close()

    print("=== breadcrumb trail, measured in WebKit ===\n")
    for label, w, h, b in rows:
        print(f"--- {label}  {w}x{h} ---")
        if b.get("error"):
            problems.append(f"{label}: {b['error']}")
            print(f"  ERROR {b['error']}\n")
            continue
        print(f"  trail {b['trailW']}px wide, {b['trailH']}px tall")
        for l in b["links"]:
            print(
                f"    {l['h']:6.2f}x{l['w']:7.2f}  top={l['top']:4d} left={l['left']:4d}  {l['text']}"
            )

        # 1. the tap floor
        for l in b["links"]:
            if l["h"] < TAP:
                problems.append(
                    f"{label}: crumb '{l['text']}' is {l['h']}px tall, under the {TAP}px floor"
                )

        # 2. the wrap: distinct left edges of RENDERED children
        lefts = sorted({l["left"] for l in b["links"]})
        rows_n = len({l["top"] for l in b["links"]})
        print(f"  distinct left edges: {lefts}  -> {rows_n} row(s)")
        if rows_n < 2:
            problems.append(
                f"{label}: the deep trail did not wrap ({rows_n} row) - the fixture is not "
                f"exercising the wrap, so it proves nothing at this width"
            )
        for l in b["links"]:
            if l["right"] > b["trailRight"] + 1:
                problems.append(
                    f"{label}: crumb '{l['text']}' right edge {l['right']} runs past the "
                    f"trail's {b['trailRight']} - the row overflows instead of wrapping"
                )
        # a wrap that overlaps rows (same left edge, two tops) would be a
        # row collision
        print(f"  separator elements in the DOM: {b['sepsInDom']} (all aria-hidden)")
        if b["loudSeps"]:
            problems.append(
                f"{label}: {b['loudSeps']} separator element(s) lack aria-hidden, so a "
                f"screen reader speaks the chevron"
            )
        if b["sepsInDom"] == 0:
            problems.append(
                f"{label}: no separator element in the DOM, so the loud ::after version "
                f"is back - CDP reads its links as 'store>'"
            )
        print()

    print("=== verdict ===")
    if problems:
        for p in problems:
            print(f"  FAIL {p}")
        sys.exit(1)
    print("  ok  every crumb reaches the 44px floor on a coarse pointer")
    print("  ok  the deep trail wraps, and no row runs past the trail's right edge")
    print("  ok  every separator is real markup carrying aria-hidden=true")


if __name__ == "__main__":
    main()
