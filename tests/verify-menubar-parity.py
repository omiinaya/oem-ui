#!/root/.venvs/mau/bin/python
"""Live proof for the six shadcn Menubar parity gaps (batch 28).

Static checks in tests/run.mjs cover the source and the driven runtime;
this settles what only a browser can: that Tab enters the bar ONCE and
leaves it, that a disabled word really refuses the platform's own
popovertarget door, and that the submenu behaves under real focus.

House rules honoured here:
  - it rebuilds nothing, but it refuses to run against a page that does
    not carry this batch's marks (wrong tree / stale dist = named fail);
  - every subject is asserted FOUND first - a selector that matches
    nothing makes the body vacuous, not green;
  - a crashed check is a failure, never a skip;
  - every check starts from a clean slate (no panel left open by the one
    before it), and focus is awaited on the state that carries it rather
    than slept for.

Run:  /root/.venvs/mau/bin/python tests/verify-menubar-parity.py
Env:  MENUBAR_URL to probe a server you started yourself (it must serve
      THIS tree), otherwise a private static server is spawned on dist/
      bound to 0.0.0.0.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
MARKS = ('data-cm-menubar', 'id="mb-help"', 'id="mb-export"', 'cm-menubar__trigger')
VIEWPORT = {'width': 402, 'height': 667}
SHOT = '/root/.hermes/cache/scratch/b28-menubar-final.png'

failures = []
passed = 0


def check(name, fn):
    global passed
    try:
        fn()
    except AssertionError as e:
        failures.append((name, str(e)))
        print(f'FAIL  {name}\n        {e}', flush=True)
    except Exception as e:  # a crashed check is a failure, never a skip
        failures.append((name, f'{type(e).__name__}: {e}'))
        print(f'FAIL  {name}\n        {type(e).__name__}: {e}', flush=True)
    else:
        passed += 1
        print(f'  ok  {name}', flush=True)


def free_port():
    s = socket.socket()
    s.bind(('0.0.0.0', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def serve():
    """Spawn a static server on dist/ and prove it serves THIS tree
    before anything measures against it."""
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port), '--bind', '0.0.0.0',
         '--directory', DIST],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'http://127.0.0.1:{port}/index.html'
    body = ''
    for _ in range(60):
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                body = r.read().decode('utf-8', 'replace')
            break
        except Exception:
            time.sleep(0.1)
    else:
        proc.terminate()
        raise SystemExit('FAIL  the static server never answered - run `npm run build` first')
    missing = [m for m in MARKS if m not in body]
    if missing:
        proc.terminate()
        raise SystemExit("FAIL  the served page is not this batch's tree, missing: "
                         + ', '.join(missing)
                         + ' - rebuild (`rm -rf dist && npm run build`) before probing')
    return proc, url


def main():
    external = os.environ.get('MENUBAR_URL')
    proc = None
    if external:
        url = external
        with urllib.request.urlopen(url, timeout=5) as r:
            body = r.read().decode('utf-8', 'replace')
        missing = [m for m in MARKS if m not in body]
        if missing:
            raise SystemExit("FAIL  MENUBAR_URL does not serve this batch's tree, missing: "
                             + ', '.join(missing))
    else:
        proc, url = serve()

    try:
        with sync_playwright() as pw:
            browser = pw.webkit.launch()
            page = browser.new_page(viewport=VIEWPORT)
            page.set_default_timeout(5000)
            # The action budget (5s) is a CLICK budget. The first navigation is
            # not: the merged showcase is a 373KB document that WebKit measured
            # at 6.92s to fire `load` (probe, 2026-10-10), so sharing one budget
            # made a correct build report a timeout on every run.
            page.set_default_navigation_timeout(30000)
            page.goto(url)
            # `load` fires before the bundle has EXECUTED (measured 2026-10-08:
            # readyState interactive, cliMono undefined, no cm-js). Every check
            # below drives runtime-wired markup, so gate on the runtime's own
            # marker rather than a sleep - a slow load can no longer pass as a
            # ready runtime, and a bundle that never runs fails LOUDLY here
            # instead of timing out somewhere in the middle of a check.
            page.wait_for_function(
                "() => document.documentElement.classList.contains('cm-js')"
                " && typeof window.cliMono === 'object'",
                timeout=15000)

            BAR = '[data-cm-menubar]'
            TRG = f'{BAR} .cm-menubar__trigger'
            PANELS = {'file': '#mb-file', 'edit': '#mb-edit',
                      'view': '#mb-view', 'help': '#mb-help'}

            def word(t):
                """The trigger whose TEXT is t, scoped to the one bar."""
                return page.locator(f'{TRG} >> text="{t}"')

            def panel_open(pid):
                return page.eval_on_selector(pid, 'el => el.matches(":popover-open")')

            def active():
                return page.evaluate('(document.activeElement.textContent || "").trim()')

            def active_is(sel):
                return page.evaluate(
                    'sel => !!document.activeElement && document.activeElement.matches(sel)',
                    sel)

            def reset():
                """No panel left open by the check before, no focus left
                inside one: each check starts from the page's own rest
                state, or it reads its results through the last one's."""
                page.evaluate('''() => {
                    document.querySelectorAll('[popover]:popover-open')
                        .forEach(el => el.hidePopover());
                    if (document.activeElement && document.activeElement.blur)
                        document.activeElement.blur();
                }''')

            def open_panel(name):
                """Focus a word, ArrowDown, and wait until the runtime has
                moved focus INTO the panel - the toggle runs as its own
                task, so pressing a key before that races it and swallows
                the press."""
                reset()
                w = word(name)
                assert w.count() == 1, f'no {name!r} word in the bar'
                w.focus()
                expect(w).to_be_focused()
                page.keyboard.press('ArrowDown')
                assert panel_open(PANELS[name]), f'ArrowDown did not open the {name} panel'
                first = page.locator(f'{PANELS[name]} .cm-dropdown__item').first
                expect(first).to_be_focused()
                return first

            # ---------------- found first ----------------
            def found_bar():
                n = page.locator(BAR).count()
                assert n == 1, f'expected exactly one menubar, found {n}'
                n = page.locator(TRG).count()
                assert n >= 4, f'the bar has {n} words; need this batch\'s four'
                stops = page.locator(f'{TRG}[tabindex="0"]')
                assert stops.count() == 1, \
                    f'{stops.count()} words sit in the tab order before any key is pressed'
                for pid in PANELS.values():
                    assert page.locator(pid).count() == 1, f'{pid} is missing from the bar'

            check('the bar, its four words and their panels are on the page', found_bar)

            # ---------------- 1. one tab stop ----------------
            def tab_stops_once():
                reset()
                w = word('file')
                w.focus()
                expect(w).to_be_focused()
                # Tab from the bar's stop must leave the BAR, not walk it.
                page.keyboard.press('Tab')
                assert not page.evaluate(
                    '!!document.activeElement.closest("[data-cm-menubar]")'), \
                    'Tab stayed inside the bar - it walks every word instead of one'
                page.keyboard.press('Shift+Tab')
                expect(w).to_be_focused()
                # ...and the runtime, not the author, owns which word: focus
                # a different word and the stop follows it. (Clicking opens
                # the panel and the toggle takes focus into it, so the stop
                # is the evidence, not the trigger's own focus.)
                word('view').click()
                # the click opened the panel and the toggle took focus into
                # it - wait for the state that says so rather than trusting
                # the trigger to still hold focus
                page.wait_for_function(
                    "document.querySelector('#mb-view').matches(':popover-open')")
                stops = page.eval_on_selector_all(
                    f'{TRG}[tabindex="0"]', 'els => els.map(e => e.textContent.trim())')
                assert stops == ['view'], \
                    f'after clicking view the stop is on {stops}, want ["view"]'
                # a disabled word must never take it, even when focus is put
                # there by script (the defect WebKit measured first)
                page.evaluate('document.querySelector(\'[popovertarget="mb-help"]\').focus()')
                stops = page.eval_on_selector_all(
                    f'{TRG}[tabindex="0"]', 'els => els.map(e => e.textContent.trim())')
                assert 'help' not in stops, \
                    f'focus on the disabled word moved the stop to {stops}'

            check('Tab enters the bar once, and the stop follows focus', tab_stops_once)

            # ---------------- 2. disabled word ----------------
            def disabled_refused():
                reset()
                h = word('help')
                assert h.count() == 1, 'the disabled word is missing from the bar'
                assert h.is_visible(), \
                    'the disabled word is not visible - aria-disabled keeps it in the tree'
                assert h.get_attribute('aria-disabled') == 'true', 'help is not aria-disabled'
                # the arrows walk file -> edit -> view -> file and skip it
                w = word('file')
                w.focus()
                expect(w).to_be_focused()
                for want in ('edit', 'view', 'file'):
                    page.keyboard.press('ArrowRight')
                    expect(word(want)).to_be_focused()
                    assert not panel_open('#mb-help'), 'a word opened the disabled panel'
                # ArrowDown with focus PUT on it (the only route a reader
                # could not have taken themselves)
                page.evaluate('document.querySelector(\'[popovertarget="mb-help"]\').focus()')
                page.keyboard.press('ArrowDown')
                assert not panel_open('#mb-help'), 'ArrowDown opened a disabled word'
                # Enter arrives as a click: popovertarget is a platform
                # attribute with no idea what aria-disabled means
                page.keyboard.press('Enter')
                assert not panel_open('#mb-help'), 'Enter opened a disabled word'
                # and the pointer must not strand focus on it either -
                # focus starts somewhere real, so "focus did not move" is a
                # claim about the click and not about the press before it
                word('file').focus()
                expect(word('file')).to_be_focused()
                h.click(force=True)
                assert not panel_open('#mb-help'), 'a click opened a disabled word'
                assert page.evaluate(
                    'document.activeElement.getAttribute("popovertarget")') != 'mb-help', \
                    'the click left focus on the disabled word, where the arrows can never return'

            check('the disabled word refuses arrows, Enter and the pointer', disabled_refused)

            # ---------------- 3. submenu ----------------
            def submenu():
                open_panel('file')
                # items: new, open, export (save is aria-disabled, so the
                # walk list has three)
                page.keyboard.press('ArrowDown')
                page.keyboard.press('ArrowDown')
                assert active_is('#mb-file [aria-controls="mb-export"]'), \
                    f'walked onto {active()!r}, want the export row'
                page.keyboard.press('ArrowRight')
                assert panel_open('#mb-export'), 'Right did not open the submenu'
                assert active_is('#mb-export .cm-dropdown__item'), \
                    f'focus did not move into the submenu (on {active()!r})'
                # the bar must NOT have walked to the next word underneath it
                assert not panel_open('#mb-edit'), 'the bar walked while a submenu had the key'
                page.keyboard.press('ArrowLeft')
                assert not panel_open('#mb-export'), 'Left did not close the submenu'
                assert panel_open('#mb-file'), 'Left took the parent panel with it'
                assert page.locator('#mb-file [aria-controls="mb-export"]').evaluate(
                    'el => el === document.activeElement'), \
                    'Left did not hand focus back to the row that owns the submenu'
                # one more Left steps out of the panel AND walks to the
                # neighbouring word - the rule the specimen documents, and
                # the reason the panel may not swallow a consumed key
                page.keyboard.press('ArrowLeft')
                assert not panel_open('#mb-file'), 'Left did not step out of the panel'
                page.wait_for_function(
                    "document.querySelector('#mb-view').matches(':popover-open')",
                    timeout=3000)
                assert panel_open('#mb-view'), \
                    'Left did not walk to the neighbouring menu while a menu was open'

            check('the submenu opens Right, returns Left, and the bar keeps its hands off', submenu)

            # ---------------- 4. checkbox ----------------
            def checkbox():
                open_panel('view')
                row = page.locator('#mb-view [role="menuitemcheckbox"]')
                assert row.count() == 1, f'expected one checkbox row, found {row.count()}'
                assert row.get_attribute('aria-checked') == 'true', 'the checkbox starts unchecked'
                # items: zoom in, zoom out, status bar, 100%, fit width
                page.keyboard.press('ArrowDown')
                page.keyboard.press('ArrowDown')
                expect(row).to_be_focused()
                page.keyboard.press(' ')
                expect(row).to_have_attribute('aria-checked', 'false')
                expect(row.locator('.cm-dropdown__icon')).to_have_attribute('data-checked', 'false')
                page.keyboard.press(' ')
                expect(row).to_have_attribute('aria-checked', 'true')
                expect(row.locator('.cm-dropdown__icon')).to_have_attribute('data-checked', 'true')

            check('the checkbox row flips in place, and its glyph follows', checkbox)

            # ---------------- 5. radio group ----------------
            def radio():
                open_panel('view')
                rows = page.locator('#mb-view [role="menuitemradio"]')
                assert rows.count() >= 2, f'expected a group of radio rows, found {rows.count()}'
                names = page.eval_on_selector_all(
                    '#mb-view [role="menuitemradio"]', 'els => els.map(e => e.dataset.cmRadio)')
                assert len(set(names)) == 1, f'rows do not share one group name: {names}'
                group = page.locator('#mb-view [role="group"]')
                assert group.count() == 1, 'the radio rows sit in no labelled group'
                assert group.get_attribute('aria-labelledby') == 'mb-grp-scale', \
                    f'group labelled by {group.get_attribute("aria-labelledby")!r}'
                # to the first radio row: zoom in, zoom out, status bar, 100%
                for _ in range(3):
                    page.keyboard.press('ArrowDown')
                expect(rows.nth(0)).to_be_focused()

                def state():
                    return page.eval_on_selector_all(
                        '#mb-view [role="menuitemradio"]',
                        'els => els.map(e => [e.textContent.trim(), e.getAttribute("aria-checked")])')

                assert sum(1 for _, c in state() if c == 'true') == 1, \
                    f'after walking, checked = {state()}'
                assert state()[0][1] == 'true', f'the first row is not the checked one: {state()}'
                # the mark is drawn on the icon slot of the checked row only
                marks = page.eval_on_selector_all(
                    '#mb-view [role="menuitemradio"]',
                    'els => els.map(e => getComputedStyle('
                    'e.querySelector(".cm-dropdown__icon"), "::before").content)')
                assert marks[0] in ('"\u25cf"', '"\u25cfs"'), f'checked row mark: {marks[0]}'
                assert marks[1] == 'none', f'unchecked row mark: {marks[1]}'
                page.keyboard.press('ArrowDown')
                after = [c for _, c in state()]
                assert after.count('true') == 1 and after[1] == 'true', \
                    f'ArrowDown did not move the selection: {after}'

            check('the radio group moves selection and draws the dot', radio)

            # ---------------- 6. composition ----------------
            def composition():
                for name in ('file', 'edit', 'view'):
                    open_panel(name)
                    icons = page.locator(f'{PANELS[name]} .cm-dropdown__icon')
                    assert icons.count() >= 1, f'{name} panel ships no icon slot'
                    assert icons.first.is_visible(), f'{name} panel icon slot is not visible'
                reset()
                labels = page.locator(f'{BAR} .cm-dropdown__group-label')
                assert labels.count() >= 2, f'{labels.count()} group labels in the bar, want >= 2'
                hints = page.locator(f'{BAR} .cm-dropdown__shortcut')
                assert hints.count() >= 3, f'{hints.count()} shortcut hints in the bar, want >= 3'
                for i in range(hints.count()):
                    assert hints.nth(i).get_attribute('aria-hidden') == 'true', \
                        f'hint {i} is in the accessible name'
                # the disabled word is a weight change, not a hue: it must
                # not paint the same ink as a live word, and hovering it
                # must not re-light it
                off = page.evaluate(
                    'getComputedStyle(document.querySelector(\'[popovertarget="mb-help"]\')).color')
                live = page.evaluate(
                    'getComputedStyle(document.querySelector(\'[popovertarget="mb-file"]\')).color')
                assert off != live, f'the disabled word renders the same colour as a live one ({off})'
                # "some other grey" is not the claim - the rule paints it in
                # the FAINT token. Without this the mutant that recoloured it
                # to plain ink still differed from the words above and lived.
                tok = page.evaluate('''() => {
                    const probe = document.createElement('span');
                    probe.style.color = 'var(--ink-faint)';
                    document.body.appendChild(probe);
                    const want = getComputedStyle(probe).color;
                    probe.remove();
                    const help = getComputedStyle(
                        document.querySelector('[popovertarget="mb-help"]')).color;
                    return { want, help };
                }''')
                assert tok['help'] == tok['want'], (
                    'the disabled word is not painted in --ink-faint: '
                    f"{tok['help']} vs the token {tok['want']}")
                word('help').hover()
                hover = page.evaluate(
                    'getComputedStyle(document.querySelector(\'[popovertarget="mb-help"]\')).color')
                assert hover == off, f'hovering re-lit the disabled word: {hover} vs {off}'

            check('the panels compose icons, group labels and hints, the disabled word a weight', composition)


            def layout():
                """Measure the panel instead of eyeballing it. The vision backends
                on this box are down (no local file reads; the browser tool hands back a
                full-page stitch too small to read), and a measurement is the stronger
                claim anyway: square corners, greyscale pixels only, hints sitting right
                of their labels, and a panel anchored to its word instead of floating on
                top of it."""
                def gray_of(css):
                    parts = [t for t in css.replace('(', ' ').replace(')', ' ')
                             .replace(',', ' ').replace('/', ' ').split()
                             if t.isdigit()]
                    return len(parts) >= 3 and parts[0] == parts[1] == parts[2]
                reset()
                open_panel('view')
                # anchorPopover rewrites left/top on the toggle task - the house rule is
                # not to read geometry until the state has settled
                page.wait_for_function(
                    """() => { const r = document.querySelector("#mb-view")
                    .getBoundingClientRect();
                    return r.width > 0 && r.top >= 0 && r.left >= 0; }""")
                d = page.evaluate(
                    """() => {
                    const gray = (v) => (v.match(/[\\d.]+/g) || []).slice(0, 3)
                        .every((n, i, a) => a[0] === n);
                    const box = (sel) => { const el = document.querySelector(sel);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        const cs = getComputedStyle(el);
                        return { w: r.width, h: r.height, l: r.left, t: r.top,
                            right: r.right, bottom: r.bottom, radius: cs.borderRadius,
                            fg: cs.color, bg: cs.backgroundColor }; };
                    const p = document.querySelector("#mb-view");
                    const rows = [...p.querySelectorAll(".cm-dropdown__item")];
                    const pos = rows.map((r) => { const l = r.querySelector(
                        ".cm-dropdown__label") || r.lastElementChild;
                        return l.offsetLeft; });
                    return {
                        vp: { w: innerWidth, h: innerHeight },
                        panel: box("#mb-view"),
                        trigger: box('[popovertarget="mb-view"]'),
                        rows: rows.map((r, i) => {
                            const ic = r.querySelector(".cm-dropdown__icon");
                            const sc = r.querySelector(".cm-dropdown__shortcut");
                            return {
                                text: (r.textContent || "").trim().slice(0, 16),
                                radius: getComputedStyle(r).borderRadius,
                                fg: getComputedStyle(r).color,
                                bg: getComputedStyle(r).backgroundColor,
                                gray: [getComputedStyle(r).color,
                                    getComputedStyle(r).backgroundColor].every(gray),
                                labelLeft: pos[i],
                                iconLeft: ic ? ic.offsetLeft : -1,
                                hintLeft: sc ? sc.offsetLeft : -1,
                                hintGray: sc ? gray(getComputedStyle(sc).color) : true
                            }; }),
                        groups: [...p.querySelectorAll(".cm-dropdown__group")].map((g) => {
                            const l = g.querySelector(".cm-dropdown__label");
                            return { label: l ? l.textContent : null,
                                gray: l ? gray(getComputedStyle(l).color) : true }; })
                    }; }""")
                # 1. square corners wherever an edge shows
                assert d['panel']['radius'] in ('0px', ''), \
                    f"panel corner is {d['panel']['radius']}, not sharp"
                for row in d['rows']:
                    assert row['radius'] in ('0px', ''), \
                        f"{row['text']!r} corner is {row['radius']}, not sharp"
                # 2. greyscale only - no hue in anything the panel paints
                assert gray_of(d['panel']['fg']), f"panel text not grey: {d['panel']['fg']}"
                assert gray_of(d['panel']['bg']), f"panel bg not grey: {d['panel']['bg']}"
                for row in d['rows']:
                    assert row['gray'], f"{row['text']!r} paints a hue: {row['fg']}/{row['bg']}"
                    assert row['hintGray'], f"{row['text']!r} shortcut paints a hue"
                for g in d['groups']:
                    assert g['gray'], f"group {g['label']!r} paints a hue"
                # 3. composition geometry: icon left of its label, hint right of it
                for row in d['rows']:
                    if row['iconLeft'] >= 0:
                        assert row['iconLeft'] < row['labelLeft'], \
                            f"{row['text']!r} icon slot is not left of its label"
                    if row['hintLeft'] >= 0:
                        assert row['hintLeft'] > row['labelLeft'], \
                            f"{row['text']!r} shortcut is not right of its label"
                # 4. the panel sits against its word, inside the viewport
                pn, tg = d['panel'], d['trigger']
                assert pn['l'] >= 0 and pn['right'] <= d['vp']['w'] + 1, \
                    f"panel escapes the {d['vp']['w']}px viewport: {pn['l']}..{pn['right']}"
                assert pn['bottom'] <= tg['t'] + 1 or pn['t'] >= tg['bottom'] - 1, \
                    'panel overlaps the word it hangs from'
                print(f"        panel {pn['w']:.0f}x{pn['h']:.0f} at y={pn['t']:.0f} "
                    f"(trigger y={tg['t']:.0f}, flipped up: {pn['bottom'] <= tg['t']})")


            check('the panel measures square, grey and anchored to its word', layout)

            page.screenshot(path=SHOT)
            browser.close()
    finally:
        if proc:
            proc.terminate()

    print(f'\n{passed} passed, {len(failures)} failed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
