#!/usr/bin/env node
/*
 * An inline editor that carries its own action must not have the action
 * amputated.
 *
 * `.cm-inline__input { width: 100% }` claims the whole `.cm-inline--wide`
 * box, so a save button sitting after it is pushed past `max-width` —
 * where `.cm-inline { overflow: hidden }` cuts it off. Measured on
 * spacetime-rpm /settings at 1280: the button's right edge is at 1284
 * against clientW 1280, clipped, unreachable, no ancestor scroll — the
 * only way to save a setting was invisible.
 *
 * The fix is scoped to `.cm-inline:has(> .cm-icon-btn)` so the pure
 * display span keeps its block layout (a flex container cannot ellipsize
 * a text node, so making every `.cm-inline` a flex row would quietly
 * trade one defect for another).
 *
 * Fixture is rpm's settings-row markup shape. Asserts:
 *   action - the save button is fully inside the inline box and inside
 *            the viewport, the input still has width, at every width
 *   display - the buttonless `.cm-inline--wide` keeps its ellipsis
 *
 * Run: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
 *        node tests/verify-inline-action.mjs      (exit 0 = pass)
 * PLAYWRIGHT_BROWSERS_PATH selects the WebKit build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = path.join(REPO, 'src/styles');
const { webkit } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);

function fixture() {
  // Inlined, not <link>ed: WebKit refuses file:// subresources from a
  // file:// page, which loads NO stylesheet and "measures" an unstyled
  // document — a fixture that can only ever agree with itself.
  const css = '<style>' + ['tokens', 'base', 'components']
    .map((f) => fs.readFileSync(`${S}/${f}.css`, 'utf8')).join('\n') + '</style>';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}</head>
<body><div class="cm-shell"><main id="main">
<div class="cm-stack">
 <div class="cm-row">
  <div class="cm-row__body"><span class="cm-row__title">lan_networks</span>
   <span class="cm-row__desc">Which requests count as LAN</span></div>
  <div class="cm-inline cm-inline--wide">
   <input class="cm-inline__input" value="192.168.0.0/16, 10.0.0.0/8" aria-label="lan_networks">
   <button class="cm-icon-btn" aria-label="Save lan_networks">S</button>
  </div>
 </div>
 <div class="cm-row">
  <div class="cm-row__body"><span class="cm-row__title">display only</span></div>
  <span class="cm-inline cm-inline--wide">a-very-long-forward-hostname.example.com</span>
 </div>
</div>
</main></div></body></html>`;
  const f = path.join(process.env.OEM_UI_SCRATCH || os.tmpdir(), 'inline-action.html');
  fs.writeFileSync(f, html);
  return 'file://' + f;
}

const MEASURE = () => {
  const r = (e) => e.getBoundingClientRect();
  const box = document.querySelector('.cm-inline--wide');
  const btn = document.querySelector('.cm-inline .cm-icon-btn');
  const input = document.querySelector('.cm-inline__input');
  const display = document.querySelector('.cm-row .cm-inline--wide');
  const rules = [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0);
  const bb = r(btn), cb = r(box);
  return {
    rules,
    btnRight: Math.round(bb.right * 10) / 10,
    boxRight: Math.round(cb.right * 10) / 10,
    btnLeft: Math.round(bb.left * 10) / 10,
    boxLeft: Math.round(cb.left * 10) / 10,
    // fully inside its own container AND inside the viewport
    clipped: bb.right > cb.right + 0.5 || bb.left < cb.left - 0.5,
    offscreen: bb.right > document.documentElement.clientWidth,
    inputW: Math.round(r(input).width),
    displayEllipsis: getComputedStyle(display).textOverflow,
    displayOverflow: getComputedStyle(display).overflow,
  };
};

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const url = fixture();
const b = await webkit.launch();
for (const w of [360, 420, 700, 1280]) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  await pg.goto(url);
  const m = await pg.evaluate(MEASURE);
  console.log('inline', w, JSON.stringify(m));
  // Fixture integrity first: an unstyled page would pass or fail for
  // reasons that have nothing to do with the rule under test.
  check(m.rules > 100, `${w}px: only ${m.rules} CSS rules loaded - the fixture is unstyled`);
  check(!m.clipped, `${w}px: save button spans [${m.btnLeft}..${m.btnRight}] outside its inline box [${m.boxLeft}..${m.boxRight}]`);
  check(!m.offscreen, `${w}px: save button right edge ${m.btnRight} is past the ${w}px viewport`);
  check(m.inputW > 40, `${w}px: the input collapsed to ${m.inputW}px`);
  check(m.displayEllipsis === 'ellipsis', `${w}px: display-only .cm-inline lost its ellipsis (text-overflow: ${m.displayEllipsis})`);
  check(m.displayOverflow === 'hidden', `${w}px: display-only .cm-inline lost overflow: hidden (${m.displayOverflow})`);
  await pg.close();
}
await b.close();
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log(' -', f)); process.exit(1); }
console.log('PASS');
