#!/usr/bin/env python3
"""Which breadcrumb separator is actually silent in the accessibility tree?

The CSS shipped this cycle claims a ::after "leaves the accessibility tree
entirely". A CDP read of Accessibility.getFullAXTree disproved it: the
link's accessible name is `plugins U+203A` and there are 6 StaticText
nodes holding the separator.

Rather than argue from the accname spec, this MEASURES all three shapes a
breadcrumb could use and reports the accessible name each produces:

  A  ::after on the link                       (what shipped)
  B  <span aria-hidden="true"> inside the link (what gantree hand-rolled)
  C  a sibling span BETWEEN the links

The question is only ever "does the separator end up in the link's
accessible NAME", because that is what a screen reader speaks when the
link is focused. A StaticText node that is not part of any name is
harmless.

Read in Chromium because only Chromium exposes the AX tree over CDP.
WebKit cannot be driven this way; the layout claims stay in WebKit.
"""
import json
import sys

from playwright.sync_api import sync_playwright

FIXTURE = """<!doctype html><html><body>
<style>
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; font-family: monospace; }
  .crumbs a::after { content: '\\203a'; margin-left: .5rem; }
  .sep { margin: 0 .25rem; color: #888; }
  /* The FIRST version of this fixture scoped the ::after to `.crumbs a`,
     so variants B and C each rendered a ::after separator IN ADDITION to
     the span they were supposed to be testing. All three then reported
     the same name and the comparison proved nothing - the fixture, not
     the browser, was the constant. Each variant now disables the shared
     ::after for itself, so the only separator present is the one under
     test. */
  #B a::after, #C a::after { content: none; }
</style>

<nav class="crumbs" id="A" aria-label="variant A">
  <a class="l" href="#1">store</a>
  <a class="l" href="#2">categories</a>
  <span class="h">thing</span>
</nav>

<nav class="crumbs" id="B" aria-label="variant B">
  <a class="l" href="#1">store<span class="sep" aria-hidden="true">&rsaquo;</span></a>
  <a class="l" href="#2">categories<span class="sep" aria-hidden="true">&rsaquo;</span></a>
  <span class="h">thing</span>
</nav>

<nav class="crumbs" id="C" aria-label="variant C">
  <a class="l" href="#1">store</a>
  <span class="sep" aria-hidden="true">&rsaquo;</span>
  <a class="l" href="#2">categories</a>
  <span class="sep" aria-hidden="true">&rsaquo;</span>
  <span class="h">thing</span>
</nav>
</body></html>"""


def main():
    path = "/tmp/crumb-variants.html"
    open(path, "w").write(FIXTURE)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context()
        page = ctx.new_page()
        page.goto("file://" + path)
        cdp = ctx.new_cdp_session(page)
        cdp.send("Accessibility.enable")
        ax = cdp.send("Accessibility.getFullAXTree")["nodes"]

        def val(n, k):
            v = n.get(k, {})
            return v.get("value", "") if isinstance(v, dict) else ""

        # CDP's getFullAXTree returns IGNORED nodes too - they are present
        # in the tree with ignored=true and are NOT exposed to assistive
        # tech. Counting them as "announced" is the error that would make
        # aria-hidden look broken. So the name, the ignored flag and the
        # reason are all needed to answer the question.
        print("=== raw: every AX node with a name, plus its ignored state ===\n")
        rows = []
        for n in ax:
            role, name = val(n, "role"), val(n, "name")
            if role not in ("link", "navigation", "StaticText", "generic"):
                continue
            if not name:
                continue
            ignored = n.get("ignored", False)
            props = {p.get("name"): p.get("value", {}).get("value") for p in n.get("properties", [])}
            rows.append((role, name, ignored, props.get("hidden")))
        for role, name, ignored, hidden in rows:
            print(f"  {role:12s} ignored={str(ignored):5s} hidden={str(hidden):6s} name={name!r}")
        print()

        names = [(val(n, "role"), val(n, "name")) for n in ax]
        b.close()

    variants = {"A ::after on the link": "A", "B span[aria-hidden] inside the link": "B", "C sibling span between links": "C"}
    results = {}
    for label, vid in variants.items():
        nav_name = next((nm for r, nm in names if r == "navigation" and vid in nm), "?")
        # link names inside this nav are the ones NOT containing the vid;
        # instead filter by position - take link names in DOM order.
        results[label] = names

    print("=== every link's accessible name, in document order ===\n")
    link_names = [nm for r, nm in names if r == "link"]
    for i, nm in enumerate(link_names):
        has = "›" in nm
        print(f"  link[{i}] name={nm!r}   separator present: {'YES' if has else 'no'}")
    print()

    print("=== per variant ===")
    groups = [link_names[0:2], link_names[2:4], link_names[4:6]]
    for (label, _), names_in_group in zip(variants.items(), groups):
        sep = any("›" in n for n in names_in_group)
        print(f"  {label}")
        print(f"      names: {names_in_group}")
        print(f"      separator in the accessible name: {'YES' if sep else 'no'}")
    print()

    quiet = [lbl for lbl, g in zip(variants.keys(), groups) if not any("›" in n for n in g)]
    print("=== verdict ===")
    print(f"  variants whose separator stays OUT of the accessible name: {quiet}")
    if not quiet:
        print("  NONE - the ::after claim is false and so is the aria-hidden span.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
