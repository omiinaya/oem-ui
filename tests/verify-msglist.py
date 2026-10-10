#!/root/.venvs/mau/bin/python
"""WebKit proof for the .cm-msglist timeline (batch 30).

tests/run.mjs reads the SOURCE: which rule declares what, and that the
built specimen renders every class in the contract. Three of batch 30's
claims are only true of a LAID-OUT row, and this measures them:

  * the action toolbar is invisible at rest AND its fourth track is
    still reserved, so :hover / :focus-within reveal it without moving
    the text a pixel. The reserve is the claim; opacity is only how the
    thing is hidden, and pointer-events:none is what keeps an invisible
    control from swallowing a click on the row underneath it.
  * one stamp per row, decided by CSS: an ungrouped row stamps itself
    in the meta line and its gutter is visibility: hidden, a
    continuation row has no header so its gutter stamps it. visibility
    (not display) is the mechanism, so the stamp column's geometry is
    identical on both rows.
  * a grouped row's EMPTY avatar slot opens the same width as a real
    .cm-avatar (--msglist-avatar is pinned to .cm-avatar's default), and
    the mention row's 2px bar hands back the padding it eats, so its
    message column stands where every other row's does.

Every check below can fail. The faults the SUITE is held to are seeded
in tests/mutate-msglist.py; the layout claims here are held to the same
standard by a seeded sweep of this harness alone (18 faults, all killed,
none surviving on a green run).

ROOT is derived from this file, not hardcoded, so the tree under test is
the tree the harness lives in (a worktree gets measured, not the main
checkout).
"""
import functools
import hashlib
import http.server
import json
import socketserver
import sys
import threading
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = ''
VIEWPORTS = [('phone', 402, 874), ('desktop', 1280, 900)]
TOL = 0.75          # px; a track and the box it sizes are the same box

results = []


def check(name, ok, detail=None):
    results.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name
          + ((' :: ' + repr(detail)) if detail is not None else ''), flush=True)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

    h = functools.partial(Quiet, directory=str(ROOT / 'dist'))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    global URL
    URL = f'http://127.0.0.1:{srv.server_address[1]}/'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------------------------------------------------------------- collect
COLLECT = r"""() => {
  const list = document.querySelector('.cm-msglist');
  if (!list) return { missing: true };
  const px = (v) => { const n = parseFloat(v); return isNaN(n) ? null : +n.toFixed(2); };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return {w: +r.width.toFixed(2), x: +r.x.toFixed(2), y: +r.y.toFixed(2),
            h: +r.height.toFixed(2)}; };
  const cs = (el, pseudo) => getComputedStyle(el, pseudo);
  // px per grid track, so a mutant that widens a track bends a LAYOUT
  // claim this harness can see a source scan cannot.
  const px_grid = (v) => [...(v || '').split(/\s+(?![^(]*\))/)].map(px);
  // --msglist-gutter / --msglist-avatar resolved to px IN THE ROW's
  // context, so a token that stops resolving reads as 0 rather than as
  // whatever the neighbouring track happens to be.
  const probe = (v) => { const d = document.createElement('span');
    d.style.cssText = 'position:absolute;visibility:hidden;width:' + v;
    list.appendChild(d); const w = d.getBoundingClientRect().width;
    d.remove(); return +w.toFixed(2); };
  const ids = []; for (let el = list.parentElement; el; el = el.parentElement)
    if (el.id) ids.push(el.id);
  const rows = [...list.querySelectorAll('.cm-msglist__msg')].map((r) => {
    const gut = r.querySelector('.cm-msglist__gutter');
    const meta = r.querySelector('.cm-msglist__meta');
    const avatar = r.querySelector('.cm-msglist__avatar');
    const main = r.querySelector('.cm-msglist__main');
    const text = r.querySelector('.cm-msglist__text');
    const act = r.querySelector('.cm-msglist__actions');
    const stamped = (el) => !!(el && el.querySelector('time') && cs(el).display !== 'none');
    const mine = r.querySelector('.cm-msglist__reaction--mine');
    const plainRx = [...r.querySelectorAll('.cm-msglist__reaction')]
      .find((b) => !b.classList.contains('cm-msglist__reaction--mine'));
    const gutVis = gut ? cs(gut).visibility : null;
    const metaVis = meta ? cs(meta).visibility : null;
    return {
      id: r.getAttribute('data-message-id'),
      anchor: r.hasAttribute('data-scroll-anchor'),
      grouped: r.classList.contains('cm-msglist__msg--grouped'),
      mention: r.classList.contains('cm-msglist__msg--mention'),
      system: r.classList.contains('cm-msglist__msg--system'),
      tracks: px_grid(cs(r).gridTemplateColumns),
      rowH: box(r).h,
      cv: cs(r).contentVisibility,
      bg: cs(r).backgroundColor,
      borderInlineStart: cs(r).borderInlineStartWidth,
      padInlineStart: cs(r).paddingInlineStart,
      mainX: main ? box(main).x : null,
      textW: text ? box(text).w : null,
      textLen: text ? text.textContent.trim().length : 0,
      padBlockStart: cs(r).paddingBlockStart,
      hOverflow: box(r).h,
      gutter: gut ? { w: box(gut).w, x: box(gut).x, h: box(gut).h,
                      visibility: gutVis, idx: cs(gut).gridColumnStart,
                      hasTime: !!gut.querySelector('time'),
                      timeW: gut.querySelector('time') ? box(gut.querySelector('time')).w : null,
                      timeText: gut.querySelector('time') ? gut.querySelector('time').textContent.trim() : null }
                    : null,
      metaCount: r.querySelectorAll('.cm-msglist__meta').length,
      metaVisibility: metaVis,
      metaHasTime: !!(meta && meta.querySelector('time')),
      mainTrack3: main ? (() => { const s = cs(main).gridColumnStart; return (s + '') === '3'; })() : null,
      avatar: avatar ? { w: box(avatar).w, x: box(avatar).x,
                         text: avatar.textContent.trim(), composes: avatar.classList.contains('cm-avatar'),
                         idx: cs(avatar).gridColumnStart } : null,
      actions: act ? { w: box(act).w, x: box(act).x, y: box(act).y,
                       opacity: cs(act).opacity, pe: cs(act).pointerEvents,
                       display: cs(act).display, position: cs(act).position,
                       idx: cs(act).gridColumnStart,
                       buttons: act.querySelectorAll('button').length,
                       tabIndex: act.querySelector('button') ? act.querySelector('button').tabIndex : null } : null,
      // Stamps a reader can actually see on this row. Two is the bug
      // the visibility rule exists to prevent; zero is a row with no
      // time on it at all.
      visibleStamps: (gutVis === 'visible' && gut && !!gut.querySelector('time') ? 1 : 0)
                   + (meta && stamped(meta) && metaVis === 'visible' ? 1 : 0),
      counts: [...r.querySelectorAll('.cm-msglist__count')].map((c) => c.textContent.trim()),
      minePressed: mine ? mine.getAttribute('aria-pressed') : null,
      plainPressed: plainRx ? plainRx.getAttribute('aria-pressed') : null,
      plainRxShadow: plainRx ? cs(plainRx).boxShadow : null,
      plainRxBorder: plainRx ? cs(plainRx).borderTopColor : null,
      mineShadow: mine ? cs(mine).boxShadow : null,
      mineBorder: mine ? cs(mine).borderTopColor : null,
    };
  });
  const unread = list.querySelector('.cm-msglist__unread');
  const day = list.querySelector('.cm-msglist__day');
  const dayBefore = day ? getComputedStyle(day, '::before') : null;
  const dayAfter = day ? getComputedStyle(day, '::after') : null;
  const content = list.closest('[role="log"]');
  const vp = list.closest('.cm-scroller__viewport');
  const row = rows.find((r) => !r.grouped && !r.mention && !r.system);
  const btn = list.querySelector('.cm-msglist__actions button');
  let hit = null;
  if (btn) { const b = box(btn); const el = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    hit = { onScreen: b.y >= 0 && b.y + b.h <= innerHeight, tag: el ? el.tagName : null,
            cls: el ? el.className : null,
            inToolbar: !!(el && el.closest && el.closest('.cm-msglist__actions')) }; }
  return {
    ids, listCount: document.querySelectorAll('.cm-msglist').length,
    rows, rowIds: rows.map((r) => r.id),
    gutterTokenPx: probe('var(--msglist-gutter)'),
    avatarTokenPx: probe('var(--msglist-avatar)'),
    unread: unread ? { h: box(unread).h, bar: cs(unread).borderBlockStartWidth,
                       text: unread.textContent.trim(),
                       times: unread.querySelectorAll('time').length } : null,
    day: day ? { text: day.textContent.trim(), before: dayBefore.content,
                 beforeBT: dayBefore.borderBlockStartWidth, beforeFlex: dayBefore.flexGrow,
                 after: dayAfter.content, afterBT: dayAfter.borderBlockStartWidth } : null,
    scroller: { vp: !!vp, vpRole: vp ? vp.getAttribute('role') : null,
                vpLabel: vp ? vp.getAttribute('aria-label') : null,
                vpTab: vp ? vp.getAttribute('tabindex') : null,
                log: !!content,
                logRelevant: content ? content.getAttribute('aria-relevant') : null },
    overflow: (() => { const c = list.closest('.cm-scroller__content');
      return c ? { sw: c.scrollWidth, cw: c.clientWidth } : null; })(),
    rowExample: row,
    hit,
  };
}"""

HOVER = r"""(id) => {
  const row = document.querySelector('.cm-msglist__msg[data-message-id="' + id + '"]');
  const t = row.querySelector('.cm-msglist__text');
  const a = row.querySelector('.cm-msglist__actions');
  const m = row.querySelector('.cm-msglist__main');
  return { textW: +t.getBoundingClientRect().width.toFixed(2),
           mainX: +m.getBoundingClientRect().x.toFixed(2),
           rowH: +row.getBoundingClientRect().height.toFixed(2),
           actX: +a.getBoundingClientRect().x.toFixed(2),
           actW: +a.getBoundingClientRect().width.toFixed(2),
           opacity: getComputedStyle(a).opacity,
           pe: getComputedStyle(a).pointerEvents,
           bg: getComputedStyle(row).backgroundColor };
}"""

FOCUS_TOOLBAR = r"""() => {
  const row = document.querySelector('.cm-msglist__msg[data-message-id="ml1"]');
  const btn = row.querySelector('.cm-msglist__actions button');
  const a = row.querySelector('.cm-msglist__actions');
  btn.focus();
  return { focused: document.activeElement === btn,
           opacity: getComputedStyle(a).opacity,
           pe: getComputedStyle(a).pointerEvents,
           tabIndex: btn.tabIndex };
}"""

# Which PHYSICAL side the mention mark landed on, and which side the
# padding it pays back sits on - measured on a right-to-left page, the
# only page where inline-start and left can disagree.
MENTION_SIDE = r"""(id) => {
  const r = document.querySelector('.cm-msglist__msg[data-message-id="' + id + '"]');
  const c = getComputedStyle(r);
  return { side: c.borderLeftWidth !== '0px' ? 'left' : (c.borderRightWidth !== '0px' ? 'right' : 'none'),
           padSide: parseFloat(c.paddingLeft) < parseFloat(c.paddingRight) ? 'left' : 'right',
           borderLeft: c.borderLeftWidth, borderRight: c.borderRightWidth,
           padLeft: c.paddingLeft, padRight: c.paddingRight };
}"""


def close(a, b, tol=TOL):
    return a is not None and b is not None and abs(a - b) <= tol


def main():
    srv = serve()
    with urllib.request.urlopen(URL, timeout=10) as r:
        served = r.read()
    want = (ROOT / 'dist' / 'index.html').read_bytes()
    served_is_ours = hashlib.sha256(served).hexdigest() == hashlib.sha256(want).hexdigest()
    check('the server is serving the build under test', served_is_ours,
          [len(served), len(want)])

    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        for label, w, h in VIEWPORTS:
            page = browser.new_page(viewport={'width': w, 'height': h})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(URL, wait_until='networkidle')
            page.wait_for_function(
                "() => window.cliMono && document.documentElement.classList.contains('cm-js')")
            page.evaluate('document.fonts.ready')
            page.mouse.move(1, 1)          # nothing hovered: this is the REST state
            page.evaluate("() => document.querySelector('.cm-msglist')"
                          ".scrollIntoView({block: 'center'})")
            page.wait_for_timeout(250)
            d = page.evaluate(COLLECT)

            if d.get('missing'):
                check(f'[{label}] the built page has a .cm-msglist', False, 'not found')
                page.close()
                continue

            rows = {r['id']: r for r in d['rows']}
            grouped = [r for r in d['rows'] if r['grouped']]
            plain = [r for r in d['rows'] if not r['grouped'] and not r['mention'] and not r['system']]
            mention = next((r for r in d['rows'] if r['mention']), None)
            system = next((r for r in d['rows'] if r['system']), None)

            # ---- the frame, and that this is the page we built -----------
            if label == 'phone':
                check('the timeline is one section of the build, inside the scroller frame',
                      d['ids'][:1] == ['msglist'] and d['listCount'] == 1, d['ids'])
                check('the list is inside a labelled, focusable scroll region over a log',
                      d['scroller']['vp'] and d['scroller']['vpRole'] == 'region'
                      and d['scroller']['vpLabel'] == 'Message list'
                      and d['scroller']['vpTab'] == '0'
                      and d['scroller']['log']
                      and d['scroller']['logRelevant'] == 'additions', d['scroller'])
                check('every row is a scroller item the frame can address',
                      len(d['rows']) >= 8
                      and all(r['id'] and r['anchor'] for r in d['rows']),
                      [len(d['rows']), [r['id'] for r in d['rows'] if not r['id'] or not r['anchor']]])
                check('rows keep the scroller item content-visibility contract',
                      all(r['cv'] == 'auto' for r in d['rows']),
                      sorted({r['cv'] for r in d['rows']}))

            # ---- the reserved action track -------------------------------
            rest_track = d['rowExample']
            acts = [r for r in d['rows'] if r['actions']]
            check(f'[{label}] every message row carries its action toolbar, and only '
                  'the system note carries none',
                  len(acts) == len(d['rows']) - 1
                  and all(r['actions']['buttons'] >= 1 for r in acts)
                  and (system is None or system['actions'] is None),
                  [len(acts), len(d['rows']),
                   {r['id']: r['actions']['buttons'] for r in d['rows'] if r['actions']}])
            check(f'[{label}] the toolbar ships invisible at rest and cannot take the pointer',
                  all(r['actions']['opacity'] == '0' and r['actions']['pe'] == 'none' for r in acts),
                  {r['id']: (r['actions']['opacity'], r['actions']['pe']) for r in acts})
            check(f'[{label}] the rest state is opacity, not geometry: the track stays in the layout',
                  all(r['actions']['display'] != 'none' and r['actions']['position'] != 'absolute'
                      and r['actions']['w'] > 0 for r in acts),
                  {r['id']: (r['actions']['display'], r['actions']['position'],
                             r['actions']['w']) for r in acts})
            four = all(len(r['tracks']) == 4 for r in d['rows'] if not r['system'])
            check(f'[{label}] the row grid is the four tracks the contract reserves',
                  four and all(len(r['tracks']) == 1 for r in d['rows'] if r['system']),
                  {r['id']: len(r['tracks']) for r in d['rows']})
            check(f'[{label}] the fourth track IS the toolbar: the column is reserved, not overlaid',
                  all(close(r['actions']['w'], px_of(r['tracks'], 3)) for r in acts),
                  {r['id']: (r['actions']['w'], r['tracks'][3] if len(r['tracks']) > 3 else None)
                   for r in acts})
            check(f'[{label}] every part is placed on its own track, so a missing child cannot shift the row',
                  all(r['gutter']['idx'] == '1' and r['avatar']['idx'] == '2' for r in d['rows']
                      if r['gutter'] and r['avatar'])
                  and all(r['actions']['idx'] == '4' for r in acts),
                  {r['id']: (r['gutter'] and r['gutter']['idx'], r['avatar'] and r['avatar']['idx'],
                             r['actions'] and r['actions']['idx']) for r in d['rows']})
            check(f'[{label}] the message column is the third track, not an auto-placed leftover',
                  all(r['mainTrack3'] for r in d['rows'] if r['mainTrack3'] is not None),
                  {r['id']: r['mainTrack3'] for r in d['rows']})
            check(f'[{label}] the two column tokens resolve to the two leading tracks',
                  close(d['gutterTokenPx'], px_of(rest_track['tracks'], 0))
                  and close(d['avatarTokenPx'], px_of(rest_track['tracks'], 1)),
                  [d['gutterTokenPx'], d['avatarTokenPx'], rest_track['tracks']])
            check(f'[{label}] the gutter token is the width of the track it names',
                  close(d['gutterTokenPx'], d['rowExample']['tracks'][0]),
                  [d['gutterTokenPx'], d['rowExample']['tracks']])
            # A token narrow enough for its own stamp to spill is not a
            # broken token (no rule forbids a narrow column) but it IS a
            # broken stamp: "11:12" carries no break opportunity, so a
            # too-narrow gutter does not wrap the time - it paints it
            # across the avatar column. The stamp must fit the column it
            # is written in, which is a LAYOUT fact no source scan states.
            stamped_rows = [r for r in d['rows'] if r['gutter'] and r['gutter']['hasTime']]
            check(f'[{label}] the stamp fits the column it is written in',
                  bool(stamped_rows) and all(r['gutter']['timeW'] is not None
                                             and r['gutter']['timeW'] <= r['gutter']['w'] + TOL
                                             for r in stamped_rows),
                  {r['id']: (r['gutter']['timeW'], r['gutter']['w'])
                   for r in stamped_rows})
            if label == 'phone':
                check('an invisible toolbar does not swallow a click on the row beneath it',
                      d['hit'] and d['hit']['onScreen'] and not d['hit']['inToolbar'], d['hit'])
            # the message column does not move when the toolbar appears
            rest = page.evaluate(HOVER, 'ml1')
            page.hover('[data-message-id="ml1"]')
            page.wait_for_timeout(150)
            hovered = page.evaluate(HOVER, 'ml1')
            check(f'[{label}] hover reveals the toolbar',
                  hovered['opacity'] == '1' and hovered['pe'] == 'auto',
                  [hovered['opacity'], hovered['pe']])
            check(f'[{label}] the reveal moves nothing: text, message column and toolbar track hold',
                  close(hovered['textW'], rest['textW']) and close(hovered['mainX'], rest['mainX'])
                  and close(hovered['actX'], rest['actX']) and close(hovered['actW'], rest['actW']),
                  {k: (rest[k], hovered[k]) for k in
                   ('textW', 'mainX', 'actX', 'actW')})
            # the keyboard door: :focus-within, with the pointer parked away
            page.mouse.move(1, 1)
            page.wait_for_timeout(150)
            away = page.evaluate(HOVER, 'ml1')
            foc = page.evaluate(FOCUS_TOOLBAR)
            check(f'[{label}] focus-within is a second door, with nothing hovered',
                  away['opacity'] == '0' and foc['focused'] and foc['opacity'] == '1'
                  and foc['pe'] == 'auto' and foc['tabIndex'] == 0, [away['opacity'], foc])
            page.mouse.move(1, 1)

            # ---- one stamp per row --------------------------------------
            # Scoped to the rows that are IN the stamp rule: a system row
            # is a full-width marker with no gutter at all, so "one
            # visible stamp" is not a claim about it.
            timed = [r for r in d['rows'] if not r['system']]
            check(f'[{label}] exactly one visible stamp on every row that carries a time',
                  all(r['visibleStamps'] == 1 for r in timed),
                  {r['id']: r['visibleStamps'] for r in d['rows']})
            check(f'[{label}] a continuation row has no header, so its gutter is the stamp it keeps',
                  all(r['grouped'] and r['gutter']['visibility'] == 'visible'
                      and r['gutter']['hasTime'] and r['metaCount'] == 0 for r in grouped),
                  {r['id']: (r['gutter']['visibility'], r['gutter']['hasTime'], r['metaCount'])
                   for r in grouped})
            check(f'[{label}] a stamped row quiets its gutter copy, and keeps the column',
                  all(not r['grouped'] and not r['system'] and r['gutter']['visibility'] == 'hidden'
                      and r['gutter']['w'] > 0 and r['metaCount'] == 1 and r['metaHasTime']
                      for r in plain),
                  {r['id']: (r['gutter']['visibility'], r['gutter']['w'], r['metaCount'])
                   for r in plain})
            check(f'[{label}] the quiet stamp is visibility, not display: the column does not move',
                  all(close(r['gutter']['x'], grouped[0]['gutter']['x'])
                      and close(r['gutter']['w'], grouped[0]['gutter']['w']) for r in plain + grouped),
                  {r['id']: (r['gutter']['x'], r['gutter']['w']) for r in plain + grouped})
            if label == 'phone':
                check('the unread rule is a bar AND a label in words, with no timestamp of its own',
                      d['unread'] and d['unread']['bar'] == '2px' and d['unread']['times'] == 0
                      and len(d['unread']['text'].strip()) >= 3
                      and any(c.isdigit() for c in d['unread']['text']), d['unread'])
            check(f'[{label}] the grouped rows share a message column, not a drifting one',
                  all(close(r['mainX'], grouped[0]['mainX']) for r in grouped),
                  {r['id']: r['mainX'] for r in grouped})
            if label == 'phone':
                check('a continuation row tightens its vertical padding over a plain one',
                      grouped[0]['padBlockStart'] != rows['ml1']['padBlockStart'],
                      {r['id']: r['padBlockStart'] for r in [rows['ml1'], *grouped]})
                check('the day divider is a label between two real hairlines',
                      d['day'] and d['day']['before'] == '""' and d['day']['after'] == '""'
                      and d['day']['beforeBT'] == '1px' and d['day']['afterBT'] == '1px'
                      and float(d['day']['beforeFlex']) > 0, d['day'])

            # ---- the reserved avatar slot, the mention mark --------------
            check(f'[{label}] a continuation row keeps an EMPTY slot the width of the avatar track',
                  bool(grouped) and all(r['avatar'] and r['avatar']['text'] == ''
                                        and r['avatar']['w'] > 0
                                        and close(r['avatar']['w'], px_of(rest_track['tracks'], 1))
                                        for r in grouped),
                  [({r['id']: (r['avatar']['text'], r['avatar']['w']) for r in grouped},
                    px_of(rest_track['tracks'], 1))])
            check(f'[{label}] a real avatar composes .cm-avatar instead of restating it',
                  all(r['avatar'] and r['avatar']['composes']
                      and r['avatar']['text'] != '' for r in plain), 
                  {r['id']: (r['avatar']['composes'], r['avatar']['text']) for r in plain})
            if mention:
                # the mention is a TINT as well as a bar
                check(f'[{label}] a mention is a mark AND a tint, on its own row',
                      mention['borderInlineStart'] == '2px' and mention['bg'] != rows['ml1']['bg']
                      and mention['textLen'] > 10,
                      [mention['borderInlineStart'], mention['bg'], rows['ml1']['bg'],
                       mention['textLen']])
                # ...and the bar does not push its message column
                check(f'[{label}] the mention bar does not push the message column a pixel',
                      all(close(mention['mainX'], r['mainX']) for r in plain),
                      [mention['mainX']] + [r['mainX'] for r in plain])
                # The mark is the INLINE-START edge, which only a right-to-
                # left page can prove: in LTR `border-inline-start` computes
                # identically to `border-left`, so measuring LTR cannot tell
                # the logical spelling from the physical one. Flip the
                # direction and the bar must move to the other side.
                if label == 'phone':
                    page.evaluate("document.documentElement.dir = 'rtl'")
                    page.wait_for_timeout(200)
                    rtl = page.evaluate(MENTION_SIDE, mention['id'])
                    check('the mention bar follows the inline-start edge into RTL',
                          rtl['side'] == 'right' and rtl['padSide'] == 'right', rtl)
                    page.evaluate("document.documentElement.dir = 'ltr'")
                    page.wait_for_timeout(200)
                page.hover('[data-message-id="%s"]' % mention['id'])
                page.wait_for_timeout(150)
                hov = page.evaluate(HOVER, mention['id'])
                check(f'[{label}] the row hover band does not repaint a mentioned row as a plain one',
                      hov['bg'] == mention['bg'], [hov['bg'], mention['bg']])
                page.mouse.move(1, 1)
                page.wait_for_timeout(100)

            # ---- the reactions ------------------------------------------
            counts = [c for r in d['rows'] for c in r['counts']]
            check(f'[{label}] every reaction count is real selectable text',
                  len(counts) >= 3 and all(c.isdigit() for c in counts), counts)
            mine = [r for r in d['rows'] if r['minePressed'] is not None]
            check(f'[{label}] the reader\'s own reaction is marked by a heavier edge, not a hue alone',
                  bool(mine) and all(r['minePressed'] == 'true' and r['mineShadow'] != 'none'
                                     and r['mineBorder'] != r['plainRxBorder'] for r in mine),
                  {r['id']: (r['minePressed'], r['mineShadow'], r['mineBorder'],
                             r['plainRxBorder']) for r in mine})
            check(f'[{label}] a reaction that is not the reader\'s still announces its state',
                  any(r['plainPressed'] == 'false' for r in d['rows']),
                  {r['id']: r['plainPressed'] for r in d['rows']})

            if label == 'phone':
                check('the timeline adds no sideways scroll to the frame',
                      d['overflow'] and d['overflow']['sw'] == d['overflow']['cw'], d['overflow'])
            check(f'[{label}] no page errors in the msglist section', not errors, errors)
            page.close()
        browser.close()
    srv.shutdown()

    ok = sum(1 for _, o in results if o)
    print('---')
    print(f'passed {ok}/{len(results)}')
    if json.dumps([n for n, o in results if not o]) != '[]':
        print('failed: ' + ', '.join(n for n, o in results if not o))
    sys.exit(0 if ok == len(results) else 1)


def px_of(tracks, i):
    if len(tracks) <= i:
        return None
    v = tracks[i]
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v[:-2]) if v.endswith('px') else None
    except ValueError:
        return None


main()
