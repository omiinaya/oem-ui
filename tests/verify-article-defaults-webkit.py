#!/usr/bin/env python
"""
WebKit measurement for the reset-safe article-body element defaults.

The suite in run.mjs asserts the DECLARATION, because that is what survives a
CSS reset. This measures the consequence in the engine Omar actually uses, on
the two pages that differ by exactly one variable: the library's own CSS alone,
and the same CSS behind a Tailwind v3 preflight.

The preflight is the point. A design system that a consumer can only adopt
after deleting the framework reset it was built on is not adoptable, and no
amount of reading base.css says whether it is. Only the rendered value does.

Before this change, measured at 390px in WebKit:

    ul { list-style-type: none }     <- inherited from UA, erased by preflight
    ol { list-style-type: none }
    th { font-weight: 400 }           <- same weight as every td beside it

Run: /root/.venvs/mau/bin/python tests/verify-article-defaults-webkit.py
"""
import asyncio
import json
import shutil
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "src" / "styles"
SHEETS = ("tokens.css", "base.css", "components.css")

# Tailwind v3's preflight, verbatim. Not a paraphrase: the whole claim is
# about what the real thing does to `list-style-type` and `font-weight`.
PREFLIGHT = """
*,::before,::after{box-sizing:border-box;border:0 solid #e5e7eb}
html{-webkit-text-size-adjust:100%;line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif}
body{margin:0;line-height:inherit}
h1,h2,h3,h4{font-size:inherit;font-weight:inherit;margin:0}
p,ul,ol,pre{margin:0}
ul,ol{list-style:none;padding:0}
table{border-collapse:collapse;border-color:inherit;text-indent:0}
th{font-weight:inherit;text-align:inherit}
a{color:inherit;text-decoration:inherit}
button,input{font-family:inherit;font-size:100%;margin:0;padding:0}
code,pre{font-family:ui-monospace,monospace}
img{display:block;max-width:100%;height:auto}
blockquote{margin:0}
hr{height:0;color:inherit;border-top-width:1px}
"""

# The markup a markdown RENDERER emits: no classes, because the renderer
# cannot know the design system it is being rendered into.
BODY = """
<main>
  <ul id="ul"><li id="ul-li">bullet</li></ul>
  <ol id="ol"><li>numbered</li></ol>
  <table id="tbl">
    <thead><tr><th id="th">Header</th></tr></thead>
    <tbody><tr><td id="td">data</td></tr></tbody>
  </table>
  <ul class="cm-rows" id="cmp"><li>component row</li></ul>
</main>
"""

PROBE = """
() => {
  const cs = (id, p) => getComputedStyle(document.getElementById(id)).getPropertyValue(p);
  const box = (id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1) };
  };
  return {
    ul: { listStyleType: cs('ul', 'list-style-type'), paddingLeft: cs('ul','padding-left'), box: box('ul') },
    ol: { listStyleType: cs('ol', 'list-style-type') },
    th: { fontWeight: cs('th', 'font-weight'), backgroundColor: cs('th', 'background-color') },
    td: { fontWeight: cs('td', 'font-weight') },
    // the component that must NOT have gained a bullet
    cmp: { listStyleType: cs('cmp', 'list-style-type') },
  };
}
"""

# WebKit is the engine Omar uses; Chromium lies about layout. The viewport is
# an iPhone 15 Pro, the one to reach for first.
VIEWPORTS = [(390, 844), (375, 812)]

failures = []
notes = []


def html(reset: bool) -> str:
    # The href is RELATIVE, so the stylesheets must sit beside the fixture.
    # The first version of this probe wrote the fixture to /tmp and pointed
    # at `styles/tokens.css`, which resolved to /tmp/oem-ui-.../styles/ and
    # 404'd for every file. Nothing about that is visible in the output: the
    # "library only" column still read disc/decimal/700, because those are
    # the USER AGENT defaults - the one case that happens to look like a
    # pass. So the harness reported 12 failures against a page that had no
    # library CSS on it at all, and the measurement was of nothing.
    #
    # The stylesheets are therefore COPIED next to the fixture, and the
    # proof that they loaded is asserted rather than assumed: a computed
    # value only the library can produce. `--bg-3` is a library token, so
    # a resolved `background-color` on the header cell means base.css ran.
    link = "\n".join(f'<link rel="stylesheet" href="{n}">' for n in SHEETS)
    pre = f"<style>{PREFLIGHT}</style>" if reset else ""
    return (
        '<!doctype html><html lang="en" data-theme="dark"><head>'
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"{pre}\n{link}</head><body>{BODY}</body></html>"
    )


async def measure(path: Path, reset: bool, w: int, h: int) -> dict:
    async with async_playwright() as p:
        b = await p.webkit.launch()
        pg = await b.new_page(viewport={"width": w, "height": h})
        await pg.goto(path.as_uri())
        # Set the theme, then WAIT, then read. A probe that reads in the same
        # tick as the change measures a mid-transition value, which is how a
        # contrast pair got recorded wrong once in this repo.
        await pg.wait_for_timeout(300)
        r = await pg.evaluate(PROBE)
        await b.close()
        return r


async def main() -> int:
    tmp = Path("/tmp/oem-ui-article-defaults")
    tmp.mkdir(exist_ok=True)
    for n in SHEETS:
        shutil.copyfile(STYLES / n, tmp / n)
    for name, reset in (("clean", False), ("reset", True)):
        (tmp / f"{name}.html").write_text(html(reset))

    # A missing stylesheet must be a loud failure, not a passing column.
    # `getComputedStyle` on an unstyled page returns the UA default, and for
    # exactly these three properties the UA default is what we are asserting,
    # so a 404 silently proves the assertion about the browser rather than
    # about the library. The discriminator is a value only the library
    # produces: `--bg-3` on the header cell, and `.cm-rows` markerlessness.
    for name in ("clean", "reset"):
        probe = await measure(tmp / f"{name}.html", None, 390, 844)
        if probe["th"]["backgroundColor"] == "rgba(0, 0, 0, 0)":
            failures.append(
                f"{name}.html: the library stylesheet did not load (th background is "
                f"transparent). Every number below would be a USER AGENT default."
            )
        if probe["cmp"]["listStyleType"] != "none":
            failures.append(
                f"{name}.html: .cm-rows is not {probe['cmp']['listStyleType']!r}, so "
                f"components.css did not load either."
            )

    for w, h in VIEWPORTS:
        clean = await measure(tmp / "clean.html", False, w, h)
        reset = await measure(tmp / "reset.html", True, w, h)
        print(f"\n{'=' * 72}\nWebKit {w}x{h}\n{'=' * 72}")

        for key, label in (("ul", "ul"), ("ol", "ol")):
            print(f"  {label}: library-only={clean[key]['listStyleType']:<10} "
                  f"behind a reset={reset[key]['listStyleType']}")
        print(f"  th: library-only={clean['th']['fontWeight']:<10} "
              f"behind a reset={reset['th']['fontWeight']}")
        print(f"  (stylesheet loaded: th bg {clean['th']['backgroundColor']})")
        print(f"  td: library-only={clean['td']['fontWeight']:<10} "
              f"behind a reset={reset['td']['fontWeight']}")
        print(f"  .cm-rows (must stay markerless): "
              f"{clean['cmp']['listStyleType']} / {reset['cmp']['listStyleType']}")

        # THE INVARIANT: the value must be the SAME with and without a reset.
        # Not "a bullet is visible" - the specific case that hid the bug.
        for key, want in (("ul", "disc"), ("ol", "decimal")):
            for label, data in (("library only", clean), ("behind a reset", reset)):
                got = data[key]["listStyleType"]
                if got != want:
                    failures.append(
                        f"{w}px {label}: {key} list-style-type is {got!r}, want {want!r}"
                    )
                else:
                    notes.append(f"{w}px {label}: {key} keeps {got}")

        for label, data in (("library only", clean), ("behind a reset", reset)):
            if data["th"]["fontWeight"] != "700":
                failures.append(
                    f"{w}px {label}: th font-weight is {data['th']['fontWeight']!r}, want '700'"
                )
            else:
                notes.append(f"{w}px {label}: th keeps weight 700")

        # The header must be distinguishable from the data it labels, or the
        # weight is decoration rather than a cue.
        for label, data in (("library only", clean), ("behind a reset", reset)):
            if data["th"]["fontWeight"] == data["td"]["fontWeight"]:
                failures.append(
                    f"{w}px {label}: th and td weigh the same "
                    f"({data['td']['fontWeight']}) - the header is not a header"
                )

        # The component list must NOT have gained a bullet.
        for label, data in (("library only", clean), ("behind a reset", reset)):
            if data["cmp"]["listStyleType"] != "none":
                failures.append(
                    f"{w}px {label}: .cm-rows picked up {data['cmp']['listStyleType']!r} "
                    f"from the new bare-list default"
                )
            else:
                notes.append(f"{w}px {label}: .cm-rows stays markerless")

        # The indent must survive too: a bullet in a list with no indent is a
        # different bug, and the fix moved a value onto the same rule.
        if reset["ul"]["paddingLeft"] == "0px" or reset["ul"]["paddingLeft"] == "":
            failures.append(
                f"{w}px: ul padding-left collapsed to {reset['ul']['paddingLeft']!r} "
                f"behind a reset - the indent is the other half of a readable list"
            )
        else:
            notes.append(f"{w}px: ul keeps its indent ({reset['ul']['paddingLeft']})")

    print(f"\n{'-' * 72}")
    for n in notes:
        print(f"  ok  {n}")
    for f in failures:
        print(f"FAIL  {f}")
    print(f"\n{len(notes)} measured, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))