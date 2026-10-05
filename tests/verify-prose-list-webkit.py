#!/usr/bin/env python3
"""The load-order specimen as RENDERED, in WebKit, at Omar's phone viewport.

The contract tests assert the selector is present in the source. This
asserts the page that ships actually RENDERS the two halves of the claim:

  1. the classless lists inside `.cm-prose` show a marker
  2. the classed `.cm-rows` list in the SAME column shows none

(2) is the half a screenshot cannot be trusted on and a `list-style-type:
disc` presence test always passes: a bulleted `.cm-rows` looks like a
normal list in a screenshot. It is measured as computed style.

Deliberately NOT asserted: marker colours, indents, spacing. The invariant
here is the marker type, which is what the rule owns.

Storage is cleared BEFORE every load, never after - a saved theme
otherwise leaks into the next page and a themed read reports the wrong
theme's value.

Usage: verify-prose-list-webkit.py [url]
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4321/"

PROBE = """() => {
  const sec = document.querySelector('#proselists-order');
  if (!sec) return { error: 'no #proselists-order section' };
  const prose = sec.querySelector('.cm-prose');
  if (!prose) return { error: 'the section has no .cm-prose container' };
  const ls = (el) => (el ? getComputedStyle(el).listStyleType : null);
  // A collapsed container keeps hidden nodes at height 0; a list with no
  // layout has no marker box to measure, so the rendered check filters.
  const lists = [...prose.querySelectorAll('ul, ol')];
  const rendered = lists.filter((el) => el.getBoundingClientRect().height > 0);
  return {
    total_lists: lists.length,
    rendered_lists: rendered.length,
    classless: rendered.filter((el) => !el.className)
      .map((el) => ({ tag: el.tagName, type: ls(el) })),
    classed: rendered.filter((el) => el.className)
      .map((el) => ({ cls: el.className.trim(), type: ls(el) })),
  };
}"""


def main():
    failures = []
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        for width, height in ((375, 667), (390, 844), (402, 874), (1024, 900)):
            pg = b.new_page(viewport={"width": width, "height": height})
            pg.goto(URL, wait_until="networkidle")
            pg.evaluate("() => localStorage.clear()")
            pg.reload(wait_until="networkidle")
            out = pg.evaluate(PROBE)
            pg.close()

            if out.get("error"):
                failures.append(f"{width}: {out['error']}")
                continue
            # A section whose lists are all zero-height would pass a
            # `.length > 0` check on `classless` and prove nothing, so the
            # rendered count is asserted first.
            if out["rendered_lists"] != out["total_lists"]:
                failures.append(
                    f"{width}px: {out['total_lists'] - out['rendered_lists']} of "
                    f"{out['total_lists']} lists have zero height, so the marker "
                    "read would be about a hidden element"
                )
            for item in out["classless"]:
                want = "disc" if item["tag"] == "UL" else "decimal"
                if item["type"] != want:
                    failures.append(
                        f"{width}px: a classless <{item['tag'].lower()}> in the "
                        f"prose column computes {item['type']}, expected {want} - "
                        "the marker rule is not reaching the element a markdown "
                        "renderer emits"
                    )
            for item in out["classed"]:
                if item["type"] != "none":
                    failures.append(
                        f"{width}px: .{item['cls']} inside .cm-prose computes "
                        f"{item['type']} - the prose marker rule reached a list "
                        "that carries a class"
                    )
            print(
                f"{width:>5}px  rendered={out['rendered_lists']}  "
                f"classless={[i['type'] for i in out['classless']]}  "
                f"classed={[(i['cls'], i['type']) for i in out['classed']]}"
            )
        b.close()

    print()
    if failures:
        for f in failures:
            print("FAIL:", f)
        sys.exit(1)
    print("PASS: classless lists keep markers, classed lists keep theirs")


if __name__ == "__main__":
    main()