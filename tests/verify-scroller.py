#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 17: the message scroller.

Their contract is behavioural, so this measures it: the frame opens at
the live edge with no flash, data-scrollable tokens flip at each edge,
inert/tabindex/data-active follow the tokens (an edge with nothing to
scroll toward must be a NON focus-stop), scrollToMessage parks a row
near the top with a peek of the previous turn and returns false for an
unknown id, the outline's aria-current tracks the anchored turn, growing
content pins only while following, and visible-row tracking marks only
rows actually on screen.
"""
import sys
from pathlib import Path
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
    # the frame is taller than the phone viewport - center its viewport
    # part; the outline/buttons get auto-scrolled by clicks when needed
    page.evaluate(
        "() => document.querySelector('.cm-scroller__viewport')"
        ".scrollIntoView({block: 'center'})")
    page.wait_for_function(
        """() => { const r = document.querySelector('.cm-scroller__viewport').getBoundingClientRect();
             return r.top > 40 && r.top < window.innerHeight / 2; }""", timeout=10000)
    page.wait_for_timeout(250)

    # ---- a11y contract of the frame --------------------------------------
    a11y = page.evaluate("""() => {
        const vp = document.querySelector('.cm-scroller__viewport');
        const content = document.querySelector('.cm-scroller__content');
        const item = document.querySelector('.cm-scroller__item');
        const scroller = document.querySelector('.cm-scroller');
        const cs = getComputedStyle(item);
        return { role: vp.getAttribute('role'), label: vp.getAttribute('aria-label'),
                 tab: vp.getAttribute('tabindex'),
                 log: content.getAttribute('role'), rel: content.getAttribute('aria-relevant'),
                 cv: cs.contentVisibility,
                 startEnd: scroller.hasAttribute('data-start-at-end'),
                 track: scroller.hasAttribute('data-track-visible') };
    }""")
    check('the viewport is a labelled focusable region over a log',
          a11y['role'] == 'region' and a11y['label'] == 'Messages'
          and a11y['tab'] == '0' and a11y['log'] == 'log'
          and a11y['rel'] == 'additions', a11y)
    check('rows opt into content-visibility; the frame declares its intents',
          a11y['cv'] == 'auto' and a11y['startEnd'] and a11y['track'], a11y)

    # ---- opens at the live edge (no flash) --------------------------------
    edge = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const vp = frame.querySelector('.cm-scroller__viewport');
        const start = frame.querySelector('[data-scroller-start]');
        const end = frame.querySelector('[data-scroller-end]');
        const pill = frame.querySelector('[data-scroller-pill]');
        return { atEnd: vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2,
                 tok: vp.getAttribute('data-scrollable'),
                 following: frame.getAttribute('data-following'),
                 startActive: start.getAttribute('data-active'),
                 startInert: start.inert, endActive: end.getAttribute('data-active'),
                 endInert: end.inert, pillHidden: pill.hidden,
                 status: frame.querySelector('[data-scroller-status]').textContent };
    }""")
    check('it opens at the live edge with the start control live and the pill away',
          edge['atEnd'] and edge['tok'] == 'start'
          and edge['following'] == 'true' and edge['startActive'] == 'true'
          and not edge['startInert'] and edge['endActive'] == 'false'
          and edge['endInert'] and edge['pillHidden']
          and 'up only' in edge['status'], edge)

    # ---- the opposite edge flips every mirror -----------------------------
    top = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const vp = frame.querySelector('.cm-scroller__viewport');
        vp.scrollTop = 0;
        vp.dispatchEvent(new Event('scroll'));
        const start = frame.querySelector('[data-scroller-start]');
        const end = frame.querySelector('[data-scroller-end]');
        const pill = frame.querySelector('[data-scroller-pill]');
        return { tok: vp.getAttribute('data-scrollable'),
                 following: frame.getAttribute('data-following'),
                 startActive: start.getAttribute('data-active'),
                 startInert: start.inert, startTab: start.tabIndex,
                 endActive: end.getAttribute('data-active'),
                 endInert: end.inert, pillHidden: pill.hidden,
                 status: frame.querySelector('[data-scroller-status]').textContent };
    }""")
    check('at the first message every mirror flips: start inert is NOT a focus stop',
          top['tok'] == 'end' and top['following'] == 'false'
          and top['startActive'] == 'false' and top['startInert']
          and top['startTab'] == -1 and top['endActive'] == 'true'
          and not top['endInert'] and not top['pillHidden']
          and 'down only' in top['status'], top)

    # ---- scrollToMessage parks with a peek; unknown id is false ----------
    jump = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const vp = frame.querySelector('.cm-scroller__viewport');
        const ok = frame.__scroller.scrollToMessage('m5');
        const row = frame.querySelector('[data-message-id="m5"]');
        const peek = frame.querySelector('[data-message-id="m4"]');
        const vr = vp.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const pr = peek.getBoundingClientRect();
        return { ok, missing: frame.__scroller.scrollToMessage('m-nope'),
                 offset: Math.round(rr.top - vr.top),
                 peekVisible: pr.bottom > vr.top && pr.top < vr.bottom,
                 anchor: frame.getAttribute('data-current-anchor') };
    }""")
    check('scrollToMessage parks the row near the top with a peek above it',
          jump['ok'] and jump['missing'] is False
          and 8 <= jump['offset'] <= 48 and jump['peekVisible'], jump)

    # ---- the outline follows the anchored turn ----------------------------
    page.click('[data-jump-to="m9"]')
    page.wait_for_timeout(80)
    outline = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const cur = frame.querySelector('[data-jump-to][aria-current="true"]');
        return { anchor: frame.getAttribute('data-current-anchor'),
                 current: cur ? cur.getAttribute('data-jump-to') : null };
    }""")
    check('the outline highlights the anchored turn after a jump',
          outline['anchor'] == 'm9' and outline['current'] == 'm9', outline)

    # ---- the live edge pins growth; scrolled away it must not ------------
    pinned = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const vp = frame.querySelector('.cm-scroller__viewport');
        const content = frame.querySelector('.cm-scroller__content');
        frame.__scroller.scrollToEnd();
        return new Promise((resolve) => setTimeout(() => {
            const before = vp.scrollHeight;
            const clone = content.querySelector('.cm-scroller__item').cloneNode(true);
            clone.setAttribute('data-message-id', 'm-live-1');
            content.appendChild(clone);
            setTimeout(() => {
                const atEnd = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2;
                const follow1 = frame.getAttribute('data-following');
                vp.scrollTop -= 120;
                vp.dispatchEvent(new Event('scroll'));
                const before2 = vp.scrollHeight;
                const clone2 = clone.cloneNode(true);
                clone2.setAttribute('data-message-id', 'm-live-2');
                content.appendChild(clone2);
                setTimeout(() => {
                    const jump = Math.abs(vp.scrollTop - (before2 - 120
                        - vp.clientHeight + vp.clientHeight));
                    resolve({ grew: vp.scrollHeight > before, atEnd, follow1,
                        stillAtEnd: vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2,
                        follow2: frame.getAttribute('data-following') });
                }, 80);
            }, 80);
        }, 120));
    }""")
    check('growth pins while following and stops pinning once the reader scrolls away',
          pinned['grew'] and pinned['atEnd'] and pinned['follow1'] == 'true'
          and not pinned['stillAtEnd'] and pinned['follow2'] == 'false', pinned)

    # ---- visible-row tracking marks only what is on screen ----------------
    vis = page.evaluate("""() => {
        const frame = document.querySelector('.cm-scroller');
        const links = [...frame.querySelectorAll('[data-jump-to]')];
        return links.map((l) => ({ id: l.getAttribute('data-jump-to'),
                                   v: l.hasAttribute('data-visible') }));
    }""")
    marked = [v['id'] for v in vis if v['v']]
    check('the outline marks on-screen rows only (pay-for-what-you-use)',
          len(marked) >= 1 and len(marked) < len(vis),
          {'marked': marked, 'all': [v['id'] for v in vis]})

    # The watcher only arms on a document that has NO library markup at
    # load (the static path arms nothing - see watchForLateMarkup). So the
    # honest surface for it is a blank page: load the library cold, then
    # let a scroller arrive. Forgetting it in hasLibraryMarkup() means
    # hasLibraryMarkup() stays false and init never runs.
    blank = browser.new_page(viewport={"width": 402, "height": 667})
    blank.set_content('<html><body><script>'
        + Path('src/js/cli-mono.js').read_text() + '</script></body></html>')
    late = blank.evaluate('''() => new Promise((done) => {
        const frag = document.createElement('div');
        frag.className = 'cm-scroller';
        frag.setAttribute('data-cm-scroller', '');
        frag.innerHTML =
            '<div class="cm-scroller__bar"><span data-scroller-status></span>'
            + '<button data-scroller-start></button>'
            + '<button data-scroller-end></button></div>'
            + '<div class="cm-scroller__viewport" role="region" aria-label="late"'
            + ' tabindex="0"><div class="cm-scroller__content" role="log"'
            + ' aria-relevant="additions"><div class="cm-scroller__item cm-msg"'
            + ' data-message-id="l1"><div class="cm-msg__body">'
            + '<div class="cm-bubble">late one</div></div></div>'
            + '</div></div>';
        document.body.appendChild(frag);
        setTimeout(() => {
            const vp = frag.querySelector('.cm-scroller__viewport');
            const start = frag.querySelector('[data-scroller-start]');
            done({
                bound: frag.__cmScrollerBound === true,
                painted: vp.hasAttribute('data-scrollable'),
                status: frag.querySelector('[data-scroller-status]').textContent,
                startActive: start.getAttribute('data-active'),
            });
        }, 400);
    })''')
    check('on a cold document the watcher binds a scroller that arrives late',
          late['bound'] is True and late['painted'], late)
    # one short row: not scrollable, so every edge mirror must say so -
    # static state is the third state of the same contract
    check('the late frame paints its mirrors too',
          late['status'] == 'all messages in view'
          and late['startActive'] == 'false', late)
    blank.close()

    check('no page errors in the scroller', not page_errors, page_errors)
    browser.close()

print('---')
print(f"passed {sum(1 for _, ok in results if ok)}/{len(results)}")
sys.exit(0 if all(ok for _, ok in results) else 1)
