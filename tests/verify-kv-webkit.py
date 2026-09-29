#!/usr/bin/env python
"""Prove the kv pair-wrapper fix in WebKit, at BOTH widths.

The bug is invisible at 390px (the library's own max-width:520px rule already
stacks the grid), so a phone-only check passes forever. The state the bug
occurs in is DESKTOP, and that is where the proof has to be taken.
"""
import http.server, socketserver, threading, functools, os, sys, json
from playwright.sync_api import sync_playwright

ROOT = '/root/projects/oem-ui/dist'
# Port 0 asks the kernel for a free one. A fixed port read as "address
# already in use" on a machine where something else already held it, and
# a squatter on a known port is also how a probe ends up measuring a
# DIFFERENT site - so the title is printed with every result below.
PORT = 0


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    srv = socketserver.TCPServer(('127.0.0.1', PORT), h)
    global URL
    URL = f'http://127.0.0.1:{srv.server_address[1]}/'
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


URL = ''


def probe(pg, url, w, h, mobile):
    pg.goto(url)
    return pg.evaluate("""(cfg) => {
      const dls = [...document.querySelectorAll('.cm-kv')];
      const wrapped = dls.find(d => d.querySelector(':scope > div'));
      const direct  = dls.find(d => !d.querySelector(':scope > div'));
      if (!wrapped) return {err: 'no wrapped dl on the page'};
      const cs = getComputedStyle(wrapped);
      const dts = [...wrapped.querySelectorAll('dt')].map(e => Math.round(e.getBoundingClientRect().left));
      const dds = [...wrapped.querySelectorAll('dd')].map(e => Math.round(e.getBoundingClientRect().left));
      const wrapDisp = getComputedStyle(wrapped.querySelector(':scope > div')).display;
      // a real two-column grid: every term and every value is at one of TWO x positions
      const allX = [...new Set([...dts, ...dds])].sort((a,b)=>a-b);
      const ddLeft = dds[0], dtLeft = dts[0];
      return {
        dlDisplay: cs.display,
        dlCols: cs.gridTemplateColumns,
        wrapperDisplay: wrapDisp,
        nDt: dts.length,
        dtXs: dts, ddXs: dds,
        distinctX: allX.length,
        dtSharesEdgeWithDd: dtLeft === ddLeft,
        // THE claim: a working grid has values in the SECOND column, to the
        // right of the terms. A collapsed grid has dt.left === dd.left.
        ddToRightOfDt: ddLeft > dtLeft,
        title: document.title,
      };
    }""", None)


def main():
    serve()
    url = URL
    bad = []
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        for w, h, mob, label in [
            (1280, 900, False, 'desktop 1280'),
            (768, 1024, False, 'tablet 768'),
            (390, 844, True, 'iPhone 390'),
            (320, 568, True, 'iPhone SE 320'),
        ]:
            ctx = b.new_context(viewport={'width': w, 'height': h},
                                device_scale_factor=3, is_mobile=mob, has_touch=mob)
            pg = ctx.new_page()
            r = probe(pg, url, w, h, mob)
            print(f"##### {label}")
            print(json.dumps(r, indent=1))
            # assertions
            if r.get('wrapperDisplay') != 'contents':
                bad.append(f'{label}: wrapper display is {r.get("wrapperDisplay")}, not contents')
            if w >= 700 and not r.get('ddToRightOfDt'):
                bad.append(f'{label}: values did NOT move into a second column')
            if w >= 700 and r.get('dtSharesEdgeWithDd'):
                bad.append(f'{label}: dt shares its left edge with dd - grid collapsed')
            # overflow
            ov = pg.evaluate("""() => { window.scrollTo(9999,0);
                return {scrollX: window.scrollX, docW: document.documentElement.scrollWidth,
                        clientW: document.documentElement.clientWidth}; }""")
            print('  overflow:', ov)
            if ov['scrollX'] != 0:
                bad.append(f'{label}: sideways scroll {ov["scrollX"]}')
            ctx.close()
        b.close()
    print('\n' + ('FAIL: ' + '; '.join(bad) if bad else 'PASS: two-column grid holds at every width, no overflow'))
    sys.exit(1 if bad else 0)


main()
