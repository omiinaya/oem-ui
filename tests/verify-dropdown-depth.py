#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 18: dropdown depth.

The features are all keyboard, so this drives keys rather than reads CSS:
Right opens a submenu and focuses its first row, Left closes it and returns
focus to the parent, checkbox rows flip on Space but NOT when the arrows
step over them, arriving on a radio row takes the selection, typeahead walks
by prefix, and a shortcut hint never reaches the accessible name.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
TRIG = '[popovertarget="menu-depth"]'
OWNER = '#menu-depth [aria-haspopup="menu"]'

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


with sync_playwright() as pw:
    b = pw.webkit.launch()
    page = b.new_page(viewport={"width": 402, "height": 667})
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => window.cliMono")

    # --- geometry first: scroll the trigger into view and settle
    page.evaluate("""() => {
        const t = document.querySelector('[popovertarget="menu-depth"]');
        t.scrollIntoView({block: 'center'});
    }""")
    page.wait_for_timeout(600)
    page.click(TRIG)
    page.wait_for_timeout(200)

    # ---- the menu opens and owns the documented roles
    roles = page.evaluate("""() => {
        const m = document.querySelector('#menu-depth');
        const rows = [...m.querySelectorAll('[role^=menuitem]')];
        return {
            open: m.matches(':popover-open'),
            n: rows.length,
            kinds: [...new Set(rows.map((r) => r.getAttribute('role')))],
            expanded: document.querySelector('[popovertarget="menu-depth"]')
                .getAttribute('aria-expanded'),
        };
    }""")
    check('the menu opens with every documented item kind',
          roles['open'] and roles['kinds'] == ['menuitem', 'menuitemcheckbox',
                                               'menuitemradio'] and roles['n'] >= 7,
          roles)

    # ---- focus lands on the first reachable row on open
    f0 = page.evaluate("() => document.activeElement.textContent.trim()")
    check('opening moves focus into the menu', f0.startswith('viewer'), f0)

    # ---- Right opens the submenu, focuses its first row AND places it,
    # all in one task. The toggle event that used to anchor the panel
    # fires later, so anything painting between showed it at its base
    # position (WebKit measured subLeft 5, subTop 708 before the task).
    right = page.evaluate("""() => {
        // from the focused row, like a real key event: onMenuKey reads
        // e.target and document has no .closest
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
            { key: 'ArrowRight', bubbles: true }));
        const s = document.getElementById('sub-depth-1');
        const p = document.getElementById('menu-depth');
        const sr = s.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        return { open: s.matches(':popover-open'),
                 focus: (document.activeElement.textContent || '').trim(),
                 placed: Math.abs(sr.left - pr.right) <= 1 };
    }""")
    check('Right opens, focuses the first row, and is placed in one task',
          right['open'] and right['focus'] == 'read only' and right['placed'],
          right)

    # ---- GEOMETRY (the vision gate's finding): the panel sits BESIDE the
    # parent, top-aligned with its owner row, inside the viewport - not
    # stacked underneath it with the parent's border crossing its rows.
    geo = page.evaluate("""() => {
        const box = (e) => {
            const r = e.getBoundingClientRect();
            return { l: Math.round(r.left), t: Math.round(r.top),
                     r: Math.round(r.right), b: Math.round(r.bottom) };
        };
        return {
            trigger: box(document.querySelector(
                '[popovertarget="menu-depth"]')),
            parent: box(document.getElementById('menu-depth')),
            sub: box(document.getElementById('sub-depth-1')),
            row: box(document.querySelector(
                '#menu-depth [aria-haspopup="menu"]')),
            vw: document.documentElement.clientWidth,
        };
    }""")
    check('the submenu sits beside its panel, top-aligned with its owner row',
          geo['sub']['l'] >= geo['parent']['r'] - 1 and
          geo['sub']['l'] <= geo['parent']['r'] + 1 and
          abs(geo['sub']['t'] - geo['row']['t']) <= 1 and
          geo['sub']['r'] <= geo['vw'], geo)
    check('at open the menu hangs from its trigger, 4px either side',
          abs(geo['parent']['t'] - (geo['trigger']['b'] + 4)) <= 1 or
          abs(geo['parent']['b'] - (geo['trigger']['t'] - 4)) <= 1, geo)

    # ---- THE PIN: with both surfaces open, scrolling keeps the menu ON
    # its trigger and the submenu beside the panel. The old single pin
    # slot meant opening the submenu evicted the parent's pin, and the
    # parent then sat still while the page scrolled under it.
    page.evaluate("() => window.scrollBy(0, -60)")
    page.wait_for_timeout(350)
    geo2 = page.evaluate("""() => {
        const box = (e) => {
            const r = e.getBoundingClientRect();
            return { l: Math.round(r.left), t: Math.round(r.top),
                     r: Math.round(r.right), b: Math.round(r.bottom) };
        };
        return {
            trigger: box(document.querySelector(
                '[popovertarget="menu-depth"]')),
            parent: box(document.getElementById('menu-depth')),
            sub: box(document.getElementById('sub-depth-1')),
            row: box(document.querySelector(
                '#menu-depth [aria-haspopup="menu"]')),
        };
    }""")
    check('scrolling keeps the menu on its trigger and the submenu beside it',
          (abs(geo2['parent']['t'] - (geo2['trigger']['b'] + 4)) <= 1 or
           abs(geo2['parent']['b'] - (geo2['trigger']['t'] - 4)) <= 1) and
          geo2['sub']['l'] >= geo2['parent']['r'] - 1 and
          geo2['sub']['l'] <= geo2['parent']['r'] + 1 and
          abs(geo2['sub']['t'] - geo2['row']['t']) <= 1, geo2)
    page.evaluate("() => window.scrollBy(0, 60)")
    page.wait_for_timeout(300)

    # ---- Left closes it and returns focus to the PARENT row
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(200)
    back = page.evaluate("""() => {
        const s = document.getElementById('sub-depth-1');
        return { open: s.matches(':popover-open'),
                 focus: (document.activeElement.textContent || '').trim(),
                 onOwner: document.activeElement === document.querySelector(
                     '#menu-depth [aria-haspopup="menu"]') };
    }""")
    check('Left closes the submenu and returns focus to the parent row',
          not back['open'] and back['onOwner'], back)

    # ---- closing must RELEASE the pin: with the submenu closed a scroll
    # may not touch its box any more. The registry entry is what unpin
    # finds - dropping the push keeps the listeners alive, and the closed
    # panel keeps re-anchoring forever (a leak no live-open check sees).
    stale = page.evaluate(
        "() => document.getElementById('sub-depth-1').style.top")
    page.evaluate("() => window.scrollBy(0, -60)")
    page.wait_for_timeout(350)
    stale2 = page.evaluate(
        "() => document.getElementById('sub-depth-1').style.top")
    page.evaluate("() => window.scrollBy(0, 60)")
    page.wait_for_timeout(300)
    check('closing releases the submenu pin (a stale one re-anchors it)',
          stale != '' and stale2 == stale, {'at_close': stale, 'after': stale2})

    # ---- Enter opens it too, with no pointer involved
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    ent = page.evaluate("""() => {
        const s = document.getElementById('sub-depth-1');
        return { open: s.matches(':popover-open'),
                 focus: (document.activeElement.textContent || '').trim() };
    }""")
    check('Enter opens the submenu from the owner row',
          ent['open'] and ent['focus'] == 'read only', ent)
    page.keyboard.press('ArrowLeft')       # close it again for the walk below
    page.wait_for_timeout(150)

    # ---- a checkbox row flips on Space
    page.keyboard.press('ArrowDown')          # -> show invisibles
    page.wait_for_timeout(80)
    page.keyboard.press(' ')
    page.wait_for_timeout(120)
    cb = page.evaluate("""() => {
        const r = [...document.querySelectorAll('#menu-depth [role=menuitemcheckbox]')];
        return r.map((x) => [x.getAttribute('aria-checked'),
                             x.querySelector('.cm-dropdown__icon')
                              .getAttribute('data-checked')]);
    }""")
    check('Space flips the checkbox and its glyph together',
          cb[0] == ['false', 'false'], {'states': cb})

    # ---- the arrows STEP OVER a checkbox without flipping it
    before = page.evaluate(
        "() => document.querySelector('#menu-depth [role=menuitemcheckbox]')"
        ".getAttribute('aria-checked')")
    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(120)
    after = page.evaluate("""() => {
        const r = [...document.querySelectorAll('#menu-depth [role=menuitemcheckbox]')];
        return { first: r[0].getAttribute('aria-checked'),
                 focused: (document.activeElement.textContent || '').trim() };
    }""")
    check('arrows step over a checkbox without flipping it',
          after['first'] == before, {'before': before, 'after': after})

    # ---- arriving on a radio row TAKES the selection (the APG exception)
    page.evaluate("""() => {
        document.querySelector('#menu-depth [role=menuitemcheckbox]').focus();
    }""")
    page.wait_for_timeout(60)
    # walk down to the radio group: checkbox2, label, comfortable, compact
    for _ in range(3):
        page.keyboard.press('ArrowDown')
        page.wait_for_timeout(50)
    radio = page.evaluate("""() => {
        const r = [...document.querySelectorAll('#menu-depth [role=menuitemradio]')];
        return { states: r.map((x) => x.getAttribute('aria-checked')),
                 focus: (document.activeElement.textContent || '').trim() };
    }""")
    check('arriving on a radio row takes the selection, one row at a time',
          radio['states'].count('true') == 1 and radio['states'][1] == 'true',
          radio)

    # ---- typeahead: "d" jumps to the row starting with d
    page.evaluate("""() => document.querySelector('#menu-depth [role=menuitem]').focus()""")
    page.wait_for_timeout(60)
    page.keyboard.press('d')
    page.wait_for_timeout(120)
    # Assert on the LABEL the typeahead actually searches, not textContent -
    # the row also carries an aria-hidden shortcut hint, and a prefix test on
    # the concatenation would be testing the wrong string.
    ta = page.evaluate("""() => {
        const el = document.activeElement;
        const lab = el.querySelector('.cm-dropdown__label');
        return {
            text: ((lab ? lab.textContent : el.textContent) || '').trim(),
            isLast: el === [...document.querySelectorAll(
                '#menu-depth [role^=menuitem]')]
                .filter((r) => !r.closest('#sub-depth-1')).slice(-1)[0],
        };
    }""")
    check('typeahead walks to the next item by prefix',
          ta['text'] == 'delete file', ta)

    # ---- a letter that matches NO row must leave focus alone. Substring
    # matching would snap to "show invisibles", which merely CONTAINS an "o".
    page.evaluate(f"() => document.querySelector('{OWNER}').focus()")
    page.wait_for_timeout(850)             # let the 800ms buffer expire
    page.keyboard.press('o')
    page.wait_for_timeout(200)
    tano = page.evaluate("() => (document.activeElement.textContent || '').trim()")
    check('typeahead matches by prefix, not by substring',
          tano.startswith('viewer'), tano)

    # ---- the walk covers the WHOLE list, including the row you are ON:
    # pressing that letter re-selects it and swallows the key. A short walk
    # never reaches the starting row, so the key leaks to the page.
    page.evaluate("""() => {
        const rows = [...document.querySelectorAll('#menu-depth [role^=menuitem]')]
            .filter((r) => !r.closest('#sub-depth-1'));
        rows[rows.length - 1].focus();     // the last row
    }""")
    page.wait_for_timeout(850)
    page.evaluate("""() => {
        window.__prevented = 'none';
        // registered last, so it observes what the library decided
        document.addEventListener('keydown', (e) => {
            window.__prevented = e.defaultPrevented;
        });
    }""")
    page.keyboard.press('d')
    page.wait_for_timeout(200)
    wrap = page.evaluate("() => window.__prevented")
    check('typeahead wraps the whole list and swallows the key',
          wrap is True, wrap)
    # ---- a shortcut hint never reaches the accessible name
    names = page.evaluate("""() => {
        const rows = [...document.querySelectorAll('#menu-depth .cm-dropdown__item')];
        return rows.filter((r) => r.querySelector('.cm-dropdown__shortcut'))
            .map((r) => r.textContent.replace(/\\s+/g, ' ').trim());
    }""")
    # the hint IS in textContent (it is real DOM), so assert the ARIA instead:
    hidden = page.evaluate("""() => [...document.querySelectorAll(
        '#menu-depth .cm-dropdown__shortcut')].every(
            (s) => s.getAttribute('aria-hidden') === 'true')""")
    check('shortcut hints are hidden from the accessible name', hidden,
          {'hinted_rows': names})

    # ---- the icon slot is fixed width, so the label column cannot shift
    col = page.evaluate("""() => {
        const slots = [...document.querySelectorAll('#menu-depth .cm-dropdown__icon')];
        const w = slots.map((s) => Math.round(s.getBoundingClientRect().width));
        return { widths: [...new Set(w)], n: slots.length };
    }""")
    check('the icon slot is one fixed width across every row',
          len(col['widths']) == 1, col)

    # ---- no hue crept in; corners stay square
    sharp = page.evaluate("""() => {
        const rows = [...document.querySelectorAll('#menu-dropdown')];
        const r = document.querySelector('#menu-depth .cm-dropdown__item');
        return { radius: getComputedStyle(r).borderRadius };
    }""")
    check('items keep the house sharp corner', sharp['radius'] == '0px', sharp)

    # ---- a MOUSE opens it: focus is parked on the trigger, then the pointer
    # crosses the owner row. Left must land on the OWNER ROW. The platform
    # restores focus to wherever it was when the panel opened - the trigger -
    # so without the explicit call the reader is thrown out of the menu.
    page.evaluate(f"() => document.querySelector('{TRIG}').focus()")
    page.hover(OWNER)
    page.wait_for_timeout(250)
    hov = page.evaluate("""() => {
        const s = document.getElementById('sub-depth-1');
        return { open: s.matches(':popover-open'),
                 focus: (document.activeElement.textContent || '').trim() };
    }""")
    check('hover inside an open menu opens the submenu',
          hov['open'] and hov['focus'] == 'read only', hov)
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    hback = page.evaluate("""() => {
        const owner = document.querySelector('#menu-depth [aria-haspopup="menu"]');
        const trig = document.querySelector('[popovertarget="menu-depth"]');
        return {
            onOwner: document.activeElement === owner,
            onTrigger: document.activeElement === trig,
            focus: (document.activeElement.textContent || '').trim(),
        };
    }""")
    check('Left after a hover-open returns focus to the owner row, not the trigger',
          hback['onOwner'] and not hback['onTrigger'], hback)

    # ---- ONE LEVEL PER PRESS. A mouse can leave focus on a parent row with
    # the submenu still open; Left must close the SUBMENU first (menu stays
    # up, focus lands on the panel's owner), and only the next press steps
    # out of the menu itself.
    page.mouse.move(2, 2)
    page.wait_for_timeout(150)
    page.hover(OWNER)
    page.wait_for_timeout(250)
    page.evaluate('''() => {
        const rows = [...document.querySelectorAll('#menu-depth [role^=menuitem]')]
            .filter((r) => !r.closest('#sub-depth-1') &&
                     r !== document.querySelector('#menu-depth [aria-haspopup="menu"]'));
        rows[0].focus();   // 'show invisibles' - a PARENT row, submenu open
    }''')
    page.wait_for_timeout(150)
    st0 = page.evaluate('''() => ({
        parent: document.getElementById('menu-depth').matches(':popover-open'),
        sub: document.getElementById('sub-depth-1').matches(':popover-open'),
        focus: (document.activeElement.textContent || '').trim().slice(0, 16),
    })''')
    check('submenu open with focus on a parent row is reachable',
          st0['parent'] and st0['sub'] and st0['focus'].startswith('show invis'), st0)

    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    st1 = page.evaluate('''() => ({
        parent: document.getElementById('menu-depth').matches(':popover-open'),
        sub: document.getElementById('sub-depth-1').matches(':popover-open'),
        onOwner: document.activeElement === document.querySelector(
            '#menu-depth [aria-haspopup="menu"]'),
    })''')
    check('first Left closes the submenu only and lands on its owner',
          st1['parent'] and not st1['sub'] and st1['onOwner'], st1)

    # the consumer's trigger may name its panel by popovertarget ALONE;
    # stepping out must work from that, not only from aria-controls.
    page.evaluate('''() => document.querySelector(
        '[popovertarget="menu-depth"]').removeAttribute('aria-controls')''')
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    st2 = page.evaluate('''() => ({
        parent: document.getElementById('menu-depth').matches(':popover-open'),
        focus: (document.activeElement.textContent || '').trim(),
        onTrigger: document.activeElement === document.querySelector(
            '[popovertarget="menu-depth"]'),
    })''')
    check('second Left steps out of the menu via popovertarget alone',
          not st2['parent'] and st2['onTrigger'], st2)

    # ---- 320px: panel + submenu cannot sit side by side (227 + 104 > 320),
    # so the panel clamps INSIDE the viewport instead of clipping off-screen.
    page.set_viewport_size({"width": 320, "height": 667})
    page.evaluate(f"() => document.querySelector('{TRIG}').scrollIntoView({{block:'center'}})")
    page.wait_for_timeout(400)
    page.click(TRIG)
    page.wait_for_timeout(250)
    page.hover(OWNER)
    page.wait_for_timeout(350)
    geo320 = page.evaluate("""() => {
        const r = document.getElementById('sub-depth-1').getBoundingClientRect();
        return { l: Math.round(r.left), r: Math.round(r.right),
                 vw: document.documentElement.clientWidth,
                 open: document.getElementById('sub-depth-1')
                     .matches(':popover-open') };
    }""")
    check('at 320 the submenu is clamped inside the viewport',
          geo320['open'] and geo320['l'] >= 0 and geo320['r'] <= geo320['vw'],
          geo320)

    check('no page errors in the dropdown', not page_errors, page_errors)
    b.close()

print(f'---\npassed {passed}/{passed + len(failed)}')
if failed:
    for f in failed:
        print(' FAILED:', f)
    raise SystemExit(1)