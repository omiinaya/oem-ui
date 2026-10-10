#!/root/.venvs/mau/bin/python
"""Batch 21 - WebKit proof for select / tabs / accordion depth.

Drives the documented surface, not the CSS: the pick mirrors into the
trigger and retires the menu; the placer aligns the CHECKED row over
the trigger and keeps the panel inside the viewport under a scroll
(the pin re-anchors); the menu scrolls inside its own 60vh box; a
plain menu keeps its top anchor; tabs skip a disabled row through
every door and move on Up/Down only when the group says vertical; a
frozen summary refuses pointer, Enter and Space while the group
exclusives through the platform.

Engines: WebKit (Safari is the engine that matters here).
"""
from playwright.sync_api import sync_playwright
import sys

# House convention: overridable, so a run says which tree it measured.
# A hardcoded port is how this harness reported 40/40 against a server
# that is not serving this repo at all.
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4471/'
OUT = '/root/.hermes/cache/scratch'
P = []


def ok(name, cond, extra=''):
    P.append((name, bool(cond), extra))



def center(page, sel):
    """The page declares scroll-behavior: smooth and its smooth
    scrollIntoView never reaches block:center, so drive the scroll
    directly with an instant jump and leave the smooth flag off."""
    page.evaluate("""(s) => {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.querySelector(s);
      const want = el.getBoundingClientRect().top + window.scrollY
                 - (window.innerHeight / 2);
      window.scrollTo(0, want);
    }""", sel)
    page.wait_for_timeout(200)


with sync_playwright() as pw:
    b = pw.webkit.launch()

    # ---------- desktop 1280 ----------
    page = b.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(URL, wait_until='networkidle')

    trig = page.locator('[popovertarget="select-demo"]')
    trig.scroll_into_view_if_needed()
    page.wait_for_timeout(300)

    # placeholder until first pick
    ph = trig.locator('.cm-dropdown__placeholder')
    val = trig.locator('.cm-dropdown__value')
    ok('select starts on its placeholder',
       ph.is_visible() and not val.is_visible(),
       f'ph={ph.is_visible()} val={val.is_visible()}')

    # open
    trig.click()
    page.wait_for_timeout(250)
    menu = page.locator('#select-demo')
    ok('menu opens', menu.evaluate('el => el.matches(":popover-open")'))

    # scrollable: 14 rows vs 60vh cap
    sc = menu.evaluate(
        'el => ({sh: el.scrollHeight, ch: el.clientHeight, '
        'mh: parseFloat(getComputedStyle(el).maxHeight), '
        'os: getComputedStyle(el).overscrollBehavior})')
    ok('menu is capped and scrolls', sc['sh'] > sc['ch'], str(sc))
    ok('cap is 60vh-ish', 0.5 < sc['mh'] / 900 < 0.61, str(sc))
    # a finger that reaches the end of the list must scroll the LIST,
    # not chain to the page behind it.
    ok('the menu contains its own overscroll', sc['os'] == 'contain', str(sc))

    # first open: nothing checked -> the placer's own job: fit the
    # viewport by below / flip / bottom-pin (a long list near the
    # bottom of the page can fit none of the first two)
    geo0 = page.evaluate('''() => {
      const m = document.getElementById('select-demo').getBoundingClientRect();
      const t = document.querySelector('[popovertarget="select-demo"]').getBoundingClientRect();
      return {mtop: m.top, mbot: m.bottom, ttop: t.top, tbot: t.bottom, vh: innerHeight};
    }''')
    ok('first open stays inside the viewport',
       geo0['mtop'] >= 7 and geo0['mbot'] <= geo0['vh'] - 7, str(geo0))

    # pick row 4 (america/denver is index 2 -> pick 4th: america/sao_paulo is 5th)
    rows = menu.locator('[data-cm-radio="tz"]')
    n = rows.count()
    rows.nth(4).click()
    page.wait_for_timeout(250)
    picked = page.evaluate('''() => {
      const w = document.querySelector('[popovertarget="select-demo"]').closest('.cm-dropdown');
      const v = w.querySelector('.cm-dropdown__value');
      const ph = w.querySelector('.cm-dropdown__placeholder');
      return {text: v.textContent, vHidden: v.hidden, phHidden: ph.hidden,
              picked: w.getAttribute('data-cm-picked'),
              open: document.getElementById('select-demo').matches(':popover-open')};
    }''')
    ok('trigger mirrors the pick',
       picked['text'] == 'america/sao_paulo' and picked['picked'] == 'true',
       str(picked))
    ok('placeholder retired, value shown',
       picked['phHidden'] and not picked['vHidden'], str(picked))
    ok('menu closes on pick', not picked['open'], str(picked))
    checked = page.evaluate('''() => [...document.querySelectorAll('#select-demo [data-cm-radio="tz"]')]
        .filter(r => r.getAttribute('aria-checked') === 'true').length''')
    ok('exactly one checked row', checked == 1, f'checked={checked}')

    # reopen: align puts the CHECKED row over the trigger. The
    # trigger is centred first so alignment is REACHABLE - with it at
    # the viewport's bottom edge the clamp (which wins) correctly
    # refuses to pull the panel out of the viewport.
    trig.click()
    page.wait_for_timeout(250)
    # ...then centre the page: the PIN must re-anchor AND re-align,
    # which is a stronger claim than the open-time geometry alone.
    center(page, '[popovertarget="select-demo"]')
    align = page.evaluate('''() => {
      const m = document.getElementById('select-demo').getBoundingClientRect();
      const t = document.querySelector('[popovertarget="select-demo"]').getBoundingClientRect();
      const c = document.querySelector('#select-demo [data-cm-radio="tz"][aria-checked="true"]').getBoundingClientRect();
      return {mTop: m.top, mBot: m.bottom, tTop: t.top, cTop: c.top, vh: innerHeight};
    }''')
    ok('checked row sits on the trigger', abs(align['cTop'] - align['tTop']) <= 2, str(align))
    ok('panel still inside the viewport',
       align['mTop'] >= 7 and align['mBot'] <= align['vh'] + 1, str(align))

    # browse-while-open (the APG menu-radio pattern): arrows arrive,
    # the menu stays put, and the mirror follows the ARRIVAL live.
    # The close lives only in the click handler - never here - which
    # is exactly what makes this a different door from the pointer.
    page.locator('#select-demo [data-cm-radio="tz"]').first.focus()
    page.keyboard.press('ArrowDown')
    page.wait_for_timeout(200)
    browse = page.evaluate('''() => {
      const rows = [...document.querySelectorAll('#select-demo [data-cm-radio="tz"]')];
      const on = rows.map(r => r.getAttribute('aria-checked'));
      const w = document.querySelector('[popovertarget="select-demo"]').closest('.cm-dropdown');
      return {checked: on.filter(v => v === 'true').length, idx: on.indexOf('true'),
              value: w.querySelector('.cm-dropdown__value').textContent,
              open: document.getElementById('select-demo').matches(':popover-open')};
    }''')
    ok('arrows arrive with the menu still open', browse['open'], str(browse))
    ok('arrival takes the selection, one row at a time',
       browse['checked'] == 1 and browse['idx'] == 1, str(browse))
    ok('the mirror follows the arrival live',
       browse['value'] == 'america/chicago', str(browse))
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)

    # align's OWN clamp: chicago (checked by the browse) sits only ~75px
    # into the list, so alignment wants the panel pushed DOWN past the
    # viewport floor. Containment wins - the panel lands pinned inside,
    # not hanging out of the bottom.
    trig.click()
    page.wait_for_timeout(250)
    center(page, '[popovertarget="select-demo"]')
    page.wait_for_timeout(300)
    clamp = page.evaluate('''() => {
      const m = document.getElementById('select-demo').getBoundingClientRect();
      return {top: m.top, bot: m.bottom, vh: window.innerHeight};
    }''')
    ok('align clamps to the viewport instead of hanging out',
       clamp['top'] >= -1 and clamp['bot'] <= clamp['vh'] + 1, str(clamp))
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)

    # plain menu is NOT aligned: top must stay trigger.bottom + 4
    page.keyboard.press('Escape')   # the select is open; let it go first
    page.wait_for_timeout(200)
    trig2 = page.locator('[popovertarget="menu-demo"]')
    trig2.click()
    page.wait_for_timeout(250)
    center(page, '[popovertarget="menu-demo"]')
    plain = page.evaluate('''() => {
      const m = document.getElementById('menu-demo').getBoundingClientRect();
      const t = document.querySelector('[popovertarget="menu-demo"]').getBoundingClientRect();
      return {gap: m.top - t.bottom, hasAlign: !!document.querySelector('[popovertarget="menu-demo"]').closest('[data-cm-align-item]')};
    }''')
    ok('plain menu keeps its top anchor', abs(plain['gap'] - 4) <= 2, str(plain))
    ok('plain menu wrap carries no align opt-in', not plain['hasAlign'], str(plain))
    page.keyboard.press('Escape')

    # ---------- tabs: disabled skip ----------
    page.locator('#tab-tokens').scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    page.locator('#tab-components').focus()
    page.keyboard.press('ArrowRight')
    t1 = page.evaluate('''() => ({
        sel: document.querySelector('.cm-tabs:not([data-orientation]) [aria-selected="true"]').id,
        focus: document.activeElement.id})''')
    ok('ArrowRight steps OVER the disabled tab (wraps to first)',
       t1['sel'] == 'tab-tokens' and t1['focus'] == 'tab-tokens', str(t1))

    page.keyboard.press('End')
    t2 = page.evaluate('''() => ({
        sel: document.querySelector('.cm-tabs:not([data-orientation]) [aria-selected="true"]').id,
        focus: document.activeElement.id})''')
    ok('End lands on the last ENABLED tab',
       t2['sel'] == 'tab-components' and t2['focus'] == 'tab-components', str(t2))

    # click a disabled tab: nothing happens
    page.locator('#tab-status').click(force=True)
    page.wait_for_timeout(150)
    t3 = page.evaluate('''() => ({
        sel: document.querySelector('.cm-tabs:not([data-orientation]) [aria-selected="true"]').id,
        focus: document.activeElement.id})''')
    ok('clicking the disabled tab changes nothing', t3['sel'] == 'tab-components', str(t3))

    # disabled styling: dim, not-allowed, hover does not light it
    page.locator('#tab-status').hover()
    page.wait_for_timeout(250)
    dim = page.evaluate('''() => {
      const s = getComputedStyle(document.getElementById('tab-status'));
      return {color: s.color, cursor: s.cursor, bg: s.backgroundColor,
              ti: document.getElementById('tab-status').getAttribute('tabindex')};
    }''')
    # compare against the placeholder, which is ink-faint BY CSS
    ref = page.evaluate("getComputedStyle(document.querySelector('.cm-dropdown__placeholder')).color")
    enabled = page.evaluate("getComputedStyle(document.getElementById('tab-tokens')).color")
    ok('disabled tab is faint', dim['color'] == ref and dim['color'] != enabled,
       f"disabled={dim['color']} ref={ref} enabled={enabled}")
    ok('disabled tab cursor is not-allowed', dim['cursor'] == 'not-allowed', str(dim))
    ok('hover does not light the disabled tab', dim['bg'] in ('rgba(0, 0, 0, 0)', 'transparent'), str(dim))
    ok('disabled tab is out of the tab order', dim['ti'] == '-1', str(dim))

    # ---------- tabs: vertical axis ----------
    vt = page.locator('.cm-tabs[data-orientation="vertical"]')
    vt.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    geo_v = vt.evaluate('''el => {
      const tabs = [...el.querySelectorAll('[role="tab"]')].map(t => t.getBoundingClientRect().top);
      const probe = document.createElement('span');
      probe.style.color = 'var(--ink)';
      document.documentElement.appendChild(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      return {stacked: tabs[1] > tabs[0] + 5,
              col: getComputedStyle(el.querySelector('.cm-tabs__list')).flexDirection,
              mk: getComputedStyle(el.querySelector('.cm-tabs__tab')).borderLeftWidth,
              mkOn: getComputedStyle(el.querySelector('.cm-tabs__tab[aria-selected="true"]')).borderLeftColor,
              ink: ink};
    }''')
    ok('vertical list is a column', geo_v['stacked'] and geo_v['col'] == 'column', str(geo_v))
    # every row pays the same 2px left edge (transparent unless selected),
    # so the marker is a border that shifts nothing, drawn from a token.
    ok('the vertical marker is a 2px left border on every row',
       geo_v['mk'] == '2px', str(geo_v))
    ok('the selected row lights its marker from the ink token',
       geo_v['mkOn'] == geo_v['ink'], str(geo_v))

    page.locator('#vtab-tokens').focus()
    page.keyboard.press('ArrowDown')
    v1 = page.evaluate('''() => ({
        sel: document.querySelector('.cm-tabs[data-orientation="vertical"] [aria-selected="true"]').id,
        focus: document.activeElement.id})''')
    ok('ArrowDown moves in vertical mode', v1['sel'] == 'vtab-base', str(v1))
    page.keyboard.press('ArrowUp')
    page.keyboard.press('ArrowLeft')
    v2 = page.evaluate('''() => ({
        sel: document.querySelector('.cm-tabs[data-orientation="vertical"] [aria-selected="true"]').id,
        focus: document.activeElement.id})''')
    ok('vertical keeps Left/Right', v2['sel'] == 'vtab-comp', str(v2))

    # horizontal ignores Up/Down: selection must be UNCHANGED
    before = page.evaluate('''() => document.querySelector('.cm-tabs:not([data-orientation]) [aria-selected="true"]').id''')
    page.locator('#tab-components').focus()
    page.keyboard.press('ArrowDown')
    page.keyboard.press('ArrowUp')
    h1 = page.evaluate('''() => document.querySelector('.cm-tabs:not([data-orientation]) [aria-selected="true"]').id''')
    ok('horizontal Up/Down is left alone', h1 == before, f'before={before} after={h1}')

    # ---------- accordion veto ----------
    frozen = page.locator('.cm-disclosure__summary[aria-disabled="true"]')
    frozen.scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    st0 = frozen.evaluate('el => el.parentElement.open')
    frozen.click()
    page.wait_for_timeout(200)
    st1 = frozen.evaluate('el => el.parentElement.open')
    ok('click on a frozen summary does nothing', st0 is False and st1 is False, f'{st0}->{st1}')

    frozen.focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    st2 = frozen.evaluate('el => el.parentElement.open')
    ok('Enter on a frozen summary does nothing', st2 is False, str(st2))
    page.keyboard.press('Space')
    page.wait_for_timeout(200)
    st3 = frozen.evaluate('el => el.parentElement.open')
    ok('Space on a frozen summary does nothing', st3 is False, str(st3))

    # an enabled sibling still opens (and closes the other via name=)
    sib = page.locator('.cm-disclosure[name="faq"]').nth(1).locator('summary')
    sib.click()
    page.wait_for_timeout(200)
    group = page.evaluate('''() => [...document.querySelectorAll('.cm-disclosure[name="faq"]')]
        .map(d => d.open)''')
    ok('the group still exclusives through the platform',
       sum(group) == 1 and group[1] is True, str(group))

    frozen.hover()
    page.wait_for_timeout(250)
    dis = frozen.evaluate('''el => { const s = getComputedStyle(el);
        const r = getComputedStyle(document.querySelector('#tab-status'));
        return {color: s.color, bg: s.backgroundColor, cursor: s.cursor,
                ref: r.color}; }''')
    ok('frozen summary is dim',
       dis['cursor'] == 'not-allowed' and dis['color'] == dis['ref'], str(dis))
    ok('frozen summary does not light on hover',
       dis['bg'] in ('rgba(0, 0, 0, 0)', 'transparent'), str(dis))
    page.close()

    # ---------- phone 402: the select must scroll INSIDE itself ----------
    page = b.new_page(viewport={'width': 402, 'height': 667})
    page.goto(URL, wait_until='networkidle')
    trig = page.locator('[popovertarget="select-demo"]')
    trig.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    trig.click()
    page.wait_for_timeout(250)
    m = page.evaluate('''() => {
      const el = document.getElementById('select-demo');
      const r = el.getBoundingClientRect();
      el.scrollTop = 120;
      return {sh: el.scrollHeight, ch: el.clientHeight, top: r.top, bot: r.bottom,
              vh: innerHeight, st: el.scrollTop,
              bodyScroll: document.documentElement.scrollTop};
    }''')
    ok('phone: menu taller than its box (scrolls)', m['sh'] > m['ch'], str(m))
    ok('phone: menu fits the viewport', m['top'] >= -1 and m['bot'] <= m['vh'] + 1, str(m))
    ok('phone: the menu itself accepts a scroll', m['st'] == 120, str(m))
    page.close()
    b.close()

fails = [x for x in P if not x[1]]
for name, good, extra in P:
    print(('ok   ' if good else 'FAIL ') + name + (' :: ' + extra if not good else ''))
print(f'\npassed {len(P) - len(fails)}/{len(P)}')
# The exit code is the ORACLE the mutator reads: a harness that always
# exits 0 makes every harness-owned mutation survive. Sidebar has
# raised SystemExit(1) since batch 20; this one must too.
if fails:
    raise SystemExit(1)
