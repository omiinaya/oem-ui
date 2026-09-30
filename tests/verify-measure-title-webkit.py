#!/usr/bin/env python3
"""
Verify the --measure-title specimen and its live readout in WebKit.

The readout is only worth shipping if it tells the TRUTH, so the central
assertion is a cross-check against the real row rather than against a
restated copy of the media queries: the readout says "handed off" if and
only if the actual `.cm-row__desc` computes to display:none, and reports
the actual width when live.

Also checks the progressive contract. The readout is JS-written, so with
scripting disabled the specimen must still render its token sample and
must not leave an empty cell behind. A JS-dependent control that is
merely hidden is a dead site.
"""
import sys

from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"

# `--measure-title` is 42ch; getComputedStyle resolves `ch` against the
# monospace font's advance width, which is 9.633px here, so 42ch lands on
# 404.578125px. Asserting the RESOLVED value is the point: it is what
# proves the specimen is painted from the token rather than typed beside
# it. If the root font size changes, this fails loudly instead of the
# specimen quietly drifting from the token it documents.
TOKEN_TITLE_PX = 404.578125

# (width, expect_live)
CASES = [
    (1440, True), (1280, True), (1100, True), (1090, True),
    (1060, True), (1056, True),      # just above the rail band
    (1040, False), (1024, False), (1000, False),   # rail band
    (996, True), (990, True),         # rail gone
    (860, True), (846, True),         # just above the lower band
    (844, False), (800, False), (700, False), (390, False),
]

PROBE = r"""
() => {
  const spec = document.querySelector('[data-spec="measure-title"]');
  if (!spec) return {error: 'no [data-spec=measure-title] specimen'};
  const readout = spec.querySelector('.cm-spec__state');
  const sample = spec.querySelector('.cm-spec__sample .cm-lede');
  const desc = document.querySelector('.cm-rows--inline .cm-row__desc');
  const rows = document.querySelectorAll('.cm-rows--inline .cm-row');
  return {
    hasReadout: !!readout,
    readoutText: readout ? readout.textContent.trim() : null,
    readoutState: readout ? readout.getAttribute('data-state') : null,
    readoutCount: spec.querySelectorAll('.cm-spec__state').length,
    // the specimen must be RENDERED FROM the token, not typed beside it
    sampleWidth: sample ? Math.round(sample.getBoundingClientRect().width*100)/100 : null,
    // numeric: `ch` is resolved by getComputedStyle, so the value comes
    // back in px and is compared as a number, not as the string '42ch'
    sampleMaxWidth: sample ? parseFloat(getComputedStyle(sample).maxWidth) : null,
    descDisplay: desc ? getComputedStyle(desc).display : null,
    descWidth: desc ? Math.round(desc.getBoundingClientRect().width*100)/100 : null,
    rowCount: rows.length,
  };
}
"""


def main() -> int:
    fails = []
    with sync_playwright() as p:
        b = p.webkit.launch()
        try:
            for w, expect_live in CASES:
                ctx = b.new_context(
                    viewport={"width": w, "height": 900},
                    is_mobile=w < 700, has_touch=w < 700,
                )
                pg = ctx.new_page()
                pg.goto(URL, wait_until="load")
                title = pg.title()
                if w == CASES[0][0]:
                    print(f"page title: {title!r}")
                    if "oem/ui" not in title:
                        print("FAIL wrong page served on 4321")
                        return 1
                r = pg.evaluate(PROBE)
                if "error" in r:
                    print(f"w={w}: {r['error']}")
                    return 1

                # The TRUTHFUL check: the readout agrees with the DOM.
                actual_live = r["descDisplay"] != "none"
                if r["hasReadout"]:
                    if (r["readoutState"] == "live") != actual_live:
                        fails.append(
                            f"w={w}: readout says {r['readoutState']!r} but "
                            f"the excerpt computes to {r['descDisplay']!r} - "
                            f"the readout is lying"
                        )
                    # The readout prints a ROUNDED width, so compare
                    # against the rounded value. The first version of
                    # this check compared 'excerpt 205px' to 205.11px and
                    # reported 24 failures against a correct readout.
                    if actual_live and r["readoutText"] != \
                            f"excerpt {round(r['descWidth'])}px":
                        fails.append(
                            f"w={w}: readout {r['readoutText']!r} does not "
                            f"match the measured width {r['descWidth']}px"
                        )
                if actual_live != expect_live:
                    fails.append(
                        f"w={w}: expected the excerpt "
                        f"{'rendered' if expect_live else 'handed off'}, "
                        f"got display={r['descDisplay']!r}"
                    )
                # Idempotence: init() runs again on every Astro page-load,
                # so re-run it and prove the cell still holds ONE readout.
                # Asserting this in the source is a regex over a guard
                # clause; counting the nodes after a real re-init is the
                # claim itself.
                pg.evaluate("() => window.cliMono && window.cliMono.init(document)");
                pg.evaluate("() => window.cliMono && window.cliMono.init(document)")
                after = pg.evaluate(
                    "() => document.querySelectorAll("
                    "'[data-spec=\"measure-title\"] .cm-spec__state').length")
                if after != 1:
                    fails.append(
                        f"w={w}: {after} readouts after two extra init() calls "
                        f"- the readout stacks on every page-load"
                    )
                if r["readoutCount"] > 1:
                    fails.append(
                        f"w={w}: {r['readoutCount']} readouts in one cell - "
                        f"init() is stacking them"
                    )
                # The specimen is rendered FROM the token, not typed beside
                # it. getComputedStyle RESOLVES the ch unit to px, so the
                # assertion is on the resolved value: 42ch at the root
                # font size is 404.578125px. Comparing the string to '42ch'
                # is what made the first version of this check report a
                # correct specimen as a literal.
                if abs(r["sampleMaxWidth"] - TOKEN_TITLE_PX) > 0.5:
                    fails.append(
                        f"w={w}: specimen resolves max-width to "
                        f"{r['sampleMaxWidth']}px, expected {TOKEN_TITLE_PX}px "
                        f"(--measure-title resolved) - it is not rendered "
                        f"from the token"
                    )
                print(f"w={w:<5} descDisp={r['descDisplay']:<7} "
                      f"descW={r['descWidth']:<9} readout={r['readoutText']!r}")
                ctx.close()

            # Progressive: no JS must not break the specimen.
            ctx = b.new_context(viewport={"width": 1280, "height": 900},
                                java_script_enabled=False)
            pg = ctx.new_page()
            pg.goto(URL, wait_until="load")
            sample = pg.locator(
                '[data-spec="measure-title"] .cm-spec__sample .cm-lede')
            box = sample.bounding_box()
            val = pg.locator('[data-spec="measure-title"] .cm-spec__val')
            # The rendered width here is the sample's own text width,
            # NOT the token's cap: `max-width` is a ceiling and the cell
            # is narrower than 42ch at this width, so the text wraps
            # inside it. What must hold with JS off is that the cap still
            # resolves from the token, which is a computed-style read and
            # needs no script of ours.
            maxw = pg.evaluate(
                "() => getComputedStyle(document.querySelector("
                "'[data-spec=\"measure-title\"] .cm-spec__sample .cm-lede'"
                ")).maxWidth")
            print(f"\nno-JS: specimen visible={sample.is_visible()} "
                  f"renderedW={box['width'] if box else None} "
                  f"maxW={maxw} val={val.inner_text()!r}")
            if not sample.is_visible():
                fails.append("no-JS: the --measure-title specimen vanished")
            if abs(float(maxw.replace('px', '')) - TOKEN_TITLE_PX) > 0.5:
                fails.append(
                    f"no-JS: specimen max-width resolves to {maxw}, expected "
                    f"{TOKEN_TITLE_PX}px - it is not rendered from the token")
            if "42ch" not in val.inner_text():
                fails.append(
                    f"no-JS: the value cell lost its token: "
                    f"{val.inner_text()!r}")
            if pg.locator('[data-spec="measure-title"] .cm-spec__state').count():
                fails.append(
                    "no-JS: a readout exists - it is JS-written, so its "
                    "absence is the progressive contract working")
            ctx.close()
        finally:
            b.close()

    print()
    if fails:
        print(f"FAIL ({len(fails)})")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PASS: readout tracks the real row, specimen renders from the "
          "token, no-JS intact")
    return 0


if __name__ == "__main__":
    sys.exit(main())
