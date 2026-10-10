#!/root/.venvs/mau/bin/python
"""Shoot each .cm-cal specimen on its own, full height, at 390x844.
"""
import sys, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'

JS = """() => {
  const out = {};
  for (const id of ['cal-single', 'cal-multiple', 'cal-range']) {
    const c = document.getElementById(id);
    const heads = c.querySelectorAll('thead th').length;
    const sel = [...c.querySelectorAll('.cm-cal__day[aria-selected="true"]')]
      .map(b => {
        const td = b.closest('td');
        const br = b.getBoundingClientRect(), tr = td.getBoundingClientRect();
        return {day: b.dataset.cmDay,
                dW: +(br.width - tr.width).toFixed(2),
                dH: +(br.height - tr.height).toFixed(2),
                dTop: +(br.top - tr.top).toFixed(2),
                cellW: +tr.width.toFixed(2), cellH: +tr.height.toFixed(2)};
      });
    out[id] = {weekdayHeads: heads, selected: sel};
  }
  return out;
}"""

with sync_playwright() as ph:
    b = ph.webkit.launch()
    p = b.new_page(viewport={'width': 390, 'height': 844})
    p.goto(URL, wait_until='load')
    p.wait_for_function('() => !!window.cliMono', timeout=15000)
    p.add_style_tag(content='html { scroll-behavior: auto !important; }')
    p.wait_for_timeout(300)
    print(json.dumps(p.evaluate(JS), indent=1))
    b.close()
