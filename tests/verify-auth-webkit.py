#!/usr/bin/env python3
"""Measure the auth section in WebKit at an iPhone viewport.

Settles five things a source check cannot:
  1. the code field is still 44px and still 16px after the dead
     declarations were deleted (it must look identical, and it does),
  2. the centred frame really centres - the card's optical centre sits
     on the frame's centre, and the card never exceeds the frame's
     padding,
  3. the code field's text is optically centred, not 6.4px left of
     centre because letter-spacing adds a trailing gap,
  4. the WIDE variant actually widens - but only in the state where the
     measure binds. At 390px both frames correctly cap at the viewport,
     so a probe that reads that as a failure is measuring the wrong
     state,
  5. nothing overflows the viewport sideways.

Run:  /root/.venvs/mau/bin/python tests/verify-auth-webkit.py <url>
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.1.68:4321/"

PROBE = """
() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => { const r = el.getBoundingClientRect();
    return {l:+r.left.toFixed(2), r:+r.right.toFixed(2),
            w:+r.width.toFixed(2), h:+r.height.toFixed(2),
            cx:+(r.left + r.width/2).toFixed(2)}; };

  const out = {};
  out.title = document.title;
  out.frame = box(q('.cm-auth'));
  out.card = box(q('.cm-card--auth'));
  out.code = box(q('.cm-code-input'));

  const cs = getComputedStyle(q('.cm-code-input'));
  out.codeStyle = {fontSize: cs.fontSize, minHeight: cs.minHeight,
    fontFamily: cs.fontFamily.split(',')[0], textAlign: cs.textAlign,
    letterSpacing: cs.letterSpacing, borderRadius: cs.borderRadius,
    borderColor: cs.borderTopColor, background: cs.backgroundColor,
    color: cs.color, padding: cs.paddingLeft};

  const fr = out.frame, cd = out.card;
  out.frameCentring = {
    frameCentreX: (fr.l + fr.r) / 2,
    cardCentreX: cd.cx,
    delta: +(cd.cx - (fr.l + fr.r)/2).toFixed(2),
    insidePadding: cd.l > fr.l && cd.r < fr.r,
    slackL: +(cd.l - fr.l).toFixed(2), slackR: +(fr.r - cd.r).toFixed(2),
  };

  // letter-spacing adds a trailing gap after the last glyph, so a
  // centred string sits LEFT of centre unless text-indent cancels it.
  out.codeCentring = {
    textIndent: cs.textIndent, letterSpacing: cs.letterSpacing,
    compensated: parseFloat(cs.textIndent) >= parseFloat(cs.letterSpacing) - 0.01,
  };

  // sideways scroll - behavioural, not scrollWidth
  window.scrollTo(9999, 0);
  out.scrollX = window.scrollX;
  window.scrollTo(0, 0);
  out.docScrollWidth = document.documentElement.scrollWidth;
  out.innerWidth = window.innerWidth;

  const sec = q('#auth');
  out.authOverflow = [...sec.querySelectorAll('*')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
  }).map(el => el.className || el.tagName).slice(0, 6);
  return out;
}
"""

DESKTOP = """
() => {
  const box = (s) => { const e = document.querySelector(s);
    if (!e) return null; const r = e.getBoundingClientRect();
    return {w: +r.width.toFixed(2), l: +r.left.toFixed(2), r: +r.right.toFixed(2)}; };
  return {narrow: box('.cm-auth:not(.cm-auth--wide) .cm-card--auth'),
          wide: box('.cm-auth--wide .cm-card--auth'),
          wideFrame: box('.cm-auth--wide')};
}
"""

fail = []


def want(label, ok, detail=""):
    print(("  ok  " if ok else "  FAIL") + f" {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        fail.append(label)


with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844},
                        device_scale_factor=3, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.goto(URL, wait_until="networkidle")
    d = pg.evaluate(PROBE)
    pg.screenshot(path="/root/.venvs/auth-390.png", full_page=False)

    pg.evaluate("document.documentElement.setAttribute('data-theme','light')")
    d_light = pg.evaluate(PROBE)
    pg.screenshot(path="/root/.venvs/auth-390-light.png", full_page=False)

    # The WIDE variant only differs once the viewport is wider than the
    # measure, so measure it in the state where the measure binds.
    pg2 = ctx.new_page()
    pg2.set_viewport_size({"width": 1200, "height": 900})
    pg2.goto(URL, wait_until="networkidle")
    w = pg2.evaluate(DESKTOP)
    pg2.screenshot(path="/root/.venvs/auth-1200.png", full_page=False)
    b.close()

print("title:", d["title"], "| light:", d_light["title"])
print(f"\n390px  code field {d['code']['w']}x{d['code']['h']}  {d['codeStyle']}")
print(f"      frame {d['frame']}")
print(f"      card  {d['card']}")
print(f"1200px narrow card {w['narrow']['w']}   wide card {w['wide']['w']} in frame {w['wideFrame']['w']}")
print()

want("the probe measured the showcase, not a stale server",
     d["title"] == "oem/ui — component library", d["title"])
want("code field reaches the tap floor in BOTH dimensions",
     d["code"]["w"] >= 44 and d["code"]["h"] >= 44,
     f'{d["code"]["w"]}x{d["code"]["h"]}')
want("code field text is 16px (iOS will not zoom)",
     d["codeStyle"]["fontSize"] == "16px", d["codeStyle"]["fontSize"])
want("code field kept the mono font (appearance:none drops it)",
     "JetBrains" in d["codeStyle"]["fontFamily"], d["codeStyle"]["fontFamily"])
want("code field is centred and tracked",
     d["codeStyle"]["textAlign"] == "center" and
     float(d["codeStyle"]["letterSpacing"].replace("px", "")) > 0,
     f'{d["codeStyle"]["textAlign"]}/{d["codeStyle"]["letterSpacing"]}')
want("letter-spacing is compensated so the code is optically centred",
     d["codeCentring"]["compensated"], json.dumps(d["codeCentring"]))
fc = d["frameCentring"]
want("the card is optically centred in the frame",
     abs(fc["delta"]) < 1.0, f'delta={fc["delta"]}px')
want("the card sits inside the frame's padding, never touching the edge",
     fc["insidePadding"], f'slack L={fc["slackL"]} R={fc["slackR"]}')
want("no sideways scroll (behavioural, not scrollWidth)",
     d["scrollX"] == 0,
     f'scrollX={d["scrollX"]}, docW={d["docScrollWidth"]}, vw={d["innerWidth"]}')
want("nothing in the auth section overflows the viewport",
     len(d["authOverflow"]) == 0, str(d["authOverflow"]))
want("the light theme renders the same geometry",
     d_light["code"]["w"] == d["code"]["w"] and d_light["code"]["h"] == d["code"]["h"],
     f'{d_light["code"]["w"]}x{d_light["code"]["h"]}')

want("at desktop the wide frame really is wider than the standard one",
     w["wide"]["w"] > w["narrow"]["w"] + 1, f'{w["wide"]["w"]} vs {w["narrow"]["w"]}')
want("the standard frame caps at its 26rem measure",
     abs(w["narrow"]["w"] - 416) < 2, f'{w["narrow"]["w"]} (26rem=416)')
want("the wide frame caps at its 34rem measure",
     abs(w["wide"]["w"] - 544) < 2, f'{w["wide"]["w"]} (34rem=544)')
want("both cards are centred in their own frame",
     abs((w["narrow"]["l"] + w["narrow"]["r"]) / 2 -
         (w["wideFrame"]["l"] + w["wideFrame"]["r"]) / 2) < 2 and
     abs((w["wide"]["l"] + w["wide"]["r"]) / 2 -
         (w["wideFrame"]["l"] + w["wideFrame"]["r"]) / 2) < 2,
     "optical centre of card vs frame")

print(f"\n{len(fail)} failed")
sys.exit(1 if fail else 0)
