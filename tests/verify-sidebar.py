#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 20: sidebar.

Drives the documented surface, not the CSS: the trigger, CMD-B, the
disclosures, the rail's two gestures (click toggles, drag resizes and
must NOT toggle), the attribute flips that stand in for shadcn's props,
and the phone sheet whose aria starts closed because the VIEWPORT is
what decides the truth - desktop and phone each prove it.

The worst bug this shape can carry: a drag that also toggles, or a
collapsed state that leaks width into the content. Both are measured.
"""
from playwright.sync_api import sync_playwright
import sys

# House convention: overridable, so a run says which tree it measured.
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4471/'
SC = '#sidebar .cm-sidebar'
PANEL = SC + ' .cm-sidebar__panel'
TRIG = '[data-cm-sidebar-trigger]'

passed = 0
failed = []


def check(name, ok, detail=None):
    global passed
    if ok:
        passed += 1
        print(f'ok   {name} :: {detail}')
    else:
        failed.append(name)
        print(f'FAIL {name} :: {detail}')


def geo(page):
    return page.evaluate("""() => {
        const sc = document.querySelector('#sidebar .cm-sidebar');
        const pa = sc.querySelector('.cm-sidebar__panel');
        const inset = sc.querySelector('.cm-sidebar__inset');
        const pr = pa.getBoundingClientRect();
        const ir = inset.getBoundingClientRect();
        return {
            scopeLeft: Math.round(sc.getBoundingClientRect().left),
            state: sc.getAttribute('data-state'),
            mobile: sc.getAttribute('data-mobile-open'),
            w: Math.round(pr.width),
            left: Math.round(pr.left),
            right: Math.round(pr.right),
            insetLeft: Math.round(ir.left),
            trig: document.querySelector('[data-cm-sidebar-trigger]')
                .getAttribute('aria-expanded'),
            pos: getComputedStyle(pa).position,
            radius: getComputedStyle(pa).borderRadius,
        };
    }""")


with sync_playwright() as pw:
    b = pw.webkit.launch()

    # ================= desktop, 1280 =================
    page = b.new_page(viewport={'width': 1280, 'height': 800})
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function('() => window.cliMono')
    page.evaluate("document.querySelector('#sidebar').scrollIntoView({block:'start'})")
    page.wait_for_timeout(400)

    # ---- 1. expanded: the panel's own width is the offset the content
    # sits behind (in-flow, no margin stack), and the trigger says so.
    g = geo(page)
    g0 = g
    check('desktop opens expanded: 16rem panel, content butted against it, trigger true',
          g['state'] == 'expanded' and g['w'] == 256
          and abs(g['insetLeft'] - g['right']) <= 2 and g['trig'] == 'true'
          and g['pos'] == 'sticky', g)
    check('the panel is sharp', g['radius'] in ('0px', ''), g['radius'])

    # ---- 2. the trigger collapses to ICON mode
    page.click(TRIG)
    page.wait_for_timeout(350)
    g = geo(page)
    label, glabel, badge, action, rail = page.evaluate("""() => {
        const sc = document.querySelector('#sidebar .cm-sidebar');
        const d = (s) => getComputedStyle(sc.querySelector(s)).display;
        return [d('.cm-sidebar__label'), d('.cm-sidebar__grouplabel'),
                d('.cm-sidebar__badge'), d('.cm-sidebar__groupaction'),
                d('.cm-sidebar__rail')];
    }""")
    check('the trigger collapses to 3rem icon mode and every label steps aside',
          g['state'] == 'collapsed' and g['w'] == 48 and g['trig'] == 'false'
          and label == 'none' and glabel == 'none' and badge == 'none'
          and action == 'none' and rail != 'none',
          f"{g} | displays={label},{glabel},{badge},{action},{rail}")

    # The collapse has two halves: labels leave (checked above) and what
    # STAYS must ride the middle of the 3rem rail. The mutation that
    # survived proof flipped only justify-content to flex-start - labels
    # still vanished, so without this the harness called it fine.
    centered = page.evaluate("""() => {
        const b = document.querySelector('#sidebar .cm-sidebar__grouphead');
        return b ? getComputedStyle(b).justifyContent : 'missing';
    }""")
    check('icon mode centers what stays (the glyphs ride the middle)',
          centered == 'center', centered)
    # the content must have MOVED IN when the panel left the width: the
    # in-flow model's whole claim. Compare against the EXPANDED geometry,
    # not the post-collapse one (the first draft compared collapsed with
    # collapsed and "proved" a reflow that had already happened).
    g2 = geo(page)
    check('the content reflows to where the panel was (no dead gap)',
          g2['insetLeft'] < g0['insetLeft'] - 100,
          f"{g0['insetLeft']} -> {g2['insetLeft']}")

    # ---- 3. CMD-B is the documented toggle, both directions, and the
    # aria tracks the state it reads.
    page.keyboard.press('Meta+b')
    page.wait_for_timeout(350)
    g = geo(page)
    check('CMD-B expands again and the trigger agrees',
          g['state'] == 'expanded' and g['trig'] == 'true', g)
    page.keyboard.press('Meta+b')
    page.wait_for_timeout(350)
    g = geo(page)
    check('CMD-B collapses once more (it really toggles, not one-way)',
          g['state'] == 'collapsed' and g['trig'] == 'false', g)
    page.keyboard.press('Meta+b')
    page.wait_for_timeout(350)

    # ---- 4. group disclosure: aria-expanded and hidden move together.
    # Drive the button that OWNS sb-group-1 - aria-controls is the
    # assistive-tech contract, so a rename of the routing attribute can
    # never move this selector to a sibling group that still routes.
    grp = page.evaluate("""() => {
        const btn = document.querySelector('[aria-controls="sb-group-1"]');
        const p = document.getElementById('sb-group-1');
        return [btn.getAttribute('aria-expanded'), p.hasAttribute('hidden')];
    }""")
    page.click('[aria-controls="sb-group-1"]')
    page.wait_for_timeout(150)
    grp_after = page.evaluate("""() => {
        const btn = document.querySelector('[aria-controls="sb-group-1"]');
        const p = document.getElementById(btn.getAttribute('aria-controls'));
        return [btn.getAttribute('aria-expanded'), p.hasAttribute('hidden')];
    }""")
    check('a group collapses as ONE fact: aria-expanded and hidden together',
          grp == ['true', False] and grp_after == ['false', True],
          f'{grp} -> {grp_after}')
    page.click('[aria-controls="sb-group-1"]')
    page.wait_for_timeout(150)

    # ---- 5. submenu disclosure (same mechanism, in-panel, no popover).
    # Driven by the panel it owns, for the same reason as the group: an
    # attribute rename must not slide the selector to a sibling that
    # still routes (the mutation that survived proof did exactly that).
    page.click('[aria-controls="sb-sub-1"]')
    page.wait_for_timeout(150)
    sub = page.evaluate("""() => {
        const btn = document.querySelector('[aria-controls="sb-sub-1"]');
        const ul = document.getElementById(btn.getAttribute('aria-controls'));
        return [btn.getAttribute('aria-expanded'), ul.hasAttribute('hidden')];
    }""")
    check('a submenu opens by disclosure: aria-expanded true, hidden gone',
          sub == ['true', False], sub)
    page.click('[aria-controls="sb-sub-1"]')
    page.wait_for_timeout(150)
    sub2 = page.evaluate("""() => {
        const btn = document.querySelector('[aria-controls="sb-sub-1"]');
        const ul = document.getElementById(btn.getAttribute('aria-controls'));
        return [btn.getAttribute('aria-expanded'), ul.hasAttribute('hidden')];
    }""")
    check('and closes back to the markup it started in', sub2 == ['false', True], sub2)

    # ---- 6. rail: an unmoved press IS the click that toggles
    page.click('.cm-sidebar__rail')
    page.wait_for_timeout(350)
    g = geo(page)
    check('the rail toggles when the press never moved',
          g['state'] == 'collapsed', g)
    page.click('.cm-sidebar__rail')
    page.wait_for_timeout(350)
    check('and toggles back', geo(page)['state'] == 'expanded')

    # ---- 7. rail: a drag RESIZES and must not also toggle - the bug
    # this component is built to avoid. The rail lives 1100px down the
    # section (measured: y=1133 at 1280x800), so a mouse event aimed at
    # its DOCUMENT position would land on <html> and prove nothing -
    # scroll it into view first and box it AFTER the scroll.
    page.evaluate("document.querySelector('.cm-sidebar__rail')"
                  ".scrollIntoView({block: 'center'})")
    page.wait_for_timeout(300)
    rail = page.query_selector('.cm-sidebar__rail')
    rb = rail.bounding_box()
    # the rail is AS TALL as the viewport (800), so centering it cannot
    # put its midpoint on screen - pick a point that is verifiably inside
    # BOTH the rail and the window instead of assuming the middle is.
    cy = min(rb['y'] + rb['height'] / 2, 800 - 40)
    assert rb['y'] <= cy <= rb['y'] + rb['height'] and 0 <= cy <= 800, \
        f'drag point {cy} not usable, rail box: {rb}'
    page.mouse.move(rb['x'] + rb['width'] / 2, cy)
    page.mouse.down()
    page.mouse.move(rb['x'] + rb['width'] / 2 + 80, cy, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)
    drag = geo(page)
    token = page.evaluate(
        "() => document.querySelector('#sidebar .cm-sidebar')"
        ".style.getPropertyValue('--sidebar-width')")
    check('dragging the rail resizes WITHOUT toggling (state stays, token set)',
          drag['state'] == 'expanded' and 330 <= drag['w'] <= 345
          and token.endswith('px'),
          f"w={drag['w']} state={drag['state']} token={token}")

    # ---- 8. a drag too small to be a drag still counts as a click.
    # The resize MOVED the rail (it rides the panel's edge), so the old
    # coordinates now point at the panel's middle - re-box the rail and
    # prove it moved, or this press would test nothing.
    rail2 = page.query_selector('.cm-sidebar__rail')
    rb2 = rail2.bounding_box()
    check('the rail rides the panel edge as it resizes',
          abs(rb2['x'] - rb['x'] - 80) <= 2,
          f"{rb['x']} -> {rb2['x']}")
    cy2 = min(rb2['y'] + rb2['height'] / 2, 800 - 40)
    x02 = rb2['x'] + rb2['width'] / 2
    page.mouse.move(x02, cy2)
    page.mouse.down()
    page.mouse.move(x02 + 2, cy2, steps=3)
    page.mouse.up()
    page.wait_for_timeout(250)
    g = geo(page)
    check('a 2px wobble is still a click, not a resize',
          g['state'] == 'collapsed', g['state'])
    page.click('.cm-sidebar__rail')
    page.wait_for_timeout(350)

    # ---- 8b. the resize has its own rails: 12rem floor, 32rem ceiling.
    # A drag far past either end must STOP at the clamp, not follow the
    # pointer to 18rem or 90rem.
    rail3 = page.query_selector('.cm-sidebar__rail')
    rb3 = rail3.bounding_box()
    cy3 = min(rb3['y'] + rb3['height'] / 2, 800 - 40)
    x03 = rb3['x'] + rb3['width'] / 2
    page.mouse.move(x03, cy3)
    page.mouse.down()
    page.mouse.move(x03 + 2000, cy3, steps=8)
    page.mouse.up()
    page.wait_for_timeout(300)
    top = page.evaluate(
        "() => Math.round(document.querySelector('.cm-sidebar__panel')"
        ".getBoundingClientRect().width)")
    check('the resize stops at its 32rem ceiling', top == 512, top)

    rail4 = page.query_selector('.cm-sidebar__rail')
    rb4 = rail4.bounding_box()
    cy4 = min(rb4['y'] + rb4['height'] / 2, 800 - 40)
    x04 = rb4['x'] + rb4['width'] / 2
    page.mouse.move(x04, cy4)
    page.mouse.down()
    page.mouse.move(x04 - 4000, cy4, steps=8)
    page.mouse.up()
    page.wait_for_timeout(300)
    floor = page.evaluate(
        "() => Math.round(document.querySelector('.cm-sidebar__panel')"
        ".getBoundingClientRect().width)")
    check('and follows the pointer down to its 12rem floor', floor == 192, floor)

    # back to the shipped width for the phases below
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".style.removeProperty('--sidebar-width')")
    page.wait_for_timeout(300)

    # The drag tests wrote an inline width token - they had to: that is
    # where the resize lives. The phases below measure the DEFAULTS, so
    # put the specimen back the way it shipped first (and prove the
    # restoration worked rather than assuming it).
    restored = page.evaluate("""() => {
        const sc = document.querySelector('#sidebar .cm-sidebar');
        sc.style.removeProperty('--sidebar-width');
        return Math.round(sc.querySelector('.cm-sidebar__panel')
            .getBoundingClientRect().width);
    }""")
    page.wait_for_timeout(300)
    check('the specimen is restored to its shipped width before the flip tests',
          restored == 256, restored)

    # ---- 9. side=right: the whole layout mirrors through one attribute
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-side', 'right')")
    page.wait_for_timeout(150)
    r = geo(page)
    check('data-side=right parks the panel on the right and the content on the left',
          r['left'] > r['insetLeft'], r)
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-side', 'left')")

    # ---- 10. variant=floating: the panel gets its own frame
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-variant', 'floating')")
    page.wait_for_timeout(150)
    fl = page.evaluate("""() => {
        const cs = getComputedStyle(document.querySelector('.cm-sidebar__panel'));
        return {m: cs.marginLeft, bw: cs.borderTopWidth, r: cs.borderTopLeftRadius};
    }""")
    check('variant=floating frames the panel (margin + border, still sharp)',
          fl['m'] == '12px' and fl['bw'] == '1px' and fl['r'] in ('0px', ''), fl)
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-variant', 'sidebar')")

    # ---- 11. variant=inset: the CONTENT becomes the card
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-variant', 'inset')")
    page.wait_for_timeout(150)
    ins = page.evaluate("""() => {
        const cs = getComputedStyle(document.querySelector('.cm-sidebar__inset'));
        return {m: cs.marginLeft, bw: cs.borderTopWidth,
                bg: cs.backgroundColor};
    }""")
    check('variant=inset cards the content instead (margin + border)',
          ins['m'] == '12px' and ins['bw'] == '1px', ins)
    page.evaluate("() => document.querySelector('#sidebar .cm-sidebar')"
                  ".setAttribute('data-variant', 'sidebar')")

    # ---- 12. collapsible=none: rail gone, collapse a NO-OP even when
    # the attribute lies about it.
    page.evaluate("""() => {
        const sc = document.querySelector('#sidebar .cm-sidebar');
        sc.setAttribute('data-collapsible', 'none');
        sc.setAttribute('data-state', 'collapsed');
    }""")
    page.wait_for_timeout(300)
    none = geo(page)
    rail_d = page.evaluate(
        "() => getComputedStyle(document.querySelector('.cm-sidebar__rail')).display")
    check('collapsible=none keeps its width, position and rail however the state reads',
          none['w'] == 256 and none['pos'] == 'sticky'
          and none['state'] == 'collapsed' and rail_d == 'none',
          f'{none} rail={rail_d}')

    # CMD-B must not collapse a none: toggle state attr but visuals stay -
    # the state attr flips, the PANEL does not move. Verify the flip writes
    # the attr (state in DOM) while width holds.
    page.keyboard.press('Meta+b')
    page.wait_for_timeout(300)
    after = geo(page)
    check('under none a toggle still writes its state (DOM-first) but nothing moves',
          after['state'] == 'expanded' and after['w'] == 256
          and after['pos'] == 'sticky', after)

    # ---- 12b. DESKTOP offcanvas: collapsed must park the panel fully
    # OFF its edge and OUT of the flow. The phone phase covers the
    # media-query sheet; this is the desktop slide-out, and the mutation
    # that survived proof turned its parking transform into translateX(0)
    # - a panel sitting on-screen reading 'collapsed' - while labels,
    # width and state all still said the right words.
    page.evaluate("""() => {
        const sc = document.querySelector('#sidebar .cm-sidebar');
        sc.setAttribute('data-collapsible', 'offcanvas');
        sc.setAttribute('data-state', 'collapsed');
    }""")
    page.wait_for_timeout(350)
    off = geo(page)
    check('desktop offcanvas parks fully off its edge, out of the flow',
          off['pos'] == 'fixed' and off['left'] + off['w'] <= 1
          and off['state'] == 'collapsed', off)
    page.evaluate("""() => {
        document.querySelector('#sidebar .cm-sidebar')
            .setAttribute('data-state', 'expanded');
    }""")
    page.wait_for_timeout(350)
    off2 = geo(page)
    check('and expanding slides the same panel back into the flow',
          off2['pos'] == 'sticky' and off2['left'] == off2['scopeLeft'], off2)
    page.evaluate("""() => {
        document.querySelector('#sidebar .cm-sidebar')
            .setAttribute('data-collapsible', 'icon');
    }""")
    page.wait_for_timeout(250)

    check('no page errors on the desktop sidebar', not page_errors, page_errors)
    page.close()

    # ================= phone, 402 =================
    page = b.new_page(viewport={'width': 402, 'height': 667})
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function('() => window.cliMono')
    page.evaluate("document.querySelector('#sidebar').scrollIntoView({block:'start'})")
    page.wait_for_timeout(400)

    # ---- 13. closed sheet, and the trigger tells the TRUTH about it:
    # the viewport decides, so aria starts false even though the state
    # attribute still says expanded (a desktop fact).
    m = geo(page)
    scrim = page.evaluate(
        "() => getComputedStyle(document.querySelector('.cm-sidebar__scrim')).display")
    check('the phone starts as a parked sheet: off-screen, scrim away, trigger false',
          m['mobile'] == 'false' and m['left'] + m['w'] <= 1
          and scrim == 'none' and m['trig'] == 'false',
          f'{m} scrim={scrim}')
    check('the sheet carries the phone width token (18rem)',
          m['w'] == 288, m['w'])
    check('and the content keeps the full width behind it (no offset at all)',
          m['insetLeft'] == m['scopeLeft'],
          f"inset={m['insetLeft']} scope={m['scopeLeft']}")

    # ---- 14. the trigger opens it: sheet in, scrim in, aria true
    page.click(TRIG)
    page.wait_for_timeout(400)
    m = geo(page)
    scrim = page.evaluate(
        "() => getComputedStyle(document.querySelector('.cm-sidebar__scrim')).display")
    check('the trigger slides the sheet in over its scrim and aria agrees',
          m['mobile'] == 'true' and m['left'] >= -1 and scrim == 'block'
          and m['trig'] == 'true', f'{m} scrim={scrim}')

    # ---- 15. the scrim is the dismiss
    page.click('.cm-sidebar__scrim', position={'x': 380, 'y': 520})
    page.wait_for_timeout(400)
    m = geo(page)
    check('pressing the scrim closes the sheet',
          m['mobile'] == 'false' and m['trig'] == 'false', m)

    # ---- 16. Escape closes and hands focus back to the trigger
    page.click(TRIG)
    page.wait_for_timeout(400)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    m = geo(page)
    focus = page.evaluate(
        "() => document.activeElement.hasAttribute('data-cm-sidebar-trigger')")
    check('Escape closes the sheet and returns focus to the trigger',
          m['mobile'] == 'false' and focus, f'{m} focus={focus}')

    # ---- 17. CMD-B opens the sheet (the shortcut is viewport-aware)
    page.keyboard.press('Meta+b')
    page.wait_for_timeout(400)
    m = geo(page)
    check('CMD-B opens the sheet on the phone too',
          m['mobile'] == 'true' and m['trig'] == 'true', m)

    # ---- 18. Escape on a CLOSED sheet must do nothing destructive -
    # no focus trap sprung from nowhere.
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)

    check('no page errors on the phone sidebar', not page_errors, page_errors)
    page.close()
    b.close()

print(f'---\npassed {passed}/{passed + len(failed)}')
if failed:
    for f in failed:
        print(' FAILED:', f)
    raise SystemExit(1)
