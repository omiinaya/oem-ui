#!/usr/bin/env python3
"""
Measure the SectionHead block in real WebKit at an iPhone viewport.

The defect this component fixes was a MEASURED one: on rpm's Dashboard the
page title and a panel heading both computed 32px / w700, so the heading
scale had one step instead of two. A font-size lookup is not the claim
though. The claim is that a section title now reads as a section title on
a phone Omar actually holds, and that is geometry:

  1. the type scale SEPARATES: every section title is strictly smaller than
     the page title. One size across the two is the exact defect.
  2. the action sits BESIDE the title on one line, not stacked under it -
     the shape rpm hand-writes 18 times.
  3. no sideways scroll at 375/390.
  4. the sub renders, and its inline <code> is a real element.

WebKit only. Chromium lies about layout in this repo, and every probe
failure recorded in the skill was either a Chromium answer or a probe that
measured the wrong thing.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"
OUT = pathlib.Path("/root/.hermes/cache/scratch/section-head-webkit.json")

WIDTHS = [375, 390, 1440]

PROBE = r"""
() => {
  const px = (v) => Math.round(v * 100) / 100;
  const cs = (el) => getComputedStyle(el);
  const one = (s) => document.querySelector(s);

  const pageTitle = one('.cm-head h1');
  const titles = [...document.querySelectorAll('.cm-section__title')];
  const subs = [...document.querySelectorAll('.cm-section__sub')];
  const clientW = document.documentElement.clientWidth;

  // The action row: does the control share a ROW with the title, and is it
  // pushed to the far end?
  //
  // The first version compared the action's `top` against the TITLE's top
  // and reported a stack at every width including 1440 - including a false
  // failure. `.cm-head-row` is `align-items: center`, so with a 94px sub
  // under the title the action is centred against the WHOLE text block,
  // not aligned to the title's first line. The correct question is whether
  // the action is horizontally beside the text and inside the same row,
  // which is what `left` proves and `top` alone cannot.
  let actionRow = null;
  for (const a of document.querySelectorAll('.cm-head-row__action')) {
    const row = a.closest('.cm-head-row');
    const t = row && row.querySelector('.cm-section__title');
    if (!t || !a.querySelector('button')) continue;
    const rb = row.getBoundingClientRect();
    const tb = t.getBoundingClientRect();
    const ab = a.getBoundingClientRect();
    actionRow = {
      title: t.textContent.trim().slice(0, 40),
      // beside = the action starts to the RIGHT of the text block, so it
      // cannot be stacked under it however the row aligns vertically.
      beside: ab.left >= tb.right - 1,
      actionLeft: px(ab.left),
      textRight: px(tb.right),
      // and it must not overflow the row it belongs to
      withinRow: ab.right <= rb.right + 1,
      insetFromRight: px(rb.right - ab.right),
      rowH: px(rb.height),
    };
    break;
  }

  return {
    w: window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    clientW,
    pageTitle: pageTitle ? {
      text: pageTitle.textContent.trim().slice(0, 30),
      size: px(parseFloat(cs(pageTitle).fontSize)),
      weight: cs(pageTitle).fontWeight,
    } : null,
    sectionCount: titles.length,
    subCount: subs.length,
    titleSizes: [...new Set(titles.map(t => px(parseFloat(cs(t).fontSize))))],
    titleWeights: [...new Set(titles.map(t => cs(t).fontWeight))],
    sample: titles.slice(0, 3).map(t => t.textContent.trim().slice(0, 26)),
    subsWithCode: subs.filter(s => s.querySelector('code')).length,
    subHeight: subs.length ? px(subs[0].getBoundingClientRect().height) : null,
    actionRow,
    overflowing: titles.filter(t => t.getBoundingClientRect().right > clientW + 1).length,
  };
}
"""


def main() -> int:
    fails = []
    results = []
    with sync_playwright() as p:
        b = p.webkit.launch()
        try:
            for w in WIDTHS:
                ctx = b.new_context(
                    viewport={"width": w, "height": 844},
                    is_mobile=w < 700, has_touch=w < 700,
                )
                pg = ctx.new_page()
                pg.goto(URL, wait_until="load")
                r = pg.evaluate(PROBE)
                results.append(r)
                ctx.close()

                print(f"\n--- WebKit {w}x844 ---")
                print(f"  page title      {r['pageTitle']}")
                print(f"  section titles  {r['sectionCount']} rendered, "
                      f"sizes {r['titleSizes']} weight {r['titleWeights']}")
                print(f"  subs            {r['subCount']} rendered, "
                      f"{r['subsWithCode']} with a live <code>, first h={r['subHeight']}")
                print(f"  action row      {r['actionRow']}")

                # 1. THE scale claim. The page title is 32px; a section title
                # that matches it is the defect this component replaced.
                if r["pageTitle"] is None:
                    fails.append(f"w={w}: no .cm-head h1 on the page")
                else:
                    pt = r["pageTitle"]["size"]
                    for s in r["titleSizes"]:
                        if s >= pt:
                            fails.append(
                                f"w={w}: a section title computes to {s}px, "
                                f"the same as the page title ({pt}px) - the "
                                f"scale has no second step"
                            )

                if r["sectionCount"] < 20:
                    fails.append(f"w={w}: only {r['sectionCount']} section titles "
                                 f"rendered; the component is not being used")

                # 2. the action belongs BESIDE the text block. `beside` is
                # horizontal, so it cannot be fooled by vertical centring.
                if r["actionRow"] is None:
                    fails.append(f"w={w}: no action row with a control was found")
                else:
                    if not r["actionRow"]["beside"]:
                        fails.append(
                            f"w={w}: the action is NOT beside the text "
                            f"({r['actionRow']}) - the block stacks instead of opposing"
                        )
                    if not r["actionRow"]["withinRow"]:
                        fails.append(
                            f"w={w}: the action overflows its row "
                            f"({r['actionRow']})"
                        )
                    if r["actionRow"]["insetFromRight"] > 1.5:
                        fails.append(
                            f"w={w}: the action sits {r['actionRow']['insetFromRight']}px "
                            f"from the row's right edge, so it is not pushed to the far end"
                        )

                # 3. no sideways scroll. `scrollWidth > clientWidth` is the
                # phone-width failure the skill records as the one a tall
                # screenshot cannot show.
                if r["scrollW"] > r["clientW"] + 1:
                    fails.append(f"w={w}: sideways scroll - scrollWidth "
                                 f"{r['scrollW']} > clientWidth {r['clientW']}")
                if r["overflowing"]:
                    fails.append(f"w={w}: {r['overflowing']} section title(s) "
                                 f"overflow the viewport")

                # 4. the sub is real markup, not escaped text.
                if r["subsWithCode"] == 0:
                    fails.append(f"w={w}: no sub carries a live <code> element; "
                                 f"the slot is escaping caller markup")
        finally:
            b.close()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    import json
    OUT.write_text(json.dumps(results, indent=2))

    print()
    if fails:
        print(f"FAILED {len(fails)}:")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PASS - the scale separates, the action is beside the title, "
          "no sideways scroll")
    print(f"measurements: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
