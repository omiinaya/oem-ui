#!/root/.venvs/mau/bin/python
"""Batch 29, measured in WebKit: .cm-guildrail and .cm-composer.

MEASURED, never claimed. Every line below reads the BUILT page in real
WebKit, because the two hardest properties here are invisible in both a
source check and a screenshot:

  * a scrollport clips its own inline overflow, so the guildrail's tip
    has to escape a rail that is `overflow-y: auto` - a claim only
    `elementFromPoint` can settle (a clipped element still LAYS OUT at
    full width, so its rect lies);
  * `textarea:not(.cm-search__input)` in base.css is (0,1,1) and beats a
    one-class composer field, so the three-row reservation is a cascade
    claim that only a computed height can settle.

Run: /root/.venvs/mau/bin/python tests/verify-guildrail-composer.py [url]
Exit 0 only when every claim passes.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4321/"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name + (("  -- " + str(detail)) if detail else ""))


with sync_playwright() as pw:
    b = pw.webkit.launch()

    # ------------------------------------------------------------------
    # Desktop. No touch: this is the pointer-and-keyboard case.
    # ------------------------------------------------------------------
    p = b.new_page(viewport={"width": 1280, "height": 900})
    p.goto(URL, wait_until="networkidle")
    p.wait_for_timeout(300)
    # The showcase sets `scroll-behavior: smooth` on html, so an
    # `scrollIntoView` here is an animation and the probe below would read
    # a rect from a page still travelling.
    p.evaluate("document.documentElement.style.scrollBehavior = 'auto'")

    p.eval_on_selector("#guildrail", "el => el.scrollIntoView({block:'center'})")
    p.wait_for_timeout(200)

    rail = p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const stage = rail.parentElement;
        const main = stage.children[1];
        const cs = getComputedStyle(rail);
        const r = rail.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        return {
            railL: r.left, railR: r.right, railT: r.top, railB: r.bottom,
            contentR: r.left + rail.clientWidth - parseFloat(cs.paddingRight),
            padR: parseFloat(cs.paddingRight),
            marginRight: parseFloat(cs.marginRight),
            offsetW: rail.offsetWidth, clientW: rail.clientWidth,
            scrollH: rail.scrollHeight, clientH: rail.clientHeight,
            stageL: s.left, mainL: m.left, mainR: m.right,
            ovy: cs.overflowY,
            sbw: cs.scrollbarWidth,
            maxBlock: cs.maxBlockSize,
        };
    }""")
    print("rail:", rail)

    # 1. The rail OWNS its scroll: it is a scrollport with real overflow.
    check("guildrail: the rail is a real scrollport (content overflows it)",
          rail["ovy"] == "auto" and rail["scrollH"] > rail["clientH"],
          f"overflowY={rail['ovy']} scrollHeight={rail['scrollH']} clientHeight={rail['clientH']}")

    # 2. ...and scrolling it moves the icons, without moving the page.
    scrolled = p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const before = rail.querySelector('.cm-guildrail__icon').getBoundingClientRect().top;
        rail.scrollTop = 120;
        const after = rail.querySelector('.cm-guildrail__icon').getBoundingClientRect().top;
        const moved = before - after;
        rail.scrollTop = 0;
        return { moved, applied: rail.scrollTop };
    }""")
    check("guildrail: scrolling the RAIL moves its icons", abs(scrolled["moved"] - 120) < 1.5,
          f"scrollTop=120 moved the first icon {scrolled['moved']}px")

    # 3. The bleed does not move the grid: the main column starts at the
    #    rail's WIDTH, not at the rail's padded box. The rail's margin box
    #    is what the grid lays out, and it must still be --guildrail-w.
    margin_box = rail["offsetW"] + rail["marginRight"]
    check("guildrail: the bleed does not push the grid column sideways",
          abs(rail["mainL"] - rail["railL"] - 72) < 1.5,
          f"rail starts at {rail['railL']}, main column at {rail['mainL']} "
          f"(delta {rail['mainL'] - rail['railL']}, --guildrail-w is 72)")
    check("guildrail: the rail's margin box is still --guildrail-w",
          abs(margin_box - 72) < 1.5,
          f"offsetWidth {rail['offsetW']} + margin-inline-end {rail['marginRight']} = {margin_box}")
    check("guildrail: the rail's padding box is --guildrail-w plus the bleed",
          abs(rail["offsetW"] - (72 + rail["padR"])) < 1.5,
          f"offsetWidth={rail['offsetW']} = 72 + padding-inline-end {rail['padR']}")

    # 4. THE claim: the tip lands to the RIGHT of the rail and does not
    #    overlap it. elementFromPoint is the witness - a clipped tip lays
    #    out at full width and still reports a perfect rect. Focus FIRST
    #    and read AFTER: the tip fades on `opacity`, so a computed style
    #    read in the same frame as the focus is the transition's t=0.
    p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const btn = rail.querySelectorAll('.cm-guildrail__icon')[3];
        btn.scrollIntoView({block:'center', inline:'nearest'});
        btn.focus({preventScroll:true});
    }""")
    p.wait_for_timeout(250)
    tip = p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const btn = rail.querySelectorAll('.cm-guildrail__icon')[3];
        const wrap = btn.closest('.cm-tooltip');
        const tip = wrap.querySelector('.cm-tooltip__tip');
        const cs = getComputedStyle(rail);
        const r = rail.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const x = (t.left + t.right) / 2, y = (t.top + t.bottom) / 2;
        const hit = document.elementFromPoint(x, y);
        return {
            tipL: t.left, tipR: t.right, tipT: t.top, tipB: t.bottom,
            railR: r.right, railT: r.top, railB: r.bottom,
            contentR: r.left + rail.clientWidth - parseFloat(cs.paddingRight),
            focused: document.activeElement === btn,
            visible: getComputedStyle(tip).visibility, opacity: getComputedStyle(tip).opacity,
            hit: hit ? (hit.id || hit.className) : null,
            hitIsTip: !!(hit && (hit === tip || tip.contains(hit))),
            vDelta: (t.top + t.bottom) / 2 - (b.top + b.bottom) / 2,
        };
    }""")
    print("tip:", tip)
    check("guildrail: the tip is visible on keyboard focus",
          tip["focused"] and tip["visible"] == "visible" and float(tip["opacity"]) > 0.9,
          f"focused={tip['focused']} visibility={tip['visible']} opacity={tip['opacity']}")
    check("guildrail: the tip is PAINTED outside the scrollport",
          tip["hitIsTip"], f"elementFromPoint at the tip's centre -> {tip['hit']!r}")
    check("guildrail: the tip starts at the rail's right edge and never overlaps it",
          abs(tip["tipL"] - tip["contentR"]) < 1.5 and tip["tipL"] >= tip["contentR"] - 1.5,
          f"tip.left={tip['tipL']} rail content-box right={tip['contentR']} (rail box right={tip['railR']})")
    check("guildrail: the tip really extends to the right of the rail",
          tip["tipR"] > tip["contentR"] + 20, f"tip.right={tip['tipR']} vs rail content right={tip['contentR']}")
    check("guildrail: the tip is centred on the square it labels",
          abs(tip["vDelta"]) < 1.5, f"tip centre is {tip['vDelta']:.1f}px from the icon's centre")
    check("guildrail: the tip stays inside the viewport",
          tip["tipT"] >= -1 and tip["tipB"] <= 901,
          f"tip spans {tip['tipT']}..{tip['tipB']} in a 900px viewport")

    # 5. The rail scrolls and the tip still escapes - the case a
    #    containing-block hand-up gets wrong and this construction gets
    #    right.
    p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const btns = rail.querySelectorAll('.cm-guildrail__icon');
        rail.scrollTop = rail.scrollHeight;
        btns[btns.length - 1].focus({preventScroll:true});
    }""")
    p.wait_for_timeout(250)
    scrolled_tip = p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const btns = rail.querySelectorAll('.cm-guildrail__icon');
        const btn = btns[btns.length - 1];
        const tip = btn.closest('.cm-tooltip').querySelector('.cm-tooltip__tip');
        const b = btn.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        const x = (t.left + t.right) / 2, y = (t.top + t.bottom) / 2;
        const hit = document.elementFromPoint(x, y);
        const out = { hitIsTip: !!(hit && (hit === tip || tip.contains(hit))),
                      delta: (t.top + t.bottom) / 2 - (b.top + b.bottom) / 2,
                      opacity: getComputedStyle(tip).opacity };
        rail.scrollTop = 0;
        return out;
    }""")
    check("guildrail: a SCROLLED rail still paints its tip outside, on its icon",
          scrolled_tip["hitIsTip"] and abs(scrolled_tip["delta"]) < 24
          and float(scrolled_tip["opacity"]) > 0.9,
          f"tip centre is {scrolled_tip['delta']:.1f}px from its icon's centre, "
          f"painted={scrolled_tip['hitIsTip']} opacity={scrolled_tip['opacity']}")

    # 6. The bleed is EMPTY: neither the panel fill nor the trailing edge
    #    paints into it, and clicks fall through it to the column behind.
    bleed = p.evaluate("""() => {
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const r = rail.getBoundingClientRect();
        const railFill = getComputedStyle(rail).backgroundColor;
        // A point inside the bleed, over the main column.
        const x = r.right - 8, y = r.top + 8;
        const under = document.elementFromPoint(x, y);
        const railBg = getComputedStyle(rail).backgroundImage;
        return {
            x, y, railFill,
            under: under ? (under.id || under.className) : null,
            insideRail: !!(under && rail.contains(under)),
            clipped: getComputedStyle(rail).backgroundClip,
            origin: getComputedStyle(rail).backgroundOrigin,
            railBgHasLine: railBg.includes('var(--line)') || railBg.includes('--line'),
        };
    }""")
    print("bleed:", bleed)
    check("guildrail: the rail's background is clipped to its CONTENT box",
          bleed["clipped"] == "content-box" and bleed["origin"] == "content-box",
          f"background-clip={bleed['clipped']} background-origin={bleed['origin']}")
    check("guildrail: clicks fall through the bleed to the column behind",
          not bleed["insideRail"], f"elementFromPoint in the bleed -> {bleed['under']!r}")

    # 7. The scrollbar would sit at the padding box edge - 18rem right of
    #    the icons it belongs to - so it must be suppressed.
    check("guildrail: the scrollbar is suppressed (it would sit in the bleed)",
          rail["sbw"] == "none", f"scrollbar-width={rail['sbw']}")

    # 8. The active square is marked by aria-current alone.
    current = p.evaluate("""() => {
        const cur = document.querySelector('#guildrail .cm-guildrail__icon[aria-current]');
        const plain = document.querySelector('#guildrail .cm-guildrail__icon[data-server="0"]');
        return {
            exists: !!cur,
            curBg: getComputedStyle(cur).backgroundColor,
            curColor: getComputedStyle(cur).color,
            plainBg: getComputedStyle(plain).backgroundColor,
            plainColor: getComputedStyle(plain).color,
            shadow: getComputedStyle(cur).boxShadow,
        };
    }""")
    check("guildrail: aria-current changes the square, in ink not hue",
          current["exists"] and current["curShadow" if "curShadow" in current else "shadow"] != "none"
          and current["curColor"] != current["plainColor"],
          f"current colour={current['curColor']} plain={current['plainColor']} "
          f"box-shadow={current['shadow']}")

    p.close()

    # ------------------------------------------------------------------
    # Phone. 402x667 (iPhone SE-ish height) with a coarse pointer, which
    # is where the --tap floor is a real requirement rather than a nicety.
    # ------------------------------------------------------------------
    p = b.new_page(viewport={"width": 402, "height": 667},
                   has_touch=True, is_mobile=True)
    p.goto(URL, wait_until="networkidle")
    p.wait_for_timeout(300)

    coarse = p.evaluate("() => matchMedia('(pointer: coarse)').matches")
    check("phone: the emulation really is a coarse pointer", coarse is True,
          f"matchMedia('(pointer: coarse)').matches -> {coarse}")

    tap = p.evaluate("""() => {
        const tap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap'));
        const rail = document.querySelector('#guildrail .cm-guildrail');
        const icon = rail.querySelector('.cm-guildrail__icon');
        const add = rail.querySelector('.cm-guildrail__add');
        const ir = icon.getBoundingClientRect(), ar = add.getBoundingClientRect();
        const send = document.querySelector('.cm-composer__send');
        const attach = document.querySelector('.cm-composer__attach');
        const sr = send.getBoundingClientRect(), at = attach.getBoundingClientRect();
        return { tap, iconW: ir.width, iconH: ir.height, addW: ar.width, addH: ar.height,
                 sendW: sr.width, sendH: sr.height, attW: at.width, attH: at.height };
    }""")
    print("tap:", tap)
    for label, w, h in [("guildrail icon", tap["iconW"], tap["iconH"]),
                        ("guildrail add", tap["addW"], tap["addH"]),
                        ("composer send", tap["sendW"], tap["sendH"]),
                        ("composer attach", tap["attW"], tap["attH"])]:
        check(f"phone: {label} clears the --tap floor",
              w >= tap["tap"] - 0.5 and h >= tap["tap"] - 0.5,
              f"{w}x{h} against --tap {tap['tap']}")

    # The composer's field: rows="3" must be the reservation, not
    # base.css's calc(--tap * 2) min-height.
    field = p.evaluate("""() => {
        const f = document.querySelector('.cm-composer__field');
        const cs = getComputedStyle(f);
        const lh = parseFloat(cs.lineHeight);
        const h = f.getBoundingClientRect().height;
        const cs2 = document.querySelector('.cm-composer');
        return { h, lh, rows: f.rows, minHeight: cs.minHeight, resize: cs.resize,
                 border: cs.borderWidth, bg: cs.backgroundColor,
                 boxBorder: getComputedStyle(cs2).borderTopWidth,
                 boxBg: getComputedStyle(cs2).backgroundColor,
                 width: f.getBoundingClientRect().width,
                 boxWidth: cs2.getBoundingClientRect().width,
                 contentW: cs2.clientWidth - parseFloat(getComputedStyle(cs2).paddingLeft)
                          - parseFloat(getComputedStyle(cs2).paddingRight) };
    }""")
    print("field:", field)
    check("composer: rows='3' is the reservation, not base.css's 2x--tap min-height",
          field["minHeight"] in ("0px", "0") and abs(field["h"] - 3 * field["lh"]) < 3,
          f"height={field['h']} vs 3x line-height={3 * field['lh']}, min-height={field['minHeight']}")
    check("composer: the field's own skin is off (the box carries it)",
          field["border"] == "0px" and field["resize"] == "none",
          f"border-width={field['border']} resize={field['resize']}")
    check("composer: the field fills the box's content area edge to edge",
          abs(field["width"] - field["contentW"]) < 1.5,
          f"field {field['width']} against the box's content width {field['contentW']}")

    # The focus-within border is the composer's only focus affordance.
    focus_change = p.evaluate("""() => {
        const c = document.querySelector('.cm-composer');
        const before = getComputedStyle(c).borderTopColor;
        document.querySelector('.cm-composer__field').focus();
        const after = getComputedStyle(c).borderTopColor;
        document.querySelector('.cm-composer__field').blur();
        return { before, after, changed: before !== after };
    }""")
    check("composer: focus-within darkens the box border",
          focus_change["changed"], f"{focus_change['before']} -> {focus_change['after']}")

    p.close()
    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
if failed:
    print("\nFAILED:")
    for n, _, d in failed:
        print(f"  {n}  -- {d}")
    sys.exit(1)
print("\nALL PASS")
