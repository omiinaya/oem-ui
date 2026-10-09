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
        const ind = bar.querySelector('.cm-navmenu__indicator');
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
        const ind = bar.querySelector('.cm-navmenu__indicator');
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
    wrapped = page.evaluate("""() => {
        const nav = () => [...document.querySelectorAll('.cm-navmenu__trigger')]
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
        const ind = bar.querySelector('.cm-navmenu__indicator');
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
                 ind: bar.querySelector('.cm-navmenu__indicator').style
                     .getPropertyValue('--cm-navmenu-x'),
                 indW: bar.querySelector('.cm-navmenu__indicator').style
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

    check('the page threw nothing', not errors, errors)
    browser.close()

print(f'\n{passed} passed, {len(failed)} failed')
for f in failed:
    print('  FAIL', f)
sys.exit(1 if failed else 0)
