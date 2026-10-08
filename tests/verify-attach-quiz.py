#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 16b: attachment + questionnaire.

The suite owns the strings; this owns behavior: the full-card trigger
really covers the card, the actions really sit ON TOP of it (hit-testing
with elementFromPoint), the group snaps and fades, and the quiz walks
its full lifecycle - failed validation focuses an answer control,
shortcuts select, navigation focuses the new legend, deep validation
jumps BACK to an unanswered required item, and a valid submit toasts
then wipes every answer with form.reset().
"""
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
    page = browser.new_page(viewport={'width': 402, 'height': 874})
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function(
        "window.cliMono && document.documentElement.classList.contains('cm-js')")

    # ---- attachment: trigger covers, actions stay on top -----------------
    # target the demo card that actually carries a trigger. elementFromPoint
    # only reports what is under the VIEWPORT point, so the card must be
    # scrolled in first or every hit lands on whatever is painted there.
    page.evaluate("() => document.querySelector('.cm-attach__trigger').scrollIntoView({block: 'center'})")
    # scrollIntoView is SMOOTH here: at 120ms the page is still mid-flight
    # (the card measured 13815px below the viewport). Wait for the scroll
    # offset to stop changing, then hit-test - a fixed wait is the bug.
    page.wait_for_function("""() => {
        const card = document.querySelector('.cm-attach__trigger').closest('.cm-attach');
        const r = card.getBoundingClientRect();
        return r.top > 60 && r.bottom < window.innerHeight - 10;
    }""", timeout=10000)
    page.wait_for_timeout(150)
    stack = page.evaluate("""() => {
        const card = document.querySelector('.cm-attach__trigger').closest('.cm-attach');
        const tr = card.querySelector('.cm-attach__trigger').getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const act = card.querySelector('.cm-attach__action');
        const ar = act.getBoundingClientRect();
        const hitAction = document.elementFromPoint(
            ar.left + ar.width / 2, ar.top + ar.height / 2);
        const title = card.querySelector('.cm-attach__title').getBoundingClientRect();
        const hitTitle = document.elementFromPoint(
            title.left + 12, title.top + title.height / 2);
        return {
            // the trigger is inset:0 against the card's PADDING box, so it
            // sits just inside the 1px border. Requiring edge-to-edge
            // equality was measuring the border, not the behaviour.
            covers: tr.width >= cr.width - 4 && tr.height >= cr.height - 4
                && Math.abs(tr.left - cr.left) <= 2 && Math.abs(tr.right - cr.right) <= 2
                && Math.abs(tr.top - cr.top) <= 2 && Math.abs(tr.bottom - cr.bottom) <= 2,
            // elementFromPoint reports what is painted at the VIEWPORT point,
            // so a hit only means "on top" if the point is inside the card AND
            // the card is on screen. Re-derive visibility here instead of
            // trusting a scroll position from an earlier evaluate.
            actionHit: (() => {
                if (ar.top < 60 || ar.bottom > 820) return 'offscreen';
                const e = document.elementFromPoint(
                    ar.left + ar.width / 2, ar.top + ar.height / 2);
                return (e === act || act.contains(e)) ? 'on-top' : 'buried';
            })(),
            titleHit: (() => {
                if (title.top < 60 || title.bottom > 820) return 'offscreen';
                const e = document.elementFromPoint(
                    title.left + 12, title.top + title.height / 2);
                return e === card.querySelector('.cm-attach__trigger') ? 'opens' : 'other';
            })(),
        };
    }""")
    check('the trigger covers the whole card edge to edge', stack['covers'], stack)
    check('the action sits on top of the trigger (never trapped)',
          stack['actionHit'] == 'on-top', stack)
    check('the title area resolves to the trigger (card opens there)',
          stack['titleHit'] == 'opens', stack)

    # ---- attachment group: scrolls, snaps, fades, keyboard-reachable -----
    group = page.evaluate("""() => {
        const g = document.querySelector('.cm-attach-group');
        const cs = getComputedStyle(g);
        const can = g.scrollWidth > g.clientWidth + 10;
        if (can) g.scrollBy({left: 30, behavior: 'auto'});
        return { scrollable: can,
                 snap: cs.scrollSnapType,
                 fade: (cs.animationTimeline || '').includes('scroll')
                       || cs.maskImage !== 'none',
                 tab: g.getAttribute('tabindex'), role: g.getAttribute('role'),
                 scrolled: can && g.scrollLeft > 10 };
    }""")
    check('the group is a keyboard-reachable snapping scroll row with an edge fade',
          group['scrollable'] and 'x' in (group['snap'] or '') and group['fade']
          and group['tab'] == '0' and group['role'] == 'group'
          and group['scrolled'], group)

    # ---- uploading shimmers (computed, not just a class) -----------------
    shimmer = page.evaluate("""() => {
        const t = document.querySelector('.cm-attach--uploading .cm-attach__title');
        const cs = getComputedStyle(t);
        return { name: cs.animationName, dur: cs.animationDuration };
    }""")
    check('the uploading title shimmers',
          'shimmer' in (shimmer['name'] or '') and shimmer['dur'] != '0s', shimmer)

    # ---- quiz: initial state --------------------------------------------
    q0 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const items = [...f.querySelectorAll('.cm-quiz__item')];
        const pg = f.querySelector('.cm-quiz__progress');
        return { visible: items.map((i) => !i.hidden),
                 prev: f.querySelector('[data-quiz-prev]').hidden,
                 next: f.querySelector('[data-quiz-next]').hidden,
                 skip: f.querySelector('[data-quiz-skip]').hidden,
                 submit: f.querySelector('[data-quiz-submit]').hidden,
                 now: pg.getAttribute('aria-valuenow'),
                 max: pg.getAttribute('aria-valuemax'),
                 bar: f.querySelector('.cm-quiz__bar').style.width };
    }""")
    check('the quiz opens on item 1 with progress 1/3 and correct actions',
          # item 1 is REQUIRED, so skip is hidden; next is the only way on
          q0['visible'] == [True, False, False] and q0['prev']
          and not q0['next'] and q0['skip'] and q0['submit']
          and q0['now'] == '1' and q0['max'] == '3' and q0['bar'] == '33%', q0)

    # ---- failed validation blocks and focuses an answer ------------------
    page.click('[data-quiz-next]')
    page.wait_for_timeout(50)
    q1 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const item = f.querySelector('.cm-quiz__item');
        const radio = item.querySelector('input[type=radio]');
        return { stillFirst: !f.querySelectorAll('.cm-quiz__item')[1].hidden === false,
                 err: !item.querySelector('.cm-quiz__error').hidden,
                 inv: radio.getAttribute('aria-invalid'),
                 focused: document.activeElement === radio,
                 invalid: item.hasAttribute('data-invalid') };
    }""")
    check('an empty required question blocks, marks and focuses its answer',
          q1['err'] and q1['inv'] == 'true' and q1['focused'] and q1['invalid'], q1)

    # ---- shortcut selects an answer, then navigation focuses the legend --
    page.keyboard.press('q')
    picked = page.evaluate(
        "() => document.querySelector('input[name=direction][value=questions]').checked")
    check("the letter shortcut 'q' selects its answer", picked, picked)

    page.click('[data-quiz-next]')
    page.wait_for_timeout(50)
    q2 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const items = [...f.querySelectorAll('.cm-quiz__item')];
        const pg = f.querySelector('.cm-quiz__progress');
        return { vis: items.map((i) => !i.hidden),
                 now: pg.getAttribute('aria-valuenow'),
                 prev: f.querySelector('[data-quiz-prev]').hidden,
                 skip: f.querySelector('[data-quiz-skip]').hidden,
                 focusedLegend: document.activeElement === items[1].querySelector('.cm-quiz__title'),
                 bar: f.querySelector('.cm-quiz__bar').style.width };
    }""")
    check('next advances to the multi-choice item and focuses its legend',
          q2['vis'] == [False, True, False] and q2['now'] == '2'
          and not q2['prev'] and q2['skip'] and q2['focusedLegend']
          and q2['bar'] == '67%', q2)

    page.keyboard.press('1')
    boxok = page.evaluate(
        "() => document.querySelector('input[name=detail][value=focused]').checked")
    check("the number shortcut '1' ticks its box", boxok, boxok)

    # ---- last item: skip appears, submit replaces next -------------------
    page.click('[data-quiz-next]')
    page.wait_for_timeout(50)
    q3 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const items = [...f.querySelectorAll('.cm-quiz__item')];
        return { vis: items.map((i) => !i.hidden),
                 skip: f.querySelector('[data-quiz-skip]').hidden,
                 next: f.querySelector('[data-quiz-next]').hidden,
                 submit: f.querySelector('[data-quiz-submit]').hidden,
                 now: f.querySelector('.cm-quiz__progress').getAttribute('aria-valuenow') };
    }""")
    check('the optional last item shows skip and submit, not next',
          q3['vis'] == [False, False, True] and not q3['skip']
          and q3['next'] and not q3['submit'] and q3['now'] == '3', q3)

    # ---- deep validation jumps BACK to the unanswered required item ------
    page.evaluate("""() => {
        document.querySelectorAll('input[name=detail]').forEach((c) => { c.checked = false; });
    }""")
    page.click('[data-quiz-submit]')
    page.wait_for_timeout(50)
    q4 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const items = [...f.querySelectorAll('.cm-quiz__item')];
        const target = items[1];
        return { vis: items.map((i) => !i.hidden),
                 err: !target.querySelector('.cm-quiz__error').hidden,
                 now: f.querySelector('.cm-quiz__progress').getAttribute('aria-valuenow'),
                 focused: document.activeElement === target.querySelector('input[type=checkbox]') };
    }""")
    check('submit jumps back to the unanswered required item and focuses it',
          q4['vis'] == [False, True, False] and q4['err'] and q4['now'] == '2'
          and q4['focused'], q4)

    # ---- a valid submit toasts and wipes with form.reset() ---------------
    # submit only exists on the LAST item, so walk there before pressing it.
    page.keyboard.press('1')
    page.wait_for_timeout(30)
    page.click('[data-quiz-next]')
    page.wait_for_timeout(50)
    page.click('[data-quiz-submit]')
    page.wait_for_timeout(250)
    q5 = page.evaluate("""() => {
        const f = document.querySelector('[data-cm-quiz]');
        const items = [...f.querySelectorAll('.cm-quiz__item')];
        const toasts = [...document.querySelectorAll('.cm-toast')];
        const toast = toasts[toasts.length - 1];
        return {
            visible: items.map((i) => !i.hidden),
            now: f.querySelector('.cm-quiz__progress').getAttribute('aria-valuenow'),
            radios: [...f.querySelectorAll('input[type=radio], input[type=checkbox]')]
                .every((i) => !i.checked),
            text: f.querySelector('.cm-quiz__input').value === '',
            err: [...f.querySelectorAll('.cm-quiz__error')].every((e) => e.hidden),
            // the page also renders STATIC demo toasts, so the quiz's is the
            // NEWEST one - querying the first match reads a specimen.
            toast: !!toast && /questionnaire submitted/.test(toast.textContent),
            focusedLegend: document.activeElement === items[0].querySelector('.cm-quiz__title'),
        };
    }""")
    check('a valid submit toasts and resets every answer, item and label',
          q5['visible'] == [True, False, False] and q5['now'] == '1'
          and q5['radios'] and q5['text'] and q5['err'] and q5['toast']
          and q5['focusedLegend'], q5)

    check('no page errors across both families', not page_errors, page_errors)
    browser.close()

print('---')
print(f"passed {sum(1 for _, ok in results if ok)}/{len(results)}")
sys.exit(0 if all(ok for _, ok in results) else 1)
