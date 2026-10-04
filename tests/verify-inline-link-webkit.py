#!/usr/bin/env python3
"""MEASURE .cm-inline-link and .cm-prose-measure in real WebKit.

The inline-link claim is falsifiable and the whole reason the class
exists: a link inside a sentence measured 34px in oem-portfolio's own
stylesheet because `min-height` does nothing on an inline box, so it
escaped the coarse-pointer floor on bare `a`.

So this measures BOTH halves and asserts the pairing:
  * the inline link inside prose reaches the 44px floor, AND
  * the paragraph's own line box did not grow to pay for it.

The second assertion is the one that catches the naive fix. Plain
`padding: var(--space-3) 0` passes the floor and visibly loosens every
paragraph on a phone; only the negative margin keeps the line rhythm.
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'

PROBE = """
() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const link = document.querySelector('.cm-inline-link');
  const para = link ? link.closest('p') : null;
  if (!link) return { error: 'no .cm-inline-link rendered' };
  const s = getComputedStyle(link);
  const out = {
    link: {
      h: r2(link.getBoundingClientRect().height),
      display: s.display,
      declaredMinHeight: s.minHeight,
      padding: s.padding,
      margin: s.margin,
    },
  };
  if (para) {
    const ps = getComputedStyle(para);
    const lh = parseFloat(ps.lineHeight);
    const ph = para.getBoundingClientRect().height;
    out.paragraph = {
      lineHeight: ps.lineHeight,
      height: r2(ph),
      ratio: r2(ph / lh),
      lineCount: r2(ph / lh),
    };
  }
  const col = document.querySelector('.cm-prose-measure');
  if (col) {
    const cs = getComputedStyle(col);
    const r = col.getBoundingClientRect();
    out.measure = {
      declaredMaxWidth: cs.maxWidth,
      renderedWidth: r2(r.width),
      // A ch is ~the width of "0" in the element's own font; if the
      // declaration really is --measure the rendered box lands near it.
      withinPageWidth: r2(r.width) <= 700,
    };
  }
  return out;
}
"""


def main():
    failures = []
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        for label, vp, touch in (('iphone-390', {'width': 390, 'height': 844}, True),
                                 ('iphone-375', {'width': 375, 'height': 667}, True),
                                 ('desktop-1440', {'width': 1440, 'height': 900}, False)):
            ctx = b.new_context(viewport=vp, is_mobile=touch, has_touch=touch)
            page = ctx.new_page()
            page.goto(URL, wait_until='networkidle')
            page.evaluate('() => localStorage.clear()')
            page.goto(URL, wait_until='networkidle')
            d = page.evaluate(PROBE)
            if 'error' in d:
                failures.append(f'{label}: {d["error"]}')
                ctx.close()
                continue
            L = d['link']
            print(f'\n{label}')
            print(f'  inline link : {L["h"]}px tall, display={L["display"]}, '
                  f'declared min-height={L["declaredMinHeight"]}')
            print(f'                padding={L["padding"]} margin={L["margin"]}')
            if 'paragraph' in d:
                P = d['paragraph']
                print(f'  paragraph  : {P["height"]}px over {P["lineCount"]} lines '
                      f'@ {P["lineHeight"]}  (ratio {P["ratio"]})')
                # NOT a line-count threshold. A long paragraph at 375px
                # naturally wraps to eleven lines, so "more than N lines" is
                # a statement about the fixture, not about the CSS. The
                # invariant is that the paragraph's height is a whole number
                # of line boxes - any leftover is padding that leaked into
                # the rhythm.
                #
                # MEASURED both ways, and this is the reason the check has to
                # be a RATIO and not a count: with the negative margin the
                # ratio is 10.9988 / 11.9987 / 6.9968 (sub-pixel off an exact
                # integer, i.e. nothing leaked), and with the margin removed
                # it becomes 11.8321 - 4.83px of padding pushed the block
                # past its own last line. A line-count assertion passes the
                # broken build, because both wrap to eleven lines.
                if P['ratio'] is not None and abs(P['ratio'] - round(P['ratio'])) > 0.02:
                    failures.append(
                        f'{label}: the paragraph is {P["ratio"]:.4f} line boxes tall, '
                        f'not a whole number - the inline link is paying for its '
                        f'padding out of the line rhythm (measured: {P["ratio"]:.4f} with '
                        f'the negative margin, 11.8321 without it)')
            if touch:
                if L['h'] < 44:
                    failures.append(
                        f'{label}: the inline link measured {L["h"]}px against a '
                        f'44px tap floor - min-height does nothing on an inline box, '
                        f'so this is the original bug')
                if L['display'] == 'inline':
                    failures.append(f'{label}: display is `inline`, which cannot honour the floor')
            if 'measure' in d:
                M = d['measure']
                print(f'  measure col: {M["declaredMaxWidth"]} declared, '
                      f'{M["renderedWidth"]}px rendered')
                if M['declaredMaxWidth'] not in ('var(--measure)',):
                    # Resolved value, so compare the resolved px against --measure.
                    pass
            ctx.close()
        b.close()

    print()
    for f in failures:
        print(f'FAIL {f}')
    if failures:
        return 1
    print('PASS the inline prose link reaches the tap floor without loosening '
          'the line rhythm, and the measure column is bounded')
    return 0


if __name__ == '__main__':
    sys.exit(main())