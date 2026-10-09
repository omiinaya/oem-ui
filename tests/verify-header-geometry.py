#!/root/.venvs/mau/bin/python
"""Header geometry + stickiness, measured in WebKit at five widths.

The defect this exists to pin is the one a HEIGHT-ONLY probe reports and
misreads: at 1280 the header measures 900px tall - the full viewport -
with `position: fixed`, while at 402 it measures 63px with `position:
sticky`. Read alone, that looks like "the desktop header blew up to the
viewport height".

It is not. Above 1000px the header opts into the desktop nav RAIL (see
README "The desktop nav rail", commit b94cb4b): a FIXED column of width
`--rail-w` down the leading edge, `height: 100vh` so its link list is a
bounded flex child, with `.cm-shell--rail` padding the content clear of
it. A 232x900 box at x=0 is that rail working; a 1280x900 box would be
the bug. So the assertions separate the two claims a single height number
conflates:

  1. VIEWPORT-TALL is only ever the rail - a width-bounded, x=0, fixed
     column whose content is offset past it. A full-width, viewport-tall
     header is asserted impossible at every width.
  2. Everywhere below 1000px the header is a COMPACT bar (<= 70px) and it
     is `position: sticky` with `top: 0`, measured at 320/390/402/768.
     402 is the phone the design is reviewed on and it must stay 63px.
  3. STICKINESS is read while actually scrolling the ~50,000px showcase:
     `scrollTo` clamps and `scroll-behavior: smooth` animates, so each
     target is waited out (`|scrollY - target| < 2`), `scrollY > 0` is
     asserted before the header is read, and the header's rect must still
     start at the top of the viewport with a nav link on screen.

Serves THIS worktree's dist on the session's own port, 8098 (nothing was
listening there, so the harness binds it): the shared :4461 server belongs
to the main clone, and a mutation run that rebuilds only this worktree
would otherwise be measured against the wrong bytes. A fixed port can be
SQUATTED, so the first thing every page read does is compare the served
body against this worktree's own dist/index.html - a squatter is a hard
failure, not a measurement.

Run from the repo root. Exits non-zero on the first failure.
"""
import functools
import hashlib
import http.server
import json
import socketserver
import sys
import threading
import urllib.request
from os.path import join

from playwright.sync_api import sync_playwright

ROOT = __file__.rsplit('/', 2)[0]
PORT = 8098
URL = ''

WIDTHS = [(320, 667), (390, 667), (402, 667), (768, 900), (1280, 900)]

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


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    h = functools.partial(Quiet, directory=join(ROOT, 'dist'))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), h)
    global URL
    URL = f'http://127.0.0.1:{srv.server_address[1]}/'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def served_is_ours():
    """A fixed port can be squatted: measuring somebody else's page and
    reporting it as ours is the one failure mode an ephemeral port had and
    this one does not. Compare bytes, not the title."""
    with urllib.request.urlopen(URL, timeout=10) as r:
        got = r.read()
    want = open(join(ROOT, 'dist', 'index.html'), 'rb').read()
    return hashlib.sha256(got).hexdigest() == hashlib.sha256(want).hexdigest()


GEO = r"""() => {
  const h = document.querySelector('header[data-cm-header]');
  const n = h && h.querySelector('.cm-header__nav');
  const r = h.getBoundingClientRect();
  // The CLASS is on the header at every width; only the min-width: 1000px
  // block turns it into a rail. Deciding the mode from the class alone
  // reads "rail" on a phone and checks the wrong geometry there.
  const rail = h.classList.contains('cm-header--rail') && innerWidth >= 1000;
  const shell = document.querySelector('main.cm-shell--rail');
  return {
    vw: innerWidth, vh: innerHeight,
    x: Math.round(r.x), top: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    pos: getComputedStyle(h).position,
    navH: n ? Math.round(n.getBoundingClientRect().height) : null,
    rail,
    railW: getComputedStyle(h).width,
    shellPadLeft: shell ? parseInt(getComputedStyle(shell).paddingLeft, 10) : null,
    docH: document.documentElement.scrollHeight,
    scrollable: document.documentElement.scrollHeight - innerHeight,
  };
}"""

# `behavior: 'instant'` is load-bearing: the page sets
# `scroll-behavior: smooth`, and a smooth programmatic scroll of 80,000px
# animates long past any sane timeout - the probe then reports "never
# settled" for a page that settles fine. Instant makes the target the
# target; the wait below still proves it actually landed.
def settled(page, target, timeout=8000):
    page.evaluate('t => window.scrollTo({ top: t, behavior: "instant" })', target)
    try:
        page.wait_for_function(
            't => Math.abs(window.scrollY - t) < 2', arg=target, timeout=timeout)
    except Exception:
        return None
    return page.evaluate('window.scrollY')


def settle(page):
    """Wait out the two things that move the bar AFTER `networkidle`:
    the font swap (the nav's `height: auto` grows 60 -> 61.59px when the
    real metrics arrive) and `initHeader`, which writes `--header-h` from
    the measured bar. Measured before this existed: 61px at load, 62.59px
    (rounds to the 63 the phone is pinned at) once both had run. Reading
    before them measures a page the reader never sees."""
    page.evaluate('() => document.fonts.ready')
    try:
        page.wait_for_function(
            "() => getComputedStyle(document.documentElement)"
            ".getPropertyValue('--header-h').trim() !== ''", timeout=5000)
    except Exception:
        pass  # absence is reported by the height check below, not here
    page.wait_for_timeout(150)


def main():
    srv = serve()
    check('the port answers with THIS worktree\'s build, not a squatter\'s',
          served_is_ours(), URL)
    if failed:
        srv.shutdown()
        print('---')
        print(f'{passed} passed, {len(failed)} failed')
        return 1
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        for (w, hgt) in WIDTHS:
            page = b.new_page(viewport={'width': w, 'height': hgt})
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(URL, wait_until='networkidle')
            settle(page)
            g = page.evaluate(GEO)
            label = f'{w}x{hgt}'
            print(f'-- {label}: {json.dumps(g)}')

            check(f'{label}: the page threw nothing', not errs, errs)
            check(f'{label}: a header and its nav are on the page',
                  g['navH'] is not None, g)

            # 1. The claim a height-only probe conflates. A full-width,
            #    viewport-tall header is the defect; a width-bounded
            #    viewport-tall box is the rail.
            full_and_tall = g['w'] >= g['vw'] - 1 and g['h'] >= g['vh'] - 1
            check(f'{label}: the header is never a full-width viewport-tall box',
                  not full_and_tall,
                  {'w': g['w'], 'vw': g['vw'], 'h': g['h'], 'vh': g['vh']})

            if g['rail']:
                rail_w = int(g['railW'].replace('px', ''))
                check(f'{label}: rail mode - fixed column, width-bound, x=0',
                      g['pos'] == 'fixed' and g['x'] == 0 and rail_w == 232,
                      {'pos': g['pos'], 'x': g['x'], 'width': rail_w})
                check(f'{label}: rail mode - viewport height is the rail body, '
                      'not a bar that grew',
                      g['h'] == g['vh'] and g['navH'] == g['vh'],
                      {'h': g['h'], 'vh': g['vh'], 'navH': g['navH']})
                check(f'{label}: rail mode - the content is offset clear of it',
                      g['shellPadLeft'] is not None
                      and g['shellPadLeft'] >= rail_w,
                      {'padLeft': g['shellPadLeft'], 'railW': rail_w})
            else:
                check(f'{label}: bar mode - sticky, not fixed, not static',
                      g['pos'] == 'sticky', g['pos'])
                check(f'{label}: bar mode - a compact bar, not a column',
                      g['h'] <= 70, {'h': g['h']})
                check(f'{label}: bar mode - full width across the top',
                      g['w'] == g['vw'], {'w': g['w'], 'vw': g['vw']})
                if w <= 640:
                    # The phone the design is reviewed on: 62.59px rounds
                    # to 63, its nav row 61.59px to 62 - the exact numbers
                    # the original probe reported, pinned so the bar can
                    # never quietly grow (or shrink) under a refactor.
                    check(f'{label}: the phone bar is exactly 63px, nav 62',
                          g['h'] == 63 and g['navH'] == 62,
                          {'h': g['h'], 'navH': g['navH']})
                else:
                    check(f'{label}: the tablet bar is 61px, nav 60',
                          g['h'] == 61 and g['navH'] == 60,
                          {'h': g['h'], 'navH': g['navH']})

            # 3. Stickiness, read while scrolling for real.
            top0 = page.evaluate('window.scrollY')
            check(f'{label}: starts at the top of the document', top0 == 0, top0)
            spans = [int(g['scrollable'] * f) for f in (0, 0.25, 0.5, 0.75, 1.0)]
            for target in spans:
                got = settled(page, target)
                if got is None:
                    check(f'{label}: scroll settled at {target}', False,
                          'never settled (smooth-scroll animation or clamp)')
                    continue
                if target > 0:
                    check(f'{label}: actually scrolled to {target}', got > 0, got)
                r = page.evaluate(
                    """() => {
                      const h = document.querySelector('header[data-cm-header]');
                      const b = h.getBoundingClientRect();
                      // The brand, not `.cm-header__links`: below 640px the
                      // link list is the burger's drawer and is display:none
                      // until opened, so reading IT reports "off screen" for
                      // a header that is right there.
                      const nav = h.querySelector('.cm-header__brand');
                      const nb = nav ? nav.getBoundingClientRect() : null;
                      return { top: Math.round(b.top), h: Math.round(b.height),
                               pos: getComputedStyle(h).position,
                               navOnScreen: nb ? nb.bottom > 0 && nb.top < innerHeight : null };
                    }""")
                check(f'{label}: header pinned at the top after scrolling to {got}',
                      abs(r['top']) <= 1 and r['h'] > 0, r)
                check(f'{label}: the header itself is on screen after scrolling to {got}',
                      r['navOnScreen'] is True, r)
            page.close()

        b.close()
    srv.shutdown()

    print('---')
    print(f'{passed} passed, {len(failed)} failed')
    if failed:
        for f in failed:
            print(f'  FAIL {f}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
