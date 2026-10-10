#!/root/.venvs/mau/bin/python
"""Prove the policy half of "the page never pans sideways" at 390, and name
the widest element when the raw scrollWidth disagrees with it.
"""
import sys, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4471/'

JS = """() => {
  const de = document.documentElement;
  const over = [];
  const lim = de.scrollWidth + 50;
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.right > de.clientWidth + 1 && r.width < lim && r.width > 0) {
      over.push({t: el.tagName, c: (el.className || '').toString().slice(0, 44),
                 right: Math.round(r.right), w: Math.round(r.width)});
    }
  });
  over.sort((a, b) => b.right - a.right);
  const g = document.querySelector('#cal-multiple .cm-cal__grid');
  const gr = g ? g.getBoundingClientRect() : null;
  return {
    scrollW: de.scrollWidth, clientW: de.clientWidth,
    htmlOverflowX: getComputedStyle(de).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    calRight: gr ? Math.round(gr.right) : null,
    calWidth: gr ? Math.round(gr.width) : null,
    calParentRight: gr ? Math.round(g.parentElement.getBoundingClientRect().right) : null,
    calScrollable: g ? g.parentElement.scrollWidth > g.parentElement.clientWidth : null,
    widest: over.slice(0, 4), overflowCount: over.length
  };
}"""

with sync_playwright() as ph:
    b = ph.webkit.launch()
    p = b.new_page(viewport={'width': 390, 'height': 844})
    p.goto(URL, wait_until='load')
    p.wait_for_function('() => !!window.cliMono', timeout=15000)
    p.wait_for_timeout(400)
    print(json.dumps(p.evaluate(JS), indent=1))
    b.close()
