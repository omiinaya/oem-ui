#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 8: the popover card and the combobox."""
import sys
from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4461/'
results, failures = [], []


def check(name, ok, detail=''):
    line = f'{"ok  " if ok else "FAIL"}  {name}'
    if detail:
        line += f' :: {detail}'
    results.append(line)
    print(line, flush=True)  # emit as it lands: a crash mid-run must show its work
    if not ok:
        failures.append(line)
    return ok


def snap(page):
    """Everything the next three checks need, read in one frame."""
    return page.evaluate("""() => {
      const pop = document.getElementById('pop-demo');
      const trig = document.querySelector('[popovertarget="pop-demo"]');
      const pr = pop.getBoundingClientRect();
      const tr = trig.getBoundingClientRect();
      const cs = getComputedStyle(pop);
      return {
        open: pop.matches(':popover-open'),
        visible: cs.visibility !== 'hidden' && cs.display !== 'none',
        radius: cs.borderRadius,
        // relative to the trigger: the anchor claim, not the absolute px.
        // Two sanctioned placements: hanging below, or FLIPPED above when
        // it would not fit below - both leave the card adjacent (4px) to
        // its trigger, which is the actual contract.
        dy: pr.top - tr.bottom,
        above: tr.top - pr.bottom,
        left: pr.left, trigLeft: tr.left,
        inside: pr.left >= 0 && pr.right <= innerWidth && pr.top >= 0,
        focused: document.activeElement === trig,
        zIndex: cs.zIndex,
      };
    }""")


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 402, 'height': 667})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.emulate_media(reduced_motion='reduce')
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function(
        "() => window.cliMono && document.querySelector('#pop-demo') && document.querySelector('.cm-combobox')")

    # ---------------- popover ----------------
    trigger = page.query_selector('[popovertarget="pop-demo"]')
    trigger.click()
    page.wait_for_function("() => document.getElementById('pop-demo').matches(':popover-open')")
    st = snap(page)
    check('the popover opens as a top-layer [popover]', st['open'], st)
    check('the opened card is on screen', st['visible'] and st['inside'], st)
    # Expected x: align to the trigger's left edge, then clamp inside the
    # viewport (pad 8). At 402px the card is wider than the room to its
    # right, so the clamp - not the alignment - decides the number.
    exp = page.evaluate("""() => {
      const pop = document.getElementById('pop-demo');
      const trig = document.querySelector('[popovertarget="pop-demo"]');
      const pad = 8;
      const left = trig.getBoundingClientRect().left;
      const w = pop.offsetWidth;
      let x = left;
      if (x < pad) x = pad;
      else if (x + w > innerWidth - pad) x = innerWidth - w - pad;
      return Math.round(x);
    }""")
    check('the card hangs below the trigger, aligned to its LEFT edge (then clamped to fit)',
          abs(st['dy'] - 4) <= 6 and abs(st['left'] - exp) <= 2,
          {'left': st['left'], 'expect': exp, 'dy': st['dy']})
    check('the card is sharp', st['radius'] == '0px', st['radius'])
    check('the card sits on the named popover layer', st['zIndex'] not in ('auto', ''), st['zIndex'])

    # Escape is the platform's half; focus return is too.
    page.keyboard.press('Escape')
    page.wait_for_function("() => !document.getElementById('pop-demo').matches(':popover-open')")
    st = snap(page)
    check('Escape closes it and focus returns to the trigger', st['focused'], st)

    # Light dismiss: a click anywhere outside.
    trigger.click()
    page.wait_for_function("() => document.getElementById('pop-demo').matches(':popover-open')")
    # Derive a point that is provably outside the card: above it, or below
    # it if it starts near the top. A hard-coded point landed ON the card
    # (403..631 at 402px) and "light dismiss" silently tested nothing.
    px, py = page.evaluate("""() => {
      const r = document.getElementById('pop-demo').getBoundingClientRect();
      const pad = 10;
      let y = r.top - 40;
      if (y < pad) y = r.bottom + 40;
      if (y > innerHeight - pad) y = r.top - 40;
      return [Math.round(innerWidth / 2), Math.round(y)];
    }""")
    page.mouse.click(px, py)
    page.wait_for_function("() => !document.getElementById('pop-demo').matches(':popover-open')", timeout=3000)
    check('a click outside dismisses it (light dismiss)', True, {'x': px, 'y': py})

    # Re-pinning: while open, scrolling the page must carry the card with
    # its trigger, because the anchoring is fixed-positioned by design.
    trigger.click()
    page.wait_for_function("() => document.getElementById('pop-demo').matches(':popover-open')")
    page.evaluate("() => window.scrollTo(0, 240)")
    # The page scrolls SMOOTHLY (html{scroll-behavior:smooth}), so reading
    # after a fixed 120ms measured the viewport half way down a 26,000px
    # jump - the card was correct for that frame and wrong for the test.
    # Wait for the scroll to finish, then for the re-anchor's next frame.
    page.wait_for_function("() => Math.abs(scrollY - 240) < 2", timeout=8000)
    page.wait_for_timeout(150)
    st = snap(page)
    adjacent = abs(st['dy'] - 4) <= 6 or abs(st['above'] - 4) <= 6
    check('the card stays adjacent to its trigger while the page scrolls', adjacent,
          {'dy': st['dy'], 'above': st['above'], 'sy': page.evaluate('() => scrollY')})
    page.keyboard.press('Escape')

    # ---------------- combobox ----------------
    box = page.query_selector('.cm-combobox__input')
    rest = page.evaluate("""() => {
      const list = document.getElementById('f-fw-list');
      return { hidden: list.hidden, display: getComputedStyle(list).display,
               expanded: document.querySelector('.cm-combobox__input').getAttribute('aria-expanded') };
    }""")
    check('at rest the list is closed and has no box at all',
          rest['hidden'] and rest['display'] == 'none' and rest['expanded'] == 'false', rest)

    box.click()
    page.wait_for_function("() => document.getElementById('f-fw-list').hidden === false")
    open_st = page.evaluate("""() => {
      const list = document.getElementById('f-fw-list');
      const opts = [...list.querySelectorAll('[role=option]')];
      return { expanded: document.querySelector('.cm-combobox__input').getAttribute('aria-expanded'),
               visible: opts.filter(o => !o.hidden).length,
               firstActive: opts[0].classList.contains('is-active'),
               display: getComputedStyle(list).display };
    }""")
    check('focusing opens the list with every option and the first active',
          open_st['expanded'] == 'true' and open_st['visible'] == 6
          and open_st['firstActive'] and open_st['display'] != 'none', open_st)

    page.keyboard.type('bu')
    filtered = page.evaluate("""() => {
      const opts = [...document.getElementById('f-fw-list').querySelectorAll('[role=option]')];
      return opts.filter(o => !o.hidden).map(o => o.dataset.value);
    }""")
    check('typing filters the list to the match', filtered == ['bun'], filtered)

    page.keyboard.type('zzz')
    dead = page.evaluate("""() => ({
      listHidden: document.getElementById('f-fw-list').hidden,
      expanded: document.querySelector('.cm-combobox__input').getAttribute('aria-expanded'),
      display: getComputedStyle(document.getElementById('f-fw-list')).display })""")
    check('a dead query closes the list instead of leaving an empty panel',
          dead['listHidden'] and dead['expanded'] == 'false' and dead['display'] == 'none', dead)

    # clear the query by retyping nothing: refill from an empty query
    page.fill('.cm-combobox__input', '')
    box.click()
    page.wait_for_function("() => document.getElementById('f-fw-list').hidden === false")
    page.keyboard.press('ArrowDown')
    after_arrow = page.evaluate("""() => {
      const inp = document.querySelector('.cm-combobox__input');
      const act = document.getElementById('f-fw-list').querySelector('.cm-combobox__option.is-active');
      return { id: inp.getAttribute('aria-activedescendant'), active: act && act.id };
    }""")
    check('ArrowDown moves the active option and mirrors it to aria-activedescendant',
          after_arrow['active'] == 'f-fw-1' and after_arrow['id'] == 'f-fw-1', after_arrow)

    # a change event is the consumer's hook; pin it before Enter swallows the state
    page.evaluate("() => { window.__cb = null; document.getElementById('f-fw-wrap')\n        .addEventListener('cm:change', e => { window.__cb = e.detail.value; }); }")
    page.keyboard.press('Enter')
    page.wait_for_function("() => document.getElementById('f-fw-list').hidden === true")
    chosen = page.evaluate("""() => ({
      value: document.querySelector('.cm-combobox__input').value,
      data: document.getElementById('f-fw-wrap').dataset.value,
      event: window.__cb,
      expanded: document.querySelector('.cm-combobox__input').getAttribute('aria-expanded') })""")
    check('Enter commits the active option into the field and fires cm:change',
          chosen['value'] == 'deno 2' and chosen['data'] == 'deno'
          and chosen['event'] == 'deno' and chosen['expanded'] == 'false', chosen)

    # clicking an option is the pointer half of the same contract
    page.fill('.cm-combobox__input', '')
    box.click()
    page.wait_for_function("() => document.getElementById('f-fw-list').hidden === false")
    page.query_selector('#f-fw-4').click()
    picked = page.evaluate("""() => ({
      value: document.querySelector('.cm-combobox__input').value,
      open: !document.getElementById('f-fw-list').hidden })""")
    check('clicking an option commits it and closes the list',
          picked['value'] == 'rust 1.82' and not picked['open'], picked)

    # outside click closes
    box.click()
    page.wait_for_function("() => document.getElementById('f-fw-list').hidden === false")
    px, py = page.evaluate("""() => {
      const w = document.getElementById('f-fw-wrap').getBoundingClientRect();
      const l = document.getElementById('f-fw-list').getBoundingClientRect();
      const pad = 10;
      // clear of BOTH the wrapper and the open list
      let y = l.bottom + 40;
      if (y > innerHeight - pad) y = l.top - 40;
      if (y < pad) y = w.top - 40;
      return [Math.round(innerWidth / 2), Math.round(Math.min(Math.max(y, pad), innerHeight - pad))];
    }""")
    page.mouse.click(px, py)
    closed = page.evaluate("() => document.getElementById('f-fw-list').hidden")
    check('clicking outside closes the list', closed is True, {'closed': closed, 'x': px, 'y': py})

    scroll = page.evaluate("() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth })")
    check('no sideways scroll at 402px', scroll['doc'] <= scroll['vw'] + 1, scroll)
    check('no page JS errors', not errors, errors[:3])
    page.close()
    browser.close()

print(f'\n{len(results) - len(failures)} passed, {len(failures)} failed')
for f in failures:
    print('  ' + f)
sys.exit(1 if failures else 0)
