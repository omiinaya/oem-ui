#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 16a: the conversation family.

What the suite cannot see: that the 80% cap actually CLAMPS (inject a
long line and measure), that ghost really spans the row, that --end
flips the grid and the avatar lands on the bottom edge, that reactions
overlap the bubble, that the footer follows the side, and that the
separator draws real rules. Geometry and computed styles only - the
suite owns the strings.
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
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function(
        "window.cliMono && document.documentElement.classList.contains('cm-js')")

    presence = page.evaluate("""() => ({
        section: !!document.getElementById('chat'),
        variants: document.querySelectorAll('.cm-bubble-group .cm-bubble').length,
        ghost: !!document.querySelector('.cm-bubble--ghost'),
        interactive: document.querySelector('.cm-bubble__content--interactive'),
        reactions: document.querySelectorAll('.cm-bubble__reactions').length,
        msgEnd: !!document.querySelector('.cm-msg--end'),
        msgGroup: !!document.querySelector('.cm-msg-group'),
        markers: document.querySelectorAll('.cm-marker--border, .cm-marker--separator').length,
        iconHidden: document.querySelector('.cm-marker__icon').getAttribute('aria-hidden'),
    })""")
    check('every chat specimen is on the page',
          presence['section'] and presence['variants'] >= 7 and presence['ghost']
          and presence['interactive'] is not None and presence['reactions'] >= 2
          and presence['msgEnd'] and presence['msgGroup']
          and presence['markers'] == 2 and presence['iconHidden'] == 'true',
          presence)

    # ---- the 80% cap clamps; ghost does not ------------------------------
    cap = page.evaluate("""() => {
        const group = document.querySelector('.cm-bubble-group');
        const b = group.querySelector('.cm-bubble--secondary');
        b.textContent = 'x'.repeat(400);
        const g = document.querySelector('.cm-bubble--ghost');
        g.textContent = 'y'.repeat(400);
        const w = group.getBoundingClientRect().width;
        return { group: w, capped: b.getBoundingClientRect().width,
                 ghost: g.getBoundingClientRect().width };
    }""")
    page.wait_for_timeout(60)
    check('a long bubble clamps to 80% of the row; ghost spans the row',
          cap['capped'] <= cap['group'] * 0.84
          and cap['ghost'] >= cap['group'] * 0.95, cap)

    # ---- end alignment flips the bubble and the row ----------------------
    align = page.evaluate("""() => {
        const pair = document.querySelectorAll('.cm-bubble-group')[1];
        const [startB, endB] = pair.querySelectorAll('.cm-bubble');
        const msg = document.querySelector('.cm-msg--end');
        const av = msg.querySelector('.cm-msg__avatar').getBoundingClientRect();
        const body = msg.querySelector('.cm-msg__body').getBoundingClientRect();
        const content = msg.querySelector('.cm-avatar');
        // order:2 flips PLACEMENT either way; the grid columns decide the
        // STRETCH - 1fr lets the body fill its column, auto makes it hug
        // its content. Measure the slack the body leaves in the row.
        const avContent = content ? content.getBoundingClientRect().width : av.width;
        return { startLeft: startB.getBoundingClientRect().left,
                 endLeft: endB.getBoundingClientRect().left,
                 avatarLeft: av.left, bodyLeft: body.left,
                 avatarBottom: av.bottom, bodyBottom: body.bottom,
                 rowW: msg.getBoundingClientRect().width,
                 bodyW: body.width, avContent: avContent };
    }""")
    check('--end flips the bubble to the right side',
          align['endLeft'] > align['startLeft'] + 10, align)
    check('the end row flips its columns too',
          align['avatarLeft'] > align['bodyLeft'], align)
    check('the end-row body stretches its 1fr column (does not hug)',
          align['bodyW'] >= align['rowW'] - align['avContent'] - 14, align)
    check('the avatar anchors to the bottom of the message',
          abs(align['avatarBottom'] - align['bodyBottom']) < 3, align)

    # ---- reactions overlap the edge; footer follows the side -------------
    rx = page.evaluate("""() => {
        const demo = document.querySelectorAll('.cm-bubble-group')[2];
        const b = demo.querySelector('.cm-bubble--danger');
        const r = demo.querySelector('.cm-bubble__reactions');
        const footer = document.querySelector('.cm-msg--end .cm-msg__footer');
        return { overlap: b.getBoundingClientRect().bottom - r.getBoundingClientRect().top,
                 role: r.getAttribute('role'), label: r.getAttribute('aria-label'),
                 footerJustify: getComputedStyle(footer).justifyContent };
    }""")
    check('reactions overlap the bubble edge (their layout note)',
          0 < rx['overlap'] < 20, rx)
    check('the reactions row announces once, as one image',
          rx['role'] == 'img' and bool(rx['label']), rx)
    check('the footer follows the message side',
          rx['footerJustify'] == 'flex-end', rx)

    # ---- interactive bubble is a real link that takes focus --------------
    link = page.evaluate("""() => {
        const el = document.querySelector('.cm-bubble__content--interactive');
        return { tag: el.tagName, href: el.getAttribute('href') };
    }""")
    page.evaluate("() => document.querySelector('.cm-bubble__content--interactive').focus()")
    focused = page.evaluate(
        "() => document.activeElement.classList.contains('cm-bubble__content--interactive')")
    check('an interactive bubble is a real, focusable link',
          link['tag'] == 'A' and link['href'] is not None and focused, link)

    # ---- marker separator and border draw real rules ---------------------
    mk = page.evaluate("""() => {
        const sep = document.querySelector('.cm-marker--separator');
        const bord = document.querySelector('.cm-marker--border');
        return { sepLine: getComputedStyle(sep, '::before').borderTopWidth,
                 bordLine: getComputedStyle(bord).borderBlockStartWidth,
                 sepWidth: sep.getBoundingClientRect().width };
    }""")
    check('the separator draws labeled rules and the border row a full-width edge',
          mk['sepLine'] == '1px' and mk['bordLine'] == '1px'
          and mk['sepWidth'] > 300, mk)

    check('no page errors on the chat section', not page_errors, page_errors)
    browser.close()

print('---')
print(f"passed {sum(1 for _, ok in results if ok)}/{len(results)}")
sys.exit(0 if all(ok for _, ok in results) else 1)
