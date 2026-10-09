"""MEASURE the scoped-entry repair in REAL WebKit, against a real DOM tree
where the scoped entry's `@import "components.css"` actually RESOLVES.

TWO fixture traps, both recorded because each one produced a confident wrong
answer on the first draft of this harness:

1. Loading BOTH scoped entries into ONE document proves nothing. They both
   declare `[data-cm-theme='dark']` at equal specificity, so the SECOND block
   wins for BOTH worlds and every reading is identical - the harness reported
   "0 differences" for a defect that is real. Each world is its OWN page.

2. `page.set_content()` with the scoped entry's text inline cannot resolve its
   `@import`, so no component rule ever loads and every z-index reads `auto` -
   in the REPAIRED file too. That made a fixed file look broken. The harness
   serves a real directory over HTTP with a <link>, so the import is the
   browser's problem and the library's own @import rule is exercised.

The invariant under test, in the order it is asserted:
  - every `--z-*` token the library declares RESOLVES in the scoped subtree;
  - a COMPONENT RULE that CONSUMES one computes a real stacking order
    (`z-index: var(--missing)` is invalid at computed-value time and falls
    back to `auto` silently, so the token alone proves nothing);
  - the sharp-corner radius from e79e3d5 is carried.
"""
import asyncio, functools, http.server, pathlib, socketserver, sys, threading
from playwright.async_api import async_playwright

DOM = pathlib.Path("/root/.hermes/cache/scratch/scopedom")

READ = """() => {
  const root = document.getElementById('world');
  const cs = getComputedStyle(root);
  // NOTE: read the SELECTOR, do not assume the base class owns the token.
  // `--z-toast` is declared on `.cm-toast-region` (components.css:3368), not
  // on `.cm-toast`; `--z-scrim` needs the runtime's `.cm-js` on <html>. An
  // oracle built on the guessed class reports 'auto' on a REPAIRED file and
  // looks like the fix failed.
  html = document.documentElement;
  html.classList.add('cm-js');
  const g = (id) => getComputedStyle(document.getElementById(id)).zIndex;
  return {
    '--z-header':  cs.getPropertyValue('--z-header').trim(),
    '--z-toast':   cs.getPropertyValue('--z-toast').trim(),
    '--z-toolbar': cs.getPropertyValue('--z-toolbar').trim(),
    '--z-scrim':   cs.getPropertyValue('--z-scrim').trim(),
    '--z-drawer':  cs.getPropertyValue('--z-drawer').trim(),
    '--radius':    cs.getPropertyValue('--radius').trim(),
    'toolbar-z':   g('t'),    // .cm-toolbar          -> --z-toolbar
    'toast-z':     g('tr'),   // .cm-toast-region    -> --z-toast
    'header-z':    g('h'),    // .cm-header          -> --z-header
    'scrim-z':     g('sc'),   // .cm-js .cm-nav-scrim-> --z-scrim
  };
}"""

# What src/styles/tokens.css declares today, and what components.css derives.
LIB = {"--z-header": "100", "--z-toast": "200", "--z-toolbar": "10",
       "--z-scrim": "98", "--z-drawer": "99"}
DERIVED = {"toolbar-z": "10", "toast-z": "200"}


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DOM)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


async def read_page(browser, port, which):
    pg = await browser.new_page(viewport={"width": 390, "height": 844})
    await pg.emulate_media(media="screen")
    # waitUntil=networkidle so the @import has landed before the read.
    await pg.goto(f"http://127.0.0.1:{port}/{which}.html", wait_until="networkidle")
    out = await pg.evaluate(READ)
    await pg.close()
    return out


async def main():
    httpd, port = serve()
    try:
        async with async_playwright() as p:
            b = await p.webkit.launch()
            before = await read_page(b, port, "stale")
            after = await read_page(b, port, "fresh")
            await b.close()
    finally:
        httpd.shutdown()

    print("BEFORE (entry generated before the --z-* scale existed):")
    for k, v in before.items():
        print(f"   {k:12s} = {v!r}")
    print()
    print("AFTER (regenerated from tokens.css):")
    for k, v in after.items():
        print(f"   {k:12s} = {v!r}")
    print()

    fails, repros = [], []

    # 1. the tokens resolve at all
    for tok, want in LIB.items():
        if before[tok] == "":
            repros.append(f"before: {tok} resolves to NOTHING in the scoped subtree")
        if after[tok] != want:
            fails.append(f"after: {tok} = {after[tok]!r}, library declares {want!r}")

    # 2. THE CAUSE: a rule that CONSUMES a token computes a real order.
    for key, want in DERIVED.items():
        if before[key] == "auto":
            repros.append(f"before: {key} computes 'auto' - no stacking order at all")
        if after[key] != want:
            fails.append(f"after: {key} = {after[key]!r}, want {want!r}")

    # 3. the radius e79e3d5 changed, carried into the scoped subtree
    if before["--radius"] != after["--radius"]:
        repros.append(f"before: --radius {before['--radius']!r} -> "
                      f"{after['--radius']!r} (e79e3d5 took the rounding out)")
    if after["--radius"] != "0":
        fails.append(f"after: --radius = {after['--radius']!r}, library says '0'")

    for r in repros:
        print("REPRO " + r)
    for f in fails:
        print("FAIL  " + f)
    print()
    print(f"reproduced: {len(repros)}   FAILURES: {len(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))