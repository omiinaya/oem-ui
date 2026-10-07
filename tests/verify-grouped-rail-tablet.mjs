#!/usr/bin/env node
/*
 * A GROUPED rail at tablet width (641-999px) must stay one row.
 *
 * The library's documented tablet shape is a single sideways-scrolling row
 * (components.css, the 641-999 block). `.cm-header--rail .cm-header__group`
 * was unscoped, so every group stayed a COLUMN at every width; inside that
 * row the groups became six side-by-side columns, each up to three 44px links
 * tall, spilling below the 61px bar and painting over the page. Measured in
 * WebKit on spacetime-rpm at 768x844: 7 link rows, links over <main>.
 *
 * The fixture is rpm's markup shape (the documented grouped rail). Asserts:
 *   tablet - every link on ONE row, inside the header box, no group label
 *            showing, no sideways DOCUMENT scroll, header <= 72px
 *   rail   - at 1280 the groups are still labelled columns (the fix must not
 *            dissolve the desktop rail)
 *   phone  - at 390 the opened drawer still shows the group labels
 *
 * Run: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
 *        node tests/verify-grouped-rail-tablet.mjs      (exit 0 = pass)
 * PLAYWRIGHT_BROWSERS_PATH selects the WebKit build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = path.join(REPO, 'src/styles');
const JS = path.join(REPO, 'src/js/cli-mono.js');
const { webkit } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);

const GROUPS = [
  [null, ['Dashboard']],
  ['Hosting', ['Proxy Hosts', 'Redirections', 'Dead Hosts', 'Streams']],
  ['Security', ['Access Lists', 'Certificates']],
  ['Users', ['Users']],
  ['Monitoring', ['Analytics', 'Metrics', 'Audit Log', 'Access Log']],
  ['System', ['Settings', 'Backup', 'Templates']],
];

function fixture() {
  const groups = GROUPS.map(([label, items]) => {
    const lab = label ? `<div class="cm-header__group-label">${label}</div>` : '';
    const links = items.map((i) => `<a class="cm-header__link" href="#${i}">${i}</a>`).join('');
    return `<div class="cm-header__group">${lab}${links}</div>`;
  }).join('');
  // Inlined, not <link>ed: WebKit refuses file:// subresources from a file://
  // page, which loads NO stylesheet and "measures" an unstyled document - a
  // fixture that can only ever agree with itself.
  const css = '<style>' + ['tokens', 'base', 'components']
    .map((f) => fs.readFileSync(`${S}/${f}.css`, 'utf8')).join('\n') + '</style>';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}</head>
<body><div class="cm-shell cm-shell--rail">
<header class="cm-header cm-header--rail" data-cm-header>
 <nav class="cm-header__nav" aria-label="Sections">
  <button class="cm-icon-btn cm-nav-toggle" data-cm-nav-toggle aria-controls="cm-header-links" aria-expanded="false">
   <span class="cm-nav-toggle__bars" aria-hidden="true"><span class="cm-nav-toggle__bar"></span></span>
   <span class="cm-sr-only">Menu</span></button>
  <a class="cm-header__brand" href="#main"><span class="cm-header__name">spacetime-rpm</span></a>
  <div class="cm-header__links" id="cm-header-links" data-cm-nav>${groups}</div>
  <div class="cm-header__controls"><button class="cm-header__link">Sign out</button></div>
 </nav>
</header>
<main id="main"><h1>Proxy Hosts</h1><p>content</p></main>
</div><script>${fs.readFileSync(JS, 'utf8')}</script></body></html>`;
  const f = path.join(process.env.OEM_UI_SCRATCH || os.tmpdir(), 'grouped-rail.html');
  fs.writeFileSync(f, html);
  return 'file://' + f;
}

const MEASURE = () => {
  const r = (e) => e.getBoundingClientRect();
  const hdr = r(document.querySelector('.cm-header'));
  const rules = [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0);
  const links = [...document.querySelectorAll('.cm-header__links .cm-header__link')];
  const labels = [...document.querySelectorAll('.cm-header__group-label')]
    .filter((e) => r(e).height > 0 && getComputedStyle(e).display !== 'none');
  return {
    hdrH: Math.round(hdr.height), rules,
    rows: new Set(links.map((a) => Math.round(r(a).top))).size,
    lefts: new Set(links.map((a) => Math.round(r(a).left))).size,
    escaped: links.filter((a) => { const b = r(a); return b.height > 0 && (b.bottom > hdr.bottom + 0.5 || b.top < hdr.top - 0.5); }).length,
    labels: labels.length,
    docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const url = fixture();
const b = await webkit.launch();
for (const w of [700, 768, 900, 999]) {
  const pg = await b.newPage({ viewport: { width: w, height: 844 } });
  await pg.goto(url);
  const m = await pg.evaluate(MEASURE);
  console.log('tablet', w, JSON.stringify(m));
  // Fixture integrity first: an unstyled page has no rail and no row, and
  // would fail (or pass) for reasons that have nothing to do with the CSS.
  check(m.rules > 100, `${w}px: only ${m.rules} CSS rules loaded - the fixture is unstyled`);
  check(m.rows === 1, `${w}px: links on ${m.rows} rows, want 1`);
  check(m.escaped === 0, `${w}px: ${m.escaped} links painted outside the header box`);
  check(m.labels === 0, `${w}px: ${m.labels} group labels showing in the one-row bar`);
  check(m.docScroll === 0, `${w}px: document scrolls sideways by ${m.docScroll}px`);
  check(m.hdrH <= 72, `${w}px: header ${m.hdrH}px tall, want <= 72`);
  await pg.close();
}
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.goto(url);
  const m = await pg.evaluate(MEASURE);
  console.log('rail 1280', JSON.stringify(m));
  check(m.lefts === 1 && m.rows === 15, `1280px: rail is not one column of 15 (${JSON.stringify(m)})`);
  check(m.labels === 5, `1280px: ${m.labels} group labels on the rail, want 5`);
  await pg.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.goto(url);
  await pg.click('[data-cm-nav-toggle]');
  const m = await pg.evaluate(MEASURE);
  console.log('phone drawer 390', JSON.stringify(m));
  check(m.labels === 5, `390px drawer: ${m.labels} group labels, want 5`);
  check(m.docScroll === 0, `390px: document scrolls sideways by ${m.docScroll}px`);
  await ctx.close();
}
await b.close();
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log(' -', f)); process.exit(1); }
console.log('PASS');
