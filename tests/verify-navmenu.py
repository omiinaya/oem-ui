#!/root/.venvs/mau/bin/python
"""WebKit proof for the navigation menu (batch 20).

Everything here is measured in the engine Omar actually reads on: WebKit at
an iPhone viewport. The claims are the three a nav menu makes and a dropdown
does not - the bar walks, the panel is placed under its own word, and the
indicator under the bar follows the section the reader has reached.

The vision model's opinions are not consulted; every number below comes from
getBoundingClientRect / getComputedStyle.
"""
import sys
from playwright.sync_api import sync_playwright

# House convention: the LAN preview, overridable so a mutation sweep or a
# worktree can point at whichever port it actually serves on.
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
BAR = '[data-cm-navmenu]'
PRODUCT = '.cm-navmenu__trigger[popovertarget="nav-product"]'
REF = '.cm-navmenu__trigger[popovertarget="nav-ref"]'
PANEL = '#nav-product'

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



def click_at(page, selector):
    """Click an element where it already is.

    Playwright scrolls an element into view before clicking it. With the
    showcase's sticky chrome that scroll can move the element somewhere the
    pointer then cannot reach - measured in WebKit: the nested root's word
    sits at y=708 in an 874px viewport and is reported `not visible` by
    Playwright's own check. Scrolling the showcase to put the word under the
    pointer is exactly what a reader does not do, so the harness clicks the
    measured point instead.
    """
    box = page.locator(selector).first.bounding_box()
    if not box:
        return False
    page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    return True


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={"width": 402, "height": 874})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='load')
    page.wait_for_function("() => window.cliMono && document.documentElement.classList.contains('cm-js')")

    # Fail READABLY if the bar is not a bound landmark. The bar is located
    # by its data hook everywhere below, so a mutant that drops the hook
    # makes the FIRST querySelector return null and every later evaluate
    # throws - the run dies with `TypeError: null is not an object` and
    # prints no FAIL line at all. A mutation sweep that greps the output
    # for FAIL then counts a real kill as a survivor: measured on this
    # batch, the suite killed that mutant (566 passed, 1 failed) while the
    # harness reported SURVIVED. A harness that cannot state its failure is
    # not a harness.
    if not page.evaluate("() => !!document.querySelector('[data-cm-navmenu]')"):
        print('FAIL the page has no [data-cm-navmenu] bar at all - '
              'nothing below can be measured')
        print('\n0 passed, 1 failed\n  FAIL the bar is missing')
        browser.close()
        sys.exit(1)

    # ---- the state the runtime is supposed to have written, at rest
    page.evaluate("() => document.querySelector('%s').scrollIntoView({block:'center'})" % BAR)
    page.wait_for_timeout(400)
    state = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const ind = [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar);
        const cur = bar.querySelectorAll('.cm-navmenu__trigger[aria-current="true"]');
        const after = getComputedStyle(ind, '::after');
        return {
            active: ind.getAttribute('data-active'),
            w: ind.style.getPropertyValue('--cm-navmenu-w'),
            x: ind.style.getPropertyValue('--cm-navmenu-x'),
            painted: after.width,
            current: cur.length,
            currentHref: cur.length ? cur[0].getAttribute('href') : null,
        };
    }""")
    check('the indicator reports that it was measured',
          state['active'] == 'true' and state['w'] and state['x'], state)
    check('exactly one trigger is the current section',
          state['current'] == 1, state)
    # The mark actually paints: a width read back off the ::after, not just a
    # custom property on the parent. A mark whose knobs are right and whose
    # pseudo-element computes to 0px is invisible at every viewport.
    check('the mark paints a non-zero width in the engine',
          state['painted'] not in ('0px', 'auto', ''), state)

    # ---- the mark is ON the current trigger: measured, not assumed
    onctx = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const ind = [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar);
        const cur = bar.querySelector('.cm-navmenu__trigger[aria-current="true"]');
        const r = cur.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        const after = getComputedStyle(ind, '::after');
        return { wantW: Math.round(r.width), wantX: Math.round(r.left - b.left),
                 haveW: parseInt(after.width, 10) };
    }""")
    check('the mark width is the current trigger width',
          abs(onctx['haveW'] - onctx['wantW']) <= 1, onctx)

    # ---- the bar walks: ArrowRight from an OPEN panel's trigger moves to the
    # next WORD and opens its panel in the same press. This is the behaviour
    # that makes the bar a bar and not four dropdowns in a row.
    page.click(PRODUCT)
    page.wait_for_timeout(250)
    opened = page.evaluate("""(sel) => {
        const t = document.querySelector(sel);
        const p = document.getElementById('nav-product');
        const tr = t.getBoundingClientRect(), pr = p.getBoundingClientRect();
        return { open: p.matches(':popover-open'),
                 expanded: t.getAttribute('aria-expanded'),
                 dl: Math.round(pr.left - tr.left),
                 below: Math.round(pr.top - tr.bottom),
                 above: Math.round(tr.top - pr.bottom),
                 ph: Math.round(pr.height), th: Math.round(tr.height),
                 panelLeft: Math.round(pr.left), panelRight: Math.round(pr.right),
                 vw: document.documentElement.clientWidth,
                 chev: getComputedStyle(t.querySelector('.cm-navmenu__chev')).transform };
    }""", PRODUCT)
    check('clicking a trigger opens its panel',
          opened['open'] and opened['expanded'] == 'true', opened)
    # Under its own word, FROM THE LEFT EDGE - the property that separates
    # this from a dropdown, whose panel aligns to its trigger's RIGHT edge.
    # A 20rem panel under a word near the middle of a 402px screen cannot
    # have both: the runtime clamps it to the viewport gutter instead
    # (measured here: the panel lands at x=8 with the trigger at x=59, a
    # dl of -51). So the claim is stated as the DISJUNCTION it is: either
    # the left edges coincide, or the panel was clamped inside the gutter -
    # and the clamp is asserted separately, at 320, below.
    # ...and the mouse-opened direction is the one this display lives in:
    # `(hover: none)` is the iPhone case, so before the 320 block the bar is
    # read under the pointer mode it is actually in. Without this the
    # disjunction above passes for the WRONG reason - the clamp satisfies
    # its second half - and the left-align claim is never exercised at all.
    page.emulate_media(media='screen')
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(200)
    fine = browser.new_context(viewport={"width": 1280, "height": 900})
    fp = fine.new_page()
    fp.goto(URL, wait_until='load')
    fp.wait_for_function("() => window.cliMono")
    fp.evaluate("""() => document.querySelector(
        '.cm-navmenu__trigger[popovertarget="nav-product"]')
        .scrollIntoView({block: 'center'})""")
    fp.wait_for_timeout(400)
    fp.click('.cm-navmenu__trigger[popovertarget="nav-product"]')
    fp.wait_for_function(
        "() => document.getElementById('nav-product').matches(':popover-open')")
    fp.wait_for_timeout(300)
    wide = fp.evaluate("""() => {
        const t = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-product"]');
        const p = document.getElementById('nav-product');
        const pr = p.getBoundingClientRect(), tr = t.getBoundingClientRect();
        return { dl: Math.round(pr.left - tr.left),
                 below: Math.round(pr.top - tr.bottom),
                 above: Math.round(tr.top - pr.bottom),
                 ph: Math.round(pr.height), th: Math.round(tr.height),
                 vw: document.documentElement.clientWidth,
                 w: Math.round(pr.width) };
    }""")
    # LEFT is the claim the mutant kills: a panel that loses its left-align
    # entry hangs off the trigger's RIGHT edge instead. VERTICAL is
    # ADJACENCY, either way - never "below" only. On this page the 276px
    # panel does not fit under a centred trigger, so it correctly flips
    # ABOVE at 32 + 8 + 276 = 316px; a "4px below" check fails on correct
    # behaviour, a trap this repo has already paid for once.
    check('at desktop the panel hangs from its trigger LEFT edge',
          abs(wide['dl']) <= 1, wide)
    check('...and is adjacent to it, 4px either below or above',
          abs(wide['below'] - 4) <= 1 or abs(wide['above'] - 4) <= 1, wide)
    check('...and is NOT clamped, so the two readings differ',
          wide['w'] > 0 and wide['dl'] != opened['dl'], wide)
    fine.close()
    check('on a phone the same panel is clamped inside the viewport instead',
          opened['panelLeft'] >= 7 and opened['panelRight'] <= opened['vw'] - 7, opened)
    # The chevron turns with the state. A chevron that never rotates leaves
    # the open state readable only by the panel itself.
    matrix = opened['chev']
    pts_up = matrix != 'none' and matrix != 'matrix(1, 0, 0, 1, 0, 0)'
    check('the chevron carries the open state visually', pts_up, matrix)

    # ---- Left/Right walk the BAR while a panel is open, and the next
    # panel opens in the same press. The dispatch and the READ are separate
    # evaluates with a settle between them: showPopover() fires `toggle` as
    # a task, so a read in the same tick sees the panel still shut (this
    # harness got that wrong twice - the reading is the panel's own state,
    # and the state does not exist yet in that tick).
    # #prose's document position, then scroll a fixed amount past the spit
    # line and WAIT FOR SETTLE. `scroll-behavior: smooth` animates every
    # programmatic scroll on this page, so a `wait_for_function` whose
    # condition is true mid-flight (y>100, still short of the section)
    # reads during the animation - measured line: 200 while the section
    # sat 37,848px below, and `current` fell back to links[0] again. The
    # two settle-waits below are what make the reading honest.
    target = page.evaluate("() => Math.round("
        "document.querySelector('#prose').getBoundingClientRect().top"
        " + window.scrollY)")
    page.evaluate("() => window.scrollTo(0, %d)" % (target + 250))
    page.wait_for_function(
        "() => Math.abs(window.scrollY - %d) < 40" % (target + 250),
        timeout=15000)
    page.evaluate("""() => {
        const t = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-product"]');
        t.focus();
        t.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    }""")
    page.wait_for_timeout(250)
    walked = page.evaluate("""() => {
        const ref = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-ref"]');
        const prod = document.getElementById('nav-product');
        const panel = document.getElementById('nav-ref');
        return { focusIsRef: document.activeElement === ref,
                 prodClosed: !prod.matches(':popover-open'),
                 refOpen: panel.matches(':popover-open'),
                 refExpanded: ref.getAttribute('aria-expanded') };
    }""")
    check('Right walks the bar and swaps the panel in the same press',
          walked['focusIsRef'] and walked['refOpen'] and walked['prodClosed']
          and walked['refExpanded'] == 'true', walked)

    # ---- wraps at the end, like every native menu bar. The bar is
    # layout / product / reference / readme, so Right from `reference` goes
    # to `readme` and the NEXT Right wraps to the first word. Neither step
    # crosses a panel boundary, so nothing here depends on toggle timing.
    # Scoped to THE bar under test (the first one): document-wide would
    # collect every trigger of every bar now that the specimen ships the
    # shared-viewport and vertical bars, and then "the last word" is some
    # other bar's - an oracle that drifts to a sibling, which is exactly
    # what this suite's rename-proofing exists for.
    wrapped = page.evaluate("""() => {
        const home = document.querySelector('.cm-navmenu__trigger[popovertarget=\"nav-product\"]');
        const ownBar = home.closest('[data-cm-navmenu]');
        const nav = () => [...ownBar.querySelectorAll('.cm-navmenu__trigger')]
            .filter(t => t.getClientRects().length > 0);
        nav()[nav().length - 2].focus();
        nav()[nav().length - 2].dispatchEvent(
            new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
        const mid = document.activeElement.getAttribute('href');
        document.activeElement.dispatchEvent(
            new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
        const last = document.activeElement;
        return { order: nav().length, mid: mid,
                 focusIsFirst: last === nav()[0],
                 firstHref: last.getAttribute('href') };
    }""")
    check('Right walks to the next word, then wraps to the first',
          wrapped['mid'] == '#readme' and wrapped['focusIsFirst']
          and wrapped['firstHref'] == '#layout', wrapped)

    # ---- the bar is inert while nothing is open: arrows in a bar with no
    # panel open must not steal a keypress from the page. Focus starts on a
    # trigger that is NOT the one the arrows would reach, so "the handler
    # did nothing" is a real reading and not a pass-by-construction.
    page.evaluate("""() => {
        document.querySelectorAll('[popover]').forEach((p) => {
            if (p.matches(':popover-open')) p.hidePopover();
        });
    }""")
    page.wait_for_timeout(200)
    page.evaluate("""() => {
        const ref = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-ref"]');
        ref.focus();
        ref.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    }""")
    page.wait_for_timeout(200)
    inert = page.evaluate("""() => {
        const ref = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-ref"]');
        return { stayed: document.activeElement === ref,
                 openPanels: [...document.querySelectorAll('[popover]')]
                     .filter(p => p.matches(':popover-open')).map(p => p.id),
                 moved: document.activeElement.getAttribute('href')
                     || document.activeElement.getAttribute('popovertarget') };
    }""")
    check('with no panel open the bar does not walk',
          inert['stayed'] and not inert['openPanels'], inert)

    # ---- scroll-spy: the mark and aria-current follow the page. Scrolled to
    # the END, the current section is the last one the bar points at, and the
    # panel openers are never candidates.
    page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_function(
        "() => Math.abs(window.scrollY - (document.documentElement.scrollHeight - window.innerHeight)) < 4")
    page.wait_for_timeout(300)
    bottom = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const cur = [...bar.querySelectorAll('.cm-navmenu__trigger')]
            .filter(t => t.getAttribute('aria-current') === 'true');
        return { n: cur.length,
                 href: cur.length ? cur[0].getAttribute('href') : null,
                 panelOpenersMarked: [...bar.querySelectorAll('[popovertarget]')]
                     .filter(t => t.hasAttribute('aria-current')).length,
                 active: bar.querySelector('.cm-navmenu__indicator')
                     .getAttribute('data-active') };
    }""")
    check('at the page end the current section is the LAST one the bar points at',
          bottom['n'] == 1 and bottom['href'] == '#readme', bottom)
    # A trigger with no href opens a panel and points at nothing: marking it
    # would tell a reader they are in a section that does not exist.
    check('a panel opener is never marked as the current section',
          bottom['panelOpenersMarked'] == 0, bottom)

    # ---- …and back to the top, the first tracked section is the current one
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_function("() => window.scrollY < 4")
    page.wait_for_timeout(300)
    top = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const ind = [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar);
        const cur = bar.querySelector('.cm-navmenu__trigger[aria-current="true"]');
        const after = getComputedStyle(ind, '::after');
        return { href: cur && cur.getAttribute('href'),
                 painted: after.width,
                 x: ind.style.getPropertyValue('--cm-navmenu-x') };
    }""")
    # The bar tracks exactly TWO sections - #layout (the first) and #readme
    # (the last, and one that never crosses the scroll line before max
    # scroll) - so on the SHIPPED fixture there is no mid-page reading that
    # a search stuck on links[0] would get wrong. Rather than weaken the
    # claim, give the fixture the hazard: add a third tracked trigger
    # pointing at a genuinely mid-page section (#prose), scroll to it, and
    # require the mark to land on IT. navSpy re-queries the bar on every
    # scroll event, so a late-added trigger is picked up without re-init -
    # which is also the SPA path this component has to survive.
    page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const a = document.createElement('a');
        a.className = 'cm-navmenu__trigger';
        a.id = 'nav-probe-middle';
        a.href = '#prose';
        a.textContent = 'middle';
        bar.appendChild(a);
    }""")
    # Scroll clear of the spy's LINE and wait for the scroll to SETTLE.
    # Two traps met here, both producing the mutant's reading on a correct
    # product: `block: 'start'` leaves the section top AT the viewport top,
    # which is still a header-height BELOW the line (`scrollTop + header
    # height`), so nothing is reached and `current` falls back to links[0];
    # and `scroll-behavior: smooth` animates every programmatic scroll on
    # this page, so a readiness condition that is already true mid-flight
    # (`y > 100`) reads during the animation - measured here as line: 200
    # while the section sat 37,848px below. Scroll to an absolute position
    # past the line, wait for it to settle, then assert the section really
    # is above the line so this cannot quietly go back.
    target = page.evaluate("() => Math.round("
        "document.querySelector('#prose').getBoundingClientRect().top"
        " + window.scrollY)")
    want = target + 250
    page.evaluate("() => window.scrollTo(0, %d)" % want)
    page.wait_for_function(
        "() => Math.abs(window.scrollY - %d) < 40" % want, timeout=15000)
    page.wait_for_timeout(400)
    # `block: 'start'` puts the section's top AT the viewport top, which is
    # still BELOW the spy's line - the line is `scrollTop + header height`,
    # so a section has to be a header-height past the top before it counts
    # as reached. Measured on the first cut of this check: proseTop 38048
    # against a line of 38024, eight pixels short, so `current` stayed null
    # and the `links[0]` fallback marked #layout - the exact reading a
    # search that never moves would produce, i.e. the check could not tell
    # the product from the mutant. Scroll clear of the line, and ASSERT the
    # section is genuinely past it, so this cannot quietly go back.
    mid = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const cur = bar.querySelector('.cm-navmenu__trigger[aria-current="true"]');
        const tracked = [...bar.querySelectorAll('.cm-navmenu__trigger')]
            .filter(t => t.getAttribute('href'));
        const head = document.querySelector('[data-cm-header]');
        const pad = head ? head.getBoundingClientRect().height : 0;
        const sec = document.querySelector('#prose');
        return { href: cur && cur.getAttribute('href'),
                 idx: tracked.indexOf(cur),
                 n: tracked.length,
                 secAboveLine: Math.round(sec.getBoundingClientRect().top
                                          + window.scrollY)
                               <= Math.round(window.scrollY + pad) + 16,
                 atEnd: Math.round(window.scrollY + window.innerHeight
                                   - document.documentElement.scrollHeight),
                 line: Math.round(window.scrollY),
                 ind: [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar).style
                     .getPropertyValue('--cm-navmenu-x'),
                 indW: [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar).style
                     .getPropertyValue('--cm-navmenu-w') };
    }""")
    check('past the first tracked section the mark moves to the section the '
          'reader is actually in (not the first one, and not because the '
          'page ended)',
          mid['secAboveLine'] and mid['idx'] == mid['n'] - 1
          and mid['href'] == '#prose' and mid['atEnd'] < -8, mid)
    check('...and the mark is measured onto that word, not left at zero',
          mid['ind'] not in ('', '0px') and mid['indW'] not in ('', '0px'), mid)
    page.evaluate("() => { const a = document.getElementById('nav-probe-middle');"
                  " a && a.remove(); }")

    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(400)
    check('back at the top the first tracked section takes the mark',
          top['href'] == '#layout' and top['painted'] not in ('0px', ''), top)

    # ---- the bar fits the phone. The bar is a flex row with wrap, so at a
    # narrow viewport it reflows to two rows and its own width stays inside
    # the card - what matters is that neither the bar NOR ITS OPENED PANEL
    # crosses the viewport. A panel is `width: min(20rem, 100vw - 2*gutter)`
    # and the runtime clamps it, so this is the check that a 20rem surface
    # cannot run off a 320px screen.
    page.set_viewport_size({"width": 320, "height": 667})
    page.wait_for_timeout(250)
    fit = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu]');
        const r = bar.getBoundingClientRect();
        const kids = [...bar.children].map(c => c.getBoundingClientRect());
        document.querySelector('.cm-navmenu__trigger[popovertarget="nav-product"]')
            .scrollIntoView({block: 'center'});
        return { barLeft: Math.round(r.left), barRight: Math.round(r.right),
                 widest: Math.round(Math.max(...kids.map(k => k.right))),
                 vw: document.documentElement.clientWidth };
    }""")
    page.wait_for_timeout(200)
    page.click('.cm-navmenu__trigger[popovertarget="nav-product"]')
    page.wait_for_timeout(250)
    panel = page.evaluate("""() => {
        const p = document.getElementById('nav-product');
        const r = p.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right),
                 w: Math.round(r.width),
                 vw: document.documentElement.clientWidth };
    }""")
    check('the bar fits a 320px screen', fit['widest'] <= fit['vw'], fit)
    check('and its opened panel is clamped inside the same 320px screen',
          panel['left'] >= 0 and panel['right'] <= panel['vw'] + 1, panel)
    page.evaluate("() => { const p = document.getElementById('nav-product');"
                  " if (p.matches(':popover-open')) p.hidePopover(); }")
    page.set_viewport_size({"width": 402, "height": 874})
    page.wait_for_timeout(150)

    # ---- the tap floor: a panel opener is a control, and on a coarse pointer
    # it must clear 44px. Read from an ISOLATED host, so a taller sibling
    # cannot stretch it and be mistaken for the declaration landing - and
    # read minHeight, which is what proves the DECLARATION and not the box.
    coarse = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    cp = coarse.new_page()
    cp.goto(URL, wait_until='load')
    cp.wait_for_function("() => window.cliMono")
    floor = cp.evaluate("""() => {
        const t = document.querySelector('.cm-navmenu__trigger');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-9999px;width:8rem';
        const clone = t.cloneNode(true);
        host.appendChild(clone);
        document.body.appendChild(host);
        const out = { h: Math.round(clone.getBoundingClientRect().height),
                      min: getComputedStyle(clone).minHeight };
        host.remove();
        return out;
    }""")
    check('on a coarse pointer the trigger takes the 44px floor',
          floor['min'] == '44px' and floor['h'] >= 44, floor)
    fine = page.evaluate("""() => {
        const t = document.querySelector('.cm-navmenu__trigger');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-9999px;width:8rem';
        const clone = t.cloneNode(true);
        host.appendChild(clone);
        document.body.appendChild(host);
        const out = { h: Math.round(clone.getBoundingClientRect().height),
                      min: getComputedStyle(clone).minHeight };
        host.remove();
        return out;
    }""")
    # The variant must DIFFER on a fine pointer: a floor that applies
    # everywhere is not a coarse-pointer rule, it is density lost at a desk.
    check('on a fine pointer the same trigger stays dense',
          floor['h'] != fine['h'], {'coarse': floor, 'fine': fine})

    # ---- batch 23: the three depth behaviours - delayed hover, the
    # shared viewport, the vertical bar. All on the FINE main page (the
    # media gate is read at event time; the coarse negative lives as a
    # source pin in the suite, because Playwright cannot flip
    # (hover: none) on a desktop WebKit).
    VPROD = '[data-cm-navmenu-viewport] .cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-product"]'
    VREF = '[data-cm-navmenu-viewport] .cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-reference"]'
    VBAR = '[data-cm-navmenu-viewport]'

    page.evaluate("""() => {
        document.querySelectorAll('[popover]').forEach((p) => {
            if (p.matches(':popover-open')) p.hidePopover();
        });
        window.scrollTo(0, 0);
    }""")
    page.wait_for_timeout(300)
    page.evaluate("(sel) => document.querySelector(sel).scrollIntoView({block:'start'})", PRODUCT)
    page.wait_for_timeout(500)
    page.evaluate("(sel) => window.scrollBy(0, document.querySelector(sel).getBoundingClientRect().top - 380)", PRODUCT)
    page.wait_for_timeout(150)
    inView = page.evaluate("(sel) => { const r = document.querySelector(sel).getBoundingClientRect();"
                            " return r.top >= 0 && r.bottom <= window.innerHeight; }", PRODUCT)
    # block:'center' is not enough here: at desktop the header is the fixed
    # full-viewport rail, so even centered the word can settle below the
    # fold - measured at y=896 in a 900px viewport, where elementFromPoint
    # returns null and WebKit delivers no pointer events for a coordinate
    # outside the page. The check was measuring the browser, not the
    # component.
    check('the hovered word is parked inside the viewport', inView, {'inView': inView})


    # (a) the delay is REAL: hover must not open in the first 200ms.
    # The read at +90ms is what separates a delay from an instant open;
    # the read after 440ms total separates a delay from a broken gate.
    box = page.locator(PRODUCT).bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.wait_for_timeout(90)
    early = page.evaluate("() => document.getElementById('nav-product').matches(':popover-open')")
    check('hover for less than 200ms opens nothing', not early, {'openAt90ms': early})
    page.wait_for_timeout(380)
    later = page.evaluate("""() => {
        const p = document.getElementById('nav-product');
        const t = document.querySelector('.cm-navmenu__trigger[popovertarget="nav-product"]');
        return { open: p.matches(':popover-open'), exp: t.getAttribute('aria-expanded') };
    }""")
    check('hovering past the 200ms delay opens the panel',
          later['open'] and later['exp'] == 'true', later)

    # (b) leaving the bar: the grace keeps the panel up while the pointer
    # is still crossing, then the HOVER-opened panel closes. Two reads,
    # because a close-at-0ms and a never-close both fail one of them.
    page.mouse.move(8, 8)
    page.wait_for_timeout(150)
    grace = page.evaluate("() => document.getElementById('nav-product').matches(':popover-open')")
    check('the hover panel survives the first 150ms after the pointer leaves',
          grace, {'openAt150ms': grace})
    page.wait_for_timeout(400)
    gone = page.evaluate("() => document.getElementById('nav-product').matches(':popover-open')")
    check('and closes once the 300ms grace has run', not gone, {'openAt550ms': gone})

    # (c) a CLICK-opened panel is sticky: the click door turns hover
    # ownership OFF (and the 200ms timer must not steal it back - the
    # timer fires AFTER the click on this very trigger).
    page.click(PRODUCT)
    page.wait_for_timeout(300)          # past the timer this click armed
    page.mouse.move(8, 8)
    page.wait_for_timeout(500)          # past every grace window
    sticky = page.evaluate("() => document.getElementById('nav-product').matches(':popover-open')")
    check('a click-opened panel stays when the pointer leaves', sticky, {'stayed': sticky})
    page.keyboard.press('Escape')
    page.wait_for_timeout(250)

    # (d) inside an OPEN bar the move to the next word is immediate: no
    # second 200ms. Read at +90ms - under the delay, so a re-delayed
    # swap would fail it.
    box = page.locator(PRODUCT).bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.wait_for_timeout(380)
    rbox = page.locator(REF).bounding_box()
    page.mouse.move(rbox['x'] + rbox['width'] / 2, rbox['y'] + rbox['height'] / 2)
    page.wait_for_timeout(90)
    swapped = page.evaluate("""() => ({
        prod: document.getElementById('nav-product').matches(':popover-open'),
        ref: document.getElementById('nav-ref').matches(':popover-open'),
        refExp: document.querySelector('.cm-navmenu__trigger[popovertarget="nav-ref"]')
                  .getAttribute('aria-expanded') })""")
    check('inside an open bar the next word swaps with no second delay',
          (not swapped['prod']) and swapped['ref'] and swapped['refExp'] == 'true', swapped)
    page.mouse.move(8, 8)
    page.wait_for_timeout(500)

    # (e) the SHARED VIEWPORT: one panel, the list swaps under it.
    page.evaluate("() => document.querySelector('%s').scrollIntoView({block:'center'})" % VBAR)
    page.wait_for_timeout(600)
    # open door 1 (synthetic click: no pointer travel, so the hover
    # timer never enters this sequence)
    page.evaluate("() => document.querySelector('%s').click()" % VPROD)
    page.wait_for_timeout(300)
    vp1 = page.evaluate("""() => {
        const vp = document.getElementById('nav-viewport');
        const p = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-product"]');
        const r = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-reference"]');
        return { open: vp.matches(':popover-open'),
                 state: vp.getAttribute('data-state'),
                 hasButtons: !!vp.querySelector('a[href="#buttons"]'),
                 kids: vp.children.length,
                 pExp: p.getAttribute('aria-expanded'),
                 rExp: r.getAttribute('aria-expanded') };
    }""")
    check('the shared viewport opens carrying the first word\'s list',
          vp1['open'] and vp1['state'] == 'open' and vp1['hasButtons']
          and vp1['kids'] > 0 and vp1['pExp'] == 'true' and vp1['rExp'] == 'false', vp1)
    # the CLICK door on a different word must SWAP, not toggle closed -
    # two triggers, one popovertarget, and the platform only knows
    # "toggle". Synthetic click: the pointer is nowhere near the bar, so
    # this is the click branch alone.
    page.evaluate("() => document.querySelector('%s').click()" % VREF)
    page.wait_for_timeout(300)
    vp2 = page.evaluate("""() => {
        const vp = document.getElementById('nav-viewport');
        const p = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-product"]');
        const r = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-reference"]');
        return { open: vp.matches(':popover-open'),
                 state: vp.getAttribute('data-state'),
                 hasButtons: !!vp.querySelector('a[href="#buttons"]'),
                 hasScroller: !!vp.querySelector('a[href="#scroller"]'),
                 pExp: p.getAttribute('aria-expanded'),
                 rExp: r.getAttribute('aria-expanded') };
    }""")
    check('clicking the next word swaps the list in the same open panel',
          vp2['open'] and vp2['hasScroller'] and not vp2['hasButtons']
          and vp2['pExp'] == 'false' and vp2['rExp'] == 'true', vp2)
    # ...and the arrow walk takes the same path: content swaps, panel
    # stays open, focus lands on the new word, panel re-anchored to IT.
    page.evaluate("""() => {
        const t = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-product"]');
        t.focus();
        t.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    }""")
    page.wait_for_timeout(350)
    vp3 = page.evaluate("""() => {
        const vp = document.getElementById('nav-viewport');
        const r = document.querySelector('[data-cm-navmenu-viewport] '
            + '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-tpl-reference"]');
        const pr = vp.getBoundingClientRect(), rr = r.getBoundingClientRect();
        return { open: vp.matches(':popover-open'),
                 focusIsR: document.activeElement === r,
                 hasScroller: !!vp.querySelector('a[href="#scroller"]'),
                 dl: Math.round(pr.left - rr.left),
                 below: Math.round(pr.top - rr.bottom),
                 vw: document.documentElement.clientWidth,
                 left: Math.round(pr.left),
                 rExp: r.getAttribute('aria-expanded') };
    }""")
    check('the arrow walk swaps the viewport in place, anchored to the new word',
          vp3['open'] and vp3['focusIsR'] and vp3['hasScroller']
          and vp3['rExp'] == 'true'
          and (abs(vp3['dl']) <= 1 or vp3['left'] >= 7), vp3)
    # close on the CURRENT word: data-state closed, every word false.
    page.evaluate("() => document.querySelector('%s').click()" % VREF)
    page.wait_for_timeout(300)
    vp4 = page.evaluate("""() => {
        const vp = document.getElementById('nav-viewport');
        const exps = [...document.querySelectorAll('[data-cm-navmenu-viewport] .cm-navmenu__trigger')]
            .map(t => t.getAttribute('aria-expanded'));
        return { open: vp.matches(':popover-open'),
                 state: vp.getAttribute('data-state'),
                 exps: exps };
    }""")
    check('the current word\'s click closes it and stamps data-state closed',
          (not vp4['open']) and vp4['state'] == 'closed'
          and all(e == 'false' for e in vp4['exps']), vp4)

    # (f) the vertical bar: the declaration is the attribute, the list
    # stacks, and the indicator rides the SECOND pair of knobs (height
    # and top) instead of width and left.
    page.evaluate("""() => document.querySelector(
        '[data-cm-navmenu][data-orientation="vertical"]') .scrollIntoView({block:'center'})""")
    page.wait_for_timeout(700)
    vert = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu][data-orientation="vertical"]:not([data-cm-navmenu-sub])');
        const kids = [...bar.querySelectorAll('.cm-navmenu__trigger')].map((k) => {
            const r = k.getBoundingClientRect();
            return { t: Math.round(r.top), b: Math.round(r.bottom),
                     l: Math.round(r.left), w: Math.round(r.width) };
        });
        const ind = [...bar.querySelectorAll('.cm-navmenu__indicator')].find((i) => i.closest('[data-cm-navmenu]') === bar);
        const after = getComputedStyle(ind, '::after');
        const widths = kids.map((k) => k.w);
        return { dir: getComputedStyle(bar).flexDirection,
                 stacked: kids.every((k, i) => i === 0 || k.t >= kids[i - 1].b - 1),
                 sameLeft: kids.length > 1 && kids.every((k) => k.l === kids[0].l),
                 sameW: kids.length > 1
                        && Math.max(...widths) - Math.min(...widths) <= 2,
                 active: ind.getAttribute('data-active'),
                 h: ind.style.getPropertyValue('--cm-navmenu-h'),
                 y: ind.style.getPropertyValue('--cm-navmenu-y'),
                 paintedH: after.height };
    }""")
    # sameW: width:100% is the difference between a LIST and a pile of
    # shrink-wrapped chips - shrink-to-fit stacks cleanly too, so the
    # left edge alone cannot see it.
    check('the vertical bar stacks its words in one column',
          vert['dir'] == 'column' and vert['stacked'] and vert['sameLeft']
          and vert['sameW'], vert)
    # paintedH must BE the h knob: an axis swap that paints the w value
    # still yields a non-empty height (vertical triggers are wide), so
    # "not empty" cannot see the wrong axis.
    check('and its mark is painted on the height axis, not the row\'s',
          vert['active'] == 'true' and vert['h'] not in ('', '0px')
          and vert['y'] not in ('',) and vert['paintedH'] == vert['h'], vert)

    # ---- batch 24: the submenu path. NavigationMenu.Sub is a nested
    # ROOT, so it carries its own viewport and its own indicator - and
    # because it is nested in the product panel, every OWN-element read
    # above has to pick the mark and rows of the bar it asks about.
    sub = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu-sub]');
        const inds = [...bar.querySelectorAll('.cm-navmenu__indicator')];
        return { label: bar.getAttribute('aria-label'),
                 vertical: bar.getAttribute('data-orientation'),
                 insidePanel: !!bar.closest('.cm-navmenu__panel'),
                 ownMarks: inds.filter((i) => i.closest('[data-cm-navmenu]') === bar).length,
                 allMarks: inds.length,
                 words: [...bar.querySelectorAll('.cm-navmenu__trigger')].length,
                 panelId: bar.getAttribute('data-cm-navmenu-viewport') };
    }""")
    check('the nested root is a bar of its own, inside the parent panel',
          sub['insidePanel'] and sub['vertical'] == 'vertical'
          and sub['ownMarks'] == 1 and sub['allMarks'] == 1 and sub['words'] >= 2, sub)
    # It is not rendered until its parent panel is open - a nested root in
    # the document flow would reflow the page under the reader.
    hidden = page.evaluate("""() => {
        const bar = document.querySelector('[data-cm-navmenu-sub]');
        return { rects: bar.getClientRects().length,
                 wordRects: document.querySelector('.cm-navmenu__trigger[data-cm-navmenu-content="#nav-sub-tpl-depth"]').getClientRects().length };
    }""")
    check('the nested root lays out nothing while its parent panel is closed',
          hidden['rects'] == 0 and hidden['wordRects'] == 0, hidden)

    # Open the parent word, walk onto the submenu's own word, then step
    # OUT with ArrowLeft: the panel closes and focus returns to the
    # parent word, which is the reader's way back.
    page.evaluate("(sel) => document.querySelector(sel).scrollIntoView({block:'start'})", PRODUCT)
    page.wait_for_timeout(500)
    page.evaluate("(sel) => window.scrollBy(0, document.querySelector(sel).getBoundingClientRect().top - 120)", PRODUCT)
    page.wait_for_timeout(150)
    page.click(PRODUCT)
    page.wait_for_timeout(250)
    opened = page.evaluate("""() => {
        const p = document.getElementById('nav-product');
        const bar = document.querySelector('[data-cm-navmenu-sub]');
        return { open: p.matches(':popover-open'),
                 subVisible: bar.getClientRects().length > 0 };
    }""")
    check('opening the parent word lays the nested root out', opened['open'] and opened['subVisible'], opened)
    # Focus the submenu's first word the way a reader reaches it: the walk
    # lands there when the parent panel is open.
    focus = page.evaluate("""() => {
        const w = document.querySelector('.cm-navmenu__trigger[data-cm-navmenu-content="#nav-sub-tpl-depth"]');
        w.focus();
        return { onWord: document.activeElement === w };
    }""")
    check('the nested word takes focus', focus['onWord'], focus)
    subPanel = page.evaluate("() => document.querySelector('[data-cm-navmenu-sub]').getAttribute('data-cm-navmenu-viewport')")
    click_at(page, '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-sub-tpl-depth"]')
    page.wait_for_timeout(250)
    deep = page.evaluate("""(id) => {
        const p = document.getElementById(id);
        return { open: !!(p && p.matches(':popover-open')),
                 label: p ? p.getAttribute('aria-label') : null };
    }""", subPanel)
    check('a nested word opens the submenu panel', deep['open'], deep)
    # ArrowLeft out: panel closed, focus on the word that owns it.

    # Placement: a nested panel must not bury the panel that holds it.
    # It may sit beside the parent, or below its own word - the bottom
    # clamp legitimately pushes it up when the word is near the fold, so
    # "below its word" is not the invariant. What must never happen is the
    # panel landing back at the parent's top-left corner, which is what
    # anchoring it like a top-level panel did: measured at 402px, word
    # y=488 with the submenu at y=196, straight over the parent's links.
    geo = page.evaluate("""(id) => {
        const R = (e) => e.getBoundingClientRect();
        const parent = document.getElementById('nav-product');
        const sub = document.getElementById(id);
        const word = document.querySelector('[data-cm-navmenu-sub] .cm-navmenu__trigger');
        const pr = R(parent), sr = R(sub), wr = R(word);
        // The parent's OWN links: `:scope > *` and `.cm-navmenu__link`,
        // because a nested root's links live in the parent's subtree too
        // (the submenu fills into it) and a submenu legitimately covers
        // its own rows.
        const links = [...parent.children]
            .filter((n) => n.classList && n.classList.contains('cm-navmenu__link'))
            .map(R);
        // A link of the parent panel covered by the submenu is that panel
        // buried - whatever the reason.
        const covered = links.filter((l) =>
            sr.top < l.bottom - 1 && sr.bottom > l.top + 1 &&
            sr.left < l.right - 1 && sr.right > l.left + 1).length;
        return { subTop: Math.round(sr.top), subLeft: Math.round(sr.left),
                 subBottom: Math.round(sr.bottom),
                 wordTop: Math.round(wr.top), wordLeft: Math.round(wr.left),
                 parentTop: Math.round(pr.top), parentBottom: Math.round(pr.bottom),
                 parentRight: Math.round(pr.right), covered, links: links.length,
                 inViewport: sr.left >= -0.5 && sr.right <= window.innerWidth + 0.5
                             && sr.top >= -0.5 && sr.bottom <= window.innerHeight + 0.5 };
    }""", subPanel)
    # The keyboard path IN: ArrowRight on an open nested word steps focus
    # into the submenu's first row. Driven on the outer bar too, so the
    # check also proves ArrowRight still roves sections where there is no
    # submenu at all - the key has one meaning per bar, not one per page.
    page.evaluate("""(sel) => {
        const w = document.querySelector(sel);
        w.focus();
    }""", '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-sub-tpl-depth"]')
    page.wait_for_timeout(120)
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(200)
    kin = page.evaluate("""(id) => {
        const panel = document.getElementById(id);
        const items = panel ? [...panel.querySelectorAll('.cm-navmenu__link')] : [];
        const a = document.activeElement;
        return { count: items.length,
                 focusedInPanel: !!(a && panel && panel.contains(a)),
                 focusedTag: a ? a.tagName : null,
                 stillOnWord: !!a && a.classList
                     && a.classList.contains('cm-navmenu__trigger') };
    }""", subPanel)
    check('ArrowRight on an open nested word steps into the submenu',
          kin['count'] > 0 and kin['focusedInPanel'] and not kin['stillOnWord'], kin)

    # And back OUT, one level per press - Radix's rule, and the house
    # dropdown's existing rule: ArrowLeft from INSIDE a submenu returns to
    # the row that owns it. The second press, from that word, is the step
    # out to the parent word. Asserting only the end state would pass on
    # a single jump that skipped the level in between.
    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    kout1 = page.evaluate("""(id) => {
        const panel = document.getElementById(id);
        const a = document.activeElement;
        return { closed: !(panel && panel.matches(':popover-open')),
                 onOwnerWord: !!a && a.classList
                     && a.classList.contains('cm-navmenu__trigger')
                     && !!a.closest('[data-cm-navmenu-sub]'),
                 focusedLabel: a ? a.textContent.trim().slice(0, 40) : null };
    }""", subPanel)
    check('ArrowLeft from inside the submenu returns to the word that owns it',
          kout1['closed'] and kout1['onOwnerWord'], kout1)

    page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(250)
    kout2 = page.evaluate("""() => {
        const a = document.activeElement;
        return { onProductWord: !!a && a.getAttribute
                    && a.getAttribute('popovertarget') === 'nav-product',
                 stillInSub: !!a && !!a.closest('[data-cm-navmenu-sub]'),
                 focusedLabel: a ? a.textContent.trim().slice(0, 40) : null };
    }""")
    check('a second ArrowLeft steps out to the parent word',
          kout2['onProductWord'] and not kout2['stillInSub'], kout2)

    check('the submenu covers none of the parent panel\'s links',
          geo['covered'] == 0 and geo['links'] > 0, geo)
    check('the submenu is never parked at the parent panel\'s corner',
          geo['subTop'] > geo['parentTop'] - 1
          or geo['subLeft'] >= geo['parentRight'] - 2, geo)
    check('the submenu stays inside the viewport', geo['inViewport'], geo)
    # NARROWER than the panel it hangs off, and by a real margin: a
    # second 20rem wall stacked on the first buries the page it sits over,
    # which is the whole reason the rule exists. Read while the submenu is
    # OPEN (a closed popover measures zero, which is no reading at all) and
    # against the PARENT panel's own width, so the check survives a panel
    # that resizes.
    open_widths = page.evaluate("""(id) => {
        const sub = document.getElementById(id);
        const parent = document.getElementById('nav-product');
        // BOTH open. A closed panel is display:none and measures zero, so
        // a ratio read while either is shut is not a reading.
        if (!parent.matches(':popover-open')) parent.showPopover();
        if (!sub.matches(':popover-open')) sub.showPopover();
        const sr = sub.getBoundingClientRect(), pr = parent.getBoundingClientRect();
        return { open: sub.matches(':popover-open'),
                 subW: Math.round(sr.width), parentW: Math.round(pr.width),
                 ratio: Math.round((sr.width / pr.width) * 100) / 100 };
    }""", subPanel)
    check('the submenu panel is narrower than the panel it hangs off',
          open_widths['open'] and open_widths['subW'] > 0
          and open_widths['parentW'] > 0
          and open_widths['subW'] < open_widths['parentW'] - 8
          and open_widths['ratio'] <= 0.85, open_widths)

    # The parent closing retires the open submenu: a submenu popover lives
    # in the top layer and survives its parent's close, which is the one
    # state that makes nested navigation unreadable.
    page.click(PRODUCT)
    page.wait_for_timeout(200)
    click_at(page, '.cm-navmenu__trigger[data-cm-navmenu-content="#nav-sub-tpl-depth"]')
    page.wait_for_timeout(250)
    page.click(PRODUCT)
    page.wait_for_timeout(300)
    retired = page.evaluate("(id) => !document.getElementById(id).matches(':popover-open')", subPanel)
    check('the parent closing retires the open submenu', retired, {'subStillOpen': not retired})

    check('the page threw nothing', not errors, errors)
    browser.close()

print(f'\n{passed} passed, {len(failed)} failed')
for f in failed:
    print('  FAIL', f)
sys.exit(1 if failed else 0)
