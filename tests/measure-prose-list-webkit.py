#!/usr/bin/env python3
"""The reset-safe prose list rule: does it survive a preflight AND keep
`.cm-rows` markerless?

THE DEFECT. base.css declares the list marker on a BARE selector:
`ul, ol { list-style-type: disc }` is (0,0,1). Tailwind v3 preflight's
`ol,ul,menu{list-style:none}` is ALSO (0,0,1). Equal specificity means the
winner is decided by SOURCE ORDER, so the library's own marker fix (f679a8b)
survives only when the consumer's reset loads first. MEASURED: with preflight
loaded AFTER the bare rule, ul computes `none`.

THE NAIVE FIX IS A REGRESSION. Scoping to `.cm-prose ul` is (0,1,1), which
beats every markerless rule in the library (they are all (0,1,0) - `.cm-rows`
at components.css:763, `.cm-cards`, `.cm-projects`, `.cm-timeline`,
`.cm-swatch`). MEASURED: it gives a `.cm-rows` nested in prose a bullet.

THE RULE UNDER TEST. `:not([class])` is the discriminator that separates the
two cases by WHAT THEY ARE rather than by a fight over specificity:

    .cm-prose ul:not([class])   (0,2,1)

  - beats preflight (0,0,1) in EITHER load order
  - cannot match `.cm-rows`, because that element carries a class - a
    class-bearing list belongs to whoever gave it the class, and Tailwind's
    own `list-disc` / `.list-none` still work

This mirrors the doctrine already in base.css: the library declares defaults
for elements a markdown renderer emits BARE, and leaves classed markup alone.

Usage: measure-prose-list-webkit.py <library-css-dir>
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PREFLIGHT = "ol,ul,menu{list-style:none;margin:0;padding:0}"
ROWS = ".cm-rows { list-style: none; margin: 0; padding: 0; }"

BARE = "ul, ol { padding-left: 1.4em; list-style-type: disc; }"
NAIVE = ".cm-prose ul, .cm-prose ol { list-style-type: disc; }"
UNDER_TEST = (
    ".cm-prose ul:not([class]), .cm-prose ol:not([class]) "
    "{ list-style-type: disc; }"
    ".cm-prose ol:not([class]) { list-style-type: decimal; }"
)

BODY = (
    "<div class='cm-prose'>"
    "<ul><li>a markdown bullet</li></ul>"
    "<ol><li>a markdown number</li></ol>"
    "<ul class='cm-rows'><li>a row that must NEVER be a bullet</li></ul>"
    "<ul class='list-none'><li>tailwind owns this one</li></ul>"
    "</div>"
)

PROBE = """() => {
  const ls = el => getComputedStyle(el).listStyleType;
  const q = s => document.querySelector(s);
  return {
    prose_ul: ls(q('.cm-prose > ul:not([class])')),
    prose_ol: ls(q('.cm-prose > ol:not([class])')),
    cm_rows: ls(q('.cm-rows')),
    tailwind_list_none: ls(q('.list-none')),
  };
}"""


def run(b, label, css):
    pg = b.new_page(viewport={"width": 390, "height": 800})
    pg.set_content(
        "<!doctype html><html><head><style>" + css + "</style></head><body>"
        + BODY
        + "</body></html>"
    )
    pg.wait_for_timeout(120)
    out = pg.evaluate(PROBE)
    pg.close()
    print(f"{label}")
    print(
        f"    prose ul={out['prose_ul']:<8} ol={out['prose_ol']:<8} "
        f"cm-rows={out['cm_rows']:<8} .list-none={out['tailwind_list_none']}"
    )
    return out


def main():
    src = Path(sys.argv[1])
    assert (src / "components.css").exists(), src
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        print("baseline - the bare rule, both load orders:")
        bare_ok = run(b, "  preflight FIRST (works today)", PREFLIGHT + BARE + ROWS)
        bare_bad = run(b, "  preflight AFTER (the defect)", BARE + PREFLIGHT + ROWS)
        print("\nrejected - naive scoping:")
        run(b, "  preflight AFTER, naive .cm-prose ul", PREFLIGHT + NAIVE + ROWS)
        print("\nunder test - :not([class]):")
        a = run(b, "  preflight FIRST", PREFLIGHT + UNDER_TEST + ROWS)
        c = run(b, "  preflight AFTER", UNDER_TEST + PREFLIGHT + ROWS)
        b.close()

    failures = []
    if bare_bad["prose_ul"] != "none":
        failures.append(
            "the bare rule was expected to LOSE when preflight loads after it"
        )
    for label, r in (("preflight-first", a), ("preflight-after", c)):
        if r["prose_ul"] != "disc":
            failures.append(f"{label}: prose ul lost its marker ({r['prose_ul']})")
        if r["prose_ol"] != "decimal":
            failures.append(f"{label}: prose ol lost its number ({r['prose_ol']})")
        if r["cm_rows"] != "none":
            failures.append(f"{label}: .cm-rows gained a bullet ({r['cm_rows']})")
        if r["tailwind_list_none"] != "none":
            failures.append(
                f"{label}: the rule reached a classed list ({r['tailwind_list_none']})"
            )

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        sys.exit(1)
    print("PASS: survives both load orders, and touches nothing that has a class")


if __name__ == "__main__":
    main()