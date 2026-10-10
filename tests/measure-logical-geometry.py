#!/root/.venvs/mau/bin/python
"""Geometry baseline for the logical-properties conversion (branch b25-logical).

The claim this file exists to prove: converting physical directional CSS
properties to LOGICAL ones is a NO-OP in an LTR document. Same pixels, to
the pixel. So this records, for every specimen section on the showcase at
five viewport widths:

  - document scrollWidth/scrollHeight
  - for EVERY element: its document-space bounding rect, and the computed
    values of every property family the conversion touches
    (margin/padding left+right, border left+right width+style+color,
    left/right, textAlign)
  - for every element that HAS one: the same computed values for the
    ::before and ::after pseudo-elements - a large share of the converted
    rules live there (rails, separators, grip hairlines, tick marks), and
    a pseudo-element has no getBoundingClientRect, so its computed values
    are the only observable.

Output: one JSON file. Run it twice - before and after - and diff. Any
delta above float slop is a defect in the conversion, not an artifact:
logical properties resolve to the SAME physical property in an LTR
document, so equality is the only acceptable result.

Settling is deliberate: reduced motion (the house 0.01ms trap - the CSS
kills animations but the JS transitions do not die, and a rect captured
mid-transition is a lie), fonts.ready (a font swap reflows every text
box), and cliMono's init (it clamps hovercards by writing inline left).
The page is scrolled to 0,0 first so position:sticky is deterministic.
"""
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WIDTHS = [320, 390, 402, 768, 1280]
HEIGHT = 800

COLLECT = """() => {
	const round = (n) => Math.round(n * 100) / 100;
	const props = [
		'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
		'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
		'borderLeftWidth', 'borderRightWidth', 'borderLeftStyle',
		'borderRightStyle', 'borderLeftColor', 'borderRightColor',
		'left', 'right', 'textAlign', 'insetInlineStart', 'insetInlineEnd',
		'width', 'height', 'position',
	];
	const path = (el) => {
		const parts = [];
		let n = el;
		while (n && n.nodeType === 1 && n !== document.documentElement) {
			let s = n.tagName.toLowerCase();
			if (n.id) { parts.unshift(s + '#' + n.id); break; }
			if (n.classList && n.classList.length) {
				s += '.' + Array.prototype.slice.call(n.classList).sort().join('.');
			}
			const parent = n.parentElement;
			if (parent) {
				const sibs = Array.prototype.filter.call(
					parent.children, (c) => c.tagName === n.tagName);
				if (sibs.length > 1) s += ':nth' + sibs.indexOf(n);
			}
			parts.unshift(s);
			n = parent;
		}
		return parts.join('>');
	};
	const out = { pseudo: {}, els: {} };
	for (const el of document.querySelectorAll('*')) {
		const key = path(el);
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		const rec = {
			r: [round(r.x + scrollX), round(r.y + scrollY), round(r.width), round(r.height)],
			d: {},
		};
		for (const p of props) rec.d[p] = cs.getPropertyValue(
			p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
		out.els[key] = rec;
		for (const pseudo of ['::before', '::after']) {
			const pcs = getComputedStyle(el, pseudo);
			if (pcs.content === 'none' || pcs.content === 'normal') continue;
			const d = {};
			for (const p of props) d[p] = pcs.getPropertyValue(
				p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
			d['display'] = pcs.display;
			out.pseudo[key + pseudo] = d;
		}
	}
	out.doc = {
		scrollWidth: document.documentElement.scrollWidth,
		scrollHeight: document.documentElement.scrollHeight,
		bodyScrollWidth: document.body.scrollWidth,
	};
	return out;
}"""


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        '/root/.hermes/cache/scratch/logical-geometry.json')
    out_path.parent.mkdir(parents=True, exist_ok=True)

    handler = http.server.SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', 0), lambda *a, **kw:
                                   handler(*a, directory=str(ROOT / 'dist'), **kw))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    result = {}
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        try:
            for w in WIDTHS:
                page = b.new_page(viewport={'width': w, 'height': HEIGHT})
                page.emulate_media(reduced_motion='reduce')
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle')
                page.wait_for_function('() => window.cliMono')
                page.evaluate('document.fonts.ready')
                page.evaluate('window.scrollTo(0, 0)')
                page.wait_for_timeout(300)
                data = page.evaluate(COLLECT)
                data['pageErrors'] = errors
                result[str(w)] = data
                print(f'{w}px: {len(data["els"])} elements, '
                      f'{len(data["pseudo"])} pseudos, '
                      f'doc {data["doc"]["scrollWidth"]}x{data["doc"]["scrollHeight"]}'
                      f'{" ERRORS:" + str(errors) if errors else ""}', flush=True)
                page.close()
        finally:
            b.close()
            httpd.shutdown()

    out_path.write_text(json.dumps(result, sort_keys=True))
    print(f'wrote {out_path} ({out_path.stat().st_size} bytes)')


if __name__ == '__main__':
    sys.exit(main())
