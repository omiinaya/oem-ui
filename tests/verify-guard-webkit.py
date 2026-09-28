#!/usr/bin/env python3
"""
Prove the FOUC guard does its job in the engine Omar actually uses.

The guard's whole purpose is to apply a saved light theme BEFORE first
paint. A source test cannot see that: the failure is a paint the user
sees for a few milliseconds, and the only way to see it is to control
the stored theme and measure the attribute the page carries into paint.

So: seed localStorage with a light theme under the LEGACY key only, load
the page, and read back what the guard did. If the guard cannot see the
legacy key, data-theme is absent and a light-theme visitor got a dark
first paint - the exact regression this file exists to catch.

Run at an iPhone viewport in WebKit, because Chromium's opinion about
layout here has been wrong repeatedly.
"""
import json
import sys
from playwright.sync_api import sync_playwright

LAN = "192.168.1.68"
IPHONE = {"width": 390, "height": 844}

TARGETS = [
    # (name, url, the key this project's <html> declares, extra legacy keys)
    ("showcase", f"http://{LAN}:4321/", "cm-theme", []),
    ("links", f"http://{LAN}:4322/", "oem-links-theme", ["cm-theme"]),
    ("oem-portfolio", f"http://{LAN}:4323/", "cm-theme", []),
]

fails = []
rows = []


def probe(ctx, url, store, expected, note):
    """Seed the store, load, and read what the guard decided.

    add_init_script runs before ANY page script, which is the only place
    the seed can go: the guard is in <head> and would otherwise read a
    store we had not written yet.

    The seed is interpolated as JSON rather than passed as an argument,
    because this Playwright build's add_init_script takes no `arg`. A new
    context is used per case so the scripts do not accumulate.
    """
    ctx.add_init_script(
        "try { for (const k of %s) { if (%s[k] === null) "
        "localStorage.removeItem(k); else localStorage.setItem(k, %s[k]); } } catch (e) {}"
        % (json.dumps(list(store)), json.dumps(store), json.dumps(store))
    )
    page = ctx.new_page()
    try:
        # wait_until="commit" resolves before <body> exists, so reading the
        # painted background there returned rgba(0,0,0,0) and reported a
        # false failure on a page that was working. The guard's ATTRIBUTE is
        # set during head parsing, so it is safe to read early, but the PAINT
        # needs the stylesheets, so wait for load and read both together.
        page.goto(url, wait_until="load")
        got = page.evaluate(
            "() => document.documentElement.getAttribute('data-theme')"
        )
        # The PAINTED background, read off <body>. Reading the custom
        # property off documentElement returned empty on a consumer that
        # overrides it in a scoped block, which is a defect in the probe,
        # not in the page - and a probe that lies about its subject is how
        # a real defect gets waved through.
        bg = page.evaluate(
            "() => getComputedStyle(document.body).backgroundColor"
        )
        return got, bg, note
    finally:
        page.close()


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    for name, url, key, legacy in TARGETS:
        # Cases are built from THIS project's declared keys, never from a
        # hardcoded literal. The showcase and oem-portfolio declare no
        # custom key and correctly fall back to cm-theme; pinning
        # oem-links-theme everywhere reported a missing guard on a project
        # that has a working one.
        #
        # The legacy case exists ONLY where the project declares a legacy
        # key. Running it against a project with no legacy key seeded an
        # empty store and then demanded light, which is the harness lying
        # about its own subject - the same failure as a probe reading the
        # wrong site.
        cases = [
            ("current light", {key: "light"}, "light",
             "a theme saved under the project key must apply before first paint"),
            ("current dark", {key: "dark"}, None,
             "dark is the default and is applied by CSS, so the guard must write nothing"),
            ("nothing saved", {key: None}, None,
             "no stored preference means the default dark theme, and the guard must write nothing"),
        ]
        if legacy:
            cases.insert(0, ("legacy light", {**{k: None for k in [key] + legacy},
                                                **{k: "light" for k in legacy}}, "light",
                             "a theme saved under a LEGACY key must still apply before first paint"))
        for case, store, expected, note in cases:
            # A FRESH context per case. add_init_script accumulates on a
            # context, so reusing one would leave the previous case's seed
            # behind and every case after the first would pass for the
            # wrong reason - a green run that proved nothing.
            try:
                ctx = browser.new_context(
                    viewport=IPHONE, device_scale_factor=3, is_mobile=True, has_touch=True
                )
            except Exception as e:
                print(f"  skip {name}: {e}")
                break
            got, bg, _ = probe(ctx, url, store, expected, note)
            ctx.close()
            ok = got == expected
            rows.append((name, case, got, ok))
            if not ok:
                fails.append(f"{name} / {case}: got {got!r}, expected {expected!r} - {note}")
            # The attribute is the mechanism; the painted background is the
            # outcome. A guard that sets data-theme but leaves the page dark
            # has still failed, and only the paint proves which happened.
            lum = 0
            nums = [float(x) for x in bg.replace("rgba", "rgb").strip("rgb() ").split(",")[:3]] \
                if bg and bg.startswith("rgb") else [0, 0, 0]
            lum = 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2]
            want_light = expected == "light"
            painted_ok = (lum > 128) == want_light
            if not painted_ok:
                fails.append(
                    f"{name} / {case}: data-theme={got!r} but the page painted {bg} "
                    f"(luminance {lum:.0f}); the guard did not actually change what the user sees"
                )
            print(
                f"{'ok  ' if ok and painted_ok else 'FAIL'} {name:16} {case:14} "
                f"data-theme={str(got):8} painted={bg} lum={lum:.0f}"
            )

        # Geometry, at the same viewport. A guard that fixes the theme
        # but breaks the page is not a win.
        try:
            ctx = browser.new_context(
                viewport=IPHONE, device_scale_factor=3, is_mobile=True, has_touch=True
            )
        except Exception as e:
            print(f"  skip {name}: {e}")
            continue
        page = ctx.new_page()
        page.goto(url, wait_until="load")
        geo = page.evaluate(
            """() => ({
                scrollX: window.scrollX,
                innerWidth: window.innerWidth,
                docW: document.documentElement.scrollWidth,
                guardInHead: (() => {
                    const h = document.head;
                    const first = h.querySelector('script');
                    return !!first && !first.hasAttribute('src');
                })(),
            })"""
        )
        sideways = geo["docW"] > geo["innerWidth"] + 1
        print(
            f"     {name:16} viewport={geo['innerWidth']} doc={geo['docW']} "
            f"inlineGuardInHead={geo['guardInHead']} sidewaysScroll={sideways}"
        )
        if sideways:
            fails.append(f"{name}: document is wider than the viewport ({geo['docW']} > {geo['innerWidth']})")
        page.close()
        ctx.close()
    browser.close()

print()
if fails:
    print(f"{len(fails)} FAILURE(S):")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"all {len(rows)} theme cases + viewport geometry correct in WebKit at 390px")
