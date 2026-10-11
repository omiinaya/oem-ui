#!/root/.venvs/mau/bin/python
"""Prove a SCOPED adoption renders `.cm-prose` like a full install.

THE GAP THIS MEASURES
---------------------
`make-scoped-entry.mjs` exists because a Vite/PostCSS consumer cannot import
`base.css` (52 bare-element rules; unlayered CSS outranks every `@layer`). That
consumer gets `components.css` and nothing else.

`.cm-prose` in components.css declares only `color` and `font-size` - every
ACTUAL typographic declaration for prose (heading sizes and rhythm, paragraph
margin, list markers, the table's borders, the `pre > code` block) lives in
base.css as a BARE ELEMENT rule. So a scoped adoption renders an article as
platform-white sans-serif with UA headings and no list markers. That is
exactly why hermes-articles still carries ~120 lines of `.article-content`
forks beside the `cm-prose` class it already adopted.

THE METHOD
----------
Render ONE fixture - the markup a markdown renderer emits, with no classes on
it - twice, at the same widths, in the SAME engine:

  full.html    tokens -> base -> components (the documented install order)
  scoped.html  one file, the real generator's output

Then fingerprint every element's computed style in both and diff. The claim is
EQUALITY: a scoped adoption is supposed to be the same design system, so any
delta is a gap in the scoped entry, not a preference.

Deliberately NOT compared: nothing about the two documents' own `html`/`body`
(a scoped adoption must NOT paint the host page - that is the whole point of
scoping), and nothing outside `.cm-prose`. Only the subtree the class owns.

Usage:  verify-scoped-prose.py [--json OUT] [--verbose]
Exit 0 when every compared property matches, 1 when any differs.
"""
import argparse
import http.server
import json
import pathlib
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WIDTHS = [390, 1280]
HEIGHT = 900

# The markup a markdown renderer emits. NO classes on any of it - that is the
# case base.css exists for, and the case a scoped consumer has to render.
FIXTURE = """
<h1>An h1 heading</h1>
<h2>An h2 heading</h2>
<h3>An h3 heading</h3>
<h4>An h4 heading</h4>
<p>A paragraph with <strong>strong emphasis</strong>, a <code>code span</code>,
a <a href="#x">link</a> and a second sentence so the line wraps at a phone
width rather than fitting on one line.</p>
<blockquote>A blockquote, which is indented with a rule down its start edge.</blockquote>
<pre><code>const a = 1;
const aLongerLine = 'that is wide enough to need the scrollport at 390px';</code></pre>
<ul>
<li>first bullet</li>
<li>second bullet</li>
</ul>
<ol>
<li>first number</li>
<li>second number</li>
</ol>
<table>
<caption>A caption</caption>
<thead>
<tr><th scope="col">Header one</th><th scope="col">Header two</th></tr>
</thead>
<tbody>
<tr><td>cell one</td><td>cell two</td></tr>
<tr><td>cell three</td><td>cell four</td></tr>
</tbody>
</table>
<hr>
<p>After the rule.</p>
<figure><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="a pixel"><figcaption>A caption under it.</figcaption></figure>
"""

# A classed list, inside the same prose subtree: it must keep the host app's
# own styling. This is the counter-example - a rule that only proves markers
# can be ADDED would also pass with a flat `.cm-prose ul`.
COUNTER = """
<ul class="cm-rows">
<li>a classed row</li>
<li>a second classed row</li>
</ul>
"""

FULL_HTML = """<!doctype html><html data-cm-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="full/tokens.css">
<link rel="stylesheet" href="full/base.css">
<link rel="stylesheet" href="full/components.css">
<style>body{margin:0}.host{width:340px;margin:0 auto}</style>
</head><body><div class="host"><div class="cm-prose" id="root" data-cm-theme="dark">%s%s</div></div></body></html>"""

SCOPED_HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="scoped/cm-prose.css">
<style>body{margin:0}.host{width:340px;margin:0 auto}</style>
</head><body><div class="host"><div class="cm-prose" id="root" data-cm-theme="dark">%s%s</div></div></body></html>""" % (
    FIXTURE,
    COUNTER,
)

# Every property family a prose rule in this library can move. A fingerprint
# that omits one is a blind spot the size of that property.
PROPS = [
    "display", "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "lineHeight", "letterSpacing", "textAlign", "textTransform",
    "textDecorationLine", "textWrap", "whiteSpace", "wordBreak",
    "overflowWrap", "color", "backgroundColor", "backgroundImage",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth",
    "borderLeftWidth", "borderTopStyle", "borderRightStyle",
    "borderBottomStyle", "borderLeftStyle", "borderTopColor",
    "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius",
    "borderBottomRightRadius", "borderInlineStartWidth", "paddingTop",
    "paddingRight", "paddingBottom", "paddingLeft", "marginTop",
    "marginRight", "marginBottom", "marginLeft", "width", "height",
    "maxWidth", "minWidth", "maxHeight", "listStyleType", "listStylePosition",
    "verticalAlign", "position", "overflowX", "overflowWrap", "boxSizing",
    "borderCollapse", "opacity", "appearance", "gap", "order", "flexGrow",
]

COLLECT = """() => {
  const root = document.querySelector('#root');
  if (!root) return null;
  const kind = (el) => {
    const parts = [];
    let n = el;
    while (n && n !== root.parentElement && n.nodeType === 1) {
      let s = n.tagName.toLowerCase();
      if (n.id === 'root') break;
      if (n.classList && n.classList.length) {
        s += '.' + Array.prototype.slice.call(n.classList).sort().join('.');
      } else {
        s += ':bare';
      }
      const parent = n.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children,
          (c) => c.tagName === n.tagName && (c.className || '') === (n.className || ''));
        if (sibs.length > 1) s += ':nth' + sibs.indexOf(n);
      }
      parts.unshift(s);
      n = parent;
    }
    return parts.join('>');
  };
  const props = %s;
  const out = {};
  for (const el of root.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName)) continue;
    const key = kind(el);
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of props) {
      const v = cs.getPropertyValue(p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
      rec[p] = /^-?[\\d.]+px$/.test(v) ? v : String(v).replace(/\\s+/g, ' ').trim();
    }
    const r = el.getBoundingClientRect();
    rec['__rect'] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    out[key] = rec;
  }
  return out;
}""" % json.dumps(PROPS)


def build_tree(tmp: Path):
    (tmp / "full").mkdir(parents=True, exist_ok=True)
    (tmp / "scoped" / "cli-mono").mkdir(parents=True, exist_ok=True)
    for f in ("tokens.css", "base.css", "components.css"):
        shutil.copyfile(ROOT / "src" / "styles" / f, tmp / "full" / f)
    shutil.copyfile(ROOT / "src" / "styles" / "components.css",
                    tmp / "scoped" / "cli-mono" / "components.css")
    out = tmp / "scoped" / "cm-prose.css"
    r = subprocess.run(
        ["node", str(ROOT / "scripts" / "make-scoped-entry.mjs"),
         "--out", str(out), "--components", "cli-mono/components.css"],
        capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode != 0:
        print("generator failed:", r.stdout, r.stderr, file=sys.stderr)
        sys.exit(2)
    (tmp / "full.html").write_text(FULL_HTML % (FIXTURE, COUNTER))
    (tmp / "scoped.html").write_text(SCOPED_HTML)


def serve(directory: Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0),
                                   lambda *a, **kw: Quiet(*a, directory=str(directory), **kw))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd.server_address[1]


def run(width, port):
    result = {}
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        ctx = b.new_context(viewport={"width": width, "height": HEIGHT})
        # The house setting: components.css guards motion behind this, and a
        # rect captured mid-transition is a lie.
        ctx.route("**/*", lambda route: route.continue_())
        page = ctx.new_page()
        page.emulate_media(reduced_motion="reduce")
        for name in ("full", "scoped"):
            page.goto(f"http://127.0.0.1:{port}/{name}.html", wait_until="load")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(200)
            result[name] = page.evaluate(COLLECT)
        b.close()
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="cm-scoped-prose-"))
    try:
        build_tree(tmp)
        port = serve(tmp)
        allres = {}
        deltas = []
        for width in WIDTHS:
            res = run(width, port)
            allres[width] = res
            full, scoped = res.get("full") or {}, res.get("scoped") or {}
            only_full = sorted(set(full) - set(scoped))
            only_scoped = sorted(set(scoped) - set(full))
            for k in only_full:
                deltas.append((width, k, "<absent>", "present in full only"))
            for k in only_scoped:
                deltas.append((width, k, "present in scoped only", "<absent>"))
            for k in sorted(set(full) & set(scoped)):
                a, b = full[k], scoped[k]
                for p in PROPS + ["__rect"]:
                    if a.get(p) != b.get(p):
                        deltas.append((width, k, p, f"full={a.get(p)!r} scoped={b.get(p)!r}"))
        print(f"compared {len(PROPS)+1} properties per element, "
              f"widths {WIDTHS}, fixture elements {len(allres[WIDTHS[0]]['full'])}")
        if deltas:
            # Group by property so a single systemic gap reads as one line.
            byprop = {}
            for w, k, p, d in deltas:
                byprop.setdefault(p, []).append((w, k, d))
            print(f"\n{len(deltas)} DELTA(S) across {len(byprop)} property(ies):")
            for p in sorted(byprop):
                items = byprop[p]
                print(f"\n  {p}  ({len(items)} element(s))")
                for w, k, d in items[: (10 if args.verbose else 3)]:
                    print(f"    @{w}  {k}\n          {d}")
                if not args.verbose and len(items) > 3:
                    print(f"    ...and {len(items) - 3} more")
        else:
            print("\nMATCH - a scoped adoption renders the prose subtree identically")
        if args.json:
            Path(args.json).write_text(json.dumps(
                {"deltas": [[w, k, p, d] for w, k, p, d in deltas]}, indent=1))
        return 1 if deltas else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
