#!/root/.venvs/mau/bin/python
"""Measure that a selected day fills its OWN <td> exactly - the claim a
screenshot cannot settle and a colour check cannot see.
"""
import sys
from playwright.sync_api import sync_playwright
from harness_wait import boot_timeout

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
D = '/root/.hermes/cache/scratch/'

with sync_playwright() as ph:
    b = ph.webkit.launch()
    p = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    p.goto(URL, wait_until='load')
    p.wait_for_function('() => !!window.cliMono', timeout=boot_timeout())
    p.add_style_tag(content='html { scroll-behavior: auto !important; }')
    p.wait_for_timeout(300)
    for cid in ('cal-single', 'cal-multiple', 'cal-range'):
        # Scroll the element itself to the top of the viewport, then let
        # it settle, so `element.screenshot()` (which scrolls internally)
        # has nothing left to do and cannot crop mid-flight.
        p.evaluate("(id) => document.getElementById(id)"
                   ".scrollIntoView({block:'start', behavior:'instant'})", cid)
        p.wait_for_timeout(250)
        el = p.query_selector('#' + cid)
        el.screenshot(path=D + cid + '.png')
        print('wrote', D + cid + '.png')
    b.close()
