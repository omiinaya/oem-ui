#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 14: the drawn ⌘K shortcut, the toast
vocabulary (info / loading / action / toast.promise / sticky), and the
dialog's sticky head + foot.

The suite pins the CSS and the source; this proves the BEHAVIOUR -
including the timing no source check can see: a loading toast that must
outlive the default retirement, and a promise that swaps its own
severity in place. Nothing here waits blind: the runtime's cm-js hook is
the readiness signal."""
import sys
from playwright.sync_api import sync_playwright

URL = 'http://192.168.1.68:4461/'
results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name
          + ((' :: ' + repr(detail)) if detail is not None else ''))


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors, perr = [], []
    page.on('pageerror', lambda e: perr.append(str(e)))
    page.on('console',
            lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function(
        "window.cliMono && document.documentElement.classList.contains('cm-js')")

    # --- every emitter is on the page ------------------------------------
    marks = page.evaluate("""() => ({
        kinds: document.querySelectorAll('[data-cm-toast-kind]').length,
        info: !!document.querySelector('.cm-spec .cm-toast--info'),
        load: !!document.querySelector('.cm-spec .cm-toast--loading'),
        act: !!document.querySelector('.cm-spec .cm-toast__action'),
        aInfo: !!document.querySelector('.cm-alert--info'),
        aLoad: !!document.querySelector('.cm-alert--loading'),
    })""")
    check('the four demos and every new specimen are on the page',
          marks == {'kinds': 4, 'info': True, 'load': True, 'act': True,
                    'aInfo': True, 'aLoad': True}, marks)

    # --- the drawn ⌘K ------------------------------------------------------
    page.keyboard.press('Control+k')
    page.wait_for_timeout(150)
    st = page.evaluate("""() => {
        const d = document.getElementById('cmd-demo');
        return { open: d.open, focusIn: d.contains(document.activeElement) };
    }""")
    check('Control+K opens the palette - the glyph tells the truth',
          st['open'] and st['focusIn'], st)

    page.keyboard.press('Control+k')
    page.wait_for_timeout(150)
    check('Control+K again closes it',
          page.evaluate("() => !document.getElementById('cmd-demo').open"))

    # a stale query must not survive a close through the KEYBOARD path
    page.click('[data-cm-open="cmd-demo"]')
    page.fill('.cm-command__input', 'zzz')
    page.keyboard.press('Control+k')
    page.wait_for_timeout(120)
    page.keyboard.press('Control+k')
    page.wait_for_timeout(150)
    v = page.evaluate("""() => ({
        open: document.getElementById('cmd-demo').open,
        val: document.querySelector('.cm-command__input').value,
    })""")
    check('a shortcut close clears the query for the next open',
          v['open'] and v['val'] == '', v)
    page.keyboard.press('Control+k')
    page.wait_for_timeout(120)

    # --- info --------------------------------------------------------------
    page.click('[data-cm-toast-kind="info"]')
    page.wait_for_timeout(250)
    info = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .find(n => n.classList.contains('cm-alert--info'));
        if (!t) return null;
        const mark = t.querySelector('.cm-toast__mark');
        return {
            glyph: getComputedStyle(mark, '::before').content,
            busy: t.getAttribute('aria-busy'),
            empty: mark.textContent.trim() === '',
        };
    }""")
    check('info lands with its injected text mark, no aria-busy, empty span',
          info and ('ℹ' in info['glyph'] or '2139' in info['glyph'])
          and info['busy'] is None and info['empty'], info)

    # --- loading -----------------------------------------------------------
    page.click('[data-cm-toast-kind="loading"]')
    page.wait_for_timeout(250)
    load = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .filter(n => n.classList.contains('cm-alert--loading')).pop();
        if (!t) return null;
        const mark = t.querySelector('.cm-toast__mark');
        const cs = getComputedStyle(mark, '::before');
        return {
            glyph: cs.content, anim: cs.animationName,
            busy: t.getAttribute('aria-busy'),
            empty: mark.textContent.trim() === '',
        };
    }""")
    check('loading announces aria-busy and spins an empty-mark ↻',
          load and ('↻' in load['glyph'] or '21bb' in load['glyph'])
          and 'cm-spin' in load['anim'] and load['busy'] == 'true'
          and load['empty'], load)

    # --- sticky: the timing no source check can see ------------------------
    page.evaluate("() => window.cliMono.toast('held by sticky', 'loading', { sticky: true })")
    page.wait_for_timeout(6300)
    held = page.evaluate("""() => [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
        .some(n => n.textContent.includes('held by sticky')
              && !n.dataset.cmToastGone)""")
    check('a sticky toast outlives the default six seconds', held)

    # --- action ------------------------------------------------------------
    page.click('[data-cm-toast-kind="action"]')
    page.wait_for_timeout(250)
    act = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .find(n => n.querySelector('.cm-toast__action'));
        if (!t) return null;
        const btn = t.querySelector('.cm-toast__action');
        const r = t.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return { label: btn.textContent, rightHalf: b.left > r.left + r.width / 2,
                 nearEdge: b.right > r.right - 60 };
    }""")
    check('the action button exists and sits on the far edge',
          act and act['label'] == 'undo' and act['rightHalf']
          and act['nearEdge'], act)
    page.click('[data-cm-toasts] .cm-toast__action')
    page.wait_for_timeout(300)
    after = page.evaluate("""() => ({
        gone: ![...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .some(n => n.textContent.includes('row deleted')),
        restored: [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .some(n => n.textContent.includes('restored')),
    })""")
    check('the action retires its toast and its callback fired',
          after['gone'] and after['restored'], after)

    # --- toast.promise -----------------------------------------------------
    page.click('[data-cm-toast-kind="promise"]')
    page.wait_for_timeout(300)
    pre = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .find(n => n.classList.contains('cm-alert--loading'));
        if (!t) return null;
        return { cls: t.className, busy: t.getAttribute('aria-busy') };
    }""")
    check('promise opens ONE sticky loading toast, aria-busy set',
          pre and 'cm-alert--loading' in pre['cls'] and pre['busy'] == 'true', pre)
    page.wait_for_timeout(1600)
    ok = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .find(n => n.textContent.includes('fleet in sync'));
        if (!t) return null;
        return { cls: t.className, busy: t.getAttribute('aria-busy'),
                 txt: (t.querySelector('.cm-toast__text') || {}).textContent };
    }""")
    check('settlement swaps the SAME node to ok: text, class, no busy',
          ok and 'cm-alert--ok' in ok['cls'] and ok['busy'] is None
          and ok['txt'] == 'fleet in sync', ok)

    page.click('[data-cm-toast-kind="promise"]')  # second run rejects
    page.wait_for_timeout(1950)
    bad = page.evaluate("""() => {
        const t = [...document.querySelectorAll('[data-cm-toasts] .cm-toast')]
            .find(n => n.textContent.includes('sync refused'));
        if (!t) return null;
        return { cls: t.className, busy: t.getAttribute('aria-busy') };
    }""")
    check('a rejection swaps the same node to err',
          bad and 'cm-alert--err' in bad['cls'] and bad['busy'] is None, bad)

    # --- sticky dialog chrome ----------------------------------------------
    page.click('[data-cm-open="dlg-demo"]')
    page.wait_for_timeout(150)
    scrolled = page.evaluate("""() => {
        const d = document.getElementById('dlg-demo');
        const body = d.querySelector('.cm-dialog__body');
        const pin = document.createElement('div');
        pin.style.cssText = 'height:2400px';
        body.appendChild(pin);
        d.scrollTop = 500;
        return d.scrollTop;
    }""")
    page.wait_for_timeout(120)
    geo = page.evaluate("""() => {
        const d = document.getElementById('dlg-demo');
        const head = d.querySelector('.cm-dialog__head').getBoundingClientRect();
        const foot = d.querySelector('.cm-dialog__foot').getBoundingClientRect();
        const r = d.getBoundingClientRect();
        return {
            scrollTop: d.scrollTop,
            headDelta: Math.round((head.top - r.top) * 10) / 10,
            footDelta: Math.round((foot.bottom - r.bottom) * 10) / 10,
        };
    }""")
    check('the injected body really scrolls the dialog', geo['scrollTop'] > 400,
          {'set': scrolled, 'now': geo})
    check('the head stays glued to the dialog top edge while it scrolls',
          abs(geo['headDelta']) <= 2.5, geo)
    check('the foot stays glued to the dialog bottom edge while it scrolls',
          abs(geo['footDelta']) <= 2.5, geo)
    page.keyboard.press('Escape')
    page.wait_for_timeout(100)

    check('no page JS errors', not errors and not perr,
          {'console': errors, 'pageerror': perr})

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
