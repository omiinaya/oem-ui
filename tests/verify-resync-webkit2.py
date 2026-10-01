#!/usr/bin/env python
"""Measure the re-synced consumers in WebKit, not Chromium.

Fix: emulate touch (pointer: coarse) so the library's tap-floor media
query actually applies. A 32px icon button becomes 44x44 under coarse
pointer in the library, and the probe was running with fine pointer by
default.
"""
import sys
import urllib.request

from playwright.sync_api import sync_playwright

IPHONE = {"width": 390, "height": 844}
TAP_FLOOR = 44

TARGETS = [
    ("dev-blog", "http://192.168.1.68:4322/", "main, .prose, body"),
    ("oem-portfolio", "http://192.168.1.68:4401/", "main, body"),
]

PROBE = r"""
(cfg) => {
  const out = {label: cfg.label, errors: [], tokens: {}, taps: [], overflow: []};
  const main = document.querySelector(cfg.sel) || document.body;
  out.docHeight = document.documentElement.scrollHeight;
  out.docWidth  = document.documentElement.scrollWidth;
  out.winWidth  = window.innerWidth;
  const cs = getComputedStyle(document.documentElement);
  for (const t of ['--ink', '--ink-dim', '--ink-faint', '--bg', '--line', '--radius']) {
    out.tokens[t] = cs.getPropertyValue(t).trim();
  }
  for (const el of document.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;
    const smaller = Math.min(r.width, r.height);
    if (smaller < cfg.floor) {
      out.taps.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.overflow.push({what: 'document', w: document.documentElement.scrollWidth});
  }
  for (const el of document.querySelectorAll('main, .prose, header, nav, table, pre')) {
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth + 1) {
      out.overflow.push({what: el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0], right: Math.round(r.right)});
    }
  }
  out.mainHeight = Math.round(main.getBoundingClientRect().height);
  return out;
}
"""

failures = []
passed = 0


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}  {detail}")
    else:
        failures.append(name)
        print(f"  FAIL {name}  {detail}")


with sync_playwright() as p:
    browser = p.webkit.launch()
    for label, url, sel in TARGETS:
        try:
            urllib.request.urlopen(url, timeout=5)
        except Exception as e:
            failures.append(f"{label}: not serving")
            print(f"  FAIL {label} is not serving at {url} ({e})")
            continue
        # A real iPhone device descriptor: it sets has_touch, which is what
        # makes WebKit report `pointer: coarse`. emulate_media() has no
        # `pointer` feature, so a device descriptor is the only way to get
        # the library's tap-floor media query to apply at all.
        ctx = browser.new_context(**p.devices["iPhone 13"])
        page = ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console.append(str(e)))
        page.add_init_script("try { localStorage.clear(); } catch (e) {}")
        page.goto(url, wait_until="load")
        page.wait_for_timeout(600)
        coarse = page.evaluate("matchMedia('(pointer: coarse)').matches")
        print(f"  ..   pointer:coarse is {coarse}")
        r = page.evaluate(PROBE, {"label": label, "sel": sel, "floor": TAP_FLOOR})
        print(f"\n### {label} at {IPHONE['width']}x{IPHONE['height']} (WebKit, pointer:coarse)")
        check(f"{label}: height real", r["docHeight"] > 800, f"scrollHeight={r['docHeight']}")
        check(f"{label}: content rendered", r["mainHeight"] > 400, f"main={r['mainHeight']}")
        for t, v in r["tokens"].items():
            check(f"{label}: {t} resolves", bool(v) and not v.startswith("var("), f"-> {v or 'EMPTY'}")
        check(f"{label}: no sideways scroll", not r["overflow"], f"-> {r['overflow'] or '0px'}")
        check(f"{label}: tap targets ≥{TAP_FLOOR}px", not r["taps"], f"-> {r['taps'][:4] or 'all pass'}")
        errs = [e for e in console if "favicon" not in e.lower()]
        check(f"{label}: no console errors", not errs, f"-> {errs[:2] or 'none'}")
        page.close()
        ctx.close()
    browser.close()

print(f"\n{'all checks passed' if not failures else str(len(failures)) + ' FAILED'} ({passed} ok)")
sys.exit(1 if failures else 0)
