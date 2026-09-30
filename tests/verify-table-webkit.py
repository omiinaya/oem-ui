#!/usr/bin/env python3
"""Verify the log table in real WebKit at phone widths.

The claims are GEOMETRY claims, so a text assertion on components.css
cannot establish any of them. This measures the rendered result:

  1. the page never grows sideways. A wide log must scroll inside its
     own wrapper; if the wrapper loses `overflow-x`, the whole UI drifts
     horizontally on a phone and every other number here is meaningless.
  2. the wrapper is a real VERTICAL scrollport. `overflow-x: auto`
     computes `overflow-y` to `auto` too (CSS overflow rule - only
     `visible` is forced to the other axis), so the wrapper is the
     scrollport `th` is sticky against. A header therefore only stays
     put if the wrapper can actually scroll vertically, which needs a
     max-height AND content taller than that cap. Asserting
     `position: sticky` alone passes on a header that visibly rides the
     page - measured: 27px of page scroll, 27px of header drift.
  3. the header holds while the WRAPPER scrolls - drift in
     getBoundingClientRect().top across a known wrapper scroll.
  4. the columns do not double up: distinct left edges == cell count.

Scrolling the WRAPPER, not the page, is the whole point. The header is
sticky to the wrapper, so a page-scroll test measures the wrong
scrollport and reports a false failure - that is what this file did
before the max-height landed.
"""
import asyncio, sys
from playwright.async_api import async_playwright

URL = "http://192.168.1.68:4321/"
IPHONE = {"iPhone 15 Pro": (393, 852), "iPhone SE": (375, 667)}


async def probe(pg, w, h):
    await pg.set_viewport_size({"width": w, "height": h})
    await pg.wait_for_timeout(350)
    return await pg.evaluate("""() => {
      const de = document.documentElement;
      // The LOG table specifically. The page carries more than one, and
      // reading the first `.cm-table-wrap` measures an unrelated
      // 4-column specimen - which reports 10 left edges for 7 columns
      // and looks like the wrap-as-second-column bug.
      const wrap = document.querySelector('#table .cm-table-wrap');
      if (!wrap) return { missing: true };
      const tbl = wrap.querySelector('.cm-table');
      const th  = wrap.querySelector('.cm-table th');
      const err = wrap.querySelector('.cm-status-code--err');
      const ok  = wrap.querySelector('.cm-status-code--ok');
      const row0 = wrap.querySelector('tbody tr');
      return {
        missing: false,
        page_grows_sideways: de.scrollWidth > de.clientWidth,
        wrap_overflow_x: getComputedStyle(wrap).overflowX,
        table_overflow_x: getComputedStyle(tbl).overflowX,
        max_height: getComputedStyle(wrap).maxHeight,
        wrap_client_h: wrap.clientHeight,
        wrap_scroll_h: wrap.scrollHeight,
        can_scroll_y: wrap.scrollHeight > wrap.clientHeight,
        rows: wrap.querySelectorAll('tbody tr').length,
        th_position: getComputedStyle(th).position,
        th_background: getComputedStyle(th).backgroundColor,
        cols: row0 ? row0.cells.length : 0,
        // distinct left edges == rendered columns. More than `cols`
        // means a second column formed - the wrap-as-second-column trap.
        distinct_lefts: [...new Set(Array.from(
            wrap.querySelectorAll('tbody td'),
            td => Math.round(td.getBoundingClientRect().left)))].length,
        err_underline: getComputedStyle(err).textDecorationLine,
        err_color: getComputedStyle(err).color,
        ok_color: getComputedStyle(ok).color,
      };
    }""")


async def probe_sticky(pg, w, h):
    """Scroll the WRAPPER - the scrollport the header is sticky to."""
    await pg.set_viewport_size({"width": w, "height": h})
    await pg.wait_for_timeout(250)
    return await pg.evaluate("""() => new Promise(res => {
      const wrap = document.querySelector('#table .cm-table-wrap');
      const th = wrap.querySelector('.cm-table th');
      const before = th.getBoundingClientRect().top;
      wrap.scrollTop = 200;
      requestAnimationFrame(() => requestAnimationFrame(() => res({
        before: Math.round(before),
        after: Math.round(th.getBoundingClientRect().top),
        scrolled_to: wrap.scrollTop,
      })));
    })""")


async def main():
    bad = []
    async with async_playwright() as p:
        b = await p.webkit.launch()
        pg = await (await b.new_context()).new_page()
        # Creating a page only gives about:blank, so every probe returns
        # null and the whole run reads as a total failure of the table
        # rather than the absence of a page.
        await pg.goto(URL, wait_until="networkidle")
        if await pg.query_selector("#table .cm-table-wrap") is None:
            print("FAIL  no log table served at %s" % URL)
            sys.exit(1)

        for name, (w, h) in IPHONE.items():
            m = await probe(pg, w, h)
            print(f"\n== {name} {w}x{h}")
            for k, v in m.items():
                print(f"   {k:20} {v}")

            if m["page_grows_sideways"]:
                bad.append(f"{name}: the page grows sideways, so the log is not "
                           f"scrolling inside its own wrapper")
            if m["wrap_overflow_x"] not in ("auto", "scroll"):
                bad.append(f"{name}: wrapper overflow-x is {m['wrap_overflow_x']}")
            if m["table_overflow_x"] != "visible":
                bad.append(f"{name}: overflow sits on .cm-table itself "
                           f"({m['table_overflow_x']}); a table box ignores it")
            if m["max_height"] == "none":
                bad.append(f"{name}: the wrapper has no max-height, so it is a "
                           f"scrollport that never scrolls and the sticky "
                           f"header rides the page")
            if not m["can_scroll_y"]:
                bad.append(f"{name}: the log ({m['wrap_scroll_h']}px) fits the cap "
                           f"({m['wrap_client_h']}px), so the header is never "
                           f"actually exercised")
            if m["th_position"] != "sticky":
                bad.append(f"{name}: th position is {m['th_position']}")
            if m["th_background"] in ("rgba(0, 0, 0, 0)", "transparent"):
                bad.append(f"{name}: the sticky header is transparent, so rows "
                           f"scroll visibly through it")
            if m["distinct_lefts"] != m["cols"]:
                bad.append(f"{name}: {m['distinct_lefts']} distinct left edges for "
                           f"{m['cols']} columns - a second column formed")
            if m["err_underline"] == "none" and m["ok_color"] == m["err_color"]:
                bad.append(f"{name}: the status tiers differ by nothing at all")

            s = await probe_sticky(pg, w, h)
            drift = abs(s["after"] - s["before"])
            print(f"   wrapper scroll -> {s['scrolled_to']}px, header drift "
                  f"{drift}px ({s['before']}->{s['after']})")
            if s["scrolled_to"] == 0:
                bad.append(f"{name}: the wrapper would not scroll, so nothing was "
                           f"proven")
            elif drift > 1:
                bad.append(f"{name}: the header drifted {drift}px while the "
                           f"wrapper scrolled, so it is not actually sticky")
        await b.close()

    print("\n" + "=" * 62)
    if bad:
        for x in bad:
            print("FAIL  " + x)
        sys.exit(1)
    print("OK  the log scrolls inside its own wrapper, the page never grows "
          "sideways, the wrapper is a real scrollport, and the header holds "
          "at 0px drift in WebKit at both phone widths.")


asyncio.run(main())
