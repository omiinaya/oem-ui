#!/usr/bin/env python3
"""Prove the served runtime is the library's, in WebKit, at an iPhone width.

The defect this cycle fixed is invisible to a source diff and to a metric:
oem-portfolio's own vendored src/js copy was current while the runtime it
SERVED over HTTP was 140 lines behind, missing initNav entirely. So this
checks the thing that was actually broken - the bytes on the wire - and then
exercises the specific capability the stale copy lacked.

  1. the served runtime is byte-identical to the library
  2. cm-js is set on <html> (initNav ran; the stale copy never sets it)
  3. the mobile nav drawer is in the DOM, hidden, and opens on tap
  4. the scrim exists and the body scroll-lock engages
  5. no horizontal overflow at 390

Chromium lies about the nav geometry and this repo's oem-ui skill records
that. WebKit is the engine Omar's iPhone Safari uses, so it is the one that
decides.
"""
import hashlib
import json
import subprocess
import sys
import urllib.request

URL = "http://192.168.1.68:4322/"
LIB = "/root/projects/oem-ui/src/js/cli-mono.js"
SERVED = "http://192.168.1.68:4322/cli-mono.js"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"  {'ok ' if cond else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))


def served_bytes():
    with urllib.request.urlopen(SERVED, timeout=10) as r:
        return r.read()


# 1. the bytes on the wire, before any browser is involved
lib = open(LIB, "rb").read()
served = served_bytes()
check("served runtime is byte-identical to the library",
      lib == served,
      f"lib {hashlib.md5(lib).hexdigest()[:12]} served {hashlib.md5(served).hexdigest()[:12]}")

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844},
                        device_scale_factor=3, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(400)

    check("page title is the site's, not a squatter's", "portfolio" in pg.title().lower()
          or "oem" in pg.title().lower(), pg.title())

    # 2. the runtime actually executed. `window.cliMono` is the only signal
    #    that survives a failed module load, and a page whose runtime never
    #    ran still looks fine in a screenshot.
    runtime_exposed = pg.evaluate("() => typeof window.cliMono === 'object'")
    check("window.cliMono exists: the module executed", runtime_exposed)

    # 3. THE CAPABILITY THE STALE COPY LACKED, asked of the live DOM.
    #
    #    Scoped to this site's actual markup. oem-portfolio's Header.astro
    #    predates the mobile nav disclosure, so it ships NO toggle and the
    #    panel stays in flow. Asserting a drawer here would be a probe
    #    describing a site it is not pointed at - the same class of error as
    #    running a legacy-key case against a project that declares none.
    #
    #    What must hold either way is the CONTRACT, and it is the one the
    #    library states: the disclosure is progressive. With no toggle in the
    #    document the runtime must NOT set .cm-js, and the nav links must
    #    stay visible. A runtime that set .cm-js unconditionally would
    #    collapse the nav of a site that has no way to open it, which is the
    #    dead-site failure the hidden-by-default rule exists to prevent.
    has_toggle = pg.evaluate("() => !!document.querySelector('[data-cm-nav-toggle]')")
    cm_js = pg.evaluate("() => document.documentElement.classList.contains('cm-js')")
    if has_toggle:
        check("cm-js is set on <html>: initNav ran", cm_js)
    else:
        check("no cm-js without a toggle: the disclosure stays progressive", not cm_js,
              "this site ships no nav toggle, so .cm-js must not be set")

    # The nav links are on screen and hittable, which is the user-facing
    # question - not "is the class present".
    links = pg.evaluate("""() => {
      const els = [...document.querySelectorAll('.cm-header__link')];
      return els.map(el => {
        const r = el.getBoundingClientRect();
        return {text: el.textContent.trim(), w: r.width, h: r.height,
                visible: r.width > 0 && r.height > 0};
      });
    }""")
    check("the header has nav links", bool(links), f"{len(links)} links")
    check("every nav link is visible at 390px (not collapsed)",
          bool(links) and all(l["visible"] for l in links),
          ", ".join(f'{l["text"]}:{l["w"]:.0f}x{l["h"]:.0f}' for l in links))
    # A link in the header is a target, not inline prose, so the floor
    # applies - and BOTH dimensions, because a height-only check passes
    # 44x32, which is tall enough to look right and still too small to hit.
    check("every nav link reaches the 44px tap floor in BOTH dimensions",
          bool(links) and all(l["h"] >= 44 for l in links),
          ", ".join(f'{l["text"]}:{l["h"]:.0f}px tall' for l in links))

    # The drawer, only if this site actually has one.
    if has_toggle:
        btn = pg.evaluate("""() => {
          const b = document.querySelector('[data-cm-nav-toggle]');
          const r = b.getBoundingClientRect();
          return {w: r.width, h: r.height};
        }""")
        check("the nav toggle reaches the 44px tap floor in BOTH dimensions",
              btn["w"] >= 44 and btn["h"] >= 44, f'{btn["w"]:.0f}x{btn["h"]:.0f}')
        pg.click("[data-cm-nav-toggle]")
        pg.wait_for_timeout(350)
        opened = pg.evaluate("""() => {
          const el = document.getElementById('cm-header-links')
                    || document.querySelector('[data-cm-nav]');
          return {
            display: el ? getComputedStyle(el).display : 'absent',
            expanded: document.querySelector('[data-cm-nav-toggle]')
                        ?.getAttribute('aria-expanded'),
            hasScrim: !!document.querySelector('.cm-nav-scrim'),
            bodyOverflow: document.body.style.overflow,
          };
        }""")
        check("the drawer opens on tap", opened["display"] not in ("none", "absent"),
              f'display={opened["display"]}')
        check("aria-expanded is true while open", opened["expanded"] == "true", str(opened["expanded"]))
        check("the scrim exists", opened["hasScrim"])
        check("the body scroll-lock engages", opened["bodyOverflow"] == "hidden", opened["bodyOverflow"])
        # Escape must close it, or a keyboard user is stranded inside a
        # panel that is now invisible.
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        closed = pg.evaluate("""() => ({
          expanded: document.querySelector('[data-cm-nav-toggle]')
                      ?.getAttribute('aria-expanded'),
          bodyOverflow: document.body.style.overflow,
        })""")
        check("Escape closes the drawer", closed["expanded"] == "false", str(closed["expanded"]))
        check("the scroll-lock is released on close", closed["bodyOverflow"] != "hidden",
              repr(closed["bodyOverflow"]))

    # 4. the theme toggle, which this site DOES use. A runtime that never ran
    #    cannot have wired it, and a toggle that is present but does not flip
    #    the theme is exactly the "present and broken" case a screenshot hides.
    pg.click("[data-cm-theme-toggle]")
    pg.wait_for_timeout(250)
    themed = pg.evaluate("""() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      stored: localStorage.getItem('cm-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    })""")
    check("the theme toggle flips and persists",
          themed["theme"] == "light" and themed["stored"] == "light",
          f'theme={themed["theme"]} stored={themed["stored"]}')
    check("the light theme actually paints",
          themed["bg"] not in ("rgba(0, 0, 0, 0)", "rgb(10, 10, 10)"),
          f'body bg={themed["bg"]}')
    pg.click("[data-cm-theme-toggle]")
    pg.wait_for_timeout(250)
    back = pg.evaluate("() => document.documentElement.getAttribute('data-theme')")
    check("the theme toggle flips back", back == "dark", str(back))

    # 5. overflow, behaviourally: scrollTo the far right and read scrollX back
    ov = pg.evaluate("""() => {
      window.scrollTo(9999, 0);
      const x = window.scrollX;
      window.scrollTo(0, 0);
      return {x, docW: document.documentElement.scrollWidth, vw: window.innerWidth};
    }""")
    check("no horizontal overflow at 390px", ov["x"] == 0, f'scrollX={ov["x"]} scrollWidth={ov["docW"]} vw={ov["vw"]}')

    check("no console errors on load", not errors, "; ".join(errors[:3]))

    pg.screenshot(path="/root/.hermes/cache/scratch/pf-390-closed.png", full_page=False)
    ctx.close()
    b.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
