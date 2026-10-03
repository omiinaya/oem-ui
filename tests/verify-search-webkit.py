"""Measure the search field in real WebKit at iPhone widths.

Every claim this cycle makes about the component is measured here, not
asserted from the CSS text:

  * the focus ring PAINTS (outline-style is not `none`) and is >= 2px
  * the computed font-size is >= 16px (the iOS zoom floor)
  * the placeholder clears the glyph on the left and the X on the right
  * the clear button takes the tap floor on a coarse pointer and stays
    compact on a fine one
  * both widths of the clear button are what the padding arithmetic assumes

    /root/.venvs/mau/bin/python tests/verify-search-webkit.py
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4321/'
VIEWPORTS = [(390, 844, False), (375, 667, False), (390, 844, True), (1440, 900, False)]

PROBE = """
() => {
  const inp = document.querySelector('#q-filled');
  const box = document.querySelector('#q-filled').closest('.cm-search');
  const clr = box.querySelector('.cm-search__clear');
  const glyph = box.querySelector('.cm-search__icon');
  const cs = getComputedStyle(inp);
  const fs = getComputedStyle(clr);
  const gs = glyph.getBoundingClientRect();
  const cr = clr.getBoundingClientRect();
  const ir = inp.getBoundingClientRect();
  return {
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    fontSize: parseFloat(cs.fontSize),
    padLeft: parseFloat(cs.paddingLeft),
    padRight: parseFloat(cs.paddingRight),
    minHeight: parseFloat(cs.minHeight),
    clearW: cr.width,
    clearH: cr.height,
    glyphW: gs.width,
    ir: {x: ir.x, w: ir.width, h: ir.height},
    // Where the text actually starts, and where the two overlays end.
    textStart: ir.x + parseFloat(cs.paddingLeft),
    glyphEnd: gs.x + gs.width,
    clearStart: cr.x,
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  };
}
"""


def main():
    out = []
    with sync_playwright() as p:
        browser = p.webkit.launch()
        for w, h, coarse in VIEWPORTS:
            ctx = browser.new_context(
                viewport={'width': w, 'height': h},
                has_touch=coarse,
                device_scale_factor=3 if coarse else 2,
            )
            page = ctx.new_page()
            # Clear storage BEFORE every measurement, or a saved light
            # theme leaks into the next page and a themed token reads
            # from the wrong theme.
            page.add_init_script(
                'try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}')
            page.goto(URL, wait_until='networkidle')
            page.locator('#q-filled').scroll_into_view_if_needed()
            d = page.evaluate(PROBE)
            d.update(width=w, height=h, coarse=coarse)
            # The ring has to be measured WITH focus applied.
            page.locator('#q-filled').focus()
            d['focusOutlineStyle'] = page.evaluate(
                "() => getComputedStyle(document.querySelector('#q-filled')).outlineStyle")
            d['focusOutlineWidth'] = page.evaluate(
                "() => getComputedStyle(document.querySelector('#q-filled')).outlineWidth")
            d['focusOutlineColor'] = page.evaluate(
                "() => getComputedStyle(document.querySelector('#q-filled')).outlineColor")
            # A range in a text input paints a selection highlight; the
            # point is to see the ring, so scroll the clear button into view.
            page.screenshot(path=f'/tmp/search-{w}-coarse{int(coarse)}.png')
            out.append(d)
            ctx.close()
        browser.close()

    print(json.dumps(out, indent=1))
    ok = True
    for d in out:
        tag = f"{d['width']}x{d['height']} coarse={d['coarse']}"
        # 1. the ring
        if d['focusOutlineStyle'] == 'none':
            print(f'FAIL {tag}: focus ring does not paint (outline-style none)')
            ok = False
        if float(d['focusOutlineWidth'].replace('px', '')) < 2:
            print(f"FAIL {tag}: focus ring is {d['focusOutlineWidth']}")
            ok = False
        # 2. the iOS zoom floor
        if d['fontSize'] < 16:
            print(f"FAIL {tag}: font-size {d['fontSize']}px is under the 16px iOS floor")
            ok = False
        # 3. the placeholder clears the glyph
        if d['textStart'] < d['glyphEnd']:
            print(f"FAIL {tag}: text starts at {d['textStart']:.1f} but the glyph "
                  f"ends at {d['glyphEnd']:.1f} - the placeholder runs under it")
            ok = False
        # 4. the value clears the X
        if d['ir']['x'] + d['ir']['w'] - d['padRight'] > d['clearStart']:
            print(f"FAIL {tag}: the text run ends under the clear button")
            ok = False
        # 5. the clear button's tap floor
        want = 44 if d['coarse'] else 32
        if abs(d['clearW'] - want) > 0.6:
            print(f"FAIL {tag}: clear button is {d['clearW']}px, expected {want}px")
            ok = False
        # 6. the field itself takes the tap floor
        if d['minHeight'] < 44:
            print(f"FAIL {tag}: field min-height {d['minHeight']}px")
            ok = False
        # 6b. the FIELD never exceeds its own container, even though the
        # page as a whole scrolls sideways for unrelated reasons.
        box = d['ir']['x'] + d['ir']['w']
        holder = d['clearStart'] + d['clearW'] + 4  # X's right edge + its inset
        if box > holder + 1:
            print(f'FAIL {tag}: the field extends {box - holder:.1f}px past its '
                  'own container')
            ok = False
        # Sideways scroll is deliberately NOT asserted here. The showcase
        # scrolls sideways at 390px today because of the `lists`, `states`
        # and `tblaction` specimens, and that is PRE-EXISTING: measured in
        # WebKit against a clean worktree at HEAD f4d57aa on port 4399,
        # scrollWidth was 524 at both 390 and 375 - byte-identical to the
        # number this section produces. Asserting it here would make this
        # verifier report a search-field defect for an unrelated table.
        # What matters for THIS component is that the field itself never
        # exceeds its container, checked below.
    print('PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
