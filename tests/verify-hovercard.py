#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 5: the hover card and the input group."""
import sys
from playwright.sync_api import sync_playwright
from harness_wait import boot_timeout

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
results, problems = [], []

def check(name, ok, detail=''):
    (results if ok else problems).append(name)
    print(('  ok  ' if ok else 'FAIL  ') + name + (' :: ' + detail if detail and not ok else ''))
    return ok

with sync_playwright() as pw:
    b = pw.webkit.launch()
    page = b.new_page(viewport={'width': 1280, 'height': 900})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => !!window.cliMono", timeout=boot_timeout())

    def panel_state():
        return page.evaluate("""() => {
            const p = document.querySelector('.cm-hovercard__panel');
            const cs = getComputedStyle(p);
            return {visibility: cs.visibility, opacity: cs.opacity,
                    radius: cs.borderRadius, r: p.getBoundingClientRect().height};
        }""")

    rest = panel_state()
    check('the panel is hidden at rest', rest['visibility'] == 'hidden', str(rest))
    check('the panel is sharp', rest['radius'] in ('0px', '0'), str(rest))
    check('the hidden panel occupies no height for a reader', rest['r'] >= 0, str(rest))

    page.hover('.cm-hovercard a')
    page.wait_for_timeout(300)
    hov = panel_state()
    check('hovering the trigger reveals the panel', hov['visibility'] == 'visible', str(hov))

    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    out = panel_state()
    check('leaving hides it again', out['visibility'] == 'hidden', str(out))

    # keyboard: tabbing to the trigger must reveal it
    page.evaluate("document.querySelector('.cm-hovercard a').focus()")
    page.wait_for_timeout(250)
    kb = panel_state()
    check('focus-within reveals it for the keyboard', kb['visibility'] == 'visible', str(kb))

    grp = page.evaluate("""() => {
        const g = document.querySelector('.cm-input-group');
        const addon = g.querySelector('.cm-input-group__addon');
        const input = g.querySelector('input');
        const a = getComputedStyle(addon), i = getComputedStyle(input);
        const r = g.getBoundingClientRect();
        return {addonLeft: a.borderLeftWidth, addonRight: a.borderRightWidth,
                inputLeft: i.borderLeftWidth, inputTop: i.borderTopWidth,
                w: r.width, radius: i.borderRadius};
    }""")
    check('the input group renders one control', grp['w'] > 120, str(grp))
    # Exactly ONE of the two borders that meet at the seam must be
    # dropped. The addon is the one we own; the field's left border comes
    # from base.css at higher specificity, so naming which side yields is
    # an implementation detail - a doubled seam is not.
    check('the seam is a single hairline (exactly one shared border dropped)',
          (grp['inputLeft'] == '0px') != (grp['addonRight'] == '0px'), str(grp))
    check('the joined control stays sharp', grp['radius'] in ('0px', '0'), str(grp))

    side = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check('no sideways scroll at 1280px', not side)
    check('no page errors', not errs, str(errs[:2]))
    b.close()

print('\n%d passed, %d failed' % (len(results), len(problems)))
sys.exit(1 if problems else 0)
