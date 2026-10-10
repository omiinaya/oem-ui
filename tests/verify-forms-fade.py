#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 15: the utils pair (scroll-fade, shimmer)
and the native-first validating forms.

What the suite cannot see: that --sf-p ACTUALLY tracks the element's
own scroll (the timeline is live, not decorative), that reduced-motion
emulation really stops the sweep, and the whole validation flow -
submit-empty, fill-valid, blur-mode, reset - with focus and the live
count. The static fallback branch is what an old engine would see;
this WebKit supports scroll timelines, so the timeline branch is the
one behaviourally verified here.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name
          + ((' :: ' + repr(detail)) if detail is not None else ''))


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 402, 'height': 874})
    page_errors, console_errors = [], []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.on('console', lambda m: console_errors.append(m.text)
            if m.type == 'error' else None)
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function(
        "window.cliMono && document.documentElement.classList.contains('cm-js')")

    # ---- specimens: every modifier class is rendered ---------------------
    presence = page.evaluate("""() => {
        const classes = ['cm-scroll-fade', 'cm-scroll-fade-y', 'cm-scroll-fade-x',
            'cm-scroll-fade--t', 'cm-scroll-fade--b', 'cm-scroll-fade--l',
            'cm-scroll-fade--r', 'cm-scroll-fade--s', 'cm-scroll-fade--e',
            'cm-scroll-fade--4', 'cm-scroll-fade--8', 'cm-scroll-fade--16',
            'cm-scroll-fade--32', 'cm-scroll-fade--none',
            'cm-shimmer', 'cm-shimmer--once', 'cm-shimmer--reverse',
            'cm-shimmer--none'];
        const out = {};
        for (const c of classes) out[c] = !!document.querySelector('.' + c);
        out.tables = [...document.querySelectorAll('.cm-table-wrap')]
            .every(t => t.classList.contains('cm-scroll-fade-x'));
        out.validators = document.querySelectorAll('form[data-cm-validate]').length;
        out.novalidate = [...document.querySelectorAll('form[data-cm-validate]')]
            .every(f => f.noValidate === true);
        out.blurMode = !!document.querySelector('form[data-cm-validate-mode="blur"]');
        return out;
    }""")
    missing = [k for k, v in presence.items()
               if (k in ('tables', 'novalidate', 'blurMode') and not v)
               or (k == 'validators' and v < 2)
               or (k not in ('tables', 'validators', 'novalidate', 'blurMode') and not v)]
    check('every utility class and both validator forms are on the page',
          not missing, missing)

    # ---- scroll-fade: the timeline is live -------------------------------
    fade = page.evaluate("""() => {
        const el = document.querySelector('.cm-scroll-fade');
        const cs = getComputedStyle(el);
        return { mask: cs.maskImage || cs.webkitMaskImage,
                 timeline: cs.animationTimeline || '',
                 anim: cs.animationName,
                 p: parseFloat(cs.getPropertyValue('--sf-p')),
                 canScroll: el.scrollHeight > el.clientHeight };
    }""")
    check('scroll-fade wears a real mask driven by a scroll timeline',
          fade['mask'] and 'none' not in fade['mask'][:6]
          and fade['timeline'].startswith('scroll(self')
          and fade['anim'] == 'cm-sf', fade)
    check('at rest the edge stops are closed (--sf-p is 0)',
          fade['p'] < 0.1 and fade['canScroll'], fade)

    scrolled = page.evaluate("""() => {
        const el = document.querySelector('.cm-scroll-fade');
        el.scrollTop = el.scrollHeight;
        return el.scrollTop;
    }""")
    page.wait_for_timeout(150)
    after = page.evaluate("""() => parseFloat(
        getComputedStyle(document.querySelector('.cm-scroll-fade'))
            .getPropertyValue('--sf-p'))""")
    check('scrolling the box to its end drives --sf-p to 1 (the timeline moves)',
          scrolled > 0 and after > 0.9, {'scrollTop': scrolled, 'p': after})

    # rest and end look identical whether or not --sf-p is REGISTERED:
    # without @property the keyframe has no interpolation and only snaps
    # 0 <-> 1. Only a MIDDLE sample can tell the two apart.
    max_scroll = page.evaluate(
        "() => { const el = document.querySelector('.cm-scroll-fade');"
        " el.scrollTop = 0; return el.scrollHeight - el.clientHeight; }")
    page.evaluate(
        "m => { document.querySelector('.cm-scroll-fade').scrollTop = m / 2; }",
        max_scroll)
    page.wait_for_timeout(120)
    mid = page.evaluate("""() => parseFloat(getComputedStyle(
        document.querySelector('.cm-scroll-fade')).getPropertyValue('--sf-p'))""")
    check('scroll-fade interpolates between the ends (no discrete snap)',
          bool(mid) and 0.05 < mid < 0.95, {'mid-p': mid})

    # ---- table wrappers carry the horizontal fade ------------------------
    tbl = page.evaluate("""() => {
        const t = document.querySelector('.cm-table-wrap');
        const cs = getComputedStyle(t);
        return { cls: t.className, mask: cs.maskImage || cs.webkitMaskImage };
    }""")
    check('the table scrollport fades its own end edge',
          'cm-scroll-fade-x' in tbl['cls'] and tbl['mask']
          and 'none' not in tbl['mask'][:6], tbl)

    # ---- shimmer ----------------------------------------------------------
    sh = page.evaluate("""() => {
        const el = document.querySelector('code.cm-shimmer');
        const cs = getComputedStyle(el);
        return { clip: cs.webkitBackgroundClip || cs.backgroundClip,
                 color: cs.color, anim: cs.animationName };
    }""")
    check('shimmer clips its gradient to the glyphs and keeps the sweep running',
          sh['clip'] == 'text' and sh['color'] == 'rgba(0, 0, 0, 0)'
          and sh['anim'] == 'cm-shimmer', sh)
    mods = page.evaluate("""() => {
        const once = getComputedStyle(document.querySelector('.cm-shimmer--once'));
        const none = getComputedStyle(document.querySelector('.cm-shimmer--none'));
        return { once: once.animationIterationCount, noneAnim: none.animationName,
                 noneColor: none.color };
    }""")
    check('--once runs a single pass; --none stops and paints plain text',
          mods['once'] == '1' and mods['noneAnim'] == 'none'
          and mods['noneColor'] != 'rgba(0, 0, 0, 0)', mods)

    # ---- validation: submit-empty ----------------------------------------
    page.evaluate("() => document.getElementById('v-handle').scrollIntoView({block:'center'})")
    page.click('form[data-cm-validate]:not([data-cm-validate-mode]) button[type="submit"]')
    page.wait_for_timeout(150)
    st = page.evaluate("""() => {
        const form = document.querySelector('form[data-cm-validate]:not([data-cm-validate-mode])');
        const handle = document.getElementById('v-handle');
        const field = handle.closest('.cm-field');
        const err = field.querySelector('.cm-field__error');
        const live = form.querySelector('[aria-live="polite"]');
        return { focus: document.activeElement.id,
                 inv: handle.getAttribute('aria-invalid'),
                 dataInv: field.hasAttribute('data-invalid'),
                 errHidden: err.hidden, errText: err.textContent,
                 native: handle.validationMessage,
                 live: live ? live.textContent : null };
    }""")
    check('empty submit: first offender focused, aria-invalid + data-invalid set',
          st['focus'] == 'v-handle' and st['inv'] == 'true' and st['dataInv'], st)
    check('empty submit: the platform message shows in the field error',
          st['errHidden'] is False and st['errText']
          and st['errText'] == st['native'], st)
    check('empty submit: the live region counts both broken fields',
          st['live'] and '2' in st['live'], st)

    # ---- validation: fill valid -> submit -> toast + cleared -------------
    page.fill('#v-handle', 'omiinaya')
    page.fill('#v-mail', 'omar@mrxlab.net')
    page.click('form[data-cm-validate]:not([data-cm-validate-mode]) button[type="submit"]')
    page.wait_for_timeout(250)
    ok = page.evaluate("""() => {
        const handle = document.getElementById('v-handle');
        const field = handle.closest('.cm-field');
        const form = handle.form;
        const toast = [...document.querySelectorAll('.cm-toast-region .cm-toast')]
            .find(t => t.textContent.includes('handle saved'));
        const live = form.querySelector('[aria-live="polite"]');
        return { inv: handle.getAttribute('aria-invalid'),
                 dataInv: field.hasAttribute('data-invalid'),
                 errHidden: field.querySelector('.cm-field__error').hidden,
                 toast: !!toast, live: live ? live.textContent : '' };
    }""")
    check('a valid submit proves itself with the configured toast and clears every mark',
          ok['inv'] is None and not ok['dataInv'] and ok['errHidden']
          and ok['toast'] and ok['live'] == '', ok)

    # ---- the anatomy specimen is untouched (no collateral) ---------------
    anatomy = page.evaluate("""() => {
        const err = document.querySelector('#f-url ~ .cm-field__error')
            || document.querySelector('label[for="f-url"] + input + .cm-sr-only + .cm-field__error')
            || [...document.querySelectorAll('.cm-field__error')]
                .find(e => !e.closest('form[data-cm-validate]'));
        const f = document.getElementById('f-url');
        return { inv: f.getAttribute('aria-invalid'),
                 errHidden: err ? err.hidden : null };
    }""")
    check('the static anatomy error stays on (validation touched only its own forms)',
          anatomy['inv'] == 'true' and anatomy['errHidden'] is False, anatomy)

    # ---- blur mode --------------------------------------------------------
    page.focus('#v-blur')
    page.evaluate("() => document.getElementById('v-blur').blur()")
    page.wait_for_timeout(120)
    b1 = page.evaluate("""() => {
        const el = document.getElementById('v-blur');
        return { inv: el.getAttribute('aria-invalid'),
                 errHidden: el.closest('.cm-field').querySelector('.cm-field__error').hidden };
    }""")
    page.fill('#v-blur', 'omiinaya/oem-ui')
    page.evaluate("() => document.getElementById('v-blur').blur()")
    page.wait_for_timeout(120)
    b2 = page.evaluate("""() => {
        const el = document.getElementById('v-blur');
        return { inv: el.getAttribute('aria-invalid'),
                 errHidden: el.closest('.cm-field').querySelector('.cm-field__error').hidden };
    }""")
    check('mode=blur: leaving the empty required field marks it, leaving a filled one clears it',
          b1['inv'] == 'true' and b1['errHidden'] is False
          and b2['inv'] is None and b2['errHidden'], {'leave-empty': b1, 'leave-filled': b2})

    # ---- reset clears the marks ------------------------------------------
    # the marks must EXIST before a reset means anything, and they must be
    # asserted on the field that is actually marked (v-mail, emptied just
    # above): checking the untouched handle would let a dead reset
    # listener pass, because the native reset empties the inputs alone.
    page.fill('#v-mail', '')
    page.click('form[data-cm-validate]:not([data-cm-validate-mode]) button[type="submit"]')
    page.wait_for_timeout(120)
    pre = page.evaluate("""() => {
        const m = document.getElementById('v-mail');
        const f = m.closest('.cm-field');
        return { inv: m.getAttribute('aria-invalid'),
                 errShown: !f.querySelector('.cm-field__error').hidden };
    }""")
    page.click('form[data-cm-validate]:not([data-cm-validate-mode]) button[type="reset"]')
    page.wait_for_timeout(200)
    rst = page.evaluate("""() => {
        const m = document.getElementById('v-mail');
        const f = m.closest('.cm-field');
        const h = document.getElementById('v-handle');
        return { val: h.value, mail: m.value,
                 inv: m.getAttribute('aria-invalid'),
                 dataInv: f.hasAttribute('data-invalid'),
                 errHidden: f.querySelector('.cm-field__error').hidden };
    }""")
    check('reset empties the fields and wipes every invalid mark',
          pre['inv'] == 'true' and pre['errShown']
          and rst['val'] == '' and rst['mail'] == '' and rst['inv'] is None
          and not rst['dataInv'] and rst['errHidden'], {'pre': pre, 'rst': rst})

    # ---- reduced motion stops both new animations -------------------------
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(120)
    rm = page.evaluate("""() => ({
        shimmer: getComputedStyle(document.querySelector('code.cm-shimmer')).animationName,
        fade: getComputedStyle(document.querySelector('.cm-scroll-fade')).animationName
    })""")
    check('reduced-motion emulation silences shimmer AND scroll-fade (both listed in the one block)',
          rm['shimmer'] == 'none' and rm['fade'] == 'none', rm)

    check('no page JS errors',
          not page_errors and not console_errors,
          {'pageerror': page_errors, 'console': console_errors})
    browser.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
