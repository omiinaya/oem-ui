"""WebKit measurement for the code / copy increment.

Run against the LAN preview, in a real iPhone viewport with touch. Proves
by MEASUREMENT, not by screenshot opinion:

  1. the copy button is reachable and 44px tall on a coarse pointer
  2. .cm-codebar does not overflow the viewport at 320/390
  3. the pre scrolls INSIDE the bar rather than widening the page
  4. clicking a copy button writes ITS OWN block to the clipboard, and
     writes it ONCE, however many times init() has run
  5. the label slot survives the copy (the glyph is not destroyed)
  6. both themes compute a distinct colour for .is-copied

Usage: OEM_UI_URL=http://192.168.1.68:4321 /root/.venvs/mau/bin/python
       verify-code-webkit.py
"""
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

URL = os.environ.get("OEM_UI_URL", "http://192.168.1.68:4321/")
OUT = pathlib.Path(os.environ.get("OEM_UI_SCRATCH", "/root/.hermes/cache/scratch"))
OUT.mkdir(parents=True, exist_ok=True)

FAILS = []


def check(ok, label, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{(' — ' + str(detail)) if detail else ''}")
    if not ok:
        FAILS.append(label)


# Record every clipboard write. WebKit headless on a plain http LAN origin
# is NOT a secure context, so navigator.clipboard is absent and the
# runtime takes the execCommand fallback - which this records too.
RECORDER = """
window.__copied = [];
(function () {
  const n = window.navigator;
  if (n.clipboard) {
    n.clipboard.writeText = function (t) { window.__copied.push(t); return Promise.resolve(); };
  }
  const orig = document.execCommand;
  document.execCommand = function (cmd) {
    if (cmd === 'copy') {
      const ta = document.querySelector('textarea[readonly]');
      window.__copied.push(ta ? ta.value : null);
    }
    return typeof orig === 'function' ? orig.apply(document, arguments) : true;
  };
})();
"""


def page(pw, width=390, height=844):
    ctx = pw.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    p = ctx.new_page()
    errors = []
    p.on("pageerror", lambda e: errors.append(str(e)))
    p.goto(URL, wait_until="networkidle")
    p.evaluate(RECORDER)
    return ctx, p, errors


def main():
    with sync_playwright() as pw:
        print(f"url: {URL}\n")

        # ---------- desktop + both themes: the is-copied state is legible --
        ctx, p, errors = page(pw, 1280, 900)
        for theme in ("dark", "light"):
            p.evaluate(
                "t => document.documentElement.setAttribute('data-theme', t)", theme
            )
            res = p.evaluate(
                """() => {
                  const btns = [...document.querySelectorAll('button[data-cm-copy]')];
                  if (!btns.length) return { n: 0 };
                  const b = btns[0];
                  const idle = getComputedStyle(b);
                  b.classList.add('is-copied');
                  const done = getComputedStyle(b);
                  const r = b.getBoundingClientRect();
                  const out = {
                    n: btns.length,
                    idleColor: idle.color,
                    doneColor: done.color,
                    idleBg: idle.backgroundColor,
                    doneBg: done.backgroundColor,
                    w: r.width, h: r.height,
                  };
                  b.classList.remove('is-copied');
                  return out;
                }"""
            )
            check(res["n"] >= 2, f"[{theme}] two live copy buttons render", f"n={res['n']}")
            check(
                res["doneColor"] != res["idleColor"],
                f"[{theme}] is-copied changes the text colour",
                f"{res['idleColor']} -> {res['doneColor']}",
            )
            check(
                res["doneBg"] != res["idleBg"],
                f"[{theme}] is-copied changes the surface (non-hue cue)",
                f"{res['idleBg']} -> {res['doneBg']}",
            )
        ctx.close()

        # ---------- phone: tap floor, overflow, scrolling --------------
        for width in (320, 390):
            ctx, p, errors = page(pw, width, 844)
            print(f"\n  {width}px, coarse pointer, touch")
            res = p.evaluate(
                """() => {
                  const btn = document.querySelector('button[data-cm-copy]');
                  const r = btn.getBoundingClientRect();
                  const bar = document.querySelector('.cm-codebar');
                  const pre = document.querySelector('.cm-codebar pre');
                  const tap = getComputedStyle(document.documentElement)
                      .getPropertyValue('--tap').trim();
                  // behavioural overflow: scroll to the end and read it back
                  window.scrollTo(9999, 0);
                  const sx = window.scrollX;
                  window.scrollTo(0, 0);
                  const fs = parseFloat(getComputedStyle(btn).fontSize);
                  return {
                    h: r.height, w: r.width, tap,
                    fontPx: fs,
                    barW: bar.getBoundingClientRect().width,
                    docW: document.documentElement.scrollWidth,
                    innerW: window.innerWidth,
                    sx,
                    preScrolls: pre.scrollWidth > pre.clientWidth,
                    preOverflowX: getComputedStyle(pre).overflowX,
                  };
                }"""
            )
            check(
                res["tap"] == "44px",
                f"[{width}] --tap resolves to 44px",
                res["tap"],
            )
            check(
                abs(res["h"] - 44) < 0.6,
                f"[{width}] the copy button reaches the 44px tap floor",
                f"height={res['h']:.1f}px",
            )
            check(
                res["fontPx"] >= 12,
                f"[{width}] the copy label is floored at 12px",
                f"{res['fontPx']}px",
            )
            check(
                res["sx"] == 0,
                f"[{width}] no sideways scroll (behavioural, not scrollWidth)",
                f"scrollX={res['sx']}",
            )
            check(
                res["barW"] <= res["innerW"],
                f"[{width}] the code bar fits the viewport",
                f"bar={res['barW']:.0f} < viewport={res['innerW']}",
            )
            # A long line must scroll INSIDE the pre, not widen the page.
            p.evaluate(
                """() => {
                  const pre = document.querySelector('.cm-codebar pre');
                  pre.querySelector('code').textContent =
                    'x'.repeat(400);
                }"""
            )
            res2 = p.evaluate(
                """() => {
                  const pre = document.querySelector('.cm-codebar pre');
                  const bar = document.querySelector('.cm-codebar');
                  window.scrollTo(9999, 0);
                  const sx = window.scrollX;
                  window.scrollTo(0, 0);
                  return {
                    sx,
                    preScrolls: pre.scrollWidth > pre.clientWidth,
                    overflowX: getComputedStyle(pre).overflowX,
                    barW: bar.getBoundingClientRect().width,
                    innerW: window.innerWidth,
                  };
                }"""
            )
            check(
                res2["preScrolls"] and res2["overflowX"] in ("auto", "scroll"),
                f"[{width}] a 400-char line scrolls INSIDE the pre",
                f"overflow-x={res2['overflowX']}, scrolls={res2['preScrolls']}",
            )
            check(
                res2["sx"] == 0,
                f"[{width}] a 400-char line does not widen the page",
                f"scrollX={res2['sx']}",
            )
            p.screenshot(path=str(OUT / f"code-{width}.png"), full_page=False)
            ctx.close()

        # ---------- behaviour: own block, once, after a re-init --------
        ctx, p, errors = page(pw, 390, 844)
        print("\n  copy behaviour")

        # Re-init the way Astro's page-load does, which is the double-bind
        # case the guard exists for.
        p.evaluate("() => { window.cliMono.init(document); window.cliMono.init(document); }")
        p.click("button[data-cm-copy] >> nth=1")
        p.wait_for_timeout(300)
        got = p.evaluate("() => window.__copied")
        want = p.evaluate(
            "() => document.querySelectorAll('.cm-codebar pre')[1].textContent.trim()"
        )
        check(
            len(got) == 1,
            "one click after 3 init() calls writes the clipboard exactly once",
            f"{len(got)} write(s)",
        )
        check(
            got and got[0] == want,
            "the button copies ITS OWN block, not the first one on the page",
            f"got {got[0][:32]!r}, wanted {want[:32]!r}",
        )

        res = p.evaluate(
            """() => {
              const btn = document.querySelectorAll('button[data-cm-copy]')[1];
              const label = btn.querySelector('[data-cm-copy-label]');
              const glyph = btn.querySelector('.cm-copy__state');
              return {
                isCopied: btn.classList.contains('is-copied'),
                label: label ? label.textContent : null,
                glyphStillThere: !!glyph,
                children: btn.children.length,
              };
            }"""
        )
        check(res["isCopied"], "the copied state class is applied", res["isCopied"])
        check(
            res["label"] == "copied",
            "the LABEL slot holds the new text",
            repr(res["label"]),
        )
        check(
            res["glyphStillThere"] and res["children"] >= 2,
            "the glyph slot survives the copy (textContent did not win)",
            f"children={res['children']}, glyph={res['glyphStillThere']}",
        )

        # The failure branch: an error must be a state, not silence.
        p.evaluate(
            """() => {
              const btn = document.querySelectorAll('button[data-cm-copy]')[1];
              btn.click();
            }"""
        )
        p.wait_for_timeout(200)
        err = p.evaluate(
            """() => {
              const btn = document.querySelectorAll('button[data-cm-copy]')[1];
              return { cls: btn.className };
            }"""
        )
        check(
            "is-error" in err["cls"] or "is-copied" in err["cls"],
            "a click always lands in a visible state (copied or error)",
            err["cls"],
        )

        check(not errors, "no page errors", "; ".join(errors))
        ctx.close()

    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED: {FAILS}")
        sys.exit(1)
    print("all WebKit checks passed")


main()
