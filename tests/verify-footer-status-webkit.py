"""Measure the footer status row in REAL WebKit at iPhone + desktop widths.

The invariant is not "there is a ::before rule" - it is that NO visual line
ENDS with a separator. A ::before separator belongs to the fragment it
PRECEDES, so whatever follows it is in the same flex item and can never be
split away. A ::after separator is its own thing hanging off the end, and
strands the moment the row wraps.

This probe reports, per width:
  - the status row's distinct top edges (= distinct visual lines)
  - per fragment: its line, its text, and its rendered ::before content
  - the VERDICT: does any line's LAST fragment render a trailing separator?
"""
import asyncio, sys
from playwright.async_api import async_playwright

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4321/"

PROBE = r"""
() => {
  const row = document.querySelector('.cm-footer__status');
  if (!row) return { error: 'no .cm-footer__status on the page' };
  const parts = Array.from(row.querySelectorAll('.cm-footer__status-part'));
  const info = parts.map(el => {
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').trim(),
      top: Math.round(r.top),
      height: Math.round(r.height),
      before: getComputedStyle(el, '::before').content,
      after: getComputedStyle(el, '::after').content,
    };
  }).filter(p => p.height > 0);
  const lineTops = [...new Set(info.map(i => i.top))].sort((a, b) => a - b);
  const lines = lineTops.map(t => info.filter(i => i.top === t));
  // A line "ends with a separator" if its LAST fragment carries a visible
  // ::after, or if it is the final fragment of a wrapped row and something
  // else put ink there. With ::before-only separators this must be empty.
  const stranded = [];
  for (const line of lines) {
    const last = line[line.length - 1];
    if (last.after && last.after !== 'none' && last.after !== 'normal') {
      stranded.push({ line: last.text, via: '::after', content: last.after });
    }
  }
  return {
    rowWidth: Math.round(row.getBoundingClientRect().width),
    display: getComputedStyle(row).display,
    flexWrap: getComputedStyle(row).flexWrap,
    lineCount: lines.length,
    lines: lines.map(l => l.map(i => ({ t: i.text, before: i.before, after: i.after }))),
    stranded,
  };
}
"""


async def main():
    widths = [(390, 844), (402, 874), (320, 667), (360, 640), (430, 932), (1280, 900)]
    total_bad = 0
    async with async_playwright() as p:
        browser = await p.webkit.launch()
        for w, h in widths:
            page = await browser.new_page(viewport={"width": w, "height": h})
            await page.goto(TARGET, wait_until="load", timeout=30000)
            d = await page.evaluate(PROBE)
            await page.close()
            if "error" in d:
                print(f"  {w}x{h}: ERROR {d['error']}")
                total_bad += 1
                continue
            verdict = "PASS" if not d["stranded"] else "FAIL"
            if d["stranded"]:
                total_bad += 1
            print(f"  {w}x{h}  row={d['rowWidth']}px {d['display']}/{d['flexWrap']} "
                  f"lines={d['lineCount']}  {verdict}")
            for i, line in enumerate(d["lines"]):
                parts = "  ||  ".join(
                    f"{q['t']!r} before={q['before']} after={q['after']}" for q in line)
                print(f"        line {i+1}: {parts}")
            if d["stranded"]:
                for s in d["stranded"]:
                    print(f"        STRANDED: {s}")
        await browser.close()
    print(f"\n{'ALL WIDTHS PASS' if total_bad == 0 else str(total_bad) + ' viewport(s) FAILED'}")
    return 0 if total_bad == 0 else 1


raise SystemExit(asyncio.run(main()))