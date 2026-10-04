#!/usr/bin/env python3
"""Isolated-control measurement: compare a variant's own box against its base.

Appends each variant to its OWN fixed-width empty host appended to body, reads
getBoundingClientRect().height, then removes the host. A variant compared to
the set of heights of its siblings in a real row measures STRETCH, not its own
box: align-items:normal (the default) fills the row from the tallest sibling
regardless of the element's own min-height.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = "http://192.168.1.68:4321/"
JS = r"""
() => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:300px;';
  document.body.appendChild(host);
  const read = (cls) => {
    host.innerHTML = '<a class="' + cls + '" href="#x">label</a>';
    const el = host.firstElementChild;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const out = { h: r.height, w: r.width, minHeight: cs.minHeight,
                  pad: cs.paddingTop + '/' + cs.paddingBottom, display: cs.display };
    host.innerHTML = '';
    return out;
  };
  const out = { pairs: {} };
  for (const pair of arguments) {} // noop
  return out;
}
"""

async def main(pairs, widths=(390, 375, 1440)):
    async with async_playwright() as p:
        b = await p.webkit.launch()
        res = {}
        for w in widths:
            page = await b.new_page(viewport={'width': w, 'height': 844})
            await page.goto(URL, wait_until='networkidle')
            await page.evaluate("() => { try { localStorage.clear(); } catch (e) {} }")
            await page.reload(wait_until='networkidle')
            r = {}
            for name, sel in pairs:
                r[name] = await page.evaluate(
                    """([sel]) => {
                        const host = document.createElement('div');
                        host.style.cssText = 'position:absolute;left:-99999px;top:0;width:300px;';
                        document.body.appendChild(host);
                        host.innerHTML = '<a class="' + sel + '" href="#x">label</a>';
                        const el = host.firstElementChild;
                        const rect = el.getBoundingClientRect();
                        const cs = getComputedStyle(el);
                        const out = { h: rect.height, minHeight: cs.minHeight,
                                      display: cs.display, color: cs.color };
                        host.remove();
                        return out;
                    }""", [sel])
            res[w] = r
            await page.close()
        await b.close()
        return res

if __name__ == '__main__':
    pairs = json.loads(sys.argv[1])
    widths = json.loads(sys.argv[2]) if len(sys.argv) > 2 else [390, 375, 1440]
    print(json.dumps(asyncio.run(main(pairs, widths)), indent=2))
