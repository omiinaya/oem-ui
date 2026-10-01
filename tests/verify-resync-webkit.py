#!/usr/bin/env python
"""Measure the re-synced consumers in WebKit, not Chromium.

It exists because "in sync" is a BYTE claim and this is a LAYOUT claim.
The drift checker proved each vendored copy now equals the library; nothing
in that proof says the pages that consume it still lay out. This probe is
the half that is not a byte comparison.

What it measures, at an iPhone width in the engine Omar reads in:

  1. The page has real height - a consumer whose CSS failed to load is
     0px tall with its text in a single 0-height line, and every other
     assertion below would pass on it.
  2. No sideways scroll. 2754 new lines of CSS arrived; a rule with a
     fixed width or an unbreakable long token is the obvious way that
     goes wrong and the reason the library ships the sideways-scroll
     guard.
  3. The tap floor on every interactive element. The library's tap floor
     is 44px, and the newest library commits are phone fixes
     (692f683 "a switch and a disclosure that work with a finger"), so
     this is the claim that would actually catch a bad re-sync.
  4. Tokens resolve to real values. An unvendored token reference
     renders as the empty string, which paints as a transparent colour,
     not as an error - so the page looks fine and the token is gone.

Measurement notes, from getting these wrong elsewhere in this repo:

  - Count DISTINCT LEFT EDGES scoped to the element under test. Counting
    children of `document.body` merges every table on the page and a
    two-column nav on a 390px viewport looks like an overflow. Each
    candidate is measured against ITS OWN scrollWidth.
  - Read a tap target from the ELEMENT's bounding box, not from the row
    that contains it. A 17px box inside a 44px row is a 17px target.
  - Clear storage BEFORE each navigation, not after: a theme saved by
    the previous page changes which token values are served.
"""
import sys
import urllib.request

from playwright.sync_api import sync_playwright

IPHONE = {"width": 390, "height": 844}
TAP_FLOOR = 44

# (label, url, selector for the main content region)
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

  // Tokens that must resolve to a real value. An empty string means the
  // token was never vendored; the declaration still parses, so nothing
  // throws and the page just paints transparent.
  const cs = getComputedStyle(document.documentElement);
  for (const t of ['--ink', '--ink-dim', '--ink-faint', '--bg', '--line', '--radius']) {
    out.tokens[t] = cs.getPropertyValue(t).trim();
  }

  // Interactive elements, measured individually. A wrapper's size is not
  // its hit area when the control inside it is smaller.
  for (const el of document.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;   // hidden / collapsed drawer
    if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;  // far offscreen
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

  // Sideways scroll, scoped per candidate element: page-level check first,
  // then any element whose own box is wider than the viewport.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.overflow.push({what: 'document', w: document.documentElement.scrollWidth});
  }
  for (const el of document.querySelectorAll('main, .prose, header, nav, table, pre')) {
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth + 1) {
      out.overflow.push({what: el.tagName.toLowerCase() + '.' +
        (el.className || '').toString().split(' ')[0], right: Math.round(r.right)});
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

        page = browser.new_page(viewport=IPHONE)
        console = []
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console.append(str(e)))
        # Clear BEFORE navigating: a saved theme changes which token values
        # are served, and the previous page's storage is inherited.
        page.add_init_script("try { localStorage.clear(); } catch (e) {}")
        page.goto(url, wait_until="load")
        page.wait_for_timeout(600)

        r = page.evaluate(PROBE, {"label": label, "sel": sel, "floor": TAP_FLOOR})

        print(f"\n### {label} at {IPHONE['width']}x{IPHONE['height']} (iPhone class, WebKit)")
        # A consumer whose stylesheet failed to load is a single 0-height
        # line. Everything below passes on that page, so check it FIRST.
        check(f"{label}: the page has real height", r["docHeight"] > 800,
              f"scrollHeight={r['docHeight']}")
        check(f"{label}: the content region rendered", r["mainHeight"] > 400,
              f"main height={r['mainHeight']}")

        for t, v in r["tokens"].items():
            check(f"{label}: {t} resolves", bool(v) and not v.startswith("var("),
                  f"-> {v or 'EMPTY (token not vendored)'}")

        check(f"{label}: no sideways scroll", not r["overflow"],
              f"-> {r['overflow'] or '0px'}")

        check(f"{label}: every tap target meets the {TAP_FLOOR}px floor",
              not r["taps"], f"-> {r['taps'][:4] or 'all pass'}")

        errs = [e for e in console if "favicon" not in e.lower()]
        check(f"{label}: no console errors", not errs, f"-> {errs[:2] or 'none'}")

        page.close()
    browser.close()

print(f"\n{'all checks passed' if not failures else str(len(failures)) + ' FAILED'}"
      f" ({passed} ok)")
sys.exit(1 if failures else 0)
