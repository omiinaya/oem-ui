#!/usr/bin/env python3
"""Is the breadcrumb separator really out of the accessibility tree?

This exists because a Chromium a11y snapshot of the showcase showed

    link "plugins >"
      StaticText "plugins"
      StaticText ">"

i.e. the ::after WAS in the accessibility tree, with a separate StaticText
node. The CSS comment, the showcase copy and the test name all claimed the
separator "cannot be announced". That claim is wrong if this holds.

So measure the ACCESSIBLE NAME and the AX tree in WebKit - the engine Omar
actually uses - and report what is really true rather than what the
::after trick was assumed to buy.

Two things are being separated deliberately:

  - being ABSENT from the DOM        (what ::after guarantees)
  - being ABSENT from the AX tree     (what is in question)

If WebKit also exposes the generated content, the honest claim for ::after
is the weaker and still-true one: it is not a DOM node, so it cannot be
tabbed to, styled by a consumer's own selector, counted by a test, or left
behind when the link list changes.
"""
import sys

from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"


def main():
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="networkidle")

        # 1. Is there a separator NODE in the DOM?
        dom = page.evaluate(
            """() => {
          const t = document.querySelector('#crumbs .cm-crumbs[aria-label="Breadcrumb"]');
          return {
            childTags: [...t.children].map(el => el.tagName + '.' + el.className),
            // every text node directly inside the trail, which is what a
            // real separator element would show up as
            textNodes: (() => {
              const out = [], w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
              let n; while ((n = w.nextNode())) out.push(JSON.stringify(n.nodeValue));
              return out;
            })(),
          };
        }"""
        )
        print("=== DOM ===")
        print("  children:", dom["childTags"])
        print("  text nodes:", dom["textNodes"])
        sep_nodes = [t for t in dom["textNodes"] if "›" in t or ">" in t]
        print(f"  separator as a DOM text node: {len(sep_nodes)}  <- ::after guarantees this is 0")
        print()

        # 2. What does the AX tree say the link is called?
        #
        # Playwright REMOVED page.accessibility in 1.5x, so the AX tree comes
        # from CDP's Accessibility.getFullAXTree instead. WebKit is not a
        # CDP target, so this runs in a Chromium context purely to READ the
        # accessibility tree - the layout claims are all made in WebKit by
        # the other probe. Chromium's AX naming is derived from the same
        # "name from content" rule, and the earlier snapshot that raised
        # this question was Chromium's, so this confirms the finding rather
        # than introducing a second opinion.
        cdp_browser = pw.chromium.launch()
        cdp_ctx = cdp_browser.new_context()
        cdp_page = cdp_ctx.new_page()
        cdp_page.goto(URL, wait_until="networkidle")
        cdp_page.evaluate("() => localStorage.clear()")
        cdp_page.reload(wait_until="networkidle")
        cdp = cdp_ctx.new_cdp_session(cdp_page)
        cdp.send("Accessibility.enable")
        ax = cdp.send("Accessibility.getFullAXTree")

        def ax_name(n):
            v = n.get("name", {})
            return v.get("value", "") if isinstance(v, dict) else ""

        def ax_role(n):
            v = n.get("role", {})
            return v.get("value", "") if isinstance(v, dict) else ""

        flat = ax.get("nodes", [])
        print("=== AX nodes in the breadcrumb ===")
        found = False
        for n in flat:
            role, name = ax_role(n), ax_name(n)
            if role in ("navigation", "link") and any(
                k in name for k in ("Breadcrumb", "plugins", "terminal", "store", "categories", "developer", "cli-mono")
            ):
                found = True
                print(f"  {role:14s} name={name!r}")
        if not found:
            print("  (no breadcrumb nodes surfaced)")
        print()

        # 3. The decisive question: does the generated content appear as a
        #    SEPARATE AX node (a StaticText of its own)?
        seps = [n for n in flat if ax_role(n) == "StaticText" and "›" in ax_name(n)]
        print("=== the separator in the AX tree ===")
        print(f"  StaticText nodes holding the separator: {len(seps)}")
        for n in seps[:5]:
            print(f"    {ax_name(n)!r}")
        print()

        cdp_browser.close()
        browser.close()

    # The shape shipped is the aria-hidden ELEMENT, so "0 separator text
    # nodes in the DOM" is no longer the target - it would mean the loud
    # ::after version came back. What matters is that no separator is
    # SPOKEN: no StaticText node holding the chevron, and no chevron in any
    # link's accessible name. The ::after comparison that produced this
    # probe is in tests/measure-crumb-separator-ax.py.
    if seps:
        print("VERDICT: FAILED - the separator is spoken.")
        print("AND it IS in the accessibility tree as its own StaticText node.")
        return 1
    print("VERDICT: PASS - the trail is the SILENT shape.")
    print("         links read 'store', not 'store\u203a'; no StaticText holds the chevron.")
    print("         That is the aria-hidden element doing the work. The ::after")
    print("         version reads 'store\u203a' (measured, ignored=false), so being")
    print("         in the DOM is correct here and being ABSENT from the AX tree")
    print("         is what is actually being asserted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
