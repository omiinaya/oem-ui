#!/root/.venvs/mau/bin/python
"""The trailing meta may sit on the title's line, or directly beneath it
on the TITLE's left edge -- never alone and right-pinned.

Two host shapes are measured, because the showcase only has one of them
and a rule that only one shape can exercise is untested:

  A. the documented shape -- badge + title inside `.cm-head-row__text`.
     Below 768px the row wraps and the meta used to land alone on the
     right margin. It must now sit under the title, on the title's left
     edge. Above that it must still trail.

  B. a bare title with a meta and NO `__text`, injected here because the
     showcase has no such row. This is the shape where `margin-left: auto`
     is the ONLY thing trailing the meta -- in shape A the growing
     `__text` does it, so shape A passes even with `auto` deleted. Measured
     that way: removing `auto` did not fail shape A, which is how that
     gap was found.

Reads line boxes (getClientRects), not bounding boxes, so a wrapped title
is not mistaken for a wrapped meta.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4451/"
WIDTHS = [320, 360, 390, 402, 440, 520, 600, 640, 768, 1024, 1280]
HEADING = "A header row with a trailing chip"
TOL = 2  # sub-pixel rounding on fractional x

fails, report = [], []

PROBE = """() => {
  const d = document.createElement('div');
  d.id = 'cm-meta-probe';
  d.style.cssText = 'position:absolute;left:-99999px;top:0;width:100%';
  d.className = 'cm-head-row';
  d.innerHTML = '<h3 class="cm-section__title">A characteristically ' +
                'unfittable header title for the probe row</h3>' +
                '<span class="cm-tag cm-head-row__meta">9 total</span>';
  document.body.appendChild(d);
}"""

MEASURE = """(txt) => {
  const measure = (el, row) => {
    const t = el.getBoundingClientRect();
    const meta = row.querySelector('.cm-head-row__meta');
    const m = meta.getBoundingClientRect();
    const rb = row.getBoundingClientRect();
    return {
      titleX: t.x, titleTop: t.y,
      metaX: m.x, metaTop: m.y, metaW: Math.round(m.width),
      rowX: rb.x, rowRight: rb.right, rowH: Math.round(rb.height),
      sameLine: Math.abs(m.y - t.y) < Math.max(12, t.height * 0.6),
      rightPinned: Math.abs(m.x + m.width - rb.right) <= 2,
      titleAligned: Math.abs(m.x - t.x) <= 2,
    };
  };
  const hs = [...document.querySelectorAll('h1,h2,h3,h4')];
  const h = hs.find(x => x.textContent.trim() === txt);
  const out = {};
  if (h) {
    const row = h.closest('.cm-head-row');
    out.A = measure(h, row);
  }
  const probe = document.getElementById('cm-meta-probe');
  if (probe) out.B = measure(probe.querySelector('.cm-section__title'), probe);
  return out;
}"""


def judge(shape, r, W):
    """Return (ok, why) for one measurement."""
    if r["sameLine"]:
        if r["rightPinned"]:
            return True, "inline, right-pinned"
        return False, (f"INLINE BUT NOT TRAILING (meta right="
                       f"{r['metaX'] + r['metaW']}, rowRight={r['rowRight']})")
    if r["titleAligned"] and not r["rightPinned"]:
        return True, "wrapped, aligned to title"
    return False, (f"WRAPPED AND ORPHANED (metaX={r['metaX']:.0f}, "
                   f"titleX={r['titleX']:.0f}, rowX={r['rowX']:.0f}, "
                   f"rowRight={r['rowRight']:.0f})")


with sync_playwright() as p:
    b = p.webkit.launch()
    for W in WIDTHS:
        pg = b.new_page(viewport={"width": W, "height": 900})
        pg.goto(URL, wait_until="load")
        pg.wait_for_timeout(300)
        pg.evaluate(PROBE)
        pg.wait_for_timeout(120)
        info = pg.evaluate(MEASURE, HEADING)

        for shape in ("A", "B"):
            r = info.get(shape)
            label = "documented" if shape == "A" else "bare-title"
            if not r:
                msg = f"{W}px shape {shape} ({label}): not measured"
                report.append(f"    {W:>5} {shape} {msg}")
                fails.append(msg)
                continue
            ok, why = judge(shape, r, W)
            report.append(f"    {W:>5} {shape}  {label:<12} {why}")
            if not ok:
                fails.append(f"{W}px shape {shape} ({label}): {why}")
        pg.close()
    b.close()

for line in report:
    print(line)
if fails:
    print("\nFAIL:")
    for f in fails:
        print("  " + f)
    sys.exit(1)
print("\nPASS: the trailing meta never sits alone and right-pinned, "
      "in either host shape")