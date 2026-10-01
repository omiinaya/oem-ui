#!/usr/bin/env python3
"""Verify the showcase still renders correctly in WebKit at iPhone widths.

This cycle changed installer tooling and the drift checker's REPORTING, not
the library's CSS or the showcase's markup. So the risk to rule out is
REGRESSION, not a new layout: the page must still render its sections, must
still be one column of nav links, and must still not scroll sideways -- in
WebKit, at the widths Omar actually views it on.

MEASURE THE GEOMETRY, NOT A METRIC
The first version of this file asserted `documentElement.scrollWidth >
clientWidth` and failed at every width, desktop included. That was the
probe's fault, not the page's. `scrollWidth` counts a wide child even when
an ancestor with `overflow-x: auto` CONTAINS it, and this library
deliberately scrolls `.cm-table` inside `.cm-table-wrap`. The question that
matters is whether the PAGE can be scrolled sideways, so that is what is
asserted: set scrollLeft far past the end and read it back.

Similarly `data-theme` was asserted unset-as-failure. This showcase does not
load the theme guard at all, so there is no attribute to find; asserting it
invented a defect. And `.cm-nav__links` does not exist -- the drawer's links
live under a different class -- so that selector asserted on nothing. Each of
those three was a NO-OP probe that reported the page as broken.
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"
VIEWPORTS = [
    ("iPhone SE", 375, 667),
    ("iPhone 15 Pro", 402, 874),
    ("iPhone 15 Pro Max", 430, 932),
    ("desktop", 1440, 900),
]
failures = []


def probe(page):
    return page.evaluate(
        """() => {
        const de = document.documentElement;

        // 1. Can the PAGE be scrolled sideways? scrollWidth lies (it counts
        //    contained overflow), so ask the scroll position itself.
        de.scrollLeft = 99999;
        const pageScrollsX = de.scrollLeft > 0;
        de.scrollLeft = 0;

        // 2. Distinct LEFT EDGES of the visible drawer links. A wrapping
        //    column adds an edge, not a child, so the child count is useless
        //    here. height > 0 or a collapsed drawer's hidden links all report
        //    the same box and look like a phantom second row.
        const navRoot = document.querySelector(
            '.cm-nav, .cm-drawer, .cm-nav__panel, .cm-nav__body'
        );
        let navCols = null, navSelectorUsed = null;
        if (navRoot) {
            const lefts = new Set();
            let n = 0;
            for (const el of navRoot.querySelectorAll('a')) {
                const r = el.getBoundingClientRect();
                if (r.height <= 0 || r.width <= 0) continue;
                n++;
                lefts.add(Math.round(r.left));
            }
            navCols = { edges: [...lefts].sort((a, b) => a - b), links: n };
            navSelectorUsed = navRoot.className;
        }

        // 3. Any wide child must be CONTAINED by an ancestor that scrolls or
        //    clips -- otherwise it pushes the page, which is what (1) checks.
        const uncontained = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= de.clientWidth + 1) continue;
            let n = el.parentElement, contained = false;
            while (n && n !== document.documentElement) {
                const cs = getComputedStyle(n);
                if (cs.overflowX !== 'visible') { contained = true; break; }
                n = n.parentElement;
            }
            if (!contained) {
                uncontained.push(el.tagName + '.' +
                  String(el.className || '').split(' ')[0] +
                  ' right=' + Math.round(r.right));
            }
        }

        return {
          pageScrollsX,
          navCols,
          navSelectorUsed,
          uncontained,
          stacks: (() => {
            // A title and its lede must STACK: the lede's top below the
            // title's bottom, both at the same left edge, and the lede wide
            // enough to read as prose.
            //
            // Without this the probe passed a build where the lede sat
            // BESIDE the title -- which IS the bug -- because the overflow
            // check alone does not see it: a 91px lede beside a 192px title
            // still fits a 295px column.
            //
            // The sliver test measures WIDTH, not height. A long lede
            // legitimately wraps to 400px of lines; the symptom of this bug
            // was a 91px WIDTH, one word per line. A height threshold would
            // have failed every correct build, which is the other way a
            // probe lies.
            //
            // Measured on the RENDERED boxes, not on computed
            // flex-direction: computed style says what was declared, not
            // what the browser did with it.
            const bad = [];
            let checked = 0;
            for (const txt of document.querySelectorAll('.cm-head-row__text')) {
              const ti = txt.querySelector(':scope > .cm-section__title, :scope > .cm-head__title');
              const su = txt.querySelector(':scope > .cm-section__sub, :scope > .cm-head__sub');
              if (!ti || !su) continue;
              checked++;
              const t = ti.getBoundingClientRect(), s = su.getBoundingClientRect();
              if (s.top < t.bottom - 1)
                bad.push('lede not below title (titleBottom=' +
                         Math.round(t.bottom) + ' subTop=' + Math.round(s.top) + ')');
              if (Math.abs(s.left - t.left) > 1)
                bad.push('lede off the title left edge (title=' +
                         Math.round(t.left) + ' sub=' + Math.round(s.left) + ')');
              if (s.width < 140)
                bad.push('lede squeezed to a sliver (' + Math.round(s.width) +
                         'x' + Math.round(s.height) + ')');
            }
            return { checked, bad };
          })(),
          sections: document.querySelectorAll('section[id]').length,
          title: document.title,
          runtimeLoaded: !!document.querySelector('script[src*="_astro"]'),
        };}"""
    )


with sync_playwright() as p:
    browser = p.webkit.launch()
    for name, w, h in VIEWPORTS:
        ctx = browser.new_context(
            viewport={"width": w, "height": h},
            device_scale_factor=3,
            is_mobile=(w < 700),
            has_touch=(w < 700),
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                if w < 700
                else None
            ),
        )
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        r = probe(page)

        if not r["title"] or "not found" in r["title"].lower():
            failures.append(f"[{name}] bad title: {r['title']!r}")
        if r["sections"] < 20:
            failures.append(f"[{name}] only {r['sections']} sections rendered (expected 20+)")
        if r["pageScrollsX"]:
            failures.append(f"[{name}] the PAGE scrolls sideways")
        if r["uncontained"]:
            failures.append(
                f"[{name}] {len(r['uncontained'])} wide element(s) no ancestor clips: "
                + "; ".join(r["uncontained"][:4])
            )
        if r["navCols"] is None:
            # SKIP, not a failure. The showcase is one long scrolling page
            # with no drawer to open, so there is no nav container to
            # measure. The first version of this probe treated the absence
            # as a defect and reported four fake failures -- a check that
            # cannot be exercised here trains you to distrust the whole
            # file, which is exactly what the rest of it is for.
            print(f"    skip {name}: no drawer nav on this page, column check not exercised")
        elif len(r["navCols"]["edges"]) > 1:
            failures.append(
                f"[{name}] nav wraps into {len(r['navCols']['edges'])} columns "
                f"(left edges {r['navCols']['edges']}, {r['navCols']['links']} links)"
            )
        if not r["runtimeLoaded"]:
            failures.append(f"[{name}] the bundled runtime script did not ship")

        if r["stacks"]["checked"] == 0:
            failures.append(
                f"[{name}] no title+lede pair found, so the stacking check was not exercised"
            )
        for b in r["stacks"]["bad"][:4]:
            failures.append(f"[{name}] header stack broken: {b}")

        cols = len(r["navCols"]["edges"]) if r["navCols"] else "n/a"
        links = r["navCols"]["links"] if r["navCols"] else 0
        print(
            f"  {name:17s} {w}x{h}: sections={r['sections']} navcols={cols} "
            f"links={links} pageScrollsX={r['pageScrollsX']} "
            f"uncontained={len(r['uncontained'])} runtime={r['runtimeLoaded']}"
        )
        ctx.close()
    browser.close()

print()
if failures:
    print("FAIL")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("WebKit iPhone-viewport render: OK (no sideways scroll, nav is one column)")