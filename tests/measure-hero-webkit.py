"""Measure the new .cm-hero in real WebKit at Omar's widths.

Three questions, each one a place a probe can lie:
  1. GEOMETRY - does `.cm-hero` actually differ from `main`'s reading
     measure, or did the class land and compute the same box?
  2. THE GRADIENT - is `background-clip: text` live, and is the text
     painted? A rule that computes `background-clip: text` with a
     transparent colour and no visible paint is invisible text.
  3. THE DIVIDER - measure the LAST item on each visual line of the action
     row. A divider is a flex item; if a wrapped line can END with one it
     is the footer-separator bug again, and only the last-item-per-line
     measurement sees it.
"""
import json
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:4321/"
WIDTHS = [(320, 667), (375, 667), (390, 844), (402, 874), (768, 1024), (1280, 900)]

PROBE = r"""
() => {
  const vis = (el) => el.checkVisibility
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : el.getClientRects().length > 0;
  const out = { main: null, hero: null, grad: [], dividerLines: [], docScrollWidth: 0, win: 0 };

  const m = document.querySelector('main');
  if (m) { const r = m.getBoundingClientRect(); out.main = { w: +r.width.toFixed(2) }; }

  const hero = document.querySelector('#hero .cm-hero');
  if (!hero) return out;
  const hr = hero.getBoundingClientRect();
  out.hero = { w: +hr.width.toFixed(2), left: +hr.left.toFixed(2) };

  for (const g of document.querySelectorAll('#hero .cm-grad-text')) {
    if (!vis(g)) continue;
    const cs = getComputedStyle(g);
    const r = g.getBoundingClientRect();
    out.grad.push({
      text: (g.textContent || '').trim().slice(0, 34),
      clip: cs.webkitBackgroundClip || cs.backgroundClip,
      color: cs.color,
      bgImage: cs.backgroundImage === 'none' ? 'none' : 'painted',
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      // the honest reading of "is there ink": does the box have pixels?
      visible: vis(g),
    });
  }

  // THE divider check. Group the row's VISIBLE children into visual lines
  // by their top edge, then look at the LAST child of each line. A
  // ::before pseudo is invisible to this walk, which is the point: the
  // fix moved it off an element and onto the row, so nothing can strand.
  const row = hero.querySelector('.cm-hero__actions');
  if (row) {
    const kids = [...row.children].filter(vis);
    const lines = new Map();
    for (const k of kids) {
      const top = Math.round(k.getBoundingClientRect().top);
      if (!lines.has(top)) lines.set(top, []);
      lines.get(top).push({
        tag: k.tagName.toLowerCase(),
        cls: k.className,
        isDivider: /^cm-hero__divider$/.test(k.className) || k.dataset.cmDivider !== undefined,
      });
    }
    for (const [top, items] of lines) {
      const last = items[items.length - 1];
      out.dividerLines.push({ top, count: items.length, endsWithDivider: last.isDivider });
    }
    // And the pseudo, read directly, because that is what actually paints.
    const pb = getComputedStyle(row, '::before');
    out.actionsBefore = { content: pb.content, w: pb.width, display: pb.display };
  }

  out.docScrollWidth = document.documentElement.scrollWidth;
  out.win = window.innerWidth;
  return out;
}
"""


def main():
    rows = []
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        for w, h in WIDTHS:
            pg = b.new_page(viewport={"width": w, "height": h})
            pg.emulate_media(reduced_motion="reduce")
            pg.goto(URL, wait_until="load")
            # Wait for the RUNTIME, never for milliseconds: networkidle can
            # fire before the bundle has executed.
            pg.wait_for_function("() => document.documentElement.classList.contains('cm-js')", timeout=15000)
            pg.evaluate("document.fonts && document.fonts.ready")
            pg.wait_for_timeout(150)
            d = pg.evaluate(PROBE)
            d["viewport"] = f"{w}x{h}"
            rows.append(d)
            pg.close()
        b.close()

    print("=" * 74)
    print("1. GEOMETRY — .cm-hero must NOT equal main's reading measure")
    for d in rows:
        print(f"   {d['viewport']:>10}  main={d['main'] and d['main']['w']}  "
              f"hero={d['hero'] and d['hero']['w']}  left={d['hero'] and d['hero']['left']}")
    print()
    print("2. THE GRADIENT — clip applied, text still visible")
    for d in rows:
        for g in d["grad"]:
            print(f"   {d['viewport']:>10}  clip={g['clip']:<10} color={g['color']:<20} "
                  f"bg={g['bgImage']:<8} visible={g['visible']}  {g['text']!r}")
    print()
    print("3. THE DIVIDER — no visual line may END with one")
    for d in rows:
        bad = [l for l in d["dividerLines"] if l["endsWithDivider"]]
        print(f"   {d['viewport']:>10}  lines={len(d['dividerLines'])}  "
              f"ending-with-divider={len(bad)}  before={d.get('actionsBefore')}")
    print()
    print("4. NO SIDEWAYS SCROLL")
    for d in rows:
        ok = d["docScrollWidth"] <= d["win"]
        print(f"   {d['viewport']:>10}  scrollWidth={d['docScrollWidth']} win={d['win']}  "
              f"{'ok' if ok else 'OVERFLOW'}")
    print(json.dumps(rows[0], indent=2)[:400])


main()
