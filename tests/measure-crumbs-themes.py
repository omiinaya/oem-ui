#!/usr/bin/env python3
"""breadcrumb across viewports and BOTH themes, measured in WebKit.

Desktop plus both themes on the phone, because a themed token read in one
theme says nothing about which theme was measured - the oem-ngo-brand
probe in this repo reported a false contrast failure from exactly that.
"""
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"

JS = """
() => {
  const t = document.querySelectorAll('.cm-crumbs')[1];
  const tr = t.getBoundingClientRect();
  const items = [...t.querySelectorAll('.cm-crumbs__link, .cm-crumbs__here')];
  const link = t.querySelector('.cm-crumbs__link');
  const cs = getComputedStyle(link);
  const here = t.querySelector('.cm-crumbs__here');
  return {
    theme: document.documentElement.getAttribute('data-theme') || 'dark (default)',
    trailH: Math.round(tr.height),
    rows: new Set(items.map(a => Math.round(a.getBoundingClientRect().top))).size,
    linkColour: cs.color,
    hereColour: getComputedStyle(here).color,
    items: items.map(a => {
      const r = a.getBoundingClientRect();
      return {
        txt: a.textContent.trim().slice(0, 24),
        h: Math.round(r.height * 100) / 100,
        current: a.getAttribute('aria-current'),
      };
    }),
  };
}
"""


def lum(c):
    # sRGB relative luminance, for the contrast read on the crumb labels
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = c
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def parse(s):
    nums = [float(x) for x in s[s.index("(") + 1 : s.index(")")].split(",")[:3]]
    return nums


def ratio(fg, bg):
    a, b = lum(parse(fg)), lum(parse(bg))
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


with sync_playwright() as pw:
    b = pw.webkit.launch()
    for label, w, h, theme in [
        ("desktop 1440x900", 1440, 900, "dark"),
        ("iPhone 393 dark", 393, 852, "dark"),
        ("iPhone 393 LIGHT", 393, 852, "light"),
    ]:
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(w < 500))
        p = ctx.new_page()
        p.goto(URL, wait_until="networkidle")
        # Clear storage BEFORE measuring: a theme saved by an earlier
        # context otherwise leaks in and you read the other theme.
        p.evaluate("() => localStorage.clear()")
        p.evaluate("t => localStorage.setItem('cm-theme', t)", theme)
        p.reload(wait_until="networkidle")
        box = p.evaluate(JS)
        bg = p.evaluate("() => getComputedStyle(document.body).backgroundColor")
        print(f"--- {label} ---")
        print(f"  theme={box['theme']}  trail height={box['trailH']}px  rows={box['rows']}")
        print(f"  crumb link {box['linkColour']} on {bg} = {ratio(box['linkColour'], bg):.2f}:1")
        print(f"  current     {box['hereColour']} on {bg} = {ratio(box['hereColour'], bg):.2f}:1")
        for it in box["items"]:
            print(f"    {it['h']:6.2f}h  current={str(it['current']):6s} {it['txt']}")
        ctx.close()
    b.close()
