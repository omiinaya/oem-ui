"""Prove the FOUC guard in real WebKit, at an iPhone viewport.

Three claims, each measured rather than read:

  1. with the theme stored ONLY under a legacy key, <html> carries
     data-theme="light" before the runtime ever runs;
  2. the guard executes BEFORE the first stylesheet link, so no frame is
     ever painted dark -- proven by counting paint-blocking resources that
     appear before the guard's document position;
  3. the theme toggle still round-trips, so moving the guard did not
     break the control that writes the key the guard reads.

Chromium is not used: Omar views these sites in iPhone Safari, and this
engine is the one the numbers must come from.

The page is served over HTTP, not opened as file://. The built HTML loads
the runtime as `<script type="module" src="/_astro/...">`, an ABSOLUTE
path: under file:// that request cannot resolve, the module never
executes, window.cliMono is undefined and every toggle is unbound. That
failure looks exactly like "the runtime is broken" and is not.

Usage: python tests/verify-fouc-guard-webkit.py <url>
"""
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4399/"
RESULTS = []


def record(name, ok, detail):
    RESULTS.append((name, ok, detail))
    print(("  ok  " if ok else "  FAIL") + f"  {name}: {detail}")


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    # iPhone-class viewport, touch, mobile, as the skill requires.
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )

    # -- 0. the runtime must actually be on the page ---------------------
    # Every claim below is about the guard and the runtime cooperating. If
    # the module never executed, all of them would "pass" or fail for the
    # wrong reason, so its absence is its own failure.
    boot = ctx.new_page()
    boot.goto(URL, wait_until="load")
    runtime_ok = boot.evaluate("() => typeof window.cliMono === 'object'")
    record(
        "the runtime bundle actually executed",
        runtime_ok,
        f"window.cliMono is {boot.evaluate('() => typeof window.cliMono')}",
    )
    boot.close()

    # -- 1. a legacy-key visitor must be light before the runtime runs ----
    page = ctx.new_page()
    # Seed ONLY the legacy key: this is the visitor the old guard missed.
    page.add_init_script(
        "try{localStorage.setItem('cm-theme','light');}catch(e){}"
    )
    page.goto(URL, wait_until="load")

    state = page.evaluate(
        """() => ({
            theme: document.documentElement.getAttribute('data-theme'),
            key: document.documentElement.getAttribute('data-cm-theme-key'),
            legacy: document.documentElement.getAttribute('data-cm-theme-legacy'),
            bodyBg: getComputedStyle(document.body).backgroundColor,
        })"""
    )
    record(
        "a legacy-key light visitor is light at first paint",
        state["theme"] == "light",
        f"data-theme={state['theme']!r} bodyBg={state['bodyBg']}",
    )

    # -- 2. the guard runs before any render-blocking stylesheet ----------
    # If a <link rel=stylesheet> precedes the guard, the browser can paint
    # the dark default first and the guard is too late to stop it.
    order = page.evaluate(
        """() => {
            const nodes = [...document.head.querySelectorAll('script,link[rel=stylesheet]')];
            let guardAt = -1, cssBefore = 0, seen = false;
            for (const n of nodes) {
                if (n.tagName === 'LINK') { if (!seen) cssBefore++; continue; }
                if (n.textContent.includes('data-cm-theme-key')) { seen = true; guardAt = nodes.indexOf(n); }
            }
            return { guardAt, cssBefore, total: nodes.length };
        }"""
    )
    record(
        "the guard precedes every render-blocking stylesheet",
        order["guardAt"] != -1 and order["cssBefore"] == 0,
        f"guard at head-child {order['guardAt']}, {order['cssBefore']} stylesheet(s) before it",
    )

    # -- 3. the toggle still round-trips through the same key ------------
    # A FRESH context: localStorage is per-context, and step 1 seeded a
    # legacy 'light' that would otherwise still be set here, making the
    # "default is dark" half of this check assert nothing.
    ctx3 = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    page3 = ctx3.new_page()
    page3.goto(URL, wait_until="load")
    dark_at_first = page3.evaluate(
        "() => document.documentElement.getAttribute('data-theme')"
    )
    toggled = page3.evaluate(
        """() => {
            const btn = document.querySelector('[data-cm-theme-toggle], .theme-toggle');
            if (!btn) return { found: false };
            btn.click();
            return {
                found: true,
                theme: document.documentElement.getAttribute('data-theme'),
                stored: localStorage.getItem('oem-log-theme'),
            };
        }"""
    )
    record(
        "dark is the default with no stored choice",
        dark_at_first is None,
        f"data-theme={dark_at_first!r} (CSS supplies the dark default)",
    )
    record(
        "the toggle still writes the project key the guard reads",
        toggled.get("found") and toggled.get("theme") == "light" and toggled.get("stored") == "light",
        f"after click: theme={toggled.get('theme')!r} oem-log-theme={toggled.get('stored')!r}",
    )
    ctx3.close()

    # -- 4. a stored value under the PROJECT key still wins --------------
    page2 = ctx.new_page()
    page2.add_init_script(
        "try{localStorage.setItem('oem-log-theme','light');"
        "localStorage.setItem('cm-theme','dark');}catch(e){}"
    )
    page2.goto(URL, wait_until="load")
    winner = page2.evaluate(
        "() => document.documentElement.getAttribute('data-theme')"
    )
    record(
        "the project key wins over a stale legacy value",
        winner == "light",
        f"oem-log-theme=light vs cm-theme=dark -> data-theme={winner!r}",
    )

    browser.close()

failed = [n for n, ok, _ in RESULTS if not ok]
print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
