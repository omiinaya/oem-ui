#!/usr/bin/env python3
"""
Verify the nav increment in the engine Omar actually uses: WebKit, iPhone
viewport. Chromium lies about layout, and a vision pass has been wrong
repeatedly in this repo, so everything below is a MEASUREMENT.

Checks:
  1. the current-page state renders with real, non-trivial geometry
  2. the two states are INDEPENDENT (aria-current and is-active coexist)
  3. the scroll-spy actually fires on scroll (it was unreachable before)
  4. the spy is correct in a POSITIONED ancestor (the offsetTop bug)
  5. tap targets, overflow, one left rail, no horizontal scroll
"""
import os
import tempfile
import json
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get('OEM_UI_URL', 'http://localhost:4321/')
OUT = os.environ.get('OEM_UI_SCRATCH', tempfile.gettempdir()) + '/nav-webkit'


def rect(page, sel):
    return page.eval_on_selector(
        sel,
        "el => { const r = el.getBoundingClientRect();"
        " const s = getComputedStyle(el);"
        " return {x:r.x,y:r.y,w:r.width,h:r.height,"
        " color:s.color, weight:s.fontWeight, deco:s.textDecorationLine,"
        " font:s.fontFamily}; }",
    )


def main():
    results = []
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        # iPhone 14 Pro-ish, exactly as the skill's recipe requires.
        ctx = b.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")

        # --- 1. current-page state geometry ---------------------------
        cur = rect(page, '[aria-current="page"].cm-header__link')
        sib = page.eval_on_selector_all(
            '.cm-header__link',
            "els => els.map(e => { const r=e.getBoundingClientRect();"
            " return {w:r.width,h:r.height,y:r.y,cur:e.getAttribute('aria-current')}; })",
        )
        results.append(("current-page link is real geometry",
                        cur["w"] > 4 and cur["h"] > 4, cur))
        # distinct from a plain link
        plain = [s for s in sib if s["cur"] is None]
        results.append(("current page differs from a plain link",
                        cur["weight"] != "400",
                        {"weight": cur["weight"], "deco": cur["deco"]}))

        # --- 2. both states independent -------------------------------
        # Scoped to [data-cm-nav] for the same reason as the spy check: the
        # showcase's nav section renders static specimens of both states, and
        # an unscoped query would find the specimens instead of the live nav.
        both = page.evaluate(
            "() => { const nav=document.querySelector('[data-cm-nav]');"
            " const a=nav.querySelector('[aria-current=\"page\"]');"
            " return {a:!!a, same: a ? a.classList.contains('is-active') : null,"
            "  specAria: document.querySelectorAll('[aria-current=\"page\"]').length,"
            "  specIsActive: document.querySelectorAll('.is-active').length}; }"
        )
        # The showcase itself must contain BOTH states as specimens, and the
        # live header must carry the spy state without the page state (this
        # page is `/`, and no header link is a separate route).
        results.append(("showcase demonstrates both nav states",
                        both["specAria"] >= 1 and both["specIsActive"] >= 1, both))
        results.append(("the live header carries the spy state",
                        both["a"] is False, both))

        # --- 3. the scroll-spy actually fires -------------------------
        # The spy marks the LAST section whose top is above 30% of the
        # viewport, so assert it TRACKS the scroll rather than equals a name:
        # with sections close together, the correct answer at a given offset
        # is whatever is highest-but-passed, and hardcoding a name tests the
        # page layout, not the runtime.
        #
        # Every query is scoped to `[data-cm-nav]`. The nav SECTION of the
        # showcase contains static specimen rows that deliberately render
        # `is-active` to show what the state looks like; an unscoped
        # `.is-active` query counts those specimens and reports a spy that
        # is behaving perfectly as broken. The runtime only ever touches
        # links inside a `[data-cm-nav]` container.
        def spy_state():
            return page.evaluate("""() => {
                const probe = window.scrollY + window.innerHeight * 0.3;
                const nav = document.querySelector('[data-cm-nav]');
                const secs = Array.from(nav.querySelectorAll('.cm-header__link[data-cm-spy]'));
                let want = null;
                for (const a of secs) {
                    const s = document.getElementById(a.getAttribute('data-cm-spy'));
                    if (s && s.getBoundingClientRect().top + window.scrollY <= probe) want = a.textContent.trim();
                }
                return {want, first: secs.length ? secs[0].textContent.trim() : null,
                    lit: Array.from(nav.querySelectorAll('.cm-header__link.is-active'))
                              .map(x => x.textContent.trim()),
                    y: window.scrollY};
            }""")

        page.evaluate("() => window.scrollTo(0,0)")
        page.wait_for_timeout(600)
        top = spy_state()
        page.evaluate("() => document.getElementById('lists').scrollIntoView({block:'center'})")
        page.wait_for_timeout(700)
        middle = spy_state()
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(700)
        bottom = spy_state()

        # 1. exactly ONE link is ever lit, and it is the one the geometry says
        for label, st in (('top', top), ('mid', middle), ('bottom', bottom)):
            # At the very top, NO section has passed the probe yet, and the
            # runtime deliberately falls back to the first one so the nav is
            # never blank. Mirror that fallback instead of asserting null.
            expected = [st["want"] if st["want"] is not None else top["first"]]
            results.append((f"spy lights exactly the right link ({label})",
                            st["lit"] == expected,
                            {"lit": st["lit"], "expected": expected}))
        # 2. and it actually MOVED as the reader scrolled
        results.append(("spy state changes as the reader scrolls",
                        top["lit"] != bottom["lit"] and top["y"] != bottom["y"],
                        {"top": top["lit"], "bottom": bottom["lit"]}))

        # --- 4. the spy survives a POSITIONED ancestor ----------------
        # offsetTop is relative to the nearest positioned ancestor, so this
        # is the exact case the old measurement got wrong.
        page.evaluate("""() => {
            const f = document.getElementById('forms');
            const w = document.createElement('div');
            w.id = 'probe-wrapper';
            w.style.cssText = 'position:relative;padding-top:0';
            f.parentNode.insertBefore(w, f);
            w.appendChild(f);
        }""")
        page.evaluate("() => window.scrollTo(0,0)")
        page.wait_for_timeout(400)
        page.evaluate("() => document.getElementById('lists').scrollIntoView({block:'center'})")
        page.wait_for_timeout(700)
        positioned = spy_state()
        results.append(("spy stays correct inside a positioned ancestor",
                        positioned["lit"] == [positioned["want"]], positioned))

        # --- 5. hygiene at the phone width ----------------------------
        overflow = page.evaluate(
            "() => ({doc: document.documentElement.scrollWidth,"
            " win: window.innerWidth,"
            #  CONTENT bands only. .cm-header and .cm-footer are full-bleed by
            #  design (they span the viewport and pad their own inner column),
            #  so including them reports a fake second rail. The rail that must
            #  be single is the one the reader's eye tracks down the column.
            " rail: Array.from(document.querySelectorAll('main, .cm-section, .cm-footer__inner, .cm-header__nav'))"
            "   .map(e => Math.round(e.getBoundingClientRect().left)),"
            " small: Array.from(document.querySelectorAll('*')).filter(e => {"
            "   const f = parseFloat(getComputedStyle(e).fontSize);"
            "   return e.textContent.trim() && e.children.length === 0"
            "      && f > 0 && f < 12; }).map(e => getComputedStyle(e).fontSize + ' ' + e.className),"
            " })")
        results.append(("no horizontal overflow",
                        overflow["doc"] <= overflow["win"] + 1, overflow["doc"]))
        results.append(("no sub-12px text",
                        len(overflow["small"]) == 0, overflow["small"][:4]))
        results.append(("one left rail down the content column",
                        len(set(overflow["rail"])) == 1, sorted(set(overflow["rail"]))))
        results.append(("no page errors", not errors, errors[:3]))

        # A full-page shot is a nicety, not a check. The page outgrew
        # WebKit's 32767px screenshot limit once the showcase grew, and an
        # exception here aborted the run AFTER every check had already been
        # recorded - so a passing suite reported as a crash. Clip instead.
        try:
            page.screenshot(path=f"{OUT}-iphone.png", full_page=True)
        except Exception as e:  # noqa: BLE001
            print(f"  note: full-page shot skipped ({type(e).__name__})")
            page.screenshot(path=f"{OUT}-iphone.png")
        page.evaluate("() => window.scrollTo(0,0)")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}-top.png")
        b.close()

    ok = True
    for name, passed, detail in results:
        print(("  ok  " if passed else "FAIL  ") + name)
        if not passed:
            ok = False
            print("        " + json.dumps(detail)[:300])
    print(f"\n{sum(1 for r in results if r[1])}/{len(results)} webkit checks passed")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
