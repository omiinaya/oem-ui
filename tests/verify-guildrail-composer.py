#!/root/.venvs/mau/bin/python
"""Batch 29, measured in WebKit: .cm-guildrail and .cm-composer.

MEASURED, never claimed. Every line below reads the BUILT page in real
WebKit, because the properties that decide these two components are
invisible in both a source check and a screenshot:

  * a scrollport clips its own inline overflow, so the guildrail's tip
    has to escape a rail that is `overflow-y: auto` - and `overflow-y`
    is not a vertical-only switch, only `visible` is ever promoted, so
    the rail clips on BOTH axes. A clipped element still LAYS OUT at
    full width and reports a perfect rect, so the witness has to be
    `elementFromPoint` and not a rect;
  * the composer's field is a native textarea under two base.css rules
    whose selectors reach (0,1,1) and (0,2,1), so "the field fills the
    bar" and "the field's own skin is off" are cascade claims only a
    computed style can settle.

It serves the tree it measured. A default harness URL is the classic
lie here: an oem-ui preview server left running on 4321 by another
worktree answers happily and measures a DIFFERENT build. So this
spawns its own static server over ./dist on an unusual port and refuses
to start unless the served HTML carries this batch's marks.

Run:  /root/.venvs/mau/bin/python tests/verify-guildrail-composer.py
Env:  GUILDRAIL_URL to probe a server you started yourself (it must
      serve THIS tree's dist, and the harness checks the marks anyway).
Exit 0 only when every claim passes.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
PORT = int(os.environ.get('GUILDRAIL_PORT', '4481'))
# Classes and ids that only this batch's tree can serve: the contract's
# own names, plus the two specimens. A build without batch 29 fails here
# by name instead of measuring a page that has no rail on it.
MARKS = ('cm-guildrail__pill', 'cm-guildrail__badge', 'cm-guildrail__unread',
         'cm-composer__replytext', 'cm-composer__tools',
         'id="guildrail"', 'id="composer"')
SHOT = '/root/.hermes/cache/scratch/b29-guildrail-composer.png'

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name
          + (("  -- " + str(detail)) if detail else ""), flush=True)


def port_free(port):
    # SO_REUSEADDR: a server this harness just terminated leaves the port in
    # TIME_WAIT, and a bind that fails on that is not "something else is
    # serving" - reporting it as one sends the reader hunting for a process
    # that does not exist.
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('127.0.0.1', port))
    except OSError:
        return False
    finally:
        s.close()
    return True


def read(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.read().decode('utf-8', 'replace')


def serve():
    """Spawn a static server over ./dist on OUR port and prove it serves
    THIS tree before anything measures against it."""
    if not os.path.isfile(os.path.join(DIST, 'index.html')):
        raise SystemExit('FAIL  dist/index.html is missing - run `npm run build` first')
    if not port_free(PORT):
        raise SystemExit(f'FAIL  port {PORT} is already in use. Something else is '
                         f'serving; a probe against a server you did not start is a '
                         f'probe of another worktree\'s build. Set GUILDRAIL_PORT.')
    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1',
         '--directory', DIST],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{PORT}/index.html'
    for _ in range(80):
        try:
            body = read(url)
            break
        except Exception:
            time.sleep(0.1)
    else:
        proc.terminate()
        raise SystemExit('FAIL  the static server never answered')
    missing = [m for m in MARKS if m not in body]
    if missing:
        proc.terminate()
        raise SystemExit('FAIL  the served page is not this batch\'s tree, missing: '
                         + ', '.join(missing)
                         + ' - rebuild (`rm -rf dist && npm run build`) before probing')
    return proc, url


def verify_marks(url):
    missing = [m for m in MARKS if m not in read(url)]
    if missing:
        raise SystemExit('FAIL  GUILDRAIL_URL does not serve this batch\'s tree, missing: '
                         + ', '.join(missing))


RAIL = '#guildrail .cm-guildrail'
COM = '#composer .cm-composer'


def png_pixel(blob):
    """The RGBA of a 1x1 PNG screenshot, decoded with the stdlib.

    Smaller than a dependency and exact: only IHDR and IDAT are read, and a
    1x1 image has no cross-pixel filters to undo (a filter byte precedes
    each scanline, and the first scanline's left/up neighbours are zero)."""
    import struct
    import zlib
    assert blob[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, hdr = 8, [], None
    while i < len(blob):
        n = struct.unpack('>I', blob[i:i + 4])[0]
        typ = blob[i + 4:i + 8]
        data = blob[i + 8:i + 8 + n]
        if typ == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat.append(data)
        elif typ == b'IEND':
            break
        i += 12 + n
    assert hdr, 'the PNG has no IHDR chunk'
    w, h, depth, ctype = hdr[0], hdr[1], hdr[2], hdr[3]
    assert (w, depth) == (1, 8), f'expected a 1x1 8-bit PNG, got {w}x{h}@{depth}'
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(b''.join(idat))
    # One filter byte, then `channels` bytes; a 1x1 image's filter is a
    # no-op against zeroed neighbours.
    return tuple(raw[1:1 + channels])


def paint_at(pg, x, y):
    return png_pixel(pg.screenshot(clip={'x': round(x), 'y': round(y),
                                         'width': 1, 'height': 1}))


def main():
    proc = None
    external = os.environ.get('GUILDRAIL_URL')
    if external:
        verify_marks(external)
        url = external
    else:
        proc, url = serve()

    try:
        with sync_playwright() as pw:
            b = pw.webkit.launch()

            # ----------------------------------------------------------
            # Desktop. No touch: this is the pointer-and-keyboard case.
            # ----------------------------------------------------------
            p = b.new_page(viewport={"width": 1280, "height": 900})
            # The first navigation is not a CLICK budget. The merged
            # showcase is a large document WebKit measured at ~7s to fire
            # `load`, so it gets its own.
            p.set_default_navigation_timeout(30000)
            p.set_default_timeout(8000)
            p.goto(url, wait_until="load")
            # Gate on the runtime's own marker rather than a sleep: a
            # bundle that never executes must fail LOUDLY here instead of
            # timing out somewhere in the middle of a check.
            p.wait_for_function(
                "() => document.documentElement.classList.contains('cm-js')"
                " && typeof window.cliMono === 'object'", timeout=20000)
            # The showcase sets `scroll-behavior: smooth` on html, so an
            # `scrollIntoView` here is an animation and the probe below
            # would read a rect from a page still travelling.
            p.evaluate("document.documentElement.style.scrollBehavior = 'auto'")

            # The two subjects must EXIST before anything is asserted of
            # them: a selector that matches nothing makes every check
            # below vacuous rather than green.
            check("desktop: the specimen rail is on the page",
                  p.eval_on_selector_all(RAIL, "els => els.length") == 1,
                  f"{p.eval_on_selector_all(RAIL, 'els => els.length')} rails found")
            check("desktop: the rail ships the contract's parts",
                  p.eval_on_selector_all(
                      RAIL + ' .cm-guildrail__item .cm-guildrail__icon',
                      "els => els.length") >= 3
                  and p.eval_on_selector_all(RAIL + ' .cm-guildrail__badge', "els => els.length") >= 1
                  and p.eval_on_selector_all(RAIL + ' .cm-guildrail__unread', "els => els.length") >= 1
                  and p.eval_on_selector_all(RAIL + ' .cm-guildrail__sep', "els => els.length") == 1
                  and p.eval_on_selector_all(RAIL + ' .cm-guildrail__item--home', "els => els.length") == 1
                  and p.eval_on_selector_all(RAIL + ' .cm-guildrail__item--add', "els => els.length") == 1,
                  'icons/badge/unread/sep/home/add')

            p.add_style_tag(content='html, body { scroll-behavior: auto !important; }')
            p.evaluate('''() => {
                const sec = document.querySelector('#guildrail');
                const de = document.documentElement;
                de.scrollTop = sec.offsetTop - Math.max(0, (de.clientHeight - sec.offsetHeight) / 2);
            }''')
            p.wait_for_timeout(250)
            onscreen = p.evaluate('''() => {
                const sec = document.querySelector('#guildrail');
                const r = sec.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom,
                         vh: document.documentElement.clientHeight };
            }''')
            check("desktop: the guildrail specimen is actually in the viewport",
                  onscreen["top"] < onscreen["vh"] and onscreen["bottom"] > 0
                  and onscreen["bottom"] <= onscreen["vh"] + 1,
                  f"the section spans y {onscreen['top']:.0f}..{onscreen['bottom']:.0f} "
                  f"in a {onscreen['vh']}px viewport; a probe below the fold reports a "
                  f"null hit, which reads exactly like a clipped one")

            rail = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const stage = rail.parentElement;
                const main = stage.children[1];
                const cs = getComputedStyle(rail);
                const r = rail.getBoundingClientRect();
                const m = main.getBoundingClientRect();
                const rootStyle = getComputedStyle(document.documentElement);
                return {
                    railL: r.left, railR: r.right, railT: r.top, railB: r.bottom,
                    contentR: r.left + rail.clientWidth - parseFloat(cs.paddingInlineEnd),
                    padE: parseFloat(cs.paddingInlineEnd),
                    marginE: parseFloat(cs.marginInlineEnd),
                    offsetW: rail.offsetWidth, clientW: rail.clientWidth,
                    scrollH: rail.scrollHeight, clientH: rail.clientHeight,
                    mainL: m.left,
                    ovy: cs.overflowY, ovx: cs.overflowX,
                    sbw: cs.scrollbarWidth,
                    maxBlock: cs.maxBlockSize,
                    w: rail.offsetWidth + parseFloat(cs.marginInlineEnd),
                    bleed: parseFloat(cs.paddingInlineEnd),
                    painted: rail.clientWidth - parseFloat(cs.paddingInlineStart)
                             - parseFloat(cs.paddingInlineEnd),
                    bleedToken: (() => {
                        // Resolve the TOKEN the way the browser would, rather
                        // than parsing `4.5rem` in Python: the token is
                        // `min(18rem, 52vw)` on purpose and arithmetic on the
                        // string would pin the wrong number.
                        const probe = document.createElement('div');
                        probe.style.cssText =
                            'position:absolute;visibility:hidden;inline-size:var(--guildrail-w);' +
                            'block-size:var(--guildrail-bleed)';
                        document.body.appendChild(probe);
                        const r = probe.getBoundingClientRect();
                        probe.remove();
                        return { w: r.width, bleed: r.height };
                    })(),
                };
            }""")
            print("rail:", rail)
            w, bleed = rail["w"], rail["bleed"]
            print(f"(margin box {w}px, bleed {bleed}px)")

            # 1. The rail OWNS its scroll: a scrollport with real overflow.
            check("guildrail: the rail is a real scrollport (content overflows it)",
                  rail["ovy"] == "auto" and rail["scrollH"] > rail["clientH"],
                  f"overflowY={rail['ovy']} scrollHeight={rail['scrollH']} "
                  f"clientHeight={rail['clientH']}")

            # 2. ...and scrolling it moves the icons, without moving the page.
            scrolled = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const icon = rail.querySelector('.cm-guildrail__icon');
                const before = icon.getBoundingClientRect().top;
                // To the MAXIMUM: an 8px-short stage has no 120px to give,
                // and asserting a number the box cannot reach measures the
                // fixture rather than the rail.
                rail.scrollTop = rail.scrollHeight;
                const applied = rail.scrollTop;
                const range = rail.scrollHeight - rail.clientHeight;
                const after = icon.getBoundingClientRect().top;
                rail.scrollTop = 0;
                return { moved: before - after, applied, range };
            }""")
            check("guildrail: scrolling the RAIL moves its icons",
                  applied_ok := (abs(scrolled["moved"] - scrolled["applied"]) < 1.5
                                 and scrolled["applied"] > 40),
                  f"the rail has {scrolled['range']}px of scroll range; the maximum "
                  f"scroll moved the first icon {scrolled['moved']}px")

            # 3. The bleed does not move the grid: the rail's MARGIN box is
            #    --guildrail-w, so the column beside it starts there.
            margin_box = rail["offsetW"] + rail["marginE"]
            check("guildrail: the rail's margin box is still --guildrail-w",
                  abs(margin_box - rail["bleedToken"]["w"]) < 1.5,
                  f"offsetWidth {rail['offsetW']} + margin-inline-end "
                  f"{rail['marginE']} = {margin_box}, --guildrail-w is "
                  f"{rail['bleedToken']['w']}")
            check("guildrail: the grid column beside the rail starts at --guildrail-w",
                  abs(rail["mainL"] - rail["railL"] - w) < 1.5,
                  f"rail at {rail['railL']:.0f}, main column at {rail['mainL']:.0f} "
                  f"(delta {rail['mainL'] - rail['railL']:.1f})")
            check("guildrail: the rail's padding box reaches out by the bleed",
                  abs(rail["offsetW"] - (rail["bleedToken"]["w"] + rail["padE"])) < 1.5
                  and abs(rail["padE"] - rail["bleedToken"]["bleed"]) < 1.5,
                  f"offsetWidth={rail['offsetW']} = --guildrail-w "
                  f"{rail['bleedToken']['w']} + padding-inline-end {rail['padE']} "
                  f"(--guildrail-bleed resolves to {rail['bleedToken']['bleed']})")
            check("guildrail: what the rail PAINTS is --guildrail-w, not the bleed",
                  abs(rail["painted"] - rail["bleedToken"]["w"]) < 1.5,
                  f"content box is {rail['painted']}px against --guildrail-w "
                  f"{rail['bleedToken']['w']}px (border box is {rail['offsetW']})")

            # 4. THE claim: the tip lands to the RIGHT of the rail and does
            #    not overlap it. elementFromPoint is the witness - a clipped
            #    tip lays out at full width and still reports a perfect rect.
            #    Focus FIRST and read AFTER: the tip fades on `opacity`, so a
            #    computed-style read in the same frame as the focus is t=0.
            p.evaluate("""() => {
                // A square whose tip (centred on it, ~30px tall) sits fully
                // inside the scrollport. A scrollport clips on a straight
                // edge, not a ragged one - a square flush with the edge is
                // clipped by half a tip, which is the clip working, not the
                // bleed failing. Pick one with room on both sides.
                const rail = document.querySelector('#guildrail .cm-guildrail');
                rail.scrollTop = 0;
                const rr = rail.getBoundingClientRect();
                let best = null, bd = Infinity;
                for (const b of rail.querySelectorAll('.cm-guildrail__item')) {
                    const r = b.getBoundingClientRect();
                    if (r.top - rr.top < 20 || rr.bottom - r.bottom < 20) continue;
                    const d = Math.abs((r.top + r.bottom) / 2 - (rr.top + rr.bottom) / 2);
                    if (d < bd) { bd = d; best = b; }
                }
                window.__b29btn = best || rail.querySelector('.cm-guildrail__item');
                window.__b29btn.focus({preventScroll: true});
            }""")
            # The tip reveals on a TRANSITION: a computed-style read in the
            # same task as the focus reports t=0, which is how a working
            # `:focus-within` gets reported as "the tip never appears".
            # A real frame plus a sleep past --cm-t (0.12s), not a sleep
            # alone: the frame is what makes WebKit recompute the style.
            p.evaluate("() => new Promise(r => requestAnimationFrame("
                       "() => requestAnimationFrame(r)))")
            p.wait_for_timeout(300)
            tip = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const btn = window.__b29btn;
                const tip = btn.closest('.cm-tooltip').querySelector('.cm-tooltip__tip');
                const cs = getComputedStyle(rail);
                const r = rail.getBoundingClientRect();
                const t = tip.getBoundingClientRect();
                const b = btn.getBoundingClientRect();
                const x = (t.left + t.right) / 2, y = (t.top + t.bottom) / 2;
                const hit = document.elementFromPoint(x, y);
                return {
                    tipL: t.left, tipR: t.right, tipT: t.top, tipB: t.bottom,
                    tipW: t.width,
                    railL: r.left, railR: r.right, railT: r.top, railB: r.bottom,
                    contentR: r.left + rail.clientWidth - parseFloat(cs.paddingInlineEnd),
                    padR: r.right,
                    focused: document.activeElement === btn,
                    label: btn.getAttribute('aria-label'),
                    visible: getComputedStyle(tip).visibility,
                    opacity: getComputedStyle(tip).opacity,
                    hit: hit ? (hit.id || hit.className) : null,
                    hitIsTip: !!(hit && (hit === tip || tip.contains(hit))),
                    vDelta: (t.top + t.bottom) / 2 - (b.top + b.bottom) / 2,
                };
            }""")
            print("tip:", tip)
            check("guildrail: the tip is visible on keyboard focus",
                  tip["focused"] and tip["visible"] == "visible" and float(tip["opacity"]) > 0.9,
                  f"focused={tip['focused']} visibility={tip['visible']} opacity={tip['opacity']}")
            tip_cx = (tip["tipL"] + tip["tipR"]) / 2
            tip_cy = (tip["tipT"] + tip["tipB"]) / 2
            tip_painted = paint_at(p, tip_cx, tip_cy)
            # The control: the same coordinate with the tip hidden. The tip
            # is `pointer-events: none`, so elementFromPoint is structurally
            # blind to it - the paint is the only witness it cannot decline
            # to answer, and hiding it is what turns one reading into a
            # measurement of the TIP rather than of the page behind it.
            control = p.evaluate("""() => {
                const tip = window.__b29btn.closest('.cm-tooltip').querySelector('.cm-tooltip__tip');
                const prev = tip.style.visibility;
                tip.style.visibility = 'hidden';
                return prev;
            }""")
            p.wait_for_timeout(200)
            tip_hidden = paint_at(p, tip_cx, tip_cy)
            p.evaluate("prev => { window.__b29btn.closest('.cm-tooltip')"
                       ".querySelector('.cm-tooltip__tip').style.visibility = prev; }", control)
            print(f"tip pixel {tip_painted} against the same pixel hidden {tip_hidden}")
            check("guildrail: the tip is PAINTED outside the scrollport",
                  tip_painted != tip_hidden and tip["label"],
                  f"the pixel at the tip's centre (for {tip['label']!r}, "
                  f"x={tip_cx:.0f} y={tip_cy:.0f}) is {tip_painted} with the tip shown and "
                  f"{tip_hidden} with it hidden. elementFromPoint cannot be the witness: "
                  f"`.cm-tooltip__tip` is `pointer-events: none` by design, and the rail's "
                  f"scrollport (y {tip['railT']:.0f}..{tip['railB']:.0f}) clips on both axes "
                  f"while a rect read still reports full width.")
            check("guildrail: the tip starts at the rail's PAINTED edge and never overlaps it",
                  abs(tip["tipL"] - tip["contentR"]) < 1.5
                  and tip["tipL"] >= tip["contentR"] - 1.5
                  and tip["tipL"] < tip["railR"],
                  f"tip.left={tip['tipL']:.1f} rail content-box right={tip['contentR']:.1f} "
                  f"(rail padding box right={tip['railR']:.1f}; the empty bleed between "
                  f"them is {tip['railR'] - tip['contentR']:.0f}px the tip has to cross)")
            check("guildrail: the tip really extends to the right of the rail",
                  tip["tipR"] > tip["contentR"] + 20,
                  f"tip.right={tip['tipR']:.1f} vs rail content right={tip['contentR']:.1f}")
            check("guildrail: the tip is centred on the square it labels",
                  abs(tip["vDelta"]) < 1.5,
                  f"tip centre is {tip['vDelta']:.1f}px from the icon's centre")
            check("guildrail: the tip is fully inside the viewport, on both axes",
                  tip["tipT"] >= -1 and tip["tipB"] <= 901
                  and tip["tipL"] >= -1 and tip["tipR"] <= 1281,
                  f"tip spans x {tip['tipL']:.0f}..{tip['tipR']:.0f} "
                  f"y {tip['tipT']:.0f}..{tip['tipB']:.0f} in 1280x900")
            check("guildrail: the tip is capped at the bleed, so its own clip box can hold it",
                  tip["tipW"] <= bleed + 1.5,
                  f"tip is {tip['tipW']:.0f}px wide against a {bleed}px bleed")

            # 5. The rail scrolls and the tip still escapes - the case a
            #    containing-block hand-up gets wrong and this construction
            #    gets right.
            p.evaluate("() => new Promise(r => requestAnimationFrame("
                       "() => requestAnimationFrame(r)))")
            p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                rail.scrollTop = rail.scrollHeight;
                const mid = rail.getBoundingClientRect().top + rail.clientHeight / 2;
                let best = null, bd = Infinity;
                for (const b of rail.querySelectorAll('.cm-guildrail__item')) {
                    const r = b.getBoundingClientRect();
                    const d = Math.abs((r.top + r.bottom) / 2 - mid);
                    if (d < bd) { bd = d; best = b; }
                }
                window.__b29btn = best;
                best.focus({preventScroll: true});
            }""")
            p.wait_for_timeout(300)
            scrolled_tip = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const btn = window.__b29btn;
                const tip = btn.closest('.cm-tooltip').querySelector('.cm-tooltip__tip');
                const t = tip.getBoundingClientRect();
                const b = btn.getBoundingClientRect();
                const hit = document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2);
                const out = { hitIsTip: !!(hit && (hit === tip || tip.contains(hit))),
                              delta: (t.top + t.bottom) / 2 - (b.top + b.bottom) / 2,
                              opacity: getComputedStyle(tip).opacity,
                              scrollTop: rail.scrollTop,
                              label: btn.getAttribute('aria-label'),
                              tipL: t.left, tipR: t.right,
                              tipT: t.top, tipB: t.bottom };
                // NOT reset here: the two pixel reads below happen at the
                // coordinates this call captured, and moving the rail first
                // would read them at a place the tip no longer is.
                return out;
            }""")
            s_cx = (scrolled_tip["tipL"] + scrolled_tip["tipR"]) / 2
            s_cy = (scrolled_tip["tipT"] + scrolled_tip["tipB"]) / 2
            s_painted = paint_at(p, s_cx, s_cy)
            p.evaluate("() => { window.__b29btn.closest('.cm-tooltip')"
                       ".querySelector('.cm-tooltip__tip').style.visibility = 'hidden'; }")
            p.wait_for_timeout(200)
            s_hidden = paint_at(p, s_cx, s_cy)
            p.evaluate("() => { window.__b29btn.closest('.cm-tooltip')"
                       ".querySelector('.cm-tooltip__tip').style.visibility = ''; "
                       "document.querySelector('#guildrail .cm-guildrail').scrollTop = 0; }")
            print(f"scrolled tip pixel {s_painted} vs hidden {s_hidden}")
            check("guildrail: a SCROLLED rail still paints its tip outside, on its icon",
                  s_painted != s_hidden and abs(scrolled_tip["delta"]) < 24
                  and float(scrolled_tip["opacity"]) > 0.9,
                  f"at scrollTop={scrolled_tip['scrollTop']:.0f} the tip for "
                  f"{scrolled_tip['label']!r} is {scrolled_tip['delta']:.1f}px from its "
                  f"icon's centre; the pixel at its centre reads {s_painted} shown against "
                  f"{s_hidden} hidden (opacity {scrolled_tip['opacity']}). A rail that has "
                  f"scrolled is the case a containing-block hand-up gets wrong.")

            # 6. The bleed is EMPTY: neither the panel fill nor the trailing
            #    edge paints into it, and clicks fall through it to the
            #    column behind.
            p.evaluate("() => document.activeElement.blur()")
            p.wait_for_timeout(200)
            bleed_probe = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const r = rail.getBoundingClientRect();
                const cs = getComputedStyle(rail);
                // A point inside the bleed, over the column beside the rail.
                const x = r.right - 8, y = r.top + 8;
                const under = document.elementFromPoint(x, y);
                return {
                    under: under ? (under.id || under.className) : null,
                    insideRail: !!(under && rail.contains(under)),
                    clip: cs.backgroundClip, origin: cs.backgroundOrigin,
                    pe: cs.pointerEvents,
                };
            }""")
            print("bleed:", bleed_probe)
            check("guildrail: the rail's background is clipped to its CONTENT box",
                  bleed_probe["clip"] == "content-box" and bleed_probe["origin"] == "content-box",
                  f"background-clip={bleed_probe['clip']} origin={bleed_probe['origin']}")
            check("guildrail: clicks fall through the bleed to the column behind",
                  not bleed_probe["insideRail"],
                  f"elementFromPoint in the bleed -> {bleed_probe['under']!r}")
            check("guildrail: the scrollbar is suppressed (it would sit in the bleed)",
                  rail["sbw"] == "none" and rail["ovx"] != "scroll",
                  f"scrollbar-width={rail['sbw']} overflow-x={rail['ovx']}")

            # 7. The active square is marked by aria-current AND the pill,
            #    in ink rather than hue.
            current = p.evaluate("""() => {
                const cur = document.querySelector('#guildrail .cm-guildrail__item[aria-current="true"]');
                const plain = document.querySelector('#guildrail .cm-guildrail__item[aria-label="Forge"]');
                const curPill = cur.querySelector('.cm-guildrail__pill');
                const plainPill = plain.querySelector('.cm-guildrail__pill');
                return {
                    exists: !!cur,
                    curBg: getComputedStyle(cur).backgroundColor,
                    plainBg: getComputedStyle(plain).backgroundColor,
                    curPillOpacity: getComputedStyle(curPill).opacity,
                    plainPillOpacity: getComputedStyle(plainPill).opacity,
                    curPillH: curPill.getBoundingClientRect().height,
                    plainPillH: plainPill.getBoundingClientRect().height,
                };
            }""")
            print("current:", current)
            check("guildrail: aria-current changes the square, in ink not hue",
                  current["exists"] and current["curBg"] != current["plainBg"]
                  and current["curPillOpacity"] == "1",
                  f"current bg={current['curBg']} plain bg={current['plainBg']} "
                  f"pill opacity={current['curPillOpacity']}")
            check("guildrail: the pill reads as a full bar only for the current server",
                  current["curPillH"] > current["plainPillH"] * 2,
                  f"current pill {current['curPillH']:.0f}px tall against "
                  f"a rest pill {current['plainPillH']:.0f}px")

            # 8. The composer's field, in the cascade it actually lands in.
            tap_px = p.evaluate(
                "() => parseFloat(getComputedStyle(document.documentElement)"
                ".getPropertyValue('--tap'))")
            com = p.evaluate("""() => {
                const box = document.querySelector('#composer .cm-composer__bar');
                const f = box.querySelector('.cm-composer__input');
                const cs = getComputedStyle(f), bs = getComputedStyle(box);
                const fr = f.getBoundingClientRect(), br = box.getBoundingClientRect();
                const tools = box.querySelector('.cm-composer__tools');
                return {
                    rows: f.rows, minHeight: cs.minHeight, resize: cs.resize,
                    border: cs.borderTopWidth, bg: cs.backgroundColor,
                    maxHeight: cs.maxHeight, overflowY: cs.overflowY,
                    h: fr.height, lh: parseFloat(cs.lineHeight),
                    w: fr.width, brL: br.left, brR: br.right,
                    toolsR: tools.getBoundingClientRect().right,
                    toolsL: tools.getBoundingClientRect().left,
                    boxPadL: parseFloat(bs.paddingInlineStart),
                    boxPadR: parseFloat(bs.paddingInlineEnd),
                    boxDisplay: bs.display,
                };
            }""")
            print("composer field:", com)
            check("composer: the field's own skin is off (the bar carries it)",
                  com["border"] == "0px" and com["resize"] == "none"
                  and com["bg"] in ("rgba(0, 0, 0, 0)", "transparent"),
                  f"border-width={com['border']} resize={com['resize']} background={com['bg']}")
            check("composer: base.css's 2x--tap reservation is overridden, not inherited",
                  com["minHeight"] == f"{tap_px}px" and com["h"] <= tap_px + 1,
                  f"min-height computes to {com['minHeight']} and the box to {com['h']:.0f}px; "
                  f"base.css reserves 2x--tap on a form textarea and the contract's floor "
                  f"is --tap ({tap_px}px)")
            check("composer: nothing caps the field's height (auto-grow is the consumer's)",
                  com["maxHeight"] == "none",
                  f"max-height={com['maxHeight']}")
            check("composer: the field fills the bar between the attach button and the tools",
                  com["w"] > 0 and com["toolsL"] > com["w"] * 0.5
                  and abs(com["toolsR"] - (com["brR"] - com["boxPadR"])) < 1.5,
                  f"field {com['w']:.0f}px wide, tools at {com['toolsL']:.0f}..{com['toolsR']:.0f}, "
                  f"bar content right edge {com['brR'] - com['boxPadR']:.0f}")

            # 9. The focus-within border on the BAR is the composer's only
            #    focus affordance. It is a TRANSITION on border-color, so the
            #    read has to happen after the transition has run: a
            #    computed-style read taken in the task that set the focus (or
            #    from inside an in-page `await rAF` pair - measured, same
            #    answer) reports t=0 and calls a working rule dead. The
            #    recipe that was measured to settle on this build is the
            #    action in one evaluate, the WAIT on the Python side, and the
            #    read in the next: 300ms after the focus the bar reads
            #    rgb(92,92,92) against rgb(38,38,38) at rest.
            FIELD = '#composer .cm-composer__bar .cm-composer__input'
            BAR = '#composer .cm-composer__bar'
            p.evaluate('''() => {
                const sec = document.querySelector('#composer');
                const de = document.documentElement;
                de.scrollTop = sec.offsetTop - Math.max(0, (de.clientHeight - sec.offsetHeight) / 2);
            }''')
            p.wait_for_timeout(250)
            p.eval_on_selector(FIELD, "el => el.blur()")
            p.wait_for_timeout(300)
            border_rest = p.eval_on_selector(BAR, "el => getComputedStyle(el).borderTopColor")
            p.eval_on_selector(FIELD, "el => el.focus()")
            settled, border_live = False, border_rest
            for _ in range(30):          # up to 3s, sampled every 100ms
                p.wait_for_timeout(100)
                border_live = p.eval_on_selector(
                    BAR, "el => getComputedStyle(el).borderTopColor")
                if border_live != border_rest:
                    settled = True
                    break
            focus_change = p.evaluate("""() => {
                const box = document.querySelector('#composer .cm-composer__bar');
                const f = box.querySelector('.cm-composer__input');
                const out = {
                    active: document.activeElement === f,
                    encircled: box.matches(':focus-within'),
                    focusVar: getComputedStyle(document.documentElement)
                        .getPropertyValue('--focus').trim(),
                    ring: getComputedStyle(f).outlineColor,
                };
                f.blur();
                return out;
            }""")
            focus_change["before"] = border_rest
            focus_change["after"] = border_live
            focus_change["changed"] = border_rest != border_live
            focus_change["settled"] = settled
            print("composer focus:", focus_change)
            check("composer: focus-within moves the BAR's border, not just the field's outline",
                  focus_change["changed"] and focus_change["encircled"],
                  f"bar border {focus_change['before']} -> {focus_change['after']} "
                  f"(field has focus: {focus_change['active']}; bar :focus-within: "
                  f"{focus_change['encircled']}; --focus={focus_change['focusVar']}; "
                  f"the poll {'saw it land' if focus_change['settled'] else 'timed out'}). "
                  f"The reveal is a TRANSITION on border-color, so a read in the same task "
                  f"as the focus reports t=0 and calls a working rule dead.")

            # 10. The reply strip is toggled by the ATTRIBUTE alone: the
            #     library styles [hidden]; the consumer only flips it.
            reply = p.evaluate("""() => {
                const strip = document.querySelector('#composer .cm-composer__reply');
                const box = document.querySelector('#composer .cm-composer__bar');
                const hiddenH = strip.getBoundingClientRect().height;
                const stripTop = () => strip.getBoundingClientRect().top;
                const barTopBefore = box.getBoundingClientRect().top;
                strip.hidden = false;
                const shownH = strip.getBoundingClientRect().height;
                const barTopAfter = box.getBoundingClientRect().top;
                const close = strip.querySelector('.cm-composer__replyclose');
                const cr = close.getBoundingClientRect();
                const out = { hiddenH, shownH, barMoved: barTopAfter - barTopBefore,
                              closeW: cr.width, closeH: cr.height,
                              display: getComputedStyle(strip).display,
                              aboveBar: strip.getBoundingClientRect().bottom
                                        <= box.getBoundingClientRect().top + 1 };
                strip.hidden = true;
                return out;
            }""")
            print("reply strip:", reply)
            check("composer: [hidden] really hides the reply strip",
                  reply["hiddenH"] == 0, f"hidden strip is {reply['hiddenH']}px tall")
            check("composer: un-hiding the strip puts it ABOVE the bar, and the bar moves down",
                  reply["shownH"] > 0 and reply["aboveBar"]
                  and reply["barMoved"] > reply["shownH"] - 1,
                  f"strip {reply['shownH']:.0f}px tall and above the bar: {reply['aboveBar']}; "
                  f"the bar started {reply['barMoved']:.0f}px lower")

            p.evaluate('''() => {
                const sec = document.querySelector('#composer');
                const de = document.documentElement;
                de.scrollTop = sec.offsetTop - Math.max(0, (de.clientHeight - sec.offsetHeight) / 2);
            }''')
            p.wait_for_timeout(250)
            p.screenshot(path=SHOT)
            p.close()

            # ----------------------------------------------------------
            # Phone. 402x667 with a coarse pointer, which is where the
            # --tap floor is a real requirement rather than a nicety.
            # ----------------------------------------------------------
            p = b.new_page(viewport={"width": 402, "height": 667},
                           has_touch=True, is_mobile=True)
            p.set_default_navigation_timeout(30000)
            p.set_default_timeout(8000)
            p.goto(url, wait_until="load")
            p.wait_for_function(
                "() => document.documentElement.classList.contains('cm-js')"
                " && typeof window.cliMono === 'object'", timeout=20000)

            coarse = p.evaluate("() => matchMedia('(pointer: coarse)').matches")
            check("phone: the emulation really is a coarse pointer", coarse is True,
                  f"matchMedia('(pointer: coarse)').matches -> {coarse}")

            tap = p.evaluate("""() => {
                const px = (v) => parseFloat(getComputedStyle(document.documentElement)
                    .getPropertyValue(v));
                const tapVar = px('--tap');
                const rect = (sel, root = document) => {
                    const el = root.querySelector(sel);
                    const r = el.getBoundingClientRect();
                    return { w: r.width, h: r.height, ok: !!el };
                };
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const com = document.querySelector('#composer .cm-composer');
                const strip = com.querySelector('.cm-composer__reply');
                strip.hidden = false;
                const out = {
                    tap: tapVar,
                    item: rect('.cm-guildrail__item', rail),
                    add: rect('.cm-guildrail__item--add', rail),
                    attach: rect('.cm-composer__attach', com),
                    send: rect('.cm-composer__send', com),
                    replyclose: rect('.cm-composer__replyclose', com),
                    railW: rail.clientWidth - parseFloat(getComputedStyle(rail).paddingInlineStart)
                           - parseFloat(getComputedStyle(rail).paddingInlineEnd),
                    railBoxW: rail.offsetWidth,
                    railWVar: (() => {
                        const probe = document.createElement('div');
                        probe.style.cssText = 'position:absolute;visibility:hidden;' +
                            'inline-size:var(--guildrail-w)';
                        document.body.appendChild(probe);
                        const r = probe.getBoundingClientRect();
                        probe.remove();
                        return r.width;
                    })(),
                    railBleed: (() => {
                        const probe = document.createElement('div');
                        probe.style.cssText = 'position:absolute;visibility:hidden;' +
                            'block-size:var(--guildrail-bleed)';
                        document.body.appendChild(probe);
                        const r = probe.getBoundingClientRect();
                        probe.remove();
                        return r.height;
                    })(),
                    railPadBoxR: rail.getBoundingClientRect().right,
                    vw: document.documentElement.clientWidth,
                };
                strip.hidden = true;
                return out;
            }""")
            print("tap:", tap)
            for label, r in [("guildrail item", tap["item"]), ("guildrail add", tap["add"]),
                             ("composer attach", tap["attach"]), ("composer send", tap["send"]),
                             ("composer replyclose", tap["replyclose"])]:
                check(f"phone: {label} clears the --tap floor on BOTH axes",
                      r["ok"] and r["w"] >= tap["tap"] - 0.5 and r["h"] >= tap["tap"] - 0.5,
                      f"{r['w']:.0f}x{r['h']:.0f} against --tap {tap['tap']}")
            check("phone: the rail PAINTS --guildrail-w, not the rail plus its bleed",
                  abs(tap["railW"] - tap["railWVar"]) < 1.5,
                  f"the rail paints {tap['railW']:.1f}px against --guildrail-w "
                  f"{tap['railWVar']:.1f}px (its border box is {tap['railBoxW']}px, "
                  f"the difference being the {tap['railBleed']:.0f}px bleed)")
            check("phone: the rail's clip box stays inside the viewport, bleed and all",
                  tap["railPadBoxR"] <= tap["vw"] + 1,
                  f"the rail's padding box ends at {tap['railPadBoxR']:.1f} in a "
                  f"{tap['vw']}px viewport; a bleed wider than the room beside the "
                  f"rail would push the document sideways")

            # The bleed must not be what widens the document. A bare
            # "scrollWidth > clientWidth" is NOT that claim: this showcase
            # already overflows 402px on its own (measured with the rail and
            # the composer both removed from the layout, the document is
            # 466px wide either way), so an unattributed reading would fail
            # on someone else's component and read as this batch's defect.
            # The attributable claim is a DIFFERENCE: neutralise the bleed
            # and require the document to be no narrower, i.e. the rail is
            # not the thing paying for the overflow.
            sideways = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                const de = document.documentElement;
                const withBleed = de.scrollWidth;
                const savedPad = rail.style.paddingInlineEnd;
                const savedMargin = rail.style.marginInlineEnd;
                rail.style.paddingInlineEnd = '0px';
                rail.style.marginInlineEnd = '0px';
                void rail.offsetWidth;
                const withoutBleed = de.scrollWidth;
                const railRight = rail.getBoundingClientRect().right;
                const painted = rail.clientWidth;
                rail.style.paddingInlineEnd = savedPad;
                rail.style.marginInlineEnd = savedMargin;
                return { withBleed, withoutBleed, railRight, painted,
                         clientW: de.clientWidth };
            }""")
            check("phone: the rail's bleed does not widen the document",
                  sideways["withBleed"] <= sideways["withoutBleed"] + 1,
                  f"document scrollWidth {sideways['withBleed']} with the bleed and "
                  f"{sideways['withoutBleed']} with it neutralised "
                  f"(clientWidth {sideways['clientW']}); the rail paints "
                  f"{sideways['painted']}px ending at {sideways['railRight']:.1f}")

            # The composer's field keeps its own floor on the phone, and
            # rows="1" is the reservation the consumer grows from.
            field = p.evaluate("""() => {
                const f = document.querySelector('#composer .cm-composer__input');
                const cs = getComputedStyle(f);
                return { h: f.getBoundingClientRect().height, rows: f.rows,
                         lh: parseFloat(cs.lineHeight), minHeight: cs.minHeight,
                         tap: parseFloat(getComputedStyle(document.documentElement)
                                 .getPropertyValue('--tap')) };
            }""")
            print("phone field:", field)
            check("phone: the composer field is one row grown to at least the floor",
                  field["rows"] == 1 and field["h"] >= field["tap"] - 1
                  and field["h"] < field["lh"] + field["tap"],
                  f"rows={field['rows']} height={field['h']:.0f} line-height={field['lh']:.1f} "
                  f"min-height={field['minHeight']} --tap={field['tap']}")

            # The rail is still a scrollport at 402, with the same bleed.
            rail_phone = p.evaluate("""() => {
                const rail = document.querySelector('#guildrail .cm-guildrail');
                return { scrollH: rail.scrollHeight, clientH: rail.clientHeight };
            }""")
            check("phone: the rail still owns its scroll",
                  rail_phone["scrollH"] > rail_phone["clientH"],
                  f"scrollHeight {rail_phone['scrollH']} > clientHeight {rail_phone['clientH']}")

            # Reduced motion: the transitions are what they are declared to be.
            p.emulate_media(reduced_motion="reduce")
            rm = p.evaluate("""() => {
                const g = (sel, prop) => {
                    const el = document.querySelector(sel);
                    return getComputedStyle(el)[prop];
                };
                return {
                    item: g('#guildrail .cm-guildrail__item', 'transitionDuration'),
                    pill: g('#guildrail .cm-guildrail__pill', 'transitionDuration'),
                    bar: g('#composer .cm-composer__bar', 'transitionDuration'),
                    send: g('#composer .cm-composer__send', 'transitionDuration'),
                };
            }""")
            print("reduced motion:", rm)
            check("phone: prefers-reduced-motion kills the rail's and the composer's transitions",
                  all(v in ("0s", "0.00001s", "1e-05s") for v in rm.values()),
                  f"{rm}")

            p.close()
            b.close()
    finally:
        if proc:
            proc.terminate()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        print("\nFAILED:")
        for n, _, d in failed:
            print(f"  {n}  -- {d}")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == '__main__':
    sys.exit(main())
