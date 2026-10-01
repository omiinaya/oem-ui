#!/usr/bin/env python3
"""Screenshot JUST the breadcrumb section, at phone width, for a vision read.

The vision model refused a full-page capture at 100px wide and was right to:
a chevron glyph is sub-pixel there. So this clips to the section's own
bounding box at an iPhone viewport, where the trail actually wraps.
"""
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"
OUT = "/tmp/crumbs-iphone.png"

with sync_playwright() as pw:
    b = pw.webkit.launch()
    ctx = b.new_context(
        viewport={"width": 393, "height": 852},
        has_touch=True,
        is_mobile=True,
        device_scale_factor=3,
    )
    p = ctx.new_page()
    p.goto(URL, wait_until="networkidle")
    p.evaluate("() => localStorage.clear()")
    p.reload(wait_until="networkidle")
    p.locator("#crumbs").scroll_into_view_if_needed()
    p.wait_for_timeout(400)
    p.locator("#crumbs").screenshot(path=OUT)
    print("wrote", OUT)
    b.close()
