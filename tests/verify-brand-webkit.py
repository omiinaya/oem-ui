#!/usr/bin/env python
"""Measure oem-ngo-brand in WebKit, not Chromium.

Run it:
    cd /root/projects/oem-ngo-brand && python3 -m http.server 8911 --bind 0.0.0.0
    /root/.venvs/mau/bin/python tests/verify-brand-webkit.py

It lives in the library, not in the consumer, on purpose: this probe is
the PROOF that a consumer was migrated correctly, and the thing that
went wrong here was never the consumer's markup - it was the drift
checker calling a broken migration "in sync". Proving a consumer means
measuring the SERVED page in the engine Omar reads it in, so the probe
belongs next to the gate that is allowed to declare victory.

Three claims, none of them provable from the source:
  1. The migrated pages still render their content - the token swap did
     not take out the box model underneath them.
  2. The library's tokens are the ones actually in play, at the
     library's contrast, not the values this page used to hand-declare.
  3. The guard runs before paint, from the library file.

MEASUREMENT NOTES, learned by getting them wrong first:

  - Read --ink-faint in BOTH themes and compare against the library's
    own pair. A single read says nothing: the first version of this
    probe cleared localStorage AFTER asserting, so the second page
    inherited a saved light theme and reported the light value (#6d6d6d)
    while claiming the dark one had failed.
  - The two pages carry DIFFERENT content. index.html is the wordmark
    page and its marks are inline <svg>; letters.html is the letterform
    page and its specimens are .spec divs with NO svg at all. Asserting
    "SVGs render" on letters.html asserts a thing the page never had, and
    a probe that asserts the wrong thing is worse than no probe: it fails
    on a correct page and gets ignored.
  - Clear storage BEFORE every measurement, not after.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8911"
IPHONE = {"width": 390, "height": 844}

# The library's own token values, for reference (src/styles/tokens.css).
FAINT_DARK, FAINT_LIGHT = "#8b8b8b", "#6d6d6d"

fails = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{('  -> ' + detail) if detail else ''}")
    if not ok:
        fails.append(name)


def probe(page, path):
    """Read a token in a known theme, with storage cleared first."""
    page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
    page.evaluate("() => localStorage.clear()")
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    read = """() => getComputedStyle(document.documentElement)
                  .getPropertyValue('--ink-faint').trim().toLowerCase()"""
    dark = page.evaluate(read)
    bg_dark = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    page.goto(f"{BASE}{path}?theme=light", wait_until="networkidle")
    light = page.evaluate(read)
    bg_light = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    page.evaluate("() => localStorage.clear()")
    return dark, light, bg_dark, bg_light


with sync_playwright() as p:
    browser = p.webkit.launch()
    ctx = browser.new_context(viewport=IPHONE, device_scale_factor=3)
    page = ctx.new_page()

    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    failed = []
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.on("response", lambda r: failed.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    # ---- 1. the library layers actually load -------------------------
    # A 404 here still renders, because each page's own <style> block
    # carries enough to look plausible. That is the silent version of
    # this bug, and it is the reason the migration needed a probe.
    page.goto(f"{BASE}/", wait_until="networkidle")
    print("### library layers are served, not just referenced")
    for asset in ("tokens.css", "base.css", "components.css"):
        check(f"{asset} loaded",
              not any(asset in f for f in failed),
              next((f for f in failed if asset in f), ""))

    for path in ("/", "/letters.html"):
        print(f"\n### {path} at 390x844 (iPhone class, WebKit)")
        dark, light, bg_dark, bg_light = probe(page, path)
        check("--ink-faint is the library DARK value (#8b8b8b)",
              dark == FAINT_DARK, f"got {dark}")
        check("--ink-faint is the library LIGHT value (#6d6d6d)",
              light == FAINT_LIGHT, f"got {light}")
        # The values the migration replaced: 2.66:1 dark / 3.33:1 light.
        check("the pre-migration #555555 is gone",
              dark != "#555555" and light != "#8a8a8a",
              f"dark={dark} light={light}")
        check("?theme=light actually changes the page",
              bg_dark != bg_light, f"{bg_dark} -> {bg_light}")

        # ---- the guard runs before paint -----------------------------
        page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        page.evaluate("() => localStorage.setItem('cm-theme','light')")
        page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        check("guard applies the saved light theme", theme == "light", f"data-theme={theme}")
        page.evaluate("() => localStorage.clear()")

        # ---- the page still renders its own content -----------------
        # Each page is checked for what it ACTUALLY contains.
        page.goto(f"{BASE}{path}", wait_until="networkidle")
        if path == "/":
            n = page.evaluate("""() => [...document.querySelectorAll('svg')]
                .filter(e => e.getBoundingClientRect().width > 0).length""")
            check("wordmark SVGs render with geometry", n > 0, f"{n} sized svgs")
        else:
            n = page.evaluate("""() => [...document.querySelectorAll('.spec')]
                .filter(e => e.getBoundingClientRect().width > 0).length""")
            check("letterform specimens render", n > 0, f"{n} sized .spec blocks")

        # ---- layout integrity at phone width ------------------------
        sw = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("no sideways scroll", sw <= 0, f"{sw}px")

        shot = "/root/.hermes/cache/scratch/brand" + path.replace("/", "_").replace(".html", "") + ".png"
        page.screenshot(path=shot)

    check("no console errors", not errors, "; ".join(errors[:3]))
    browser.close()

print()
if fails:
    print(f"FAILED: {len(fails)}")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
print("all checks passed")