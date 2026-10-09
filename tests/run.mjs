#!/usr/bin/env node
/**
 * oem-ui contract tests.
 *
 * These are real assertions, not a smoke test: each one FAILS if the
 * library is broken. Run with `npm test`.
 *
 * The CSS checks are structural (tokens declared, components defined,
 * contrast computed from the real hex values in tokens.css). The runtime
 * checks execute the actual cli-mono.js runtime against a minimal fake DOM so a
 * regression in the theme logic fails the build.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, appendFileSync, statSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL_ = String.fromCharCode(10);
const read = (p) => readFileSync(isAbsolute(p) ? p : join(root, p), 'utf8');
// `exists` accepts absolute paths as-is; only relative ones resolve against
// the repo root, so the installer test can point at a temp dir.
const exists = (p) => existsSync(isAbsolute(p) ? p : join(root, p));

let passed = 0;
const failures = [];
const pending = [];

// Checks may be async (installer tests shell out); queue them and drain at
// the end so a slow test does not interleave with the rest of the output.
function check(name, fn) {
	if (fn.constructor.name === 'AsyncFunction') {
		pending.push([name, fn]);
		return;
	}
	try {
		const r = fn();
		if (r === false) throw new Error('returned false');
		passed++;
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures.push([name, e.message]);
		console.log(`FAIL  ${name}\n        ${e.message}`);
	}
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'assertion failed');
}

// Sources the component tests read, stripped of comments once so a note in
// the CSS can never be mistaken for a rule.
const tokenSrc = read('src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');

// Resolve a font-size DECLARATION to a number, following one level of
// var() indirection into tokens.css. Every size rule in the components
// layer now names a scale token rather than a raw rem, so a guard that
// parsed a literal silently stopped testing anything - it reported a
// "missing size" where there was a real rule, and would have passed if
// the rule were deleted. Resolve the value the browser would.
function resolveSize(decl) {
  if (!decl) return null;
  // `max(var(--min-font), var(--text-md))` renders as the SECOND
  // argument at desktop: the first is a floor, and a floor is not the
  // value. Reading the first argument instead reported a size nothing
  // ever paints.
  const fn = /\b(?:max|min|clamp)\(([^()]*)\)/.exec(decl);
  if (fn) return resolveSize(fn[1].split(',').slice(-1)[0].trim());
  // A token may point at another token (`--head-h2: var(--text-md)`).
  // One hop reported a false "no resolvable font-size" on a perfectly
  // valid scale, and the tempting fix - deleting the indirection - is
  // how two sources for one step come to exist. Follow the chain.
  for (let i = 0; i < 8; i++) {
    const v = /var\(\s*(--[a-z0-9-]+)\s*\)/.exec(decl);
    if (!v) break;
    const t = new RegExp(`^\\s*${v[1]}\\s*:\\s*([^;]+);`, 'm').exec(tokenSrc);
    if (!t) return null;
    decl = t[1].trim();
  }
  const m = /([0-9.]+)rem|([0-9.]+)px/.exec(decl);
  if (!m) return null;
  return parseFloat(m[1] ?? m[2]) * (m[1] ? 16 : 1);
}
// The value of a size, in px, from a rule body.
function sizeOf(body) {
  const d = /font-size:\s*([^;}]+)/.exec(body || '');
  return d ? resolveSize(d[1]) : null;
}
const compSrc = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
// Element defaults live in base.css by design - a bare `input` is
// on-brand there, and `.cm-sr-only` is a bare element utility. A
// reachability test that only reads components.css therefore reports
// every base-layer class as unstyled, which is the same false negative
// as a check that reads only the showcase source.
const baseSrc = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
const allCss = compSrc + '\n' + baseSrc;
const showcase = read('src/pages/index.astro');

/* The DECLARATION that rule gives the selector, or null.
   A selector LIST - `.a .b::before, .a .c::before { content: 'x' }` - is one
   rule with two selectors, so a `selector {` regex cannot see it: the comma
   between them is not part of the selector, and the anchored pattern never
   matches either half. That reads as "this variant has no glyph", and it
   costs a full cycle: the alert and toast glyphs were merged into a shared
   selector list, the browser rendered it correctly, and two contract tests
   went red on a perfectly good rule.

   So walk the rule's whole selector LIST, exactly as the variant test
   below already does for the same reason. The class has to be ONE of the
   selectors; that is the whole contract.

   // `want` is a full selector (e.g. '.cm-alert--ok .cm-alert__mark::before'),
      matched as a substring of each trimmed selector, not as a regex, so a
      caller cannot accidentally hand us a pattern with a stray metacharacter.

      `exact` turns that off and compares for EQUALITY instead. The substring
      reading is right for a compound selector and WRONG for a bare one:
      `.cm-btn` is a substring of `.cm-head-row__action .cm-btn`, so asking
      "what does the rule for .cm-btn declare?" returned whatever the
      descendant rule declared, and the answer was confidently about a rule
      the caller never named. Pass exact when `want` is the whole selector. */
   function declForSelector(want, src = compSrc, exact = false) {
     for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
       const hit = m[1].split(',').some((s) => (exact ? s.trim() === want : s.trim().includes(want)));
       if (!hit) continue;
       return m[2];
     }
     return null;
   }

/* The rule that OWNS a property, for an exact bare-element selector.
 *
 * `declForSelector` returns the FIRST matching rule, which is not the same
 * thing. `th, td` is declared before `th`, so the first match for 'th' is
 * the padding rule and the header's weight rule is never seen. Two of the
 * three "element defaults" checks read the wrong rule because of it.
 *
 * In the cascade the value that wins is the one declared LAST at the
 * highest specificity, so this walks every exactly-matching rule in source
 * order and returns the final declaration of `prop` it finds - or null if
 * no matching rule declares it at all (which is the real bug: the value is
 * inherited from the user agent and any reset erases it).
 */
function owningDecl(sel, prop, src = compSrc) {
  let found = null;
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!m[1].split(',').some((s) => s.trim() === sel)) continue;
    const d = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm').exec(m[2]);
    if (d) found = d[1].trim();
  }
  return found;
}

/* ================= contrast math (WCAG 2.1) ================= */
const srgb = (h) => {
	const x = h.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
};
const lum = (h) => {
	const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const [r, g, b] = srgb(h).map(f);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
	const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (l1 + 0.05) / (l2 + 0.05);
};

/* ================= tokens.css ================= */
console.log('\ntokens.css');
const tokens = read('src/styles/tokens.css');
const varOf = (name, block) => {
	// grab the Nth declaration of --name
	const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`, 'g');
	const all = [...tokens.matchAll(re)].map((m) => m[1]);
	assert(all.length >= 2, `--${name} must be declared in both document themes`);
	return block === 'dark' ? all[0] : all[1];
};

check('declares layout tokens once (single content width)', () => {
	const maxw = tokens.match(/--maxw:/g);
	assert(maxw.length === 1, `--maxw declared ${maxw.length}x, want 1`);
});

check('dark is the default theme (no attribute required)', () => {
	assert(/:root,\s*:root\[data-theme='dark'\]/.test(tokens), 'dark must be the :root default block');
});

check('light theme is explicit opt-in via [data-theme=light]', () => {
	assert(/:root\[data-theme='light'\]/.test(tokens), "missing :root[data-theme='light']");
});

for (const theme of ['dark', 'light']) {
	for (const t of ['ink', 'ink-dim', 'ink-faint']) {
		check(`${theme} --${t} passes WCAG AA on every surface`, () => {
			const c = varOf(t, theme);
			const surfaces = theme === 'dark' ? ['#0a0a0a', '#111111', '#161616'] : ['#fafafa', '#f5f5f5', '#ffffff'];
			for (const s of surfaces) {
				const r = contrast(c, s);
				assert(r >= 4.5, `--${t} ${c} on ${s} = ${r.toFixed(2)}:1 (need 4.5)`);
			}
		});
	}
}

/* ================= base.css ================= */
console.log('\nbase.css');
const base = read('src/styles/base.css');
check('reserves the scrollbar gutter on every page', () => {
	assert(/html\s*\{[^}]*overflow-y:\s*scroll/.test(base), 'html must set overflow-y:scroll');
});
check('defines prefers-reduced-motion support', () => {
	assert(base.includes('prefers-reduced-motion'), 'missing reduced-motion block');
});
check('keeps a visible focus indicator', () => {
	assert(/:focus-visible/.test(base) && !/outline:\s*(none|0)\s*;?\s*\}/.test(base.replace(/:focus-visible[^}]*}/g, '')), 'focus outline was removed');
});

/* ================= components.css ================= */
console.log('\ncomponents.css');
const comp = read('src/styles/components.css');
const REQUIRED = [
	'cm-kicker', 'cm-section', 'cm-head', 'cm-byline', 'cm-btn', 'cm-btn--primary',
	'cm-btn--ghost', 'cm-btn-group', 'cm-status', 'cm-list-head', 'cm-rows', 'cm-row',
	'cm-row__idx', 'cm-row__body', 'cm-row__title', 'cm-row__desc', 'cm-row__meta',
	'cm-row__sym', 'cm-list-more', 'cm-prose', 'cm-media', 'cm-cursor', 'cm-rule',
	'cm-term', 'cm-kv', 'cm-tag', 'cm-footer',
];
for (const sel of REQUIRED) {
	check(`defines .${sel}`, () => assert(comp.includes('.' + sel), `missing .${sel}`));
}
check('row title never ellipsizes before the description does', () => {
	const t = comp.match(/\.cm-row__title\s*\{[^}]*\}/)[0];
	const d = comp.match(/\.cm-row__desc\s*\{[^}]*\}/)[0];
	assert(/flex:\s*0 0 auto/.test(t), 'title must be flex:0 0 auto');
	assert(/text-overflow:\s*ellipsis/.test(d), 'description must be the truncating element');
});
check('row body is a flex baseline row (prevents title/desc collision)', () => {
	const b = comp.match(/\.cm-row__body\s*\{[^}]*\}/)[0];
	assert(/display:\s*flex/.test(b) && /align-items:\s*baseline/.test(b), 'row body must flex+baseline');
});

check('pre can never widen the page (narrow-viewport overflow guard)', () => {
	const pre = base.match(/(^|\n)pre\s*\{[^}]*\}/)[0];
	// A long line in a pre inside a flex/grid column must scroll INSIDE the
	// block. Without max-width/min-width the block stretches and the whole
	// document gains horizontal scroll. This was a real 21px overflow at
	// 380px, so it is guarded from here on.
	assert(/overflow-x:\s*auto/.test(pre), 'pre must scroll internally');
	assert(/max-width:\s*100%/.test(pre), 'pre must have max-width:100%');
	assert(/min-width:\s*0/.test(pre), 'pre must have min-width:0');
});
check('header nav can shrink (flex-wrap + min-width:0)', () => {
	// Owned by the shared layer, not the Astro file, so every framework gets it.
	const nav = comp.match(/\.cm-header__nav\s*\{[^}]*\}/)[0];
	// `.cm-header__links { animation: none; }` also exists, in the
	// reduced-motion guard well above the base rule, and a bare
	// match() takes whichever comes first.
	const links = [...comp.matchAll(/\.cm-header__links\s*\{[^}]*\}/g)]
		.map((m) => m[0])
		.find((r) => /flex-wrap|min-width/.test(r));
	if (!links) throw new Error('no base .cm-header__links rule found');
	assert(/flex-wrap:\s*wrap/.test(nav), 'nav must wrap');
	assert(/min-width:\s*0/.test(nav), 'nav needs min-width:0 to shrink');
	assert(/flex-wrap:\s*wrap/.test(links), 'link row must wrap');
	assert(/min-width:\s*0/.test(links), 'link row needs min-width:0 to shrink');
});

/* ================= runtime ================= */
console.log('\nruntime (cli-mono.js)');
const runtimeSrc = read('src/js/cli-mono.js');
check('exposes a global handle', () => assert(/window\.cliMono\s*=/.test(runtimeSrc), 'no window.cliMono'));
check('defaults to dark with no stored preference', () => {
	// Minimal fake DOM. setAttribute writes into `el.attrs`, which is the
	// single place the test reads state back from.
	const el = { attrs: {} };
	const store = {};
	const doc = {
		documentElement: {
			getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
			setAttribute: (k, v) => {
				el.attrs[k] = v;
			},
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: () => {},
		createElement: () => ({ setAttribute() {}, style: {}, classList: { add() {} }, appendChild() {} }),
		readyState: 'complete',
	};
	const ctx = {
		document: doc,
		window: { addEventListener: () => {}, scrollY: 0, innerHeight: 800, requestAnimationFrame: () => {} },
		localStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: (k, v) => {
				store[k] = v;
			},
		},
		navigator: { clipboard: undefined },
		module: { exports: {} },
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	vm.runInContext(runtimeSrc, ctx);

	assert(typeof ctx.window.cliMono === 'object', 'window.cliMono was not set');
	assert(ctx.window.cliMono.getTheme() === 'dark', 'default theme must be dark with no stored pref');
	assert(!('data-theme' in el.attrs), 'dark default must not need a data-theme attribute');

	ctx.window.cliMono.applyTheme('light');
	assert(el.attrs['data-theme'] === 'light', 'applyTheme did not set data-theme');
	assert(store['cm-theme'] === 'light', 'applyTheme did not persist to the cm-theme key');

	// persisted value must survive a "reload" (fresh context, same storage)
	const ctx2 = { ...ctx, window: { addEventListener: () => {} } };
	ctx2.globalThis = ctx2;
	vm.createContext(ctx2);
	vm.runInContext(runtimeSrc, ctx2);
	assert(ctx2.window.cliMono.getTheme() === 'light', 'theme did not survive reload');
});

check('themeInitScript emits a self-contained light-only guard', () => {
	const sandbox = { window: {}, localStorage: { getItem: () => null } };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(runtimeSrc, sandbox);
	const snippet = sandbox.window.cliMono.themeInitScript();
	assert(snippet.includes('cm-theme'), 'snippet must use the cm-theme key');
	assert(snippet.includes('"light"'), 'snippet must only apply light');
	assert(!/\bsrc=/.test(snippet), 'snippet must be inline, not a src reference');
});
check('emits a FOUC guard snippet that only applies saved light', () => {
	// Assert the SNIPPET'S BEHAVIOUR, not its source shape: the guard is
	// executed in a throwaway context and must apply light from whichever
	// key holds a saved value, and must never write to storage or touch
	// anything beyond documentElement.
	// themeInitScript is exposed on the public handle, not the module scope.
	const api = { module: { exports: {} }, window: undefined };
	vm.runInNewContext(runtimeSrc, api);
	const snippet = api.module.exports.themeInitScript();
	assert(typeof snippet === 'string', 'themeInitScript must return a string');
	assert(!/\bsrc=/.test(snippet), 'snippet must be inline, not a src reference');

	const attrs = [];
	const store = { light: 'light', both: 'dark', legacy: 'light' };
	const ctx = {
		localStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: () => { throw new Error('FOUC guard must not write'); },
		},
		document: { documentElement: { setAttribute: (n, v) => attrs.push([n, v]) } },
	};
	for (const [key, expected] of [['current', null], ['light', 'light'], ['both', null], ['legacy', 'light']]) {
		attrs.length = 0;
		const src = api.module.exports.themeInitScript(key);
		vm.runInNewContext(src, ctx);
		const applied = attrs.length ? attrs[0][1] : null;
		assert(
			applied === expected,
			`with key ${key} holding ${JSON.stringify(store[key] ?? null)}, expected ${JSON.stringify(expected)}, applied ${JSON.stringify(applied)}`,
		);
	}
	assert(attrs.every(([n]) => n === 'data-theme'), 'the guard may only touch data-theme');
});

check('a dropdown menu anchors to its trigger, and flips when it will not fit', () => {
	// A `[popover]` lives in the TOP LAYER, whose containing block is the
	// INITIAL CONTAINING BLOCK - never its `.cm-dropdown` parent. So the
	// menu's own `position: absolute; right: 0; top: calc(100% + 4px)` is
	// resolved against the document origin, and the UA's popover default
	// (`inset: 0`) leaves `left: 0` in place, which over-constrains the
	// horizontal pair. MEASURED in WebKit on this repo's own showcase at
	// 390x844 and 1280x900: the "row actions" trigger sat at (40, 25576)
	// and (356, 19116) while its open menu rendered at (0, 848) and
	// (0, 904) - the left edge of the viewport, exactly one viewport
	// height down. CSS has no selector that names the trigger, so the
	// runtime places it: fixed, right-aligned to the trigger, four pixels
	// below it, flipped above when it would leave the viewport.
	//
	// The listener is captured at `document` rather than bound per menu:
	// `toggle` does NOT bubble, and a consumer that re-renders its rows
	// (the hearth console rewrites its <tbody> every 5s) replaces the
	// menu nodes, taking any per-node binding with them.
	const listeners = [];
	const triggers = {};
	const store = {};
	const doc = {
		documentElement: {
			getAttribute: () => null,
			setAttribute: () => {},
			classList: { add() {}, contains: () => false },
		},
		querySelector: (sel) => {
			const m = /^\[popovertarget="(.*)"\]$/.exec(sel);
			return m ? triggers[m[1]] || null : null;
		},
		querySelectorAll: (sel) => sel === '[popovertarget]'
			? Object.keys(triggers).map((id) => ({
				getAttribute: (n) => (n === 'popovertarget' ? id : null),
				// the fake has to expose EVERY method the runtime touches on a
				// trigger: a double that answers only half the wire fails later
				// with "x is not a function" and reads like a runtime bug.
				getBoundingClientRect: (...a) => triggers[id].getBoundingClientRect(...a),
			}))
			: [],
		getElementById: () => null,
		addEventListener: (type, fn, opts) => listeners.push({ type, fn, capture: opts === true }),
		createElement: () => ({ setAttribute() {}, style: {}, classList: { add() {} }, appendChild() {} }),
		readyState: 'complete',
	};
	const winListeners = [];
	const ctx = {
		document: doc,
		window: {
			addEventListener: (t, fn) => winListeners.push([t, fn]),
			removeEventListener: (t, fn) => {
				const i = winListeners.findIndex((x) => x[0] === t && x[1] === fn);
				if (i >= 0) winListeners.splice(i, 1);
			},
			innerWidth: 390,
			innerHeight: 844,
			scrollY: 0,
			requestAnimationFrame: () => {},
		},
		localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
		navigator: { clipboard: undefined },
		module: { exports: {} },
	};
	ctx.globalThis = ctx;
	// A browser exposes requestAnimationFrame as a GLOBAL, not only on
	// window: the pin's frame loop calls it bare, and a context without it
	// throws where the test meant to assert. Scheduled, never invoked - an
	// immediately-recursive rAF would hang the suite.
	ctx.requestAnimationFrame = () => 1;
	ctx.cancelAnimationFrame = () => {};
	vm.createContext(ctx);
	vm.runInContext(runtimeSrc, ctx);

	const toggle = listeners.find((l) => l.type === 'toggle');
	assert(toggle, 'the runtime registers no `toggle` listener');
	assert(toggle.capture, '`toggle` does not bubble: a non-capturing listener at document never fires');
	const scrollCount = () => winListeners.filter(([t]) => t === 'scroll').length;
	// One fake per id, MUTATED between open and close: the real menu is a
	// single element and pins are keyed by element identity (two popovers
	// may be open at once). A factory returning a fresh object per call
	// would make the close path unpin NOTHING - failing for a reason that
	// cannot happen in a browser.
	const fakes = {};
	const pin = (id, top, bottom, open) => {
		triggers[id] = { getBoundingClientRect: () => ({ top, bottom, left: 220, right: 349 }) };
		const fake = fakes[id] || (fakes[id] = {
			id,
			style: {},
			offsetWidth: 192,
			offsetHeight: 171,
			// The real menu is an Element. An empty fake menu still exposes
			// querySelectorAll, even though this anchor test owns no items.
			// `querySelector` too: opening a menu falls back to the first
			// focusable node, and a fake without it throws instead of
			// answering "none".
			querySelectorAll: () => [],
			querySelector: () => null,
			classList: { contains: () => false },
			// Mirror the WIRE, not a guess: the runtime asks POP_SEL, which
			// now names both the menu and the popover card, so a fake that
			// only knows the old single selector silently stops matching and
			// the anchor path never runs.
			matches: (sel) =>
				(typeof sel === 'string' && sel.split(',').some((s) => s.trim() === '.cm-dropdown__menu[popover]'))
					? true
					: fake._open ? sel === ':popover-open' : false,
		});
		fake._open = open;
		return fake;
	};

	const base = scrollCount();
	const below = pin('m-below', 300, 344, true);
	toggle.fn({ target: below });
	assert(below.style.position === 'fixed', 'a top-layer menu cannot be anchored while it is position: absolute');
	assert(below.style.inset === 'auto', 'the stylesheet\'s `right: 0` must be cleared, or left and right fight');
	assert(below.style.left === '157px', `expected right edge aligned at 157px, got ${below.style.left}`);
	assert(below.style.top === '348px', `expected 348px (4px below the trigger), got ${below.style.top}`);
	assert(scrollCount() === base + 1, 'a fixed menu must be re-pinned while the page scrolls under it');

	// The popover card shares this anchoring but takes the OTHER edge: a
	// menu right-aligns to the chevron it hangs from, a card of prose
	// starts at the left edge it was opened from.
	const open2 = true;
	const card = {
		id: 'pop-card',
		style: {},
		offsetWidth: 192,
		offsetHeight: 171,
		querySelectorAll: () => [],
		querySelector: () => null,
		classList: { contains: (c) => c === 'cm-popover' },
		matches: (sel) =>
			(typeof sel === 'string' && sel.split(',').some((x) => x.trim() === '.cm-popover[popover]'))
				? true
				: open2 ? sel === ':popover-open' : false,
	};
	// Placed where it fits: at innerWidth 390 with a 192px card, a trigger
	// whose left edge sits at 220 would (correctly) clamp in to 190 and the
	// assertion would be measuring the clamp, not the alignment.
	triggers['pop-card'] = { getBoundingClientRect: () => ({ top: 120, bottom: 164, left: 60, right: 189 }) };
	toggle.fn({ target: card });
	assert(card.style.left === '60px',
		`a popover card aligns to the LEFT edge of its trigger, got ${card.style.left}`);

	const above = pin('m-above', 700, 744, true);
	toggle.fn({ target: above });
	assert(above.style.top === '525px', `expected 525px (flipped above the trigger), got ${above.style.top}`);
	assert(above.style.left === '157px', `flipping is vertical only; got left ${above.style.left}`);

	toggle.fn({ target: pin('m-above', 700, 744, false) });
	// three menus were open (below, card, above): closing above must drop
	// exactly its own pin. The old single slot released... nothing useful -
	// it had already been evicted by whoever opened last.
	assert(scrollCount() === base + 2,
		'closing one menu must release its own pin and leave the others');
});

/* ================= astro components ================= */
console.log('\nastro components');
// This list is the CONTRACT: every name here is installed into consumers
// by `install.sh --astro` and is asserted to exist on disk below.
//
// It used to be the only place the shipped set was written down, which
// let `CodeBlock.astro` sit in src/astro/ shipping to every consumer with
// no test naming it at all - the file was invisible to the suite, so it
// could have been deleted or emptied and every check would still pass.
// scripts/install.sh now installs whatever is IN the directory, so the
// list has to be derived the other way round or the two drift apart again:
// this check fails when a component exists on disk but is not claimed here.
const astroFiles = ['Head.astro', 'Header.astro', 'HeaderLink.astro', 'Footer.astro', 'PageHead.astro', 'PostHead.astro', 'PostRow.astro', 'StatusStrip.astro', 'Card.astro', 'CodeBlock.astro', 'Meter.astro', 'Stat.astro', 'SectionHead.astro', 'TimelineItem.astro', 'config.ts', 'current.ts'];
for (const f of astroFiles) {
	check(`ships src/astro/${f}`, () => {
		// Assert the file is ON DISK, not merely named in this list. A list
		// entry with a deleted file behind it is the definition of a component
		// nobody can install, and the list itself can never report that.
		const p = join(root, 'src/astro', f);
		assert(existsSync(p), `src/astro/${f} is listed as shipped but does not exist`);
		const s = readFileSync(p, 'utf8');
		assert(s.trim().length > 0, `src/astro/${f} is empty`);
	});
}
check('every component on disk is claimed by the shipped list', () => {
	// The inverse of the check above, and the one that closes the
	// CodeBlock.astro hole: the installer walks the DIRECTORY, so a
	// component nobody listed here is still copied into every consumer -
	// untested, and therefore trusted by nobody.
	for (const f of readdirSync(join(root, 'src/astro'))) {
		if (!/\.(astro|ts)$/.test(f)) continue;
		assert(
			astroFiles.includes(f),
			`src/astro/${f} exists and install.sh --astro will ship it, but no test ` +
				'claims it; add it to astroFiles so it is asserted to be non-empty',
		);
	}
});
check('--astro installs every file the components IMPORT, not just the .astro files', () => {
	// The bug this closes shipped in the same release as `current.ts`.
	// Header.astro and HeaderLink.astro both do
	//     import { isCurrentPage } from './current';
	// and the installer's loop matched `*.astro config.ts`, so it copied
	// both components and NOT the module they import. Every green signal
	// agreed the installer worked:
	//
	//   - `ls` succeeded and the installer exited 0,
	//   - check-design-sync.sh reported the consumer IN SYNC,
	//   - the consumer's `astro build` was green.
	//
	// The build is green for the worst possible reason: an unresolvable
	// import only fails when something imports that component, so a site
	// that had not yet adopted <Header> never compiled it. The library's
	// flagship component - the one carrying the measured 18x44 tap floor and
	// the phone burger - could not actually be installed and used, while
	// every check said it was fine.
	//
	// So assert the CLOSURE, derived from the source: parse every relative
	// import out of every file the installer copies, and require each one to
	// exist in the installed tree. Listing current.ts by hand would pass
	// again the moment the next shared helper landed, which is the same
	// hand-kept list that caused this.
	const dir = mkdtempSync(join(tmpdir(), 'oemui-closure-'));
	try {
		const r = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--astro'], {
			encoding: 'utf8',
		});
		assert(r.status === 0, `install.sh --astro exited ${r.status}: ${r.stderr}`);

		const shipped = readdirSync(join(root, 'src/astro')).filter((f) =>
			/\.(astro|ts)$/.test(f),
		);
		const missing = [];
		for (const f of shipped) {
			const src = readFileSync(join(root, 'src/astro', f), 'utf8');
			// Relative specifiers only. `astro/types` and `lucide` resolve
			// from node_modules and are the consumer's business, not ours.
			for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
				const spec = m[1];
				// Resolution must mirror Vite's, not string concatenation.
				// `import './config'` is a real, WORKING import - the module is
				// `config.ts` - so `join(...,'./config')` misses it and this
				// check would report a defect that does not exist. Strip any
				// explicit extension, drop a Vite `?raw` suffix, then accept
				// the specifier if ANY candidate extension resolves.
				const clean = spec.replace(/\?.*$/, '').replace(/\.(astro|ts|js)$/, '');
				const cands = [clean, `${clean}.ts`, `${clean}.astro`, `${clean}.js`];
				const resolved = cands.find((c) => existsSync(join(root, 'src/astro', c)));
				if (!resolved) {
					missing.push(`${f} imports '${spec}' but nothing resolves it in src/astro`);
					continue;
				}
				const installed = join(dir, 'src/astro', resolved);
				assert(
					existsSync(installed),
					`install.sh --astro copied ${f}, which imports '${spec}' (${resolved}), but ` +
						`did NOT install that file. A component that cannot resolve its own import is ` +
						`unbuildable in every consumer that adopts it.`,
				);
			}
		}
		assert(
			missing.length === 0,
			`the library itself has unresolved relative imports:\n  ${missing.join('\n  ')}`,
		);
		// And the specific regression, named, so the failure is legible even
		// if someone later loosens the closure walk above.
		assert(
			existsSync(join(dir, 'src/astro', 'current.ts')),
			'install.sh --astro did not install src/astro/current.ts, which Header.astro ' +
				'and HeaderLink.astro both import',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
check('install.sh can actually install the components', () => {
	// The claim this cycle rests on. Before --astro existed, install.sh
	// installed five CSS/JS files and NOTHING from src/astro, so a
	// consumer had no supported way to obtain the components its own
	// vendored stylesheet was written to style - and hand-rolled a
	// parallel implementation instead. Assert the flag exists AND that it
	// produces real files, because a flag that parses and installs nothing
	// reports success.
	const inst = read('scripts/install.sh');
	assert(/--astro\)/.test(inst), 'install.sh has no --astro flag');
	const dir = mkdtempSync(join(tmpdir(), 'oemui-astro-'));
	try {
		const r = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--astro'], {
			encoding: 'utf8',
		});
		assert(r.status === 0, `install.sh --astro exited ${r.status}: ${r.stderr}`);
		// The two components whose fixes are the measured ones, plus the
		// config a consumer must be able to edit.
		for (const f of ['Header.astro', 'Footer.astro', 'HeaderLink.astro', 'config.ts']) {
			const p = join(dir, 'src/astro', f);
			assert(existsSync(p), `--astro did not install src/astro/${f}`);
			assert(
				readFileSync(p, 'utf8').trim().length > 0,
				`--astro installed an empty src/astro/${f}`,
			);
		}
		// Without --astro nothing is installed, so the flag is what does it.
		const bare = mkdtempSync(join(tmpdir(), 'oemui-bare-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), bare], { encoding: 'utf8' });
			assert(
				!existsSync(join(bare, 'src/astro', 'Header.astro')),
				'install.sh without --astro also wrote src/astro; the flag would prove nothing',
			);
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
check('--astro never overwrites the consumer\'s own site identity', async () => {
	// The asymmetry, and it has to be asymmetric. A .astro copy is a
	// vendored artifact: re-syncing it is the whole point, and drift is a
	// bug. config.ts is the one file the consumer OWNS - it holds the
	// site's own title, author and email. An installer that overwrote it
	// would republish the library's placeholder identity over a real site
	// on the next routine sync, and nothing would say so.
	//
	// So: components are overwritten, config.ts is kept, and the skip is
	// REPORTED by name rather than happening silently.
	const dir = mkdtempSync(join(tmpdir(), 'oemui-cfg-'));
	try {
		spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--astro'], {
			encoding: 'utf8',
		});
		const cfg = join(dir, 'src/astro/config.ts');
		const MINE = 'export const SITE = { title: "not-the-library" };\n';
		writeFileSync(cfg, MINE);

		// A component edit MUST be reverted: that is the vendored contract.
		const hdr = join(dir, 'src/astro/Header.astro');
		writeFileSync(hdr, 'EDITED BY CONSUMER\n');
		const r = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--astro'], {
			encoding: 'utf8',
		});
		assert(r.status === 0, `second install exited ${r.status}: ${r.stderr}`);
		assert(
			readFileSync(hdr, 'utf8') === readFileSync(join(root, 'src/astro/Header.astro'), 'utf8'),
			'--astro did not re-sync an edited component; a vendored copy that is never ' +
				'overwritten is a fork, and a fork is what this flag exists to remove',
		);
		assert(
			readFileSync(cfg, 'utf8') === MINE,
			'--astro OVERWROTE the consumer\'s config.ts, destroying its site identity',
		);
		// And the skip is visible, so "the installer ran" never reads as
		// "the installer overwrote my site".
		assert(
			/KEPT/.test(r.stdout),
			'--astro kept config.ts silently; the operator must be able to see that a file was spared',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
check('config.ts is the single site-identity source', () => {
	const c = read('src/astro/config.ts');
	for (const k of ['title', 'description', 'author', 'email', 'github', 'url']) {
		assert(c.includes(k), `config.ts missing ${k}`);
	}
});
check('Header hardcodes no site identity (all from props/config)', () => {
	const h = read('src/astro/Header.astro');
	assert(!/omiinaya|mrxlab/.test(h), 'Header must not hardcode identity');
});
check('Head ships the FOUC guard before the stylesheet', () => {
	const h = read('src/astro/Head.astro');
	// Compare positions in the *markup*, ignoring comments, so a comment
	// that merely mentions the word "stylesheet" cannot fail this test.
	const markup = h.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '');
	const guard = markup.indexOf('set:html={guard}');
	const sheet = markup.indexOf('rel="stylesheet"');
	assert(guard !== -1, 'Head.astro missing theme guard');
	assert(guard < sheet, `FOUC guard must precede the stylesheet link (guard@${guard}, sheet@${sheet})`);
	assert(/stylesHref\s*&&\s*<link/.test(markup), 'stylesheet must be prop-driven, not hardcoded');
});

/* The guard is inlined into <head> verbatim, and the HTML parser ends a
   script element at the first closing tag sequence it sees WHETHER OR NOT
   IT SITS INSIDE A JAVASCRIPT COMMENT.

   That is not hypothetical. The first version of the shared guard
   documented its own usage by writing the closing tag literally in the
   header comment. The build succeeded, all 269 contract tests passed, and
   the consumer shipped NO GUARD AT ALL: the parser cut the file at the
   comment, so what reached dist/ was a truncated comment with the entire
   code body missing. Every green signal agreed and the page was broken -
   the exact failure mode this repo keeps rediscovering, and the reason
   this asserts on the BUILT output.

   The same applies to an HTML comment opener, which a parser can treat as
   legacy script-data escaping. Neither sequence may appear anywhere in
   the file, comment included, and `docs` is proven by a mutation. */
check('the shared guard carries no sequence that can close its own script tag', () => {
	const src = read('src/js/cli-mono-theme-guard.js');
	const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

	// The code body must actually be here, and must be a real IIFE that
	// ends in its own invocation. A file that is nothing but comments
	// passes a "no bad sequence" test while shipping no guard at all -
	// which is precisely how the first version slipped through.
	assert(/\(function\s*\(\)\s*\{/.test(code),
		'the guard file must contain an executable IIFE, not only prose');
	assert(code.trimEnd().endsWith('})();'),
		'the guard must end by invoking itself, or nothing runs before first paint');
	for (const probe of ['data-cm-theme-key', 'data-cm-theme-legacy', 'localStorage.getItem']) {
		assert(code.includes(probe),
			`the guard body must read ${probe}; a comment mentioning it proves nothing`);
	}

	// The whole file, comments included. This is the check that would have
	// caught the shipped bug.
	for (const [what, seq] of [
		['a script-closing tag', '</script'],
		['a script tag', '<script'],
		['an HTML comment opener', '<!--'],
		['an HTML comment closer', '-->'],
	]) {
		assert(!src.toLowerCase().includes(seq),
			`the guard file contains ${what} ("${seq}"). Inlined into <head> the HTML parser ` +
				'stops there, comment or not, and the page silently loses the guard. ' +
				'Describe the tag in prose, never spell it.');
	}
});

check('the guard file is the one the installer and the drift checker ship', () => {
	// Three hand-maintained lists have to agree, and a disagreement is
	// silent: a consumer is told to copy a file the installer never
	// installs, or a fix lands in a file no consumer is compared against.
	const inst = read('scripts/install.sh');
	const sync = read('scripts/check-design-sync.sh');
	assert(/cli-mono-theme-guard\.js/.test(inst),
		'install.sh must install the guard, or a consumer cannot obtain it');
	assert(/src\/js\/cli-mono-theme-guard\.js:/.test(sync),
		'check-design-sync.sh must compare the guard, or a copy drifts silently');
});

/* A component that emits a class the stylesheet never defines is the
   renamed-without-selector bug from the migration notes, one level up:
   the markup and the stylesheet are two hand-maintained lists and
   nothing compared them. <PostHead> shipped `cm-post-head` for months
   with no rule behind it, and the showcase never rendered <PostHead>,
   so the build never compiled it either. Both the audit's dead-class
   list and this test see it; this one runs in CI.

   Both directions, because the one that actually bites is a class in
   the MARKUP with no selector. A selector with no element is merely
   unused, which the showcase may legitimately exercise later.

   "Defined" means the class is the SUBJECT of a rule that declares
   something, not merely a name appearing somewhere in a selector. The
   first cut of this test used a bare `/\.cm-[\w-]+/g` and the mutation
   caught it: `.cm-post-head .cm-kicker { ... }` mentions the class, so
   deleting `.cm-post-head { ... }` entirely left the name in the sheet
   and the suite stayed green. A class named in only a DESCENDANT rule
   styles nothing when it is the element. The subject must be followed by
   its own declaration block. */
check('every class a shipped component emits is defined in the CSS', () => {
	const sheets = comp + '\n' + read('src/styles/base.css');
	const defined = new Set();
	for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const body = m[2].trim();
		// An empty block styles nothing either.
		if (!body) continue;
		for (const sel of m[1].split(',')) {
			// The subject is the compound selector's own class list, i.e.
			// the classes after the last descendant combinator.
			const subject = sel.trim().split(/\s+|>|\+|~/).pop() || '';
			for (const c of subject.matchAll(/\.((?:cm|data-cm)-[a-z0-9_-]+)/g)) {
				defined.add(c[1]);
			}
		}
	}
	const seen = new Map();
	for (const f of astroFiles) {
		if (!f.endsWith('.astro')) continue;
		let src = read(join('src/astro', f));
		// Only the MARKUP can be audited. A scoped <style> block is that
		// component's own CSS and may legitimately define its own classes;
		// the frontmatter builds class names from props and cannot be
		// audited by reading text at all.
		const cut = src.indexOf('<style');
		if (cut !== -1) src = src.slice(0, cut);
		for (const m of src.matchAll(/class(:list)?[=\s]*[\[{'"]([^\]}'"]+)[\]}'"]/g)) {
			for (const cls of m[2].split(/[\s'"]+/).filter(Boolean)) {
				if (/^cm-[a-z0-9_-]+$/.test(cls)) seen.set(cls, f);
			}
		}
	}
	assert(seen.size > 20, `the scan found only ${seen.size} classes — the regex is broken, not the library`);
	assert(defined.size > 20, `the scan found only ${defined.size} defined classes — the parser is broken, not the library`);
	for (const [cls, file] of seen) {
		assert(
			defined.has(cls),
			`${file} emits "${cls}" but no stylesheet declares a rule whose subject is that class (dead class: builds, ships, renders, styles nothing)`,
		);
	}
});

check('the showcase is LAN-reachable, not localhost-only', () => {
	// Astro defaults to 127.0.0.1, which refuses connections from a
	// phone or laptop on the LAN. The bind must be explicit in BOTH the
	// config and the npm scripts, or one of them silently loses it.
	const cfg = read('astro.config.mjs');
	assert(/host:\s*true/.test(cfg), 'astro.config.mjs must set server.host = true');
	const pkg = JSON.parse(read('package.json'));
	assert(/-host\s+0\.0\.0\.0|--host\b/.test(pkg.scripts.dev), 'dev script must pass --host');
	assert(
		/-host\s+0\.0\.0\.0|--host\b/.test(pkg.scripts.preview),
		'preview script must pass --host',
	);
});

check('form controls are element defaults, so a bare input is on-brand', () => {
	const comp = read('src/styles/components.css');
	// 59 files across the fleet use an <input>; none of them had a class on
	// it. If these are scoped to .cm-* they would still re-declare the field.
	const b = read('src/styles/base.css');
	const formBlock = b.slice(b.indexOf('form controls'));
	assert(formBlock.length > 400, 'form defaults are not in the base layer');
	for (const sel of ["input:not([type='checkbox'])", 'textarea', 'select']) {
		assert(formBlock.includes(sel), `${sel} has no base default`);
	}
	// the tap target, inherited rather than opt-in
	const coarse = b.slice(b.indexOf('pointer: coarse'));
	for (const sel of ['input', 'textarea', 'select']) {
		assert(new RegExp(`^\\s*${sel},?$`, 'm').test(coarse.split('@media')[0] + coarse)
			|| coarse.includes(`${sel},`), `${sel} missing from the coarse-pointer block`);
	}
	// never below the type floor, and never below 16px on iOS (it zooms)
	const fsz = formBlock.match(/font-size:\s*([^;]+)/);
	assert(fsz && fsz[1].includes('--min-font'), 'form text is not floored at --min-font');
	// aria-invalid must OUTSPECIFY the base input rule. The base uses :not()
	// three times and :not() counts its argument, so it lands at (0,3,1);
	// a plain [aria-invalid] is (0,1,1) and silently loses. Assert the counts.
	const spec = (sel) => (sel.match(/:not\(/g) || []).length
		+ (sel.match(/\[[^\]]+\]/g) || []).length;
	const baseSel = "input:not([type='checkbox']):not([type='radio']):not([type='range'])";
	// parse the real rule block. Strip comments first: the doc note above the
	// rule mentions the selector in prose, and matching that yields garbage.
	const invRule = (formBlock.replace(/\/\*[\s\S]*?\*\//g, '')
		.match(/[^{}\n]*\[aria-invalid='true'\][^{]*\{[^}]*\}/g) || []).join('\n');
	assert(invRule.length > 0, 'no aria-invalid rule found');
	const invSel = (invRule.match(/^[^{}\n]*/) || [''])[0].split(',')[0].trim();
	assert(invSel.length > 0, `could not parse the invalid selector from: ${invRule.slice(0, 80)}`);
	assert(spec(invSel) >= spec(baseSel),
		`aria-invalid specificity ${spec(invSel)} < base ${spec(baseSel)}: the invalid state never applies (${invSel})`);
	// and the state is visible without relying on hue (the palette is grey)
	assert(/border-width:\s*2px/.test(invRule), 'invalid state has no non-hue cue');

	// The floor and the tap block must key off the SAME condition. The
	// floor was width-based (max-width: 680px) and the tap block is
	// pointer-based, so a touch tablet in landscape got 44px targets and
	// 11px text. Found by adopting the library in oem/links.
	const floorQuery = (comp.match(/@media ([^{]+)\{\s*\n\s*\.cm-status__label/) || [])[1];
	assert(floorQuery, 'cannot find the mobile type floor media query');
	assert(/pointer:\s*coarse/.test(floorQuery),
		`the type floor keys off "${floorQuery.trim()}" but the tap block uses pointer:coarse — a landscape tablet would get big targets and tiny text`);
	assert(/max-width/.test(floorQuery),
		'the type floor should also apply on a narrow desktop window');

	// the components layer owns the layout, the base layer owns the control
	for (const sel of ['.cm-field', '.cm-field__label', '.cm-form__actions']) {
		assert(comp.includes(sel), `${sel} is missing from the components layer`);
	}
	// and the showcase proves they render
	const idx = read('src/pages/index.astro');
	assert(idx.includes('id="forms"'), 'showcase has no forms section');
	assert(/<input[^>]*type="checkbox"/.test(idx), 'showcase renders no checkbox');
	assert(/<textarea/.test(idx), 'showcase renders no textarea');
	assert(/<select/.test(idx), 'showcase renders no select');
});

/* ================= the select class and the element default are one product ================= */

check('.cm-select draws its arrow from a gradient, so it needs no image or icon font', () => {
	const body = (compSrc.match(/\.cm-select\s*\{([^}]*)\}/) || [, ''])[1];
	assert(body, '.cm-select is not defined in the components layer');
	// An arrow made of an image would need a second asset per theme; a
	// gradient in `currentColor` repaints with the ink. Assert the
	// currentColor, not merely a background-image: a two-hex gradient
	// would be a rebrand bug that survives every shape-shaped check.
	//
	// The two wedges are two `linear-gradient()` calls on ONE declaration,
	// so the value is read as a whole and each wedge is matched on its own.
	// A `[^)]*` up to `currentColor` CANNOT work here: `50%` and
	// `currentColor` both live inside the first `linear-gradient(...)`, so
	// the lazy run stops at the gradient's own closing paren.
	const arrow = (body.match(/background-image:\s*([^;]+);/) || [, ''])[1];
	assert(arrow, '.cm-select declares no background-image, so it has no arrow at all');
	assert(/linear-gradient\(45deg,\s*transparent 50%,\s*currentColor 50%\)/.test(arrow),
		'the left wedge of the chevron is missing or is not in currentColor');
	assert(/linear-gradient\(135deg,\s*currentColor 50%,\s*transparent 50%\)/.test(arrow),
		'the right wedge of the chevron is missing — one gradient is half a chevron');
	assert(!/#[0-9a-f]{3,8}\b/i.test(body), '.cm-select hardcodes a colour');
	assert(!/url\(/.test(body), '.cm-select loads an arrow image; currentColor is the point');
	// the clearance, from the token that owns it
	assert(/padding-right:\s*var\(--space-7\)/.test(body),
		'the value runs under the wedges without padding-right clearance');
});

check('the element default and the class agree, or a full and a scoped adoption differ', () => {
	// `.cm-select` exists because a SCOPED adoption gets components.css and
	// cannot import base.css. Two copies of one widget is a smell; two
	// copies held together by a test is the `.cm-surface` pattern.
	// Only the properties that define the ARROW are compared: the class
	// additionally declares the surface it would otherwise inherit, and
	// asserting those are equal would be asserting the base layer away.
	//
	// Each selector below is matched as a RAW pattern (they carry `:not()`
	// and attribute quotes that no class-name escaping could survive), so
	// the bodies are pulled with explicit regexes rather than by name.
	const bodiesOf = (src, re) => [...src.matchAll(re)].map((m) => m[1]);
	// The element selector is NOT a bare `select` any more: it repeats the
	// field block's two exclusions so its `padding-right` can win the tie at
	// (0,2,1) and beyond, plus `:not([multiple])` so a list box is not a
	// picker at the ELEMENT level either. A test that still watched
	// `^\s*select\s*{` would report the rule gone while it sat right there -
	// the same shape as the `(?::not\(...\))*` typo this repo already paid
	// three rebuild cycles for, and the same shape that cost this cycle
	// another rebuild when the pattern trailed one clause behind the CSS.
	// So the trailing group is a REPEATED group, each with its own colon,
	// and the matches are counted: a SECOND arrow rule is itself a failure.
	const bareBodies = bodiesOf(baseSrc,
		/(?:^|\n)select:not\(\.cm-search__input\):not\(\.cm-inline__input\)(?::not\([^)]*\))*\s*\{([^}]*)\}/g);
	assert(bareBodies.length === 1,
		`expected exactly one arrow rule in base.css, found ${bareBodies.length}`);
	const bare = bareBodies[0];
	// A list box is not a picker, and this half is asserted at the ELEMENT
	// level as well as on the class: the (0,2,1) element rule reaches a
	// `<select multiple>` that carries no class at all, which is why it was
	// forced onto the list box the moment the specificity was fixed.
	assert(/:not\(\[multiple\]\)/.test(
		(baseSrc.match(/(select:not\(\.cm-search__input\):not\(\.cm-inline__input\)[^{]*)\{/) || [, ''])[1]),
		'the arrow rule must exclude [multiple] at the element level, or every list box wears a chevron it cannot use');
	const cls = (compSrc.match(/\.cm-select\s*\{([^}]*)\}/) || [, ''])[1];
	assert(cls, 'components.css has no .cm-select rule');
	// The class and the element default must not drift. Only the arrow
	// geometry is compared pairwise there; the FULL-element agreement is
	// asserted below, because the class now restates the element defaults
	// for the SCOPED case and a divergence would mean a consumer's select
	// changes appearance depending on how it installed the library.
	for (const prop of ['background-image', 'background-position', 'background-size',
		'background-repeat', 'padding-right']) {
		const of = (b) => (b.match(new RegExp(prop + ':\\s*([^;]+);')) || [, ''])[1].replace(/\s+/g, '');
		assert(of(bare) && of(bare) === of(cls),
			`${prop} differs between the bare select and .cm-select — a full and a scoped adoption would paint different arrows`);
	}
	// ...and the class restates the ELEMENT DEFAULTS too, because a scoped
	// adoption gets no base.css. That restatement is the whole reason the
	// class is not just an arrow, so each one is checked against the base
	// block it mirrors: a divergence here is a select that looks different
	// depending on how the consumer installed the library.
	const restated = [
		['font-family', /font-family:\s*var\(--font-mono\)/, /font-family:\s*var\(--font-mono\)/],
		['font-size', /font-size:\s*max\(var\(--min-font\),\s*1rem\)/, /font-size:\s*max\(var\(--min-font\),\s*1rem\)/],
		['colour', /color:\s*var\(--ink\);/, /color:\s*var\(--ink\);/],
		['fill', /background-color:\s*var\(--bg-2\)/, /background-color:\s*var\(--bg-2\)/],
		['border', /border:\s*1px solid var\(--line\)/, /border:\s*1px solid var\(--line\)/],
		['radius', /border-radius:\s*var\(--radius-sm\)/, /border-radius:\s*var\(--radius-sm\)/],
		['tap floor', /min-height:\s*var\(--tap\)/, /min-height:\s*var\(--tap\)/],
		['line-height', /line-height:\s*1\.5/, /line-height:\s*1\.5/],
	];
	const fieldBlockFull = bodiesOf(baseSrc,
		/(?:^|\n)select:not\(\.cm-search__input\)\s*\{([^}]*)\}/g)[0];
	assert(fieldBlockFull, 'the shared field block was not found for the restatement check');
	for (const [what, inBase, inClass] of restated) {
		assert(inBase.test(fieldBlockFull),
			`base.css no longer declares ${what} on the field block; this check is watching the wrong rule`);
		assert(inClass.test(cls),
			`.cm-select does not restate ${what}, so a SCOPED adoption renders a different control than a full one`);
	}
	// The bird's-eye complement of the pairwise loop above: EVERY declaration
	// the class makes that base.css also places on a select must agree in
	// value. The arrow geometry is in that set and is compared fuzzy there;
	// exact-string disagreement on it here would be a false failure, so it is
	// the one exception, named rather than silently skipped.
	for (const decl of cls.matchAll(/([a-z-]+):\s*([^;]+);/g)) {
		const [prop, value] = [decl[1], decl[2].replace(/\s+/g, '')];
		if (prop.startsWith('background-') && /gradient|calc\(|rem/.test(value)) continue;
		if (['display', 'width', 'max-width'].includes(prop)) continue; // the class sizes itself
		const mirror = (fieldBlockFull.match(new RegExp(prop + ':\\s*([^;]+);')) || [, ''])[1]
			.replace(/\s+/g, '');
		if (!mirror) continue; // base.css does not place this property on a select
		assert(mirror === value,
			`.cm-select declares ${prop}: ${value} but the base select rule declares ${mirror} — a full and a scoped adoption would paint different controls`);
	}
	// `appearance: none` is the ARROW rule's own declaration, not the field
	// block's, so it is asserted there - and it is the single most important
	// restatement of the lot: without it a scoped consumer keeps the native
	// widget AND paints the gradient, and the control shows TWO chevrons.
	assert(/-webkit-appearance:\s*none;/.test(bare),
		'base.css no longer suppresses the native widget; this check is watching the wrong rule');
	assert(/-webkit-appearance:\s*none;/.test(cls) && /appearance:\s*none;/.test(cls),
		'.cm-select must suppress the native widget itself — a SCOPED adoption gets no base.css, so without it the control paints the platform chevron AND the gradient');
	// The invariant, and the half that makes it real: the arrow is not a
	// separate rule a (0,0,1) selector can lose. In base.css the shared
	// field block has to fill with `background-color`, because the
	// `background` SHORTHAND resets `background-image` and the field block
	// outranks the bare `select` rule.
	// MEASURED in WebKit at 390px and 1280px before this fix: the select
	// computed `appearance: none` with `background-image: none`, so the
	// library had removed the native arrow and painted nothing.
	const fieldBodies = bodiesOf(baseSrc,
		/(?:^|\n)select:not\(\.cm-search__input\)\s*\{([^}]*)\}/g);
	assert(fieldBodies.length === 1,
		`expected exactly one shared field block carrying select, found ${fieldBodies.length}`);
	const fieldBlock = fieldBodies[0];
	assert(/background-color:\s*var\(--bg-2\)/.test(fieldBlock),
		'the field block must fill with background-COLOR — the `background` shorthand resets background-image and silently eats the select arrow');
	assert(!/(?:^|[\s;])background:\s/.test(fieldBlock),
		'the field block uses the `background` shorthand, which resets the arrow to none');
});

check('a list box drops the chevron and a picker keeps it', () => {
	// The pair is the invariant: an arrowless picker and a list box wearing
	// an arrow are the same bug in opposite directions, and a test that
	// checks one half passes whichever way round it is broken.
	const multi = (compSrc.match(/\.cm-select--multi\s*\{([^}]*)\}/) || [, ''])[1];
	assert(multi, '.cm-select--multi is not defined');
	assert(/background-image:\s*none/.test(multi),
		'a multi-select opens no popup, so a chevron is a control that does nothing');
	assert(/overflow-y:\s*auto/.test(multi),
		'a list box taller than its own box must scroll, or its later options are unreachable');
	// ...and BOTH halves demonstrated on the one page.
	const idx = read('src/pages/index.astro');
	assert(/<select[^>]*class="cm-select"\s*>/.test(idx),
		'the showcase never demonstrates a plain picker with .cm-select, so the arrow is unproven');
	assert(/<select[^>]*class="cm-select cm-select--multi"[^>]*\bmultiple\b/.test(idx),
		'the showcase demonstrates no multiple select wearing the modifier, so the list-box half is unproven');
});

check('the install docs only promise paths that actually work', () => {
	const readme = read('README.md');
	// The repo is private and unpublished, so raw.githubusercontent and npm
	// both 404. Documenting them as the install path ships a silent no-op.
	const shell = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Layers'));
	// A curl inside a ```bash fence is a prescription; the same string in
	// prose ("returns 404") is a warning. Only flag fenced shell lines.
	const fences = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
	const prescribesCurl = fences.some(b => /curl[^|]*raw\.githubusercontent/.test(b));
	assert(!prescribesCurl,
		'Install prescribes a curl from raw.githubusercontent (404 while private)');
	const npmLine = /npm i oem-ui/.test(shell);
	assert(npmLine === false || /not available|404|unpublished/i.test(shell),
		'Install recommends `npm i oem-ui` without saying it is unpublished');
	// The installer is the real path, and it must exist and be executable.
	assert(/scripts\/install\.sh/.test(shell), 'Install does not mention scripts/install.sh');
	assert(exists('scripts/install.sh'), 'scripts/install.sh is missing');
	assert(/^#!/.test(read('scripts/install.sh')), 'install.sh has no shebang');
	// The default branch is master; docs pointing at `main` 404 even once public.
	assert(!/githubusercontent\.com\/omiinaya\/cli-mono\/main\//.test(readme),
		'README points at branch `main` but the default branch is `master`');
});

check('the installer lands byte-identical files in a fixed layout', async () => {
	// Run the real installer into a temp dir and diff against the source.
	const dir = mkdtempSync(join(tmpdir(), 'cm-install-'));
	try {
		const r = spawnSync('bash', [join(root, 'scripts/install.sh'), dir], { encoding: 'utf8' });
		assert(r.status === 0, `installer exited ${r.status}: ${r.stderr}`);
		for (const f of ['tokens.css', 'base.css', 'components.css']) {
			const got = join(dir, 'src/styles/cli-mono', f);
			assert(exists(got), `${f} not installed at the documented path`);
			assert(read(got) === read(`src/styles/${f}`), `${f} differs from source`);
		}
		const js = join(dir, 'src/js/cli-mono.js');
		assert(read(js) === read('src/js/cli-mono.js'), 'cli-mono.js differs from source');

		// --flat is what a plain HTML project uses; it must not nest under src/.
		const flat = mkdtempSync(join(tmpdir(), 'cm-flat-'));
		try {
			const r2 = spawnSync('bash', [join(root, 'scripts/install.sh'), flat, '--flat'],
				{ encoding: 'utf8' });
			assert(r2.status === 0, `flat install exited ${r2.status}: ${r2.stderr}`);
			assert(exists(join(flat, 'cli-mono/tokens.css')), '--flat put CSS in the wrong place');
			assert(exists(join(flat, 'cli-mono.js')), '--flat put JS in the wrong place');
		} finally { rmSync(flat, { recursive: true, force: true }); }
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

check('checkbox and radio rows are real tap targets, and on-brand', () => {
	// The drawn box is ~17px because appearance:none removes the native
	// control. That is fine for a MARK, but the tap target is the label.
	// Measured on a phone: without min-height the whole row is 17px.
	const comp = read('src/styles/components.css');
	const labelRule = /\.cm-field label\s*\{([^}]*)\}/.exec(comp);
	assert(labelRule, '.cm-field label rule is missing (checkbox rows lose their tap target)');
	assert(/min-height:\s*var\(--tap\)/.test(labelRule[1]),
		'.cm-field label has no min-height: var(--tap) — the checkbox row is not a 44px target');

	// appearance:none drops the native widget AND its font, so the box
	// silently falls back to Arial in an all-mono design system.
	const base = read('src/styles/base.css');
	const boxRule = /input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{([^}]*)\}/.exec(base);
	assert(boxRule, 'checkbox/radio rule not found in base.css');
	assert(/font-family:\s*var\(--font-mono\)/.test(boxRule[1]),
		'checkbox/radio do not inherit the mono font — they fall back to Arial');
});

check('the demo form does not mix checkbox and radio in one fieldset', () => {
	// A fieldset is one question. Showing "listed in nav" (checkbox) beside
	// "public" (radio) implied a relationship that does not exist.
	const page = read('src/pages/index.astro');
	for (const fs of page.matchAll(/<fieldset[^>]*>([\s\S]*?)<\/fieldset>/g)) {
		const types = new Set([...fs[1].matchAll(/type="(checkbox|radio)"/g)].map(m => m[1]));
		assert(types.size <= 1,
			`a fieldset mixes ${[...types].join(' and ')}; split it into two questions`);
	}
});

check('a fieldset with a choice must have a legend', () => {
	// An unlabelled radio group is unusable with a screen reader; the
	// legend is what names the question.
	const page = read('src/pages/index.astro');
	for (const fs of page.matchAll(/<fieldset([^>]*)>([\s\S]*?)<\/fieldset>/g)) {
		if (!/type="(checkbox|radio)"/.test(fs[2])) continue;
		assert(/<legend(?:\s|>)/.test(fs[2]),
			`a fieldset with choices has no <legend>: ${fs[1].trim().slice(0, 60)}`);
	}
});

check('the page has ONE left rail, shared by chrome and content', () => {
	// main carries max-width:calc(100% - 2*gutter), which already reserves
	// the gutter. Adding horizontal padding on top put content at 40px while
	// the header sat at 20px — two rails, and every section inherits it.
	const base = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of base.matchAll(/(?:main|\.cm-shell)[^{]*\{([^}]*)\}/g)) {
		assert(!/padding:[^;]*var\(--gutter\)/.test(m[1]),
			'main/.cm-shell re-adds horizontal gutter padding on top of max-width');
	}
});

check('the house corner tokens and component declarations stay sharp', () => {
	const tokens = read('src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const name of ['radius', 'radius-sm']) {
		assert(new RegExp(`--${name}:\\s*0(?:[a-z]+)?\\s*;`).test(tokens),
			`--${name} must remain zero (sharp)`);
	}
	for (const path of ['src/styles/base.css', 'src/styles/components.css']) {
		const css = read(path).replace(/\/\*[\s\S]*?\*\//g, '');
		// Circular radios, loading spinners and the traffic lights retain a
		// circle because their geometry carries meaning - the traffic lights
		// are the macOS window identity, and squaring them (e79e3d5 did) was
		// reported as broken. Everything else, including focus marks, should
		// take the zero-valued token or declare zero directly.
		const circular = path.endsWith('base.css')
			? ['input[type=\'radio\']'] : ['.cm-spinner', '.cm-term__dot'];
		for (const rule of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
			if (!/border-radius\s*:/.test(rule[2])) continue;
			const selectors = rule[1].trim();
			const circularRule = circular.some(s => selectors === s || selectors === s.replaceAll("'", '"'));
			for (const decl of rule[2].matchAll(/border-radius\s*:\s*([^;]+);/g)) {
				if (circularRule) continue;
				// A shorthand with several values must be checked value by value.
				const values = decl[1].trim().split(/\s+/);
				assert(values.every(v => /^(?:0(?:[a-z]+)?|var\(--radius(?:-sm)?\))$/.test(v)),
					`${path}: ${selectors} rounds a corner: ${decl[1]}`);
			}
		}
	}
});

check('the macOS traffic lights are circles, not squares', () => {
	// Reverses e79e3d5, which swept them into the sharp-corner rule and
	// turned three round window controls into three square boxes - the
	// one regression on this page a token-level guard cannot catch,
	// because `border-radius: 0` is what the guard demands.
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = [...comp.matchAll(/([^{}]*)\{([^}]*)\}/g)]
		.map(m => ({ sels: m[1].split(',').map(s => s.trim()), body: m[2] }))
		.find(r => r.sels.includes('.cm-term__dot'));
	assert(rule, 'no rule with selector exactly `.cm-term__dot` found');
	assert(/border-radius:\s*4px\s*;/.test(rule.body),
		`.cm-term__dot must be a 4px circle on its 8px box; found: ` +
		(/border-radius:[^;]*;/.exec(rule.body)?.[0] ?? 'no declaration'));
	// and the window chrome must still ship all three of them
	const page = read('src/pages/index.astro');
	const bar = [...page.matchAll(/<div class="cm-term__bar">[\s\S]*?<\/div>/g)]
		.find(b => (b[0].match(/cm-term__dot/g) || []).length >= 3);
	assert(bar, 'the terminal window must still show three traffic lights');
});

check('the showcased radius values match the sharp tokens', () => {
	const page = read('src/pages/index.astro');
	const rows = [...page.matchAll(/<span class="cm-spec__label"><code>(--radius(?:-sm)?)<\/code><\/span>([\s\S]*?)<\/div>/g)];
	assert(rows.length === 2, `expected both radius specimens, got ${rows.length}`);
	for (const [, name, body] of rows) {
		assert(/<span class="cm-spec__val"><code>0px · sharp<\/code><\/span>/.test(body),
			`${name} claims rounded corners while the token is zero`);
	}
});

check('.cm-btn has a SHARP corner, matching the original cli-mono shape', () => {
	// Reverses ecd1e42 (2026-10-02), which gave .cm-btn var(--radius-sm)
	// to match the inputs. Reversed on request 2026-10-05: square is the
	// intended shape here, not an unstyled button that missed its CSS.
	//
	// This check exists because NOTHING pinned that radius when it
	// flipped - the suite stayed green on the rounded version, so the
	// preference lived only in a commit message. Comments are stripped
	// first: the note above names `border-radius: 0` in prose, and a raw
	// scan would trip on its own documentation.
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	// Scope to the rule whose selector list contains EXACTLY `.cm-btn`.
	// `.cm-btn--primary` and `.cm-btn:hover` are separate rules and must
	// not be able to satisfy this on behalf of the base rule.
	const rule = [...comp.matchAll(/([^{}]*)\{([^}]*)\}/g)]
		.map(m => ({ sels: m[1].split(',').map(s => s.trim()), body: m[2] }))
		.find(r => r.sels.includes('.cm-btn'));
	assert(rule, 'no rule with selector exactly `.cm-btn` found');
	const found = /border-radius:[^;]*;/.exec(rule.body)?.[0] ?? 'no border-radius declaration';
	// A zero LENGTH is what sharp means. Asserting the literal `0` would
	// reject `0px` / `0rem`, which are equally sharp and which a future
	// edit could legitimately pick up from a token - the guard would fail
	// on a correct implementation, and a guard that fails on the right
	// answer gets deleted rather than fixed. (Measured: `0px` DID fail a
	// literal-`0` version of this check.)
	assert(/(^|[;\s{])border-radius:\s*0(?:[a-z]+)?\s*;/.test(rule.body),
		`.cm-btn must be sharp (a zero-length border-radius); found: ${found}`);
	assert(!/border-radius:\s*var\(/.test(rule.body),
		`.cm-btn must not take a radius token; found: ${found}`);
});

check('a padded section does not also carry the heading top margin', () => {
	// Padding plus an h2's own margin-top put the heading 65px below the
	// card border against 17.6px of padding, so the padding was invisible.
	const comp = read('src/styles/components.css');
	assert(/\.cm-section--pad\s*>\s*:first-child\s*\{\s*margin-top:\s*0/.test(comp),
		'padded sections do not collapse the first heading margin');
});

check('wrapped text hangs under the text, not under the marker', () => {
	// A ::before bullet is part of the text run, so a wrapped line snapped
	// back to the container edge and ran UNDER the bullet: measured the
	// second line 15px left of the first.
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	// There are TWO .cm-status__value rules (color, then the indent). A
	// single non-global regex matched the first and never saw the second.
	const rules = [...comp.matchAll(/\.cm-status__value\s*\{([^}]*)\}/g)].map(m => m[1]);
	assert(rules.length > 0, '.cm-status__value rule missing');
	const hanging = rules.some(r => /padding-left:[^;]*em/.test(r) && /text-indent:\s*-[^;]*em/.test(r));
	assert(hanging,
		'status value has no hanging indent — a wrapped line runs back under the bullet');
});

check('wrapping never breaks an identifier in half', () => {
	// overflow-wrap:anywhere split ".cm-*" mid-token and also changed
	// min-content sizing, which starved the value column.
	const comp = read('src/styles/components.css');
	assert(!/overflow-wrap:\s*anywhere/.test(comp),
		'overflow-wrap:anywhere breaks identifiers mid-token (and starves the column)');
	// The chip is the label and the annotation the detail; inline, the
	// annotation wrapped into the chip and read as a new value.
	assert(/\.cm-kv dd code\s*\{[^}]*display:\s*block/.test(comp),
		'kv chip does not become a block on narrow screens, so annotations wrap into it');
});

/* ---------- the pair wrapper ----------
   A <div> between the <dl> and its <dt>/<dd> is valid HTML and is the
   natural way to give a row a control of its own, but it is a grid
   ITEM, so it takes a cell and the two-column grid is gone. Measured
   in WebKit on oem-portfolio /certs at 1280px: three wrapped pairs
   laid out 2-across with every dt sharing its left edge with its own
   dd. At 390px the library's own max-width:520px rule already stacks
   the grid, so the bug is invisible on a phone - which is why the
   check has to be about the DECLARATION and not about a narrow
   viewport measurement.

   Three things have to hold, and each is a separate way to be wrong:

   1. the wrapper is neutralised, by the CHILD combinator. A descendant
      selector (`.cm-kv div`) would also match a <div> nested inside a
      <dd> - a value containing a rich block - and flatten that too,
      which is a different and much worse bug. So the `>` is asserted,
      not assumed.
   2. it is `display: contents`, not `display: block` (no change) and
      not `display: none` (which would delete the rows from the
      accessibility tree along with the layout).
   3. a margin is NOT added on a box that no longer exists. A
      `display: contents` element generates no box, so a margin on it
      is a declaration that cannot paint: it reads like a spacing
      decision and does nothing.
*/
check('a wrapped dt/dd pair stays in the two-column kv grid', () => {
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');

	// 2. a descendant rule would be the same declaration applied to a
	//    <div> nested inside a <dd>, which is a different element with
	//    a different job. Reject it by name, in ADDITION to the combinator
	//    check above, and SEPARATELY from it: when the child rule is
	//    deleted, assertion 1 fires first and these two are never reached,
	//    so the mutation that swaps `>` for a space is caught by the wrong
	//    check and the wrong message. Scanning for a descendant selector
	//    FIRST makes each mutation land on its own claim.
	assert(!/\.cm-kv\s+div\b/.test(comp),
		'.cm-kv must not flatten a div nested inside a value - only a direct pair wrapper');
	assert(!/\.cm-kv\s+span\b/.test(comp),
		'.cm-kv must not flatten a span nested inside a value - only a direct pair wrapper');

	// 1. the child combinator, on a selector that is its own rule. With
	//    nothing above able to fire, this is now reachable on its own.
	const rule = /\.cm-kv\s*>\s*(div|span)\s*\{([^}]*)\}/.exec(comp);
	assert(rule, '.cm-kv neutralises its pair wrapper with a > child selector, not a descendant one');
	const body = rule[2];

	assert(!/display:\s*none/.test(body),
		'the pair wrapper is neutralised, not removed - display:none hides the row from assistive tech too');
	assert(!/display:\s*block/.test(body),
		'display:block leaves the wrapper a grid item and the two-column grid never renders');
	// Each declaration is checked by its PROPERTY name, not by a line
	// anchor. The first version used `^\s*margin` with the `m` flag,
	// which anchors to the start of a LINE, and the whole body is one
	// line beginning `display: contents;` - so a margin added to the end
	// of it was invisible and the mutation read as a pass. The property
	// name has to be found wherever it sits in the body.
	const props = body.split(';')
		.map((d) => d.split(':')[0].trim())
		.filter(Boolean);
	assert(!props.some((prop) => /^margin(-|$)/.test(prop)),
		'a display:contents wrapper generates no box, so a margin on it is dead CSS');
	assert(/display:\s*contents\s*;/.test(body),
		'a wrapped pair is taken out of the kv grid layout');
});

check('the showcase demonstrates a wrapped kv pair beside a direct one', () => {
	// Presence in the markup is not demonstration: the wrapped list has
	// to be rendered NEXT TO a direct one in the same state, or a
	// screenshot at a phone width shows two identical stacked lists and
	// proves nothing.
	//
	// Scope to THIS block before asserting anything. The showcase has
	// other `<dl class="cm-kv">` lists (the layer list in foundation,
	// the one inside the split aside), and a search over the whole file
	// silently satisfies itself from one of those - the first version of
	// this check did exactly that and failed on its own fixture, which
	// is the only reason it was caught. The block runs from its own
	// heading to the next heading of the same level.
	const show = read('src/pages/index.astro');
	const start = show.indexOf('key-value, wrapped pairs');
	assert(start !== -1, 'the showcase has no section demonstrating wrapped dt/dd pairs');
	const end = show.indexOf('<h3 class="cm-kicker', start + 10);
	const block = show.slice(start, end === -1 ? show.length : end);

	assert(/<dl class="cm-kv">\s*<dt>/.test(block),
		'the showcase shows a direct dt/dd kv list, as the control for the wrapped one');
	assert(/<dl class="cm-kv">\s*<div>\s*<dt>/.test(block),
		'the showcase never demonstrates a wrapped dt/dd pair, so the fix is unproven');
	// A specimen in the wrong state is GREEN, BUILT, and INVISIBLE: both
	// specimens have to sit inside the SAME .cm-split, because that is
	// what puts them side by side above 700px. Two lists in two separate
	// sections compare nothing.
	assert((block.match(/<div class="cm-split">/g) || []).length === 1,
		'both kv specimens must share one .cm-split, or they cannot be compared side by side');
	const splitAt = block.indexOf('<div class="cm-split">');
	const nKv = (block.match(/<dl class="cm-kv">/g) || []).length;
	assert(nKv === 2 && block.lastIndexOf('<dl class="cm-kv">') > splitAt,
		'the direct and the wrapped kv list must both live inside that one .cm-split');
});

/* ---------- the kv row that is the whole link ----------
   Promoted from oem-portfolio, which had this in its own stylesheet
   while the library owned the grid underneath it. The migration half of
   the increment: the pattern now has one home, and the consumer's copy
   is deleted rather than left to drift.

   Every assertion here is mutation-checked in tests/mutate-kv-link.mjs.
*/
check('the whole-row kv link reaches the tap floor from the token', () => {
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');

	// The rule has to exist as its own rule. A bare `.cm-kv--link`
	// substring is satisfied by the comment above it and by the media
	// query, so the anchor is the selector list.
	const rule = /(^|[},])\s*\.cm-kv--link a\s*\{([^}]*)\}/m.exec(comp);
	assert(rule, 'the library does not style the link inside a whole-row kv');
	const body = rule[2];

	// The floor comes from the token. A literal 44px measures the same
	// and is a rebrand bug the moment a consumer retunes --tap.
	assert(/min-height:\s*var\(--tap\)/.test(body),
		'the whole-row kv link must reach the tap floor from var(--tap), not a literal');
	assert(!/min-height:\s*\d/.test(body),
		'a hardcoded min-height would survive a consumer retuning --tap');

	// It must be a GRID, or it stops being a two-column list and the
	// term and the value stack with no way back.
	assert(/display:\s*grid/.test(body),
		'the link owns the two columns itself - a block link collapses the kv grid');
	assert(/grid-template-columns:\s*minmax\(/.test(body),
		'the link must declare the term/value column split');

	// The padding/margin cancellation. Both or neither: padding alone
	// pushes the text away from the term above it, and a negative
	// margin with no padding grows the hit area into the row above.
	assert(/padding:\s*var\(--space-2\)/.test(body),
		'the row needs padding to be a comfortable target');
	assert(/margin:\s*calc\(var\(--space-2\)\s*\*\s*-1\)/.test(body),
		'the padding must be cancelled by an equal negative margin, or the text drifts');
});

check('the whole-row kv link is not a second grid owner', () => {
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');

	// The variant must neutralise the base grid, because the grid moves
	// DOWN onto the link. Leaving `display:grid` on the <dl> makes the
	// pair wrapper a grid item again - the exact bug the pair-wrapper
	// rule above documents, reintroduced through the front door.
	const block = /(^|[},])\s*\.cm-kv--link\s*\{([^}]*)\}/m.exec(comp);
	assert(block, 'the library never neutralises .cm-kv for the whole-row variant');
	assert(/display:\s*block/.test(block[2]),
		'the whole-row variant must take the base kv grid out of the layout - the link owns the columns');

	// Spacing between rows belongs to the pairs. `> div` and not a
	// descendant: a descendant also matches a div nested inside a dd.
	assert(!/\.cm-kv--link\s+div\b/.test(comp),
		'row spacing must use a child selector, or a div inside a value gets a margin too');
	assert(/\.cm-kv--link\s*>\s*div\s*\{/.test(comp),
		'the whole-row variant has no child-combinator rule for its pairs');
});

check('the whole-row kv link keeps a term reading as a term', () => {
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');

	// The link must not paint the whole row as one word. Without a
	// per-part colour the term and the value become the same ink and the
	// list stops scanning - this is the one case where the fix for the
	// tap target can cost the thing the component is for.
	assert(/\.cm-kv--link\s+dt\s*\{[^}]*color:/.test(comp),
		'the term in a whole-row kv keeps its own colour, or the row reads as one word');
	assert(/\.cm-kv--link\s+dd\s*\{[^}]*color:/.test(comp),
		'the value in a whole-row kv keeps its own colour');

	// The focus ring. The row is focusable - it is an <a> - so a keyboard
	// user needs to see which row they are on. The first version of this
	// check asserted only that a `:hover` selector exists, which the
	// background rule satisfies on its own: deleting the entire
	// focus-visible block left the suite green. This has to name the
	// property, in a focus-visible rule, or it is decoration.
	//
	// EVERY focus-visible rule, not the first. There are two - the shared
	// background and the outline - and a single non-global regex matches
	// the first, which is the one with no outline in it. That is the
	// ordering trap: the check was green against a rule that could never
	// satisfy it. Same shape as the anchor-count bug below.
	const focusRules = [...comp.matchAll(/\.cm-kv--link a:focus-visible\s*\{([^}]*)\}/g)].map((m) => m[1]);
	assert(focusRules.length > 0, 'the whole-row kv link has no focus-visible rule, so a keyboard user cannot see the row they are on');
	assert(focusRules.some((b) => /outline:/.test(b)),
		'the focused whole-row kv row must paint a visible outline');
	assert(focusRules.some((b) => /outline-offset:/.test(b)),
		'a focus outline drawn outside the row is cut off by the row above it');

	// And the hover state has to move BOTH parts, or hovering lights up
	// half a row and the other half looks broken.
	assert(/a:hover\s+dt/.test(comp),
		'hovering a whole-row kv must also lift the term out of its faint colour');
	assert(/a:hover\s+dd/.test(comp),
		'hovering a whole-row kv must also lift the value');
});

check('the showcase demonstrates a whole-row kv link', () => {
	// Presence is not demonstration, and neither is the wrong markup:
	// the <a> has to WRAP the dt/dd, because the entire point is that
	// the target is the row. A class on the dd, or an <a> inside the
	// dd, builds, renders, and is exactly the bug this component fixes.
	const show = read('src/pages/index.astro');
	const start = show.indexOf('key-value, whole row is the link');
	assert(start !== -1, 'the showcase has no section demonstrating a whole-row kv link');
	const end = show.indexOf('<h3 class="cm-kicker', start + 10);
	const block = show.slice(start, end === -1 ? show.length : end);

	assert(/<dl class="cm-kv cm-kv--link">/.test(block),
		'the specimen does not carry the variant class alongside the base');

	// EVERY anchor, not just the first one. A block-level check for
	// "some anchor wraps a dt" is satisfied by the two rows that were left
	// alone while the third was rewritten into the bug - the first
	// version of this check did exactly that and the mutation survived.
	// So the anchors are counted against the rows and EACH one's content
	// is inspected.
	const anchors = block.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
	assert(anchors.length >= 2, 'the specimen demonstrates a single row, which proves nothing about a list');
	const rows = (block.match(/<div>/g) || []).length;
	assert(anchors.length === rows,
		'every row in the whole-row kv specimen must be a link, or the untested ones are the ones that break');
	for (const a of anchors) {
		const inner = a.replace(/<a\b[^>]*>/, '').replace(/<\/a>$/, '');
		assert(/^\s*<dt>/.test(inner),
			'the link must wrap the dt, or the tap target is the term alone and 14px tall');
		assert(/<dd>/.test(inner),
			'the link must wrap the dt AND the dd, or only half the row is a target');
	}
	// A real href, not a placeholder: an <a> with no href is not focusable
	// and not a target, so the specimen would demonstrate nothing.
	assert(!/<a href="#"/.test(block), 'the kv link specimen has a placeholder href, which is not a link');
});

check('the whole-row kv link is not re-implemented in a consumer', () => {
	// The whole point of promoting the pattern. oem-portfolio shipped it
	// under its own names, and the audit found those names WEARING the
	// library's reserved .cm- prefix from a consumer stylesheet - a
	// cascade race waiting to happen, and invisible to every check the
	// library can run about itself.
	//
	// Scoped to the consumer's OWN layer. The vendored library copy
	// legitimately defines the class, so an unscoped scan would find the
	// origin and pass forever. Same reason: scanning the consumer's
	// `cli-mono/` directory would find the library's own definition.
	const globalCss = '/root/projects/oem-portfolio/src/styles/global.css';
	if (!exists(globalCss)) return; // consumer absent: nothing to claim
	const css = read(globalCss);

	assert(!/\.cm-kv--link/.test(css),
		'oem-portfolio still ships its own copy of the whole-row kv link; it must use the library class');

	// The reserved prefix. What makes a consumer .cm-* rule a DEFECT is
	// not that it uses the prefix - restyling a library part
	// (`.cm-footer__meta a`, which this file legitimately does) is an
	// override and is allowed - it is that the consumer DEFINES a name
	// the library does not own. Then the same .cm-* selector lives in
	// two files and which one wins is a question of import order nobody
	// wrote down.
	//
	// Comments are stripped first: the note above this section names the
	// retired classes on purpose, and a check that matches its own
	// documentation is the same failure as one that never fires. (It
	// fired on exactly that during this cycle - the first version read
	// the comment the migration left behind and reported the migration
	// itself as a violation.)
	//
	// The names come from the LIBRARY's own rules, walked selector by
	// selector: a `.cls {` substring search is satisfied by a compound
	// selector and by the class name inside a comment.
	const libCss = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const owned = new Set();
	for (const m of libCss.matchAll(/(^|[},])\s*([^{}@]+?)\s*\{/g)) {
		for (const sel of m[2].split(',')) {
			for (const c of sel.matchAll(/\.(cm-[\w-]+)/g)) owned.add(c[1]);
		}
	}
	const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const intruders = new Set();
	for (const m of cssNoComments.matchAll(/(^|[},])\s*([^{}@]+?)\s*\{/g)) {
		for (const sel of m[2].split(',')) {
			for (const c of sel.matchAll(/\.(cm-[\w-]+)/g)) {
				if (!owned.has(c[1])) intruders.add(c[1]);
			}
		}
	}
	assert(intruders.size === 0,
		`oem-portfolio defines .cm-* names the library does not own: ${[...intruders].join(', ')} - the .cm- prefix is reserved`);

	// The MARKUP half, and this is the direction that actually bites.
	// Deleting the consumer's rules left `.cm-kv__pair` in the page
	// styling nothing: the build stayed green, every class string was
	// still present in the HTML, and the list silently lost whatever
	// those rules were doing. A class in markup whose rule is gone is
	// the same defect as a rule whose class was renamed, one repo over.
	//
	// `class="..."` is parsed and split on whitespace, never matched
	// with \b: `_` is a word character, so /\bcm-kv__pair\b/ cannot match
	// inside a LONGER name and would silently pass.
	const certs = '/root/projects/oem-portfolio/src/pages/certs.astro';
	if (exists(certs)) {
		const used = new Set();
		for (const attr of read(certs).matchAll(/class="([^"]*)"/g)) {
			for (const c of attr[1].split(/\s+/)) if (c) used.add(c);
		}
		const retired = [...used].filter((c) => /^cm-kv__/.test(c));
		assert(retired.length === 0,
			`oem-portfolio markup still uses ${retired.join(', ')} - the rules for those were removed, so the classes style nothing`);
	}
});

check('nav separators sit BETWEEN items, never before the first', () => {
	// border-left on every link put a dangling pipe at the page margin on
	// each WRAPPED row, and the left padding pushed the first item 11px off
	// the content rail. Only links after the first may carry a separator.
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const base = /\.cm-header__link\s*\{([^}]*)\}/.exec(comp);
	assert(base, '.cm-header__link rule missing');
	assert(!/border-left/.test(base[1]),
		'.cm-header__link still uses border-left, so the first link of a wrapped row has a dangling pipe');
	assert(!/padding:[^;]*var\(--gutter\)|padding:\s*0\s+[1-9]/.test(base[1]) || /padding:\s*0\s/.test(base[1]),
		'.cm-header__link has left padding, pushing the first item off the content rail');
	// The separator must be drawn by an adjacent-sibling rule.
	assert(/\.cm-header__link\s*\+\s*\.cm-header__link::before/.test(comp),
		'no adjacent-sibling separator rule — pipes are not scoped to between-items');
});

check('a drawn checkbox/radio stays square inside a flex row', () => {
	// The row has min-height:var(--tap) so the LABEL is the tap target. A
	// child with a fixed height in that row still got stretched: measured
	// 17x44 (ratio 2.62) instead of 17x17, which read as a tall slab.
	const base = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const r = /input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{([^}]*)\}/.exec(base);
	assert(r, 'checkbox/radio rule missing from base.css');
	assert(/min-height:\s*0/.test(r[1]),
		'checkbox/radio have no min-height:0 — the row stretches them into a slab');
	assert(/aspect-ratio:\s*1/.test(r[1]),
		'checkbox/radio do not declare aspect-ratio: 1, so square is a hope not a rule');
});

check('a control boundary clears WCAG 1.4.11 (3:1), not 1.4.11 (1.25:1)', () => {
	// --line against the fieldset surface is 1.25:1: the unchecked box was
	// literally invisible. A control's own edge is a UI boundary, not a
	// decorative divider, so it must clear 3:1.
	const base = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const m = /input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{\s*border-color:\s*var\((--[a-z-]+)\)/.exec(base);
	assert(m, 'checkbox/radio do not set an explicit border-color');
	const tok = m[1];
	assert(tok !== '--line',
		`checkbox/radio border uses ${tok}, which is a decorative divider colour (< 3:1)`);
	// And the token it does use must be one the WCAG suite already checks.
	assert(/--(ink-dim|ink-faint|ink)/.test(tok),
		`checkbox/radio border-color uses ${tok}, which is not a text-grade token`);
});

check('the radio radius is a FIXED px value, not 50%', () => {
	// WebKit (the iOS engine) painted an oval from a percentage radius on
	// this replaced element. A fixed px radius cannot drift, so the rule
	// must not go back to 50%.
	const base = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
	// Selectors are comma-separated, so `input[type='radio']:checked` is one
	// rule and `input[type='radio'] { ... }` is another. Collect every
	// declaration block whose selector mentions the radio.
	const radioRules = [...base.matchAll(/([^{}]*input\[type='radio'\][^{}]*)\{([^}]*)\}/g)]
		.map(m => m[2]).join('\n');
	assert(radioRules.length > 0, 'no input[type=radio] rule found');
	// The radius is derived from the box, not hardcoded, so the two can
	// never drift apart. What matters is that it is a LENGTH: a percentage
	// is what WebKit rendered as an oval.
	assert(/border-radius:\s*calc\(var\(--cm-box\)\s*\/\s*2\)/.test(radioRules),
		`radio radius must be calc(var(--cm-box) / 2); found: ${radioRules.trim()}`);
	assert(!/border-radius:\s*50%/.test(radioRules),
		'radio radius is a percentage; WebKit renders that oval');
	// -webkit-appearance is the property WebKit actually honours for form
	// controls; bare `appearance` is an alias older WebKit ignores.
	assert(/-webkit-appearance:\s*none/.test(base),
		'missing -webkit-appearance:none — WebKit would draw the native control');
});

check('a sticky header reserves its height for anchor jumps', () => {
	// position:sticky header above the content means a nav link lands the
	// section heading underneath it: #buttons resolved to top:63px while
	// the header bottom was 61px.
	const comp = read('src/styles/components.css');
	assert(/html\s*\{[^}]*scroll-padding-top/.test(comp),
		'no scroll-padding-top on html — sticky header covers anchor targets');

	// The height is dynamic: the header wraps to two rows on a phone (165px)
	// vs one on a desktop (61px), so a static token in CSS would be wrong.
	const js = read('src/js/cli-mono.js');
	assert(/--header-h/.test(js),
		'runtime never publishes --header-h, so scroll-padding-top falls back to a guess');
	// Strip comments first: the word "ResizeObserver" appears in a comment,
	// so a bare regex passed even with the observer removed.
	const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	assert(/new\s+ResizeObserver\([^)]*\)\.observe\(/.test(jsCode),
		'--header-h is set once at init and never updated on resize');
	assert(/window\.addEventListener\(\s*['"]resize['"]/.test(jsCode),
		'no resize listener either — the header height can never be refreshed');
});

check('mobile ergonomics live in the base layer, not per-component', () => {
	// A new component must inherit touch targets and the type floor by
	// existing, not by remembering to opt in. So the rules belong in the
	// base layer and the tokens, not scattered in component blocks.
	assert(/--tap:\s*44px/.test(tokens), 'tokens must define --tap: 44px (WCAG 2.5.5)');
	assert(/--min-font:\s*12px/.test(tokens), 'tokens must define --min-font: 12px');
	assert(
		/@media\s*\(pointer:\s*coarse\)/.test(base),
		'base.css must gate touch targets on (pointer: coarse)',
	);
	assert(
		/min-height:\s*var\(--tap\)/.test(base),
		'touch targets must be sized from --tap, not a hardcoded px',
	);
});

check('every text-bearing component is floored on mobile', () => {
	// A floor in base.css loses the cascade to components.css, which
	// loads later. The micro-labels are defined in the component layer, so
	// the floor must exist there too or they render at ~10.5px on a phone.
	const floored = comp.slice(comp.indexOf('/* ============ mobile type floor'));
	const must = [
		'.cm-status__label',
		'.cm-list-head',
		'.cm-term__bar',
		'.cm-kv dt',
		'.cm-row__idx',
		'.cm-row__meta',
		'.cm-footer__status',
	];
	for (const sel of must) {
		assert(floored.includes(sel), `${sel} is not in the mobile type-floor block`);
	}
	// Containers must be floored too: a child that declares its own
	// font-size inherits nothing from a floored parent.
	for (const sel of ['.cm-status', '.cm-kv', '.cm-row', '.cm-term__body']) {
		assert(floored.includes(sel), `${sel} container is not floored`);
	}

	// EXHAUSTIVE: any selector in this layer that declares text below 12px
	// must be covered by the floor. A hand-kept list silently misses the
	// next component someone adds, so derive the requirement from the file.
	//
	// "Covered" means the selector appears in ANY rule inside the floor's
	// media query — including inside a comma-grouped selector list, which
	// a naive /\{\s*font-size/ scan misses. Compare on the base class of
	// each selector, so `.cm-kv dt` covers a `.cm-kv dt` declaration.
	const floorBlock = (() => {
		const i = comp.indexOf('/* ============ mobile type floor');
		if (i === -1) return '';
		const body = comp.slice(i);
		const open = body.indexOf('@media');
		if (open === -1) return '';
		// take only the FIRST media block: the rest of the file is not the floor
		let depth = 0;
		for (let j = body.indexOf('{', open); j < body.length; j++) {
			if (body[j] === '{') depth++;
			else if (body[j] === '}' && --depth === 0) return body.slice(open, j + 1);
		}
		return '';
	})();
	assert(floorBlock !== '', 'mobile type floor block not found');
	const covered = new Set(
		[...floorBlock.matchAll(/(\.[a-z0-9_-]+)/g)].map((m) => m[1]),
	);

	const under = [];
	for (const m of comp.matchAll(/(^|\n)((?:\.[a-z0-9_.-]+)[^{}\n]*?)\s*\{([^}]*)\}/g)) {
		const sel = m[2].trim();
		const fm = m[3].match(/font-size:\s*([0-9.]+)(rem|em|px)\b/);
		if (!fm) continue;
		const v = parseFloat(fm[1]);
		const px = fm[2] === 'rem' ? v * 16 : fm[2] === 'px' ? v : v * 12.4;
		// Skip rules that are themselves inside the floor (they use max()).
		if (/max\(var\(--min-font\)/.test(m[3])) continue;
		const base = sel.split(/[\s,:]/)[0];
		if (px < 12.4 && !covered.has(base)) under.push(`${sel} (~${px.toFixed(1)}px)`);
	}
	assert(
		under.length === 0,
		`these render under 12px on a phone and are not in the floor: ${under.join(', ')}`,
	);
});

check('inline code and pre code cannot render under the floor', () => {
	// `all: unset` on pre > code drops the inherited size, and inline code
	// scales at 0.9em of its container, which compounds below 12px. Both
	// must be floored at their own definition.
	assert(
		/@media[^{]*\{\s*pre > code\s*\{\s*font-size:\s*max\(var\(--min-font\)/.test(base),
		'pre > code must be floored at its definition',
	);
	assert(
		/@media[^{]*\{[^@}]*\bcode\s*\{\s*font-size:\s*max\(var\(--min-font\)/.test(base),
		'inline code must be floored at its definition',
	);
});

check('the header is styled in the shared layer, not scoped in the Astro file', () => {
	// If header CSS lives only inside Header.astro's <style>, every other
	// framework gets an unstyled header. It must be in components.css, and
	// it must exist there EXACTLY ONCE.
	const h = read('src/astro/Header.astro');
	for (const sel of ['.cm-header', '.cm-header__link', '.cm-icon-btn', '.cm-header__nav']) {
		assert(comp.includes(sel), `${sel} is missing from components.css`);
	}
	// A scoped style can use :global(); a plain stylesheet cannot.
	assert(!/:global\(/.test(comp), 'components.css must not contain :global()');

	// One owner per selector. A rule in both layers is a silent cascade
	// race: whichever loads last wins, and the loser is still there to
	// confuse the next reader.
	const style = (h.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
	const base_layer = [h, comp].map((src, i) => {
		const out = [];
		for (const m of src.matchAll(/(^|\n)(\.[a-z0-9_-]+)\s*\{/g)) {
			if (i === 0 && !style.includes(m[0].trim())) continue; // astro-only text
			out.push(m[2]);
		}
		return out;
	});
	const shared = base_layer[0].filter(s => comp.includes(s));
	assert(
		shared.length === 0,
		`header rules owned by both layers: ${[...new Set(shared)].join(', ')} — pick one`,
	);
});

/* ================= docs ================= */
console.log('\ndocs & license');
for (const f of ['README.md', 'LICENSE', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CHANGELOG.md']) {
	check(`ships ${f}`, () => assert(read(f).trim().length > 0, `${f} empty`));
}

/* ================= spacing scale ================= */
console.log('\nspacing scale');
// Read the scale out of tokens.css rather than restating it. A test that
// hardcodes the step NAMES breaks on a rename, and a rename is exactly the
// moment you least want the suite to be arguing about anything else.
const scaleSteps = () => [...read('src/styles/tokens.css')
	.matchAll(/--space-([\d]+):\s*([\d.]+)rem/g)]
	.map(m => ({ name: m[1], rem: parseFloat(m[2]) }));

check('declares the full --space-* scale', () => {
	const steps = scaleSteps();
	assert(steps.length === 11, `expected 11 steps, found ${steps.length}`);
	for (let i = 0; i < steps.length; i++) {
		assert(steps[i].name === String(i),
			`step ${i} is named --space-${steps[i].name}; the scale must run 0..10`);
		assert(steps[i].rem > 0, `--space-${steps[i].name} has no length`);
	}
});

check('the scale is monotonic and distinct', () => {
	const t = read('src/styles/tokens.css');
	const vals = scaleSteps().map(s => s.rem);
	assert(vals.length === 11, `expected 11 steps, parsed ${vals.length}`);
	for (let i = 1; i < vals.length; i++) {
		assert(vals[i] > vals[i - 1],
			`step ${i} (${vals[i]}rem) is not larger than step ${i - 1} (${vals[i - 1]}rem)`);
	}
});

check('no layer hardcodes a raw rem/px spacing value', () => {
	// The whole point of the scale: a gap is a step, not a number. A raw
	// value here is how the hero rhythm drifted in the first place, and
	// how a tightened gap silently became 0 during the migration.
	// em, calc(), var(), auto and 0 are exempt: they are relative to a
	// font size, not the rhythm.
	const dec = /\b(margin|padding|gap|row-gap|column-gap)((?:-[a-z]+)*):\s*(-?[\d.]+)(rem|px)\s*;/g;
	for (const f of ['src/styles/base.css', 'src/styles/components.css']) {
		const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
		for (const m of css.matchAll(dec)) {
			assert(false, `${f}: ${m[1]}${m[2]}: ${m[3]}${m[4]} is a raw spacing value; use var(--space-*)`);
		}
	}
});

check('components consume the scale rather than redefining steps', () => {
	// A component must not reintroduce a local spacing scale under a
	// different name; --space-* is the only rhythm the system owns.
	for (const f of ['src/styles/base.css', 'src/styles/components.css']) {
		const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
		const local = [...css.matchAll(/(--cm-space[a-z-]*|cm-space[a-z-]*):\s*[\d.]/g)];
		assert(local.length === 0,
			`${f} declares its own spacing scale: ${local.map(m => m[1]).join(', ')}`);
	}
});

check('the scale is theme-independent, declared once in :root', () => {
	// Spacing does not vary by theme, so the scale belongs in the shared
	// :root block only. A step redeclared in a theme block would let the two
	// themes drift apart on rhythm, which is the bug the scale exists to stop.
	const t = read('src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
	assert([...t.matchAll(/--space-[\d]+:/g)].length === 11,
		'expected exactly 11 --space-* declarations across the file');
	// Find the :root block and every theme block, then assert the space
	// tokens live only in :root.
	const blocks = [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map(m => ({ sel: m[1].trim(), body: m[2] }))
		.filter(b => b.sel);
	const rootBlocks = blocks.filter(b => b.sel === ':root');
	assert(rootBlocks.length === 1, `expected one plain :root block, found ${rootBlocks.length}`);
	const themeBlocks = blocks.filter(b => b.sel !== ':root');
	for (const b of themeBlocks) {
		assert(!/--space-\d/.test(b.body),
			`theme block ${b.sel} redefines --space-*; spacing must be theme-independent`);
	}
});

/* ================= theme key ================= */
console.log('\ntheme storage key');
const themeHarness = () => {
	// A fresh store + document, with data-cm-theme-key settable.
	const store = {};
	const attrs = {};
	const doc = {
		documentElement: {
			attrs,
			getAttribute: (n) => (n in attrs ? attrs[n] : null),
			setAttribute: (n, v) => { attrs[n] = v; },
			style: { setProperty: () => {} },
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		readyState: 'complete',
		addEventListener: () => {},
	};
	const ctx = {
		module: { exports: {} },
		document: doc,
		localStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: (k, v) => { store[k] = String(v); },
			removeItem: (k) => { delete store[k]; },
		},
	};
	vm.runInNewContext(runtimeSrc, ctx);
	return { api: ctx.module.exports, store, attrs, doc };
};

check('the storage key is per-project via data-cm-theme-key', () => {
	const h = themeHarness();
	h.doc.documentElement.setAttribute('data-cm-theme-key', 'oem-links-theme');
	assert(h.api.storeKey() === 'oem-links-theme', 'must read the key off <html>');
	h.api.applyTheme('light');
	assert(h.store['oem-links-theme'] === 'light', 'must write to the project key');
	assert(!('cm-theme' in h.store), 'must NOT write to the library default key');
});

check('the default key is still cm-theme when a project declares none', () => {
	const h = themeHarness();
	assert(h.api.storeKey() === 'cm-theme', 'unconfigured projects keep cm-theme');
	h.api.applyTheme('light');
	assert(h.store['cm-theme'] === 'light', 'must write to cm-theme by default');
});

check('a legacy key is honoured and folded into the new one', () => {
	// This is the rename path: a returning visitor saved light under the old
	// key must not lose their preference.
	const h = themeHarness();
	h.store['oem-links-theme'] = 'light';
	h.api.setLegacyKeys(['cm-theme', 'oem-log-theme']);
	h.doc.documentElement.setAttribute('data-cm-theme-key', 'oem-links-theme');

	assert(h.api.getTheme() === 'light', 'must read the value from the legacy key');
	assert(
		h.store['oem-links-theme'] === 'light',
		'must migrate the legacy value into the current key',
	);
});

check('a legacy key is preferred over an absent current key, and dark is respected', () => {
	const h = themeHarness();
	h.store['cm-theme'] = 'dark';
	h.api.setLegacyKeys(['cm-theme']);
	h.doc.documentElement.setAttribute('data-cm-theme-key', 'brand-new-key');
	assert(h.api.getTheme() === 'dark', 'a stored dark must not read as light');

	const h2 = themeHarness();
	h2.store['cm-theme'] = 'light';
	h2.api.setLegacyKeys(['cm-theme']);
	h2.doc.documentElement.setAttribute('data-cm-theme-key', 'brand-new-key');
	assert(h2.api.getTheme() === 'light', 'a stored light must be read from the legacy key');
	assert(h2.store['brand-new-key'] === 'light', 'and migrated forward');
});

check('no stored preference anywhere still defaults to dark', () => {
	const h = themeHarness();
	h.api.setLegacyKeys(['cm-theme', 'oem-log-theme']);
	h.doc.documentElement.setAttribute('data-cm-theme-key', 'oem-links-theme');
	assert(h.api.getTheme() === 'dark', 'dark is the default with no stored choice');
	assert(h.attrs['data-theme'] === undefined, 'reading the theme must not apply one');
});

check('the library <Head> guard reads the same keys the runtime does', () => {
	// The guard is the one piece of theme code that runs BEFORE the runtime
	// exists, so it cannot import anything. That made it a natural place to
	// retype a key list by hand -- and it had drifted from cli-mono.js,
	// which cost every returning light-theme visitor a black flash. Assert
	// it reads the <html> attributes instead of a literal.
	const src = readFileSync(join(root, 'src/astro/Head.astro'), 'utf8');
	assert(
		src.includes('data-cm-theme-key'),
		'Head.astro must read data-cm-theme-key so the guard follows the project declaration',
	);
	assert(
		src.includes('data-cm-theme-legacy'),
		'Head.astro must read data-cm-theme-legacy or a pre-library theme is invisible',
	);
	// Strip comments before matching source, or the prose above satisfies it.
	const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
	assert(
		!/localStorage\.getItem\(\s*['"]cm-theme['"]\s*\)/.test(code),
		"Head.astro must not hardcode a single getItem('cm-theme'); that is the drift",
	);
});

// Every .astro under a consumer's src/, skipping node_modules and dist
// (which hold copies of the same files and would only add noise).
const listAstroFiles = (dir) => {
	const out = [];
	const stack = [join(dir, 'src')];
	while (stack.length) {
		const d = stack.pop();
		let entries;
		try {
			entries = readdirSync(d, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
			const p = join(d, e.name);
			if (e.isDirectory()) stack.push(p);
			else if (e.name.endsWith('.astro')) out.push(p.slice(dir.length + 1));
		}
	}
	return out;
};

check('no consumer keeps its FOUC guard inside the body', () => {
	// dev-blog's guard lived in Header.astro, which renders inside <body>.
	// A guard there runs AFTER the stylesheets have painted, so the flash
	// it exists to prevent still happens. Source order in a component file
	// is not the rendered order, so assert on the COMPONENT that owns
	// <head>, which is the only placement that can be correct.
	for (const c of [
		{ name: 'dev-blog', dir: '../dev-blog', body: 'src/components/Header.astro' },
		{ name: 'oem-portfolio', dir: '../oem-portfolio', body: 'src/components/Header.astro' },
	]) {
		const p = join(root, c.dir, c.body);
		if (!existsSync(p)) continue;
		const s = readFileSync(p, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/<!--[\s\S]*?-->/g, '');
		if (!/data-theme/.test(s)) continue; // not a theme guard
		assert(
			!/<script[^>]*is:inline/.test(s),
			`${c.name}: ${c.body} emits a theme guard from a component that renders inside <body>; ` +
				'move it to the component that owns <head> or the flash comes back',
		);
	}
});

check('every shipped FOUC guard covers the keys its own <html> declares', () => {
	// The real invariant is CONSISTENCY, not "more than one key": a project
	// that never renamed its key legitimately has exactly one. What must
	// never happen is a guard that searches a different key than the
	// runtime will -- a returning light-theme visitor then flashes black.
	//
	// So derive the expected key list from the project's own <html> tags
	// and require every one of them to appear in the guard.
	const CONSUMERS = [
		// The guard must live in the <head> owner. It used to sit in
		// Header.astro, which renders inside <body> — the one placement the
		// FOUC guard can never occupy.
		{ name: 'dev-blog', dir: '../dev-blog', guard: 'src/components/BaseHead.astro' },
		{ name: 'oem-portfolio', dir: '../oem-portfolio', guard: 'src/components/Head.astro' },
	];
	for (const c of CONSUMERS) {
		const dir = join(root, c.dir);
		if (!existsSync(dir)) continue;
		const guard = readFileSync(join(dir, c.guard), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/<!--[\s\S]*?-->/g, '');
		if (!/data-theme/.test(guard)) continue; // not a theme guard at all

		// Every <html ...> in the project, so a key declared on one layout
		// and forgotten on another is caught. Walk only the source tree:
		// node_modules and dist hold copies that would add noise.
		const htmlTags = [];
		for (const f of listAstroFiles(dir)) {
			const s = readFileSync(join(dir, f), 'utf8');
			for (const m of s.match(/<html[\s\S]{0,400}?>/g) || []) htmlTags.push({ f, tag: m });
		}
		assert(htmlTags.length > 0, `${c.name}: no <html> tag found, so nothing to check the guard against`);

		for (const { f, tag } of htmlTags) {
			const key = (tag.match(/data-cm-theme-key="([^"]+)"/) || [])[1] || 'cm-theme';
			const legacy = (tag.match(/data-cm-theme-legacy="([^"]+)"/) || [])[1];
			for (const k of [key].concat(legacy ? legacy.split(',') : [])) {
				const kk = k.trim();
				assert(
					guard.includes(kk),
					`${c.name}: ${f} declares theme key ${JSON.stringify(kk)} but ${c.guard} never searches it, ` +
						`so a visitor saved under it gets a black flash`,
				);
			}
		}
	}
});

check('the FOUC guard finds a theme saved under a LEGACY key', () => {
	// The regression this guards: the guard is evaluated in <head>, before
	// the runtime bundle has run, so the module's LEGACY_KEYS is still [].
	// A guard that bakes its key list in at build time therefore sees only
	// the project key and misses a visitor whose theme is stored under the
	// old one -- a black flash for exactly the returning light-theme users
	// the guard exists to protect.
	//
	// Assert the SNIPPET'S BEHAVIOUR in a context shaped like a real
	// <head>: documentElement with BOTH attributes set, a store holding the
	// theme under the legacy key ONLY, and no module state seeded at all.
	const api = { module: { exports: {} }, window: undefined };
	vm.runInNewContext(runtimeSrc, api);
	const src = api.module.exports.themeInitScript('oem-links-theme');

	const store = { 'oem-log-theme': 'light' };
	const attrs = {
		'data-cm-theme-key': 'oem-links-theme',
		'data-cm-theme-legacy': 'cm-theme,oem-log-theme',
	};
	const ctx = {
		localStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: () => { throw new Error('FOUC guard must not write'); },
		},
		document: {
			documentElement: {
				getAttribute: (n) => (n in attrs ? attrs[n] : null),
				setAttribute: (n, v) => { attrs[n] = v; },
			},
		},
	};
	vm.runInNewContext(src, ctx);
	assert(
		attrs['data-theme'] === 'light',
		'a visitor whose light theme is stored under a legacy key must still get light before first paint, got ' +
			JSON.stringify(attrs['data-theme'] ?? null),
	);
});

check('the FOUC guard prefers the project key over the legacy ones', () => {
	// Order matters: a project that has since written 'dark' under its own
	// key must not be flipped back to light by a stale legacy value.
	const api = { module: { exports: {} }, window: undefined };
	vm.runInNewContext(runtimeSrc, api);
	const src = api.module.exports.themeInitScript('oem-links-theme');

	const store = { 'oem-links-theme': 'dark', 'oem-log-theme': 'light' };
	const attrs = {
		'data-cm-theme-key': 'oem-links-theme',
		'data-cm-theme-legacy': 'cm-theme,oem-log-theme',
	};
	vm.runInNewContext(src, {
		localStorage: { getItem: (k) => (k in store ? store[k] : null) },
		document: {
			documentElement: {
				getAttribute: (n) => (n in attrs ? attrs[n] : null),
				setAttribute: (n, v) => { attrs[n] = v; },
			},
		},
	});
	assert(
		attrs['data-theme'] === undefined,
		'dark is the default and is applied by CSS, so the guard must write nothing, got ' +
			JSON.stringify(attrs['data-theme'] ?? null),
	);
});

check('the toggle binds legacy .theme-toggle markup as well as the library one', () => {
	assert(
		/\[data-cm-theme-toggle\], \.theme-toggle/.test(runtimeSrc),
		'the toggle selector must cover the class the oem projects already ship',
	);
	assert(
		/btn\.querySelector\('\.icon'\)/.test(runtimeSrc),
		'the icon lookup must find .icon for legacy markup, or the glyph never paints',
	);
});

/* ================= runtime actually ships ================= */
console.log('\nruntime ships');
check('the showcase loads the runtime as a bundled module', () => {
	const s = read('src/pages/index.astro');
	// A relative <script src="../js/cli-mono.js"> is NOT a build asset: Astro
	// emitted the tag verbatim and dist/ shipped ZERO JS, so the theme toggle
	// and every runtime feature were dead in the one place that demos them.
	assert(
		/import\s+['"]\.\.\/js\/cli-mono\.js['"]/.test(s),
		'the runtime must be imported so Vite bundles it, not referenced by a raw src',
	);
	assert(
		!/<script[^>]*\ssrc=["'][^"']*cli-mono\.js["']/.test(s),
		'a raw <script src=...> for the runtime is not bundled and never ships',
	);
});

check('the FOUC guard is the first node in <head>, not inside <header>', () => {
	// A guard rendered from <header> lives in <body> and runs after the
	// stylesheets have painted, which is the flash it exists to prevent.
	const header = read('src/astro/Header.astro');
	assert(
		!header.includes('data-theme'),
		'Header.astro must not emit a theme guard; <head> owns that position',
	);

	for (const [name, path] of [
		['showcase', 'src/pages/index.astro'],
		['Head.astro', 'src/astro/Head.astro'],
	]) {
		const s = read(path);
		// Two legal spellings. Either the tag carries its body directly,
		// or - the shape a consumer with its own <head> must now use -
		// it inlines the shared guard FILE with set:html, which is
		// self-closing. Both are scoped to set:html or an IIFE body so an
		// unrelated self-closing inline script cannot satisfy this.
		//
		// An external <script src> is NOT a match: it runs after the
		// stylesheets, which is the flash this checks for.
		const guardAt = s.search(
			/<script\s+is:inline[^>]*set:html[^>]*\/>|<script\s+is:inline[^>]*>\s*\(function/
		);
		const charsetAt = s.indexOf('<meta charset');
		assert(guardAt !== -1, `${name}: no inline FOUC guard found`);
		assert(
			!/<script[^>]*is:inline[^>]*src=/.test(s),
			`${name}: the guard must be INLINE; a src= tag runs after the stylesheets, which is the flash`,
		);
		assert(
			charsetAt === -1 || guardAt < charsetAt,
			`${name}: the FOUC guard must precede <meta charset>, or a light-theme visitor sees a dark flash`,
		);
	}
});

check('the runtime reads its key from <html> and can migrate an old one', () => {
	assert(
		/readLegacyKeys\(\)\.length/.test(runtimeSrc),
		'migrateStored must consult the DECLARED legacy keys; a project that lists them in an attribute is otherwise never migrated',
	);
	assert(
		/data-cm-theme-legacy/.test(runtimeSrc),
		'the runtime must read data-cm-theme-legacy so a project declares its old keys once',
	);
});

/* ================= async states ================= */
console.log('\nasync states');
check('every animation in the system is guarded by prefers-reduced-motion', () => {
	// An animation with no guard is not a nit: an unguarded spinner is a real
	// accessibility failure. List every animated selector in the library, then
	// assert the single reduced-motion block names all of them. A guard that
	// lives beside one component silently leaves the next one unguarded.
	// A rule may name several selectors, and they may be written on several
	// lines. Split on the rule's OWN braces first, then on commas, so
	// `.a, .b {` yields two selectors and not one mangled string.
	// Walk the sheet rule by rule. `@keyframes` bodies are not rules and hold
	// no `animation:` shorthand, so they fall out naturally.
	const animated = [];
	const rule = /(^|[};])\s*([^;{}@][^{}]*?)\s*\{([^{}]*)\}/gm;
	const guardAt = compSrc.indexOf('@media (prefers-reduced-motion: reduce)');
	assert(guardAt !== -1, 'there must be a reduced-motion block in components.css');
	for (const m of compSrc.matchAll(rule)) {
		if (!/\banimation\s*:/.test(m[3])) continue;
		// The guard's own rule sets `animation: none` — that is the guard doing
		// its job, not a component that needs guarding. Decide that by VALUE,
		// not by position: components may be declared before OR after the
		// @media block, and a position test silently drops whichever half.
		if (/animation\s*:\s*none\b/.test(m[3])) continue;
		// A selector list may be written across SEVERAL lines, which is how the
		// reduced-motion guard itself is written. Take the whole run and join
		// it, or a multi-line list yields only its last line and the earlier
		// components look unguarded.
		const head = m[2].replace(/\s+/g, ' ');
		for (const one of head.split(',')) {
			const t = one.trim();
			// A BEM element like `.cm-skeleton__line` must not be collected as
			// its block `.cm-skeleton`: a prefix match invents a selector that
			// does not exist, and then demands a guard for it.
			if (/^\.cm-[\w-]+$/.test(t)) animated.push(t);
		}
	}
	assert(animated.length > 0, 'no animated components found — is the parse stale?');
	// The guard is the ONE @media block and nothing after it. Slicing to the
	// end of the file would let any later mention of the selector — another
	// media query, a comment, a rule that happens to repeat it — satisfy the
	// check, which is exactly how a real gap stays green.
	const close = compSrc.indexOf('\n}', guardAt);
	assert(close !== -1, 'the reduced-motion block is not closed');
	const guard = compSrc.slice(guardAt, close);
	// The selector must appear in the rule that sets `animation: none`, not
	// merely somewhere in the block. The block also carries cosmetic rules
	// (`.cm-cursor { opacity: 1 }`) and a loose "does the name appear" test
	// counts those as a guard, which is precisely how a real gap stays green.
	const stopRules = [...guard.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter(m => /animation\s*:\s*none\b/.test(m[2]))
		.map(m => m[1])
		.join(',');
	assert(stopRules.trim(), 'the reduced-motion block must set animation: none');
	const missing = [...new Set(animated)].filter(
		// The last selector in a list has no trailing comma, so accept the end
		// of the list too.
		sel => !new RegExp(`${sel.replace('.', '\\.')}\\s*(,|\\s*\\{|\\s*$)`, 'm').test(stopRules));
	assert(missing.length === 0,
		`animated but unguarded under reduced motion: ${missing.join(', ')}`);
});

check('the state components carry no chroma', () => {
	// House rule: greyscale only. A state colour is the easiest place to break
	// it, because "red for error" is the reflex.
	// Test the RULES that own the state components, not a slice of the file.
	// An earlier version cut the section out using its `/* ---- */` comment
	// header — but this test runs against comment-stripped source, so that
	// marker was already gone, the slice silently became the whole sheet, and
	// every alert variant landed outside the range it checked. Collect the
	// rules by selector instead: those exist whatever the comments say.
	const STATE = ['.cm-skeleton', '.cm-spinner', '.cm-alert', '.cm-table'];
	const blocks = STATE.flatMap(sel =>
		[...compSrc.matchAll(new RegExp(
			`(^|[};])\\s*([^;{}@]*\\b${sel.slice(1)}\\b[^{}]*?)\\s*\\{([^{}]*)\\}`, 'gm'))]
			.filter(m => {
				const s = m[2];
				if (sel === '.cm-table' && /\.cm-table-wrap\b/.test(s)) return false;
				return true;
			})
			.map(m => m[2] + ' {' + m[3] + '}'));
	assert(blocks.length > 0, 'no state rules found — is the parse stale?');
	const block = blocks.join('\n');
	// `.cm-table-wrap` is PART of the table component - it is the scroll
	// box the sticky header depends on - so it stays in scope. The `#000`
	// in it is not chroma: a CSS mask gradient is matched on ALPHA
	// (mask-mode: match-source makes a gradient an alpha mask), so the
	// colour stop is inert and `#000` there means "fully opaque", the
	// same word `transparent` is carrying on the next stop. Stripping
	// mask declarations before the colour scans keeps the table
	// scannable without opening a hole in any other property.
	const scan = block.replace(
		/(^|[;{])\s*(?:-webkit-)?mask(?:-image)?\s*:[^;}]*/g, '$1');
	const hex = scan.match(/#[0-9a-f]{3,8}\b/gi) || [];
	const named = scan.match(/:\s*(red|green|blue|yellow|orange|purple|pink|teal)\b/gi) || [];
	assert(hex.length === 0, `state components must use tokens, found literal colours: ${hex}`);
	assert(named.length === 0, `state components must use tokens, found named colours: ${named}`);
	// every colour-ish declaration must go through a var()
	// Every colour-ish declaration must be a var() reference. Checked per
	// declaration, not with a loose `[^v]` class, which is thrown off by
	// leading whitespace and matches values a token already covers.
	const raw = [...block.matchAll(
		/(?:^|[;{])\s*((?:-webkit-)?[a-z-]*color|(?:-webkit-)?background(?:-color)?|border(?:-[a-z]+)?-color|outline(?:-[a-z]+)?-color|box-shadow|fill|stroke|caret-color)\s*:\s*([^;}]+)/g)]
		.filter(m => !/^var\(|^currentColor$|^inherit$|^none$|^transparent$/.test(m[2].trim()))
		.map(m => `${m[1]}: ${m[2].trim()}`);
	assert(raw.length === 0, `colour must come from a token, found: ${raw.join(', ')}`);
});

check('status is never carried by colour alone', () => {
	// A colour-blind user and a greyscale print both still need to read the
	// state, so every alert variant ships a glyph slot and every state surface
	// ships a mark.
	assert(/\.cm-alert__mark/.test(compSrc), 'alerts need a glyph slot');
	// Each variant must ship a GLYPH, and the glyphs must differ. A rule that
	// sets only the border colour leaves a greyscale print with three alerts
	// that read identically, which defeats the point of having three variants.
	const glyph = {};
	for (const v of ['ok', 'warn', 'err']) {
		assert(new RegExp(`\\.cm-alert--${v}\\b`).test(compSrc), `.cm-alert--${v} is missing`);
		// Read the rule through declForSelector, not `selector {`. The glyph
		// rules are the ones most likely to be written as a selector list once
		// someone shares them with another component, and a list makes the
		// anchored form match nothing at all - which reads as "this variant
		// has no glyph" against a rule that renders the glyph fine.
		const body = declForSelector(`.cm-alert--${v} .cm-alert__mark::before`);
		assert(body, `.cm-alert--${v} must carry a ::before glyph, not a colour alone`);
		const m = /content:\s*'([^']*)'/.exec(body);
		assert(m, `.cm-alert--${v} declares no content: for its ::before glyph`);
		glyph[v] = m[1];
	}
	assert(new Set(Object.values(glyph)).size === 3,
		`the three alert glyphs must differ, got ${JSON.stringify(glyph)}`);
	// Differing is not enough: an emptied glyph is a distinct value, and the
	// alert then carries nothing at all in a greyscale print. Trailing `\\00a0`
	// is the deliberate non-breaking space that keeps the mark attached to its
	// text, so it does not count as content.
	for (const [v, g] of Object.entries(glyph)) {
		const marks = g.replace(/\\00a0/g, '').trim();
		assert(marks !== '', `.cm-alert--${v} has an empty glyph`);
	}
	assert(/\.cm-state__mark/.test(compSrc), 'empty/skeleton surfaces need a mark');
	// and the mark must be hidden from assistive tech, not read as "circle slash"
	const show = showcase.slice(showcase.indexOf('id="states"'),
		showcase.indexOf('id="prose"'));
	const marks = show.match(/class="cm-state__mark"[^>]*>/g) || [];
	assert(marks.length >= 1, 'the showcase must demo the state mark');
	for (const m of marks) assert(m.includes('aria-hidden'), `state mark needs aria-hidden: ${m}`);
	// The alert glyph is injected by CSS per variant, so the markup must be
	// EMPTY. A literal glyph left in the span renders twice — CSS adds one —
	// which reads as a duplicated mark and is announced twice by a screen
	// reader. This shipped once, so it is worth a permanent test.
	const alertMarks = show.match(/<span class="cm-alert__mark"[^>]*>([\s\S]*?)<\/span>/g) || [];
	// One EMPTY mark per alert specimen - the count is derived, not
	// pinned: the vocabulary grew (info/loading) and a hardcoded 3
	// would fail for growing rather than for BREAKING. What must never
	// change is the emptiness: the glyph is injected by CSS.
	const alertSpecimens = (show.match(/class="cm-alert cm-alert--/g) || []).length;
	assert(alertSpecimens >= 3 && alertMarks.length === alertSpecimens,
		`expected one empty mark per alert specimen (${alertSpecimens}), found ${alertMarks.length}`);
	for (const m of alertMarks) {
		const inner = m.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '').trim();
		assert(inner === '',
			`the alert mark must be empty; CSS owns the glyph. Found: ${JSON.stringify(inner)}`);
	}
});

check('the table owns its scroll wrapper', () => {
	assert(/\.cm-table-wrap\s*\{[^}]*overflow-x:\s*auto/.test(compSrc),
		'a wide table must scroll inside its own wrapper, not overflow the page');
	// sticky headers only work when the wrapper is the scroll box
	assert(/\.cm-table th\s*\{[^}]*position:\s*sticky/.test(compSrc),
		'the table head must be sticky');
	// and the wrapper must be keyboard reachable, which is a markup duty
	const show = showcase.slice(showcase.indexOf('id="states"'),
		showcase.indexOf('id="prose"'));
	// Re-derived: the claim is that THE WRAPPER is reachable and named,
	// not that its class list is exactly one class long - utilities
	// compose onto it (.cm-scroll-fade-x) and pinning the list made a
	// honest composition fail a reachability check.
	assert(/class="[^"]*cm-table-wrap[^"]*"[^>]*tabindex="0"/.test(show),
		'a scrollable region needs tabindex="0" to be keyboard reachable');
	assert(/class="[^"]*cm-table-wrap[^"]*"[^>]*aria-label=/.test(show),
		'a scrollable region needs an accessible name');
});

check('the showcase demonstrates every new state component', () => {
	const show = showcase.slice(showcase.indexOf('id="states"'),
		showcase.indexOf('id="prose"'));
	for (const cls of ['cm-state', 'cm-state__title', 'cm-state__body',
		'cm-skeleton', 'cm-skeleton__line', 'cm-spinner',
		'cm-alert', 'cm-alert--ok', 'cm-alert--warn', 'cm-alert--err',
		'cm-table', 'cm-table-wrap']) {
		assert(new RegExp(`class="[^"]*\\b${cls}\\b`).test(show),
			`the states section should demonstrate .${cls}`);
	}
	// and a skeleton or spinner must never be the only thing announced
	assert(/cm-spinner-row[^>]*role="status"/.test(show),
		'a spinner row needs role="status" so the wait is announced once');
});

check('the progress bar draws --cm-progress and pairs the aria value with it', () => {
	// The determinate sibling of the spinner. Four claims, each of which
	// has failed in some form elsewhere in this library:
	//
	//  1. CAUSE, not effect: the fill is positioned by the CUSTOM PROPERTY
	//     (translateX(calc(var(--cm-progress) ...))). Asserting only
	//     `transform:` would pass a fill pinned at translateX(0) — a bar
	//     that always reads 100% while every other check stays green.
	//  2. The showcase renders it: a class defined but never demonstrated
	//     is dead code the next person cannot trust.
	//  3. PAIRING: aria-valuenow is the source of truth and the inline
	//     --cm-progress is what the eye sees. If they can drift, the bar
	//     lies to assistive tech; assert they are the SAME number per
	//     instance, not merely that both exist.
	//  4. Reduced motion silences the fill's transition, inside the ONE
	//     guard block (a guard beside the component is the failure mode
	//     the sheet already documents).
	assert(/\.cm-progress\s*\{[^}]*height:\s*var\(--space-1\)/.test(compSrc),
		'cm-progress must take its height from the spacing scale, not a typed px');
	// The hairline is the denominator. A bare --bg-3 track measured
	// 1.04:1 against the --panel behind it (WebKit, 390px): the empty
	// half of the bar was invisible, so a 33% fill read as a stub of
	// unknown length. Same answer as .cm-meter__track - the sheet's
	// hairline is what draws the box the fill is a fraction OF. Assert
	// the BORDER declaration, not the colour: a colour-shaped check passes
	// a track that renders at 1:1 with its background.
	assert(/\.cm-progress\s*\{[^}]*border:\s*1px solid var\(--line\)/.test(compSrc),
		'cm-progress must frame its track with the --line hairline, or the ' +
		'empty part of the bar has no visible extent');
	// Scope to the rule that OWNS the transform: `.cm-progress__fill` is
	// also named inside the reduced-motion guard (transition: none), and a
	// bare first-match read finds THAT rule and reports the real one
	// missing. Requiring translateX in the same body as the selector is
	// what makes both readings unambiguous.
	assert(/\.cm-progress__fill\s*\{[^}]*transform:\s*translateX\(calc\(var\(--cm-progress/.test(compSrc),
		'the fill must be driven by the var(--cm-progress) custom property, ' +
		'not a width (a width transition repaints layout and cannot be read back)');

	const show = showcase.slice(showcase.indexOf('id="surface"'),
		showcase.indexOf('id="selection"'));
	assert(show.length > 0, 'the surface section is missing from the showcase');
	const bars = show.match(/<div class="cm-progress"[^>]*>/g) || [];
	assert(bars.length >= 2,
		`the showcase must demonstrate cm-progress; found ${bars.length} bar(s)`);
	for (const bar of bars) {
		assert(/role="progressbar"/.test(bar),
			`a progress bar needs role="progressbar": ${bar}`);
		assert(/aria-valuenow="\d+"/.test(bar),
			`a progress bar needs aria-valuenow: ${bar}`);
		assert(/aria-valuemin="0"/.test(bar) && /aria-valuemax="100"/.test(bar),
			`a progress bar needs the 0..100 range: ${bar}`);
		const prop = (bar.match(/--cm-progress:\s*(\d+)%/) || [])[1];
		const now = (bar.match(/aria-valuenow="(\d+)"/) || [])[1];
		assert(prop !== undefined && now !== undefined,
			`each demo must set both --cm-progress and aria-valuenow: ${bar}`);
		assert(prop === now,
			`the bar and its aria value must agree (${prop}% vs ${now}): ` +
			'the eye and assistive tech are reading two different numbers');
	}
	// reduced motion: inside the ONE guard block, by name
	const guardAt = compSrc.indexOf('@media (prefers-reduced-motion: reduce)');
	const close = compSrc.indexOf('\n}', guardAt);
	const guard = compSrc.slice(guardAt, close);
	assert(/\.cm-progress__fill[^{}]*\{[^}]*transition:\s*none/.test(guard),
		'the reduced-motion guard must silence the progress fill transition');
});

/* ================= the design language is documented ================= */
console.log('\ndesign language');

check('the spacing scale is a run: 0,1,2…10 with no gaps or strays', () => {
	const names = [...tokenSrc.matchAll(/--space-(\S+?):/g)].map(m => m[1]);
	assert(names.length === 11, `expected 11 steps, found ${names.length}: ${names}`);
	const expect = [...Array(11).keys()].map(String);
	assert(JSON.stringify(names) === JSON.stringify(expect),
		`steps must read 0,1,2…10 in order, found ${names.join(',')}`);
	// A leading-zero name like `05` next to plain `1` is a real hazard: the two
	// sort and read as different scales. That is exactly what shipped.
	assert(!names.some(n => n.length > 1 && n[0] === '0'),
		`no step may be zero-padded: ${names}`);
});

check('every specimen in the showcase is rendered from a token, not typed', () => {
	const f = showcase.slice(showcase.indexOf('id="foundation"'),
		showcase.indexOf('id="buttons"'));
	// spacing: the bar must be width:var(--space-N), the value text is data
	assert(f.includes("['--space-0', '0.125rem', '2px']"), 'space-0 specimen missing');
	assert(/width:\s*var\(\$\{token\}\)/.test(f) && /class="cm-spec__bar"/.test(f),
		'spacing bars must be drawn from the token they name, not a literal px value');
	const specRows = f.match(/\['--space-\d+',/g) || [];
	assert(specRows.length === 11, `all 11 steps must be listed, found ${specRows.length}`);
	// swatches: the chip must paint the token it names
	const chips = f.match(/background:\s*var\(--[\w-]+\)/g) || [];
	assert(chips.length >= 7, `swatch chips must paint their token, found ${chips.length}`);
	// type scale: each sample must set the size from a token
	assert(/font-size:\s*var\(--/.test(f),
		'type specimens must render their size from a token, not a literal rem');
	assert(/font-size:\s*var\(--min-font\)/.test(f),
		'the type scale must show the --min-font floor as a specimen');
	// and one hardcoded spacing value in the block would defeat the whole point.
	// The slice has to reach back to the section's own opening tag: an inline
	// style on <section> or its heading sits BEFORE the id, and that is exactly
	// where a stray `margin-bottom:1.8rem` hid while this test passed.
	const start = showcase.lastIndexOf('<section', showcase.indexOf('id="foundation"'));
	const whole = showcase.slice(start, showcase.indexOf('id="buttons"'));
	const raw = whole.match(/(?:padding|margin|gap)[a-z-]*:[\d.]+(?:px|rem)\b/g) || [];
	assert(raw.length === 0, `foundation must not hardcode spacing, found: ${raw.join(', ')}`);
});

check('a token name can never be truncated in a swatch', () => {
	assert(/white-space:\s*nowrap/.test(compSrc), 'swatch labels must not wrap');
	// and must not be elided either: an ellipsis renders a name that does not
	// exist, which is the same defect wearing a different hat
	const swatchBlock = compSrc.slice(compSrc.indexOf('.cm-swatch__meta'),
		compSrc.indexOf('.cm-spec {'));
	assert(!/text-overflow:\s*ellipsis/.test(swatchBlock),
		'swatch labels must not ellipsise; size the chip off the font instead');
	assert(/\.cm-swatch__chip\s*\{[^}]*width:\s*[\d.]+em/.test(compSrc),
		'the swatch chip must be font-relative so a long name still fits');
});

/* ================= shared row surface ================= */
console.log('\nrow surface (migrated from oem-links)');
check('the row icon slot exists and is a fixed-width centred box', () => {
	const css = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = css.match(/\.cm-row__icon\s*\{([^}]*)\}/);
	assert(rule, '.cm-row__icon is not defined');
	const body = rule[1];
	assert(/flex:\s*0 0 auto/.test(body), 'the icon must not flex, or columns drift');
	assert(/display:\s*flex/.test(body), 'the icon slot must centre its glyph');
	assert(/width:\s*1\.1rem/.test(body), 'the icon slot needs a fixed width');
});

check('a column row stacks title over desc with a tight gap', () => {
	const css = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	assert(/\.cm-rows--column \.cm-row__body\s*\{[^}]*flex-direction:\s*column/.test(css),
		'.cm-rows--column must stack the row body in a column');
	assert(/\.cm-rows--column \.cm-row__body\s*\{[^}]*gap:\s*var\(--space-0\)/.test(css),
		'the stacked body must use a scale step for its gap, not a raw value');
});

check('--stacked and --column do not collide', () => {
	// Both restyle .cm-row__body. If a consumer uses both, the last one
	// wins silently. Keep them mutually exclusive in the component docs.
	const css = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const stacked = [...css.matchAll(/\.cm-rows--stacked \.cm-row__body\s*\{([^}]*)\}/g)];
	const column = [...css.matchAll(/\.cm-rows--column \.cm-row__body\s*\{([^}]*)\}/g)];
	assert(stacked.length && column.length, 'both variants must be defined');
	assert(!/flex-direction/.test(stacked[0][1]),
		'--stacked must stay a block; --column owns the flex-column form');
});

check('every class the showcase demonstrates is defined in the library', () => {
	// A demo of a class the library does not own is a lie in the showcase.
	const page = read('src/pages/index.astro');
	const demoed = new Set([...page.matchAll(/class="(cm-[a-z0-9_ -]+)"/g)]
		.flatMap(m => m[1].split(/\s+/)));
	// BOTH layers, not just components.css. A class is part of the library
	// whether it is a component or a base utility, and reading one file
	// meant every base-layer class had to be excepted by name - which is
	// how `cm-sr-only` was already special-cased here. The rail added a
	// second one (`cm-shell`) and the honest fix was to read both layers
	// rather than to grow the exception list.
	const all = ['src/styles/components.css', 'src/styles/base.css']
		.map(f => read(f).replace(/\/\*[\s\S]*?\*\//g, ''))
		.join('\n');
	for (const c of demoed) {
		assert(new RegExp(`\\.${c}(?![a-z0-9_-])`).test(all),
			`the showcase demos .${c} but neither components.css nor base.css defines it`);
	}
});

/* ================= the rail never wraps into columns ================= */

check('the rail and its link list are both a single unwrapped column', () => {
	// The bar's nav and link list are `flex-wrap: wrap` so a long bar
	// wraps instead of forcing sideways page scroll. In the RAIL that
	// inherited wrap is the defect: a COLUMN that wraps turns into a
	// two-column grid once the children stop fitting the viewport HEIGHT,
	// and the rail's own `overflow: hidden` then clips the second column
	// away. Measured at 1280x500: links 1-7 at x=8, links 8-14 at x=143.
	// Height is the variable, so every claim here is about `flex-wrap`,
	// which cannot be checked by reading a screenshot.
	// These selectors are each split across several additive rules, so the
	// property that matters is the LAST declaration to win, not "present in
	// every block". Assert the effective value.
	for (const sel of ['.cm-header--rail .cm-header__nav', '.cm-header--rail .cm-header__links']) {
		const rules = ruleBodies(comp, sel);
		assert(rules.length >= 1, `${sel} has no rule in the library`);
		const declared = rules
			.flatMap((b) => [...b.matchAll(/flex-wrap:\s*([a-z]+)/g)].map((m) => m[1]));
		assert(declared.length >= 1, `${sel} never declares flex-wrap, so it inherits the bar's wrap`);
		assert(
			declared[declared.length - 1] === 'nowrap',
			`${sel} still wraps: the rail is a COLUMN and a wrapping column becomes a second column`,
		);
	}
});

check('the rail link list fills the rail instead of shrink-wrapping', () => {
	// `align-items: flex-start` on the nav makes a flex child shrink to
	// its content unless it opts out. Without `align-self: stretch` the
	// list measured 133px inside a 231px rail, and at short heights it
	// slid to x=158 — 59px past the rail, over the content.
	const rules = ruleBodies(comp, '.cm-header--rail .cm-header__links');
	const body = rules.join('\n');
	assert(/align-self:\s*stretch/.test(body), 'the list shrink-wraps: it needs align-self: stretch');
	assert(/width:\s*100%/.test(body), 'the list has no width: 100% to back up align-self');
});

check('a short window scrolls the rail rather than hiding links', () => {
	// The point of `overflow-y: auto` is that a short window can still
	// reach every destination. Assert the declaration is there; the
	// geometry is proved by tests/verify-rail-short-window.py, which
	// scrolls a real WebKit viewport and checks all 14 are reachable.
	const body = ruleBodies(comp, '.cm-header--rail .cm-header__links').join('\n');
	assert(/overflow-y:\s*auto/.test(body), 'the list cannot scroll, so a short window hides links');
});

/* ================= the showcase section index agrees with the document ================= */

// One derived value for the "is this section reachable" checks below. The
// nav is built from SECTION_ORDER rather than a restated list of `href`s,
// so a check that greps for a literal `href: '#x'` reports a section as
// unreachable when it is exactly as reachable as before.
const showcaseIndex = (() => {
	const m = read('src/pages/index.astro').match(/const SECTION_ORDER = \[([\s\S]*?)\]/);
	if (!m) return [];
	return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"].*$/g, '')).filter(Boolean);
})();



// The rail is a scroll-spy: it highlights whichever section you are in, so
// the nav order and the DOM order are the SAME list stated twice. Shipped
// broken once already — the nav said `lists -> ... -> layout -> forms`
// while the page had `forms` directly after `lists`, so scrolling lit up
// `forms` early and then jumped back up to `states`. A section that exists
// with no nav link (`surface`) is the same bug wearing a quieter hat: the
// spy skips it entirely, so no rail row is ever highlighted while you are
// reading it.
//
// One array, SECTION_ORDER, feeds both. These checks are what keep it true.

check('the showcase declares one section index, and the nav is built from it', () => {
	const page = read('src/pages/index.astro');
	const decl = page.match(/const SECTION_ORDER = \[([\s\S]*?)\]/);
	if (!decl) throw new Error('SECTION_ORDER is gone; the nav must derive from it, not restate it');
	assert(/links=\{SECTION_ORDER\.map/.test(page),
		'the nav is not built from SECTION_ORDER, so the two can drift again');
	assert(/extraLinks/.test(page), 'the external links were dropped from the nav');
});

check('every id in the section index is a real section in the markup', () => {
	const page = read('src/pages/index.astro');
	const order = [...page.matchAll(/const SECTION_ORDER = \[([\s\S]*?)\]/g)][0][1]
		.split(',')
		.map((x) => x.trim().replace(/^['"]|['"].*$/g, ''))
		.filter(Boolean);
	assert(order.length >= 10, `only ${order.length} sections in the index`);
	const sections = [...page.matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]);
	// A duplicated id is a real HTML bug and it also breaks anchor jumps.
	assert(new Set(sections).size === sections.length,
		`duplicate section id in the markup: ${sections.length} sections, ${new Set(sections).size} unique`);
	const missing = order.filter((id) => !sections.includes(id));
	assert(missing.length === 0,
		`the index names sections the page does not render: ${missing.join(', ')}`);
	// The inverse: a section nobody can navigate to.
	const unlinked = sections.filter((id) => !order.includes(id));
	assert(unlinked.length === 0,
		`the page renders sections with no nav link, so the scroll-spy skips them: ${unlinked.join(', ')}`);
});

check('the section index is in the order the sections actually appear', () => {
	const page = read('src/pages/index.astro');
	const order = [...page.matchAll(/const SECTION_ORDER = \[([\s\S]*?)\]/g)][0][1]
		.split(',')
		.map((x) => x.trim().replace(/^['"]|['"].*$/g, ''))
		.filter(Boolean);
	const sections = [...page.matchAll(/<section id="([\w-]+)"/g)].map((m) => m[1]);
	// This is the check the bug needed. Comparing the two lists directly
	// names the first place they disagree, so the failure says WHICH pair
	// is out of order instead of just "not equal".
	for (let i = 0; i < order.length; i++) {
		if (order[i] === sections[i]) continue;
		throw new Error(
			`the index and the document disagree at position ${i + 1}: ` +
			`the nav says "${order[i]}" but the page has "${sections[i]}" there. ` +
			`The rail is a scroll-spy, so it highlights in the wrong order.`,
		);
	}
});

/* ================= the bar never paints outside its own box ================= */

check('the bar keeps one nav row between the phone drawer and the rail', () => {
	// A wrapped nav row is not "tidy", it is a rendering bug. The bar's
	// nav is `flex-wrap: wrap` with a FIXED 60px height, and both the list
	// and the header are `overflow: visible`, so a second row painted
	// below the header box and over the page content. Measured at 700px:
	// the list ran y=35 to y=77 inside a header ending at y=61, and
	// `elementFromPoint(200, 70)` returned a `.cm-header__link`.
	// Height is what exposes it, so no screenshot of a tall window shows
	// the defect; a hit-test at a y inside the header must always return
	// the header, and the nav must never be a scroller in the rail.
	// The band rule has to exist, and it has to be BETWEEN the drawer
	// breakpoint and the rail breakpoint, not inside the rail query.
	assert(
		/@media \(min-width: 641px\) and \(max-width: 999px\)/.test(comp),
		'the band between the phone drawer and the rail is not handled: a wrapped nav row paints outside the header',
	);
	// `nowrap` on the nav is what stops the wrap; `nowrap` on the LIST is
	// what stops the list wrapping inside the row.
	// The rail anchor must match the RAIL rule, not any query that opens
	// with the same width: a bare indexOf('@media (min-width: 1000px)')
	// also found the inline-row handoff added next to it, and reported
	// the band rule as "out of order" against a rule 700 lines away. A
	// check anchored on a string another rule can satisfy is worthless.
	// Anchored on the rail's own selector, which nothing else carries --
	// and not on the brace right after the query, which a comment sits
	// between.
	const bandAt = comp.indexOf('@media (min-width: 641px) and (max-width: 999px)');
	const railAt = comp.indexOf('@media (min-width: 1000px)');
	const railRuleAt = comp.indexOf('.cm-header--rail {', railAt);
	assert(bandAt > -1 && railAt > -1 && railRuleAt > -1,
		`could not locate both rules: band=${bandAt} rail=${railAt} rule=${railRuleAt}`);
	assert(railRuleAt > bandAt, 'the band rule and the rail rule are out of order');
	const slice = comp.slice(bandAt, railRuleAt);
	assert(/\.cm-header__nav\s*\{[^}]*flex-wrap:\s*nowrap/.test(slice),
		'the bar nav still wraps in the band, so a second row can paint below the header');
	assert(/\.cm-header__links\s*\{[^}]*flex-wrap:\s*nowrap/.test(slice),
		'the link list still wraps in the band');
	// A horizontal scroller is the intended fallback, and it must not
	// paint a scrollbar into the bar.
	assert(/overflow-x:\s*auto/.test(slice),
		'the band row cannot scroll sideways, so a link that does not fit is unreachable');
	// Comments are stripped first. A prose comment that names the
	// declaration reads as the declaration to a naive regex, which is how
	// this assertion passed while the property was set to `auto` — the
	// same trap as the tooltip cap and the ResizeObserver check in this
	// file. Match the DECLARATION, anchored to the start of a line.
	const sliceBare = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	assert(/^\s*scrollbar-width:\s*none\s*;/m.test(sliceBare),
		'the band row will paint a scrollbar into a 60px bar');
});

/* ================= sync means the consumer USES the library ================= */

check('a synced consumer is not just a consumer with the same files', () => {
	// `check-design-sync.sh` compares the CSS and JS by bytes and reports
	// "in sync". That is a statement about FILES. It is not a statement
	// about USE, and the two came apart badly enough to be worth a test.
	//
	// All three consumers were reported "in sync" while dev-blog was
	// shipping a header built from its own un-prefixed classes -- brand,
	// internal-links, controls, plain `<header>` -- and never rendering
	// `.cm-header` in its markup at all. Its `Header.astro` was imported
	// on four pages and styled by a stylesheet the library owns, which is
	// exactly what made "in sync" look like adoption.
	//
	// The reachable claim is narrower and is the one that matters: if a
	// consumer's stylesheet defines a rule for a class, some page of that
	// consumer must put that class in the DOM. Otherwise the library was
	// copied in, never adopted, and a change to it cannot be verified
	// against the site that is supposed to display it.
	const script = read('scripts/check-design-sync.sh');
	assert(/cm-header/.test(script),
		'the sync checker does not know what class the library header uses');
});

/* ================= the deploy serves the build, not the README ====== */
// This is a test of the PUBLISHED site, not of the source. It has no way
// to run in a unit suite, so it is asserted two ways: here, that the
// workflow publishes the way Pages is actually configured, and in
// tests/verify-live-deploy.py, which fetches the real URL.
//
// The failure this encodes: Pages was configured source={branch:master,
// path:/} while the workflow used actions/deploy-pages. Those are two
// incompatible mechanisms. Classic Pages published the repo ROOT, so
// GitHub rendered README.md as the homepage and the Astro build was
// never served. Every workflow reported success the whole time -- the
// build ran, the artifact uploaded, the deploy step went green -- and
// ui.mrx.sh showed a page with no <header> and a title from a commit
// three days prior. Verified green for 3 days while shipping nothing.
const workflow = read('.github/workflows/deploy.yml');
check('the deploy uses the GitHub Actions Pages publisher', () => {
	// A classic source and a workflow publisher cannot both be in play.
	assert(/actions\/deploy-pages/.test(workflow),
		'the deploy job does not use actions/deploy-pages');
	assert(/actions\/upload-pages-artifact/.test(workflow),
		'the build job never uploads a Pages artifact');
});

// The artifact has to be the BUILD, not the repository. Uploading the
// repo root is exactly the bug: it publishes README.md.
check('the published artifact is the build, not the repository', () => {
	assert(/path:\s*dist\b/.test(workflow),
		'the uploaded artifact is not dist; the repo root would serve README.md');
});

// A CNAME in the repo is only a suggestion; the Pages setting is the
// thing that binds the domain. Keep the file honest about why it exists.
check('the CNAME matches the domain the build publishes', () => {
	assert(/SITE_URL:\s*https:\/\/ui\.mrx\.sh/.test(workflow),
		'the build publishes a different origin than the CNAME claims');
});

/* ================= an extraLink renders something ================= */
console.log('\nheader icon links');
{
	const hdr = read('src/astro/Header.astro');
	// The absence was INVISIBLE: the <a> rendered, the href was right,
	// the link was focusable -- and it measured width 0, because its
	// only child was the sr-only label. A link that is present in the
	// DOM and absent from the screen is the hardest kind of missing.
	check('an extraLink with no artwork still gets a built-in mark', () => {
		assert(/const ICON: Record<string, string>/.test(hdr),
			'the library ships no built-in marks, so an extraLink with no ' +
			'icon renders as a zero-width invisible link');
	});

	check('the built-in mark is raw HTML, not a slot fallback', () => {
		// A named slot's fallback content is ESCAPED as text. Passing the
		// mark that way rendered `&lt;svg ...` literally: the link measured
		// 337x625 of visible angle brackets and contained no SVG at all.
		const i = hdr.indexOf('icon-${l.label.toLowerCase()}');
		assert(i > 0, 'the icon slot is gone entirely');
		const around = hdr.slice(Math.max(0, i - 400), i);
		assert(/set:html=\{ICON\[/.test(around),
			'the built-in mark must render via set:html; a slot fallback ' +
			'escapes it and the button turns into literal markup text');
	});

	check('the github mark is the real path, not a truncated one', () => {
		const m = hdr.match(/d="(M8 0C3\.58[^"]+)"/);
		assert(m, 'no github path found in the library header');
		// A mangled path (a bad transform, a clipped curve) still parses
		// and still has a long `d`, so length alone proves nothing: the
		// authoritative copy is dev-blog's, byte for byte.
		assert(m[1].length === 570,
			`the github path is ${m[1].length} chars; the real mark is 570`);
	});
}

/* ================= the mobile drawer is one column ================= */
console.log('\nmobile drawer');
{
	const css = read('src/styles/components.css');
	// The drawer block is the one that is `position: fixed` and
	// `flex-direction: column`. `ruleBodies` strips comments, so a
	// match on the comment that explains the fix cannot satisfy this.
	// `.cm-header__links` is used by THREE rules: the bar row, the
	// drawer, and the 641-999px band. Taking the last one in source
	// order reads the BAND's `nowrap`, so the test passed with the
	// drawer's own `nowrap` deleted -- it was asserting a sibling.
	// The drawer is the rule that is `position: fixed`, so scope to
	// that body and read the winner inside it.
	const drawerBody = ruleBodies(css, '.cm-header__links')
		.find((b) => /position:\s*fixed/.test(b));
	const decl = (prop) => {
		if (!drawerBody) return null;
		const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;}]+)')
			.exec(drawerBody);
		return m ? m[1].trim() : null;
	};

	check('the drawer is a column, so its wrap runs across', () => {
		assert(/column/.test(decl('flex-direction') || ''),
			'the drawer is no longer a flex column');
	});

	check('the drawer does not wrap into a second column', () => {
		const w = decl('flex-wrap');
		assert(w === 'nowrap',
			`the drawer's effective flex-wrap is '${w}', not nowrap. A ` +
			'column with wrap breaks into a SECOND COLUMN when the rows ' +
			'stop fitting the panel height, and the panel is 320px wide, ' +
			'so the wrapped links land outside it and cannot be reached: ' +
			'at 402x667, layout/forms/auth/readme stranded at x=179.');
	});

	check('the drawer is allowed to scroll instead', () => {
		assert(/auto|scroll/.test(decl('overflow-y') || ''),
			'the drawer cannot scroll, so a short window strands the last links');
	});
}

/* ================= the desktop nav rail ================= */
console.log('\ndesktop nav rail');
const RAIL_CSS = read('src/styles/components.css');
const RAIL_START = RAIL_CSS.indexOf('/* ============================================================\n   The desktop nav rail');
const RAIL_END = RAIL_CSS.indexOf('/* ============================================================\n   Records: stat tiles');
const RAIL = RAIL_START > -1 ? RAIL_CSS.slice(RAIL_START, RAIL_END) : '';
const RAIL_HDR = read('src/astro/Header.astro');
const TOK = read('src/styles/tokens.css');

check('the rail ships as a block scoped above the rail breakpoint', () => {
	assert(RAIL !== '', 'the rail block is missing from components.css');
	// Below the breakpoint the header must still be a bar. A rail rule
	// outside the query would take the phone layout with it.
	assert(/@media \(min-width: 1000px\)/.test(RAIL),
		'the rail rules are not inside a min-width query, so they apply on a phone');
});

check('the rail is opt-in, so a consumer that did not ask for it is unaffected', () => {
	assert(/\.cm-header--rail/.test(RAIL),
		'the rail is not keyed off a modifier class');
	// No bare .cm-header rule may be altered by the rail block: a consumer
	// that never sets the modifier has to keep the bar.
	const bare = RAIL.match(/^\s*\.cm-header\s*\{/m);
	assert(!bare, 'the rail block styles .cm-header itself, which every consumer gets');
});

check('the rail width is a token, not a literal', () => {
	assert(/--rail-w:/.test(TOK), '--rail-w is not declared in tokens.css');
	assert(/width: var\(--rail-w\)/.test(RAIL),
		'the rail hardcodes a width instead of reading --rail-w');
	assert(!/width: 2\d\dpx/.test(RAIL), 'a raw px width crept into the rail');
});

check('the rail link rules reach a grouped link without styling a SPECIMEN', () => {
	// The showcase demonstrates the link style with bare .cm-header__link
	// elements. A descendant-of-the-list selector restyled those specimens
	// as rail rows.
	//
	// REVERSED IN PART (2026-10-05, adopting kanban). This used to require
	// the rail link rule to be `>`-scoped. That was true for the SPECIMEN
	// reason above and false for the CONSUMER reason below: a rail whose
	// links are grouped nests a second `.cm-header__links` inside each
	// `.cm-header__group`, so a `>`-only rule matches nothing and the
	// grouped rail loses the tap floor AND the current-page marker
	// (measured 34px rows and border-left-width 0px in WebKit at
	// 1280x900, against 44px and 2px for a flat rail).
	//
	// So the guarantee is now split into two claims, and both matter:
	//   1. a SPECIMEN-safe rule: nothing under `.cm-header--rail` matches a
	//      bare `.cm-header__link` with NO list and no group between them.
	//   2. a GROUPED-safe rule: `.cm-header__group .cm-header__link` is
	//      styled, which is what the `>` was silently excluding.
	// The old single assertion could not tell those apart, which is why it
	// was happy for years against a rail that did not work.
	assert(/^\.cm-header--rail \.cm-header__link\s*\{/m.test(RAIL) === false,
		'a bare .cm-header--rail .cm-header__link rule will style the showcase specimens');
	assert(ruleBodies(comp, '.cm-header--rail .cm-header__group .cm-header__link').length > 0,
		'no rail rule styles a link inside .cm-header__group, so a grouped rail ' +
		'gets no tap floor and no current-page marker');
});

check('a rail link keeps the tap floor', () => {
	// Read the rule that owns the property, and read it by SELECTOR LIST
	// rather than by the `>` alone: after the fix the grouped case is a
	// second selector on the SAME rule, and a regex pinned to the flat
	// selector plus `\s*\{` no longer matches a comma-joined rule. The
	// mutation this must still catch is flattening `min-height` to `0` on
	// the rail link rule.
	const m = RAIL.match(/\.cm-header--rail \.cm-header__links > \.cm-header__link[^{]*\{([^}]*)\}/);
	assert(m, 'the rail link rule is missing');
	// Declaration-anchored: the rail block explains the 44px floor in a
	// comment, so a bare `min-height: var(--tap)` search was satisfied by
	// the prose describing it.
	assert(/^[ 	]*min-height:\s*var\(--tap\);/m.test(m[1]),
		'a rail link drops the 44px tap floor');
});

check('the rail is a bounded column, so a long list scrolls instead of escaping', () => {
	// Must match a DECLARATION. The rail block explains `height: 100vh` in a
	// comment, so a bare regex was satisfied by the prose explaining it.
	assert(/^[ \t]*height:\s*100vh;/m.test(RAIL),
		'the rail is not bounded to the viewport height');
	// Must be inside the rail's OWN link list rule. The mobile drawer already
	// had `overflow-y: auto` and an unscoped regex was satisfied by it.
	const lm = RAIL.match(/\.cm-header--rail \.cm-header__links\s*\{([^}]*)\}/);
	assert(lm, 'the rail link list rule is missing');
	assert(/overflow-y:\s*auto/.test(lm[1]),
		'the link list cannot scroll, so a long nav runs off the bottom');
	assert(/min-height:\s*0/.test(lm[1]),
		'the list is a flex child without min-height: 0, so it will not shrink to scroll');
});

check('the rail clears the content, and the measure stays centred beside it', () => {
	assert(/\.cm-shell--rail/.test(RAIL), 'nothing offsets the content clear of the rail');
	assert(/padding-left:\s*calc\(var\(--rail-w\)/.test(RAIL),
		'the shell offset is not derived from --rail-w');
	// `margin: 0 auto` in base.css centres main on the VIEWPORT. Left
	// alone, the rail overlapped the first section by 58px at 1440.
	assert(/\.cm-shell--rail\s*\{[^}]*margin-inline:\s*0/.test(RAIL),
		'main keeps margin: 0 auto and re-centres on the viewport, overlapping the rail');
	assert(/\.cm-shell--rail > \*/.test(RAIL),
		'the measure is not re-imposed inside the space beside the rail');
});

check('the header opts in through a documented rail prop', () => {
	assert(/^\trail\?: boolean;$/m.test(RAIL_HDR),
		'Header.astro does not declare a rail prop');
	assert(/rail = false/.test(RAIL_HDR), 'the rail prop does not default to off');
	assert(/class:list=\{\['cm-header', rail && 'cm-header--rail'\]\}/.test(RAIL_HDR),
		'the rail modifier class is not applied conditionally');
});

check('the showcase opts in, and a mobile reader still gets the burger', () => {
	const page = read('src/pages/index.astro');
	// `/rail/` was satisfied by a sentence of prose about a rail being drawn
	// on an item. The opt-in is the PROP on the <Header> call, so anchor
	// there: a bare `rail` line inside the tag's attribute block.
	// The prop sits at the END of a long `links` array, so the window has to
	// span that whole attribute block. A tight window silently passed.
	assert(/<Header[\s\S]{0,4000}?\n\s*rail\b[\s\S]{0,400}?\/>/.test(page),
		'the showcase never sets the rail prop on its <Header>');
	// The INTENT is that <main> carries the rail offset so the sticky header
	// rail does not sit on top of the content. Pinning the whole class string
	// broke the moment the page also became a stack (it now reads
	// `cm-shell cm-shell--rail cm-stack cm-stack--section`), which is a
	// legitimate change - so assert the rail is PRESENT, not that it is
	// alone.
	assert(/<main class="[^"]*\bcm-shell--rail\b/.test(page),
		'the showcase does not offset its own content for the rail');
	// The burger is a phone control. In rail mode the links are permanent,
	// so the button would open something already open.
	assert(/\.cm-header--rail \.cm-nav-toggle\s*\{\s*display:\s*none/.test(RAIL),
		'the burger is still rendered beside a permanently-visible rail');
});

/* ================= page-shape layout ================= */
console.log('\npage-shape layout');
const LAYOUT_CLASSES = ['cm-lede', 'cm-split', 'cm-split__aside', 'cm-back', 'cm-back__arrow'];

/* True iff some rule in `css` actually DECLARES `cls`.
 *
 * A substring search is not "defined". The name also occurs inside a
 * COMPOUND selector (`.cm-back:hover .cm-back__arrow`) and inside the
 * explanatory comments, and both scored as a definition: the mutation
 * check deleted the whole rule and the suite stayed green twice. So
 * this walks the rules, and requires the class to be a selector on its
 * own. A selector containing a space needs an ANCESTOR, which means the
 * class is being styled conditionally rather than defined here.
 */
/* Rule bodies for an exact selector. Selector LISTS are split, so
   `a, b { … }` yields a body for `a` and a body for `b` separately — a
   `[^}]*` scan over the raw text runs past a comma and reads the wrong
   declaration. Comments are stripped first: a prose comment naming a
   sibling selector reads as a selector to a naive scan, and an
   assertion can then pass on a sentence that describes the property
   instead of declaring it. That is how `height: 100vh` came to be
   "asserted" by a comment quoting itself. */
function ruleBodies(css, sel) {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const out = [];
	for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const selectors = m[1].split(',').map((x) => x.trim());
		if (selectors.includes(sel)) out.push(m[2]);
	}
	return out;
}

// EVERY body of an at-rule, in source order. `ruleBodies` cannot reach
// inside one: its regex matches the INNER rule as the BODY of the outer
// at-rule match, so the inner selector never appears in `m[1]` and a rule
// that only exists on a coarse pointer reads as undefined - a silent
// wrong answer, not a failing one. (Same reason an indexed [0] into the
// result was wrong: there are many `(pointer: coarse)` blocks and the one
// that matters is not the first.) Returns the bodies CONCATENATED so a
// caller can assert a rule lives somewhere in the at-rule, not in a
// particular one.
function allAtRuleBodies(css, prelude) {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const out = [];
	const needle = prelude + ' {';
	let at = bare.indexOf(needle);
	while (at >= 0) {
		const open = bare.indexOf('{', at);
		let depth = 0;
		for (let i = open; i < bare.length; i++) {
			if (bare[i] === '{') depth++;
			else if (bare[i] === '}') {
				depth--;
				if (depth === 0) { out.push(bare.slice(open + 1, i)); break; }
			}
		}
		at = bare.indexOf(needle, at + 1);
	}
	return out.join('\n');
}

function isDeclared(css, cls) {
	const bare = new RegExp(`^\\.${cls}(?![\\w-])$`);
	for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
		const sel = m[1].trim();
		if (sel.startsWith('@')) continue; // at-rule prelude, not a selector
		for (const part of sel.split(',')) {
			const one = part.trim();
			if (one && !/\s/.test(one) && bare.test(one)) return true;
		}
	}
	return false;
}

/* The set of classes the showcase actually puts on an element. Parsed by
   splitting the ATTRIBUTE on whitespace rather than by matching a token
   with `\b`: `_` is a word character in JS regex, so `\bcm-back__arrow\b`
   silently fails to match inside a longer name. The mutation check caught
   exactly that: the test stayed green with the class undefined. */
const demoedClasses = new Set(
	[...showcase.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
);

check('the page-shape classes are defined and demonstrated', () => {
	for (const c of LAYOUT_CLASSES) {
		// "Appears somewhere in the file" is NOT "is defined". A class name
		// also occurs inside a COMPOUND selector (`.cm-back:hover
		// .cm-back__arrow`) and inside the explanatory comments, and a
		// substring search scored both as a definition: the mutation check
		// deleted the whole rule and the suite stayed green. Require a real
		// declaration - the class immediately followed by a block - in
		// comment-stripped source.
		assert(isDeclared(compSrc, c),
			`.${c} is used by the showcase but components.css never defines a rule for it`);
		assert(demoedClasses.has(c),
			`.${c} is defined in the library but the showcase never demonstrates it`);
	}
});

/** Like isDeclared, for a bare ELEMENT selector (`strong`, `b`, `label`).
 *  isDeclared anchors on a leading dot, because it answers "is this
 *  .class defined"; an element has no dot and would never match. Same
 *  comment-stripping and same compound-selector rules for the same reasons. */
function isElementDeclared(css, tag) {
	const bare = new RegExp(`^${tag}(?![\\w-])$`);
	for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
		const sel = m[1].trim();
		if (sel.startsWith('@')) continue; // at-rule prelude, not a selector
		for (const part of sel.split(',')) {
			const one = part.trim();
			// A selector containing a space names an ANCESTOR, so the tag
			// is being styled conditionally rather than defined here.
			if (one && !/\s/.test(one) && bare.test(one)) return true;
		}
	}
	return false;
}

check('emphasis is an element default, so a bare <strong> is on-brand', () => {
	// The same argument the form controls already make, for a different
	// reason. `strong` is a bare ELEMENT: oem-log re-declared it in two
	// separate pages, in two separate scoped blocks, before it was
	// declared once here. A consumer writing <strong> with no class is
	// the case that has to work, so this must be a selector of its own
	// and not a `.cm-*` rule.
	//
	// isDeclared, not `base.includes('strong')`: the word also appears
	// inside the comment block explaining why the rule exists, and a
	// substring check scored that prose as a definition. That is the
	// exact trap the deletion mutation below is here to catch.
	assert(isElementDeclared(base, 'strong'),
		'strong is not declared as a bare element selector in base.css');
	assert(isElementDeclared(base, 'b'),
		'b is not declared as a bare element selector in base.css');

	// One owner per rule. A second declaration in components.css would be
	// a silent cascade race, which is how a consumer ends up with a
	// different strong than the one the library documents.
	const owners = [base, comp].filter((css) => isElementDeclared(css, 'strong')).length;
	assert(owners === 1,
		`strong is declared in ${owners} layers; exactly one owner per rule`);

	// Both cues, not one. Colour alone is what the browser gives you and
	// it is a ~1.6:1 nudge inside --ink-dim prose, which is not emphasis.
	// Weight alone survives, but the house style carries the step too,
	// and it is the same --ink/--ink-dim pair the row title uses.
	//
	// Read the body from COMMENT-STRIPPED source. The block above this
	// rule explains why it exists, and a regex over the raw file matches
	// that prose as readily as the rule - the same class of bug the
	// deletion mutation is here to catch.
	const baseNoComments = base.replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = /(?:^|\n)strong,\s*b\s*\{([^}]*)\}/.exec(baseNoComments);
	assert(rule, 'could not parse the strong/b rule body');
	assert(/font-weight:\s*700/.test(rule[1]),
		'emphasis must carry a weight cue, not colour alone');
	assert(/color:\s*var\(--ink\)/.test(rule[1]),
		'emphasis must step to --ink, not a hardcoded colour');
	// A hardcoded hex here would be a rebrand bug and would not follow
	// the theme. Token-only, so both themes come along for free.
	assert(!/#[0-9a-f]{3,6}/i.test(rule[1]),
		'the emphasis colour must come from a token, not a literal hex');
	// And the showcase must actually RENDER one, in a dim paragraph, or the
	// rule is shipped undemonstrated and the next person reads the CSS
	// instead of the page. A bare <strong> with a class on it would prove
	// nothing, so the specimen must carry none.
	const prose = showcase.slice(showcase.indexOf('id="prose"'),
		showcase.indexOf('id="layout"'));
	assert(prose.length > 0, 'the prose section is missing from the showcase');
	const strongs = [...prose.matchAll(/<strong([^>]*)>/g)];
	assert(strongs.length > 0, 'the showcase demonstrates no <strong>');
	for (const attrs of strongs) {
		assert(!/class=/.test(attrs[1]),
			`the emphasis specimen must be a BARE <strong>, found attributes:${attrs[1]}`);
	}
	// ...and it has to sit inside DIM prose, which is the only case the
	// default is for. `.cm-prose` is itself --ink, so a <strong> there
	// computes to the same colour as its paragraph and the specimen
	// proves nothing - it is green, rendered, and invisible. Caught by
	// measuring, not by reading the markup. The lede is --ink-dim, which
	// is where every consumer was re-declaring the rule.
	assert(/class="cm-lede"[\s\S]*?<strong>/.test(prose),
		'the emphasis specimen must sit in dim prose (.cm-lede), not in .cm-prose, which is already --ink');
	const inProse = prose.slice(prose.indexOf('class="cm-prose"'),
		prose.indexOf('</div>', prose.indexOf('class="cm-prose"')));
	assert(!/<strong/.test(inProse),
		'a <strong> inside .cm-prose is invisible: that block is --ink, so the specimen demonstrates nothing');
});

check('the emphasis colour is legible on the surfaces it renders on', () => {
	// The rule above can be structurally perfect and still be unreadable.
	//
	// The quantity WCAG actually asks about is the text against its
	// SURFACE, not against the paragraph sitting beside it: --ink
	// emphasised inside a --ink-dim paragraph is still required to clear
	// 4.5:1 against --bg / --panel behind both. An earlier draft of this
	// test asserted the dim->ink ratio at 4.5:1, which is measuring the
	// wrong thing - that step is a RELATIVE cue and it is 2.2:1, on
	// purpose, because the library's own faint->dim step is only 1.24:1.
	// What is asserted here is legibility; the step is asserted below as
	// a step, against the library's existing step rather than a magic
	// number of its own.
	// varOf already reads the Nth declaration per document theme from the
	// real file and asserts both themes declare the token, which is the
	// indexing this needs. `bg-2` has to be passed as a bare name: the
	// helper builds `--${name}:`, and writing the token with its dashes
	// would look for `--bg-2:` under the name "bg-2", which is the same
	// string, so a failure here is the token being absent, not the
	// pattern.
	for (const theme of ['dark', 'light']) {
		for (const surface of ['bg', 'bg-2', 'panel']) {
			const ratio = contrast(varOf(surface, theme), varOf('ink', theme));
			assert(ratio >= 4.5,
				`${theme}: --ink on --${surface} is ${ratio.toFixed(2)}:1, under AA 4.5:1`);
		}
	}

	// The emphasis must also be a VISIBLE step against the dim prose it
	// sits in - a token change that quietly flattened the two to the same
	// value would still pass every legibility check above while making
	// <strong> mean nothing. Compared to the library's own subtle
	// faint->dim step rather than to a number invented here.
	const subtle = contrast(varOf('ink-faint', 'dark'), varOf('ink-dim', 'dark'));
	const emphasis = contrast(varOf('ink-dim', 'dark'), varOf('ink', 'dark'));
	assert(emphasis > subtle,
		`--ink-dim->--ink (${emphasis.toFixed(2)}:1) is not a more visible step than --ink-faint->--ink-dim (${subtle.toFixed(2)}:1)`);
});

check('the measure tokens are declared once, in :root, and theme-independent', () => {
	for (const name of ['--measure', '--measure-narrow', '--measure-title']) {
		const all = [...tokenSrc.matchAll(new RegExp(`${name}\\s*:`, 'g'))];
		assert(all.length === 1, `${name} is declared ${all.length} times; it must exist once in :root`);
	}
	// A measure is a property of the font, not of a theme. Redeclaring it
	// per theme would let light and dark silently disagree about how long a
	// line is, which is exactly the "0 violations by two themes" trap.
	const themed = [...tokenSrc.matchAll(/(data-theme[^{]*)\{([^}]*)\}/g)]
		.flatMap(m => [...m[2].matchAll(/--(?:measure)[\w-]*\s*:/g)]);
	assert(themed.length === 0, 'a measure token is redeclared inside a theme block');
});

check('a page-shape width comes from a measure token, not a typed ch literal', () => {
	// The failure this catches is the one that shipped: a consumer (and
	// once this library) wrote `max-width: 34ch` inline, so the reading
	// width was a number in a rule instead of a named decision in the
	// scale. `ch` is only legal in tokens.css.
	const css = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const literals = [...css.matchAll(/\b(max|min)-width:\s*([\d.]+)ch\b/g)];
	assert(literals.length === 0,
		`a component hardcodes a measure in ch (${literals.map(m => m[0]).join(', ')}); use var(--measure)`);
	// ...and the showcase must not reintroduce one either.
	const demo = showcase.slice(showcase.indexOf('id="layout"'));
	const end = demo.search(/<section id="/);
	const block = end > 0 ? demo.slice(0, demo.indexOf('id="', 10)) : demo;
	const demoLiterals = [...block.matchAll(/\b(max|min)-width:\s*([\d.]+)ch\b/g)];
	assert(demoLiterals.length === 0,
		`the layout specimen hardcodes a measure (${demoLiterals.map(m => m[0]).join(', ')})`);
});

// The inline row gives its title and excerpt a FIXED column each, so a
// list reads as a table rather than a ragged stack of lines. Two things
// have to hold, and the second is the one that shipped broken.
//
// 1. Both columns name a measure TOKEN. A `ch` literal here is a
//    rebrand bug (the check above rejects those in components.css).
// 2. There is a width at which the row cannot afford both, and at that
//    width the excerpt is HANDED OFF, not squeezed. With a fixed basis
//    and no handoff the title never gives ground, the excerpt absorbs
//    the entire deficit, and it collapses: measured in WebKit at 700px
//    it rendered 5.11px wide -- present, non-zero, unreadable, and a
//    false pass for any check that only asks whether the column
//    collapsed. A non-zero box is not a readable box.
check('the inline row names both of its columns with measure tokens', () => {
	const inline = comp.match(/^\.cm-rows--inline \.cm-row__title\s*\{[^}]*\}/m);
	assert(inline, 'no .cm-rows--inline .cm-row__title rule found');
	// ORDERING: the shrink check comes FIRST on purpose. `flex: 0 1` is
	// both a shrink AND a wrong basis, so an exact-match assertion above
	// would fire first and the specific claim below would be unreachable
	// — a test that can never fail. Asserting the shrink property BEFORE
	// the exact string means the mutation trips the assertion that
	// explains WHY, which is the one worth reading when it goes red.
	assert(!/flex:\s*0\s+1\s/.test(inline[0]),
		'the inline title must not shrink; it is the primary label and never truncates');
	// The BASIS must still name the token and must still refuse to give
	// ground (flex-grow 0, flex-shrink 0). It may be wrapped in
	// `min(..., 100%)`: that is the same token, capped at the width the
	// row actually has, which is what keeps a 320px viewport from
	// being widened by a 42ch title the row cannot afford. Asserting the
	// exact string here would forbid the cap and re-open a 204px
	// sideways scroll, so the test names the two properties instead.
	assert(/flex:\s*0 0 (min\(var\(--measure-title\),\s*100%\)|var\(--measure-title\))/.test(inline[0]),
		`the inline title's basis must be var(--measure-title) with no grow and no shrink, got: ${inline[0]}`);
	// Same reasoning as the basis above: the cap must come from the
	// token, and may be `min(token, 100%)` so a narrow row is never
	// promised width it does not have.
	assert(/max-width:\s*(min\(var\(--measure-title\),\s*100%\)|var\(--measure-title\))/.test(inline[0]),
		'the inline title cap must come from --measure-title');
});

check('the inline row hands the excerpt off instead of starving it', () => {
	// Both starve bands, measured at 5px steps in WebKit with the
	// queries neutralized: 845px and below (5.11px at 700px), and
	// 1000-1055px where --rail-w takes 232px out of the content column
	// (93.11px at 1000px). It RECOVERS at 1060px and at 995px, so a
	// bare min-width: 1000px would hide an excerpt that measures
	// 205.11px at 1440px -- correct-looking CSS, wrong at both ends.
	const rules = [...comp.matchAll(
		/@media\s*([^{]+)\{\s*\.cm-rows--inline \.cm-row__desc\s*\{\s*display:\s*none/g)]
	assert(rules.length >= 2,
		`expected both starve bands guarded, found ${rules.length}` +
		` (a single query is wrong in at least one direction)`);
	const conds = rules.map((m) => m[1].replace(/\s+/g, ' ').trim());
	assert(conds.some((c) => /max-width:\s*84\d/.test(c)),
		`no lower handoff near the measured 844px edge: ${JSON.stringify(conds)}`);
	assert(conds.some((c) => /min-width:\s*1000px/.test(c) && /max-width:\s*10\d\d/.test(c)),
		`the rail band needs BOTH edges -- it recovers at 1060px: ${JSON.stringify(conds)}`);
});

// The --measure-title specimen is the showcase's half of the increment.
// Two things it must not be, both of which render fine and read as
// documentation: a value TYPED beside its token (it is rendered from
// `var(--measure-title)`, so retuning the token retunes the specimen),
// and a readout that restates the media queries (it measures the live
// row, because a second copy of the breakpoints is how a showcase and a
// stylesheet drift apart).
check('the --measure-title specimen is rendered from the token, not typed', () => {
	const row = showcase.match(/<div class="cm-spec__row" data-spec="measure-title">[\s\S]*?<\/div>\s*<\/div>/);
	assert(row, 'no [data-spec="measure-title"] specimen in the showcase');
	assert(/max-width:\s*var\(--measure-title\)/.test(row[0]),
		`the specimen must paint with var(--measure-title), got: ${row[0]}`);
	// A `ch` literal in the specimen is the "typed beside it" failure.
	assert(!/\d+ch/.test(row[0].replace(/<code>[^<]*<\/code>/g, '')),
		'the specimen hardcodes a ch literal instead of using the token');
});

check('the measure readout measures the row instead of restating the breakpoints', () => {
	// Scope to the readout's own body. A blanket ban on matchMedia is
	// wrong -- the burger and the rail both use it legitimately -- and the
	// first version of this check failed for that reason, which is a
	// check that can only ever be red.
	const body = runtimeSrc.match(
		/function initMeasureReadout\(\)\s*\{[\s\S]*?\n	\}/);
	assert(body, 'no initMeasureReadout function in the runtime');
	assert(!/matchMedia/.test(body[0]),
		'the readout must not use matchMedia - it measures the row, ' +
		'otherwise it restates the breakpoints and can disagree with them');
	assert(/getComputedStyle\(desc\)\.display\s*!==\s*'none'/.test(body[0]),
		'the readout must read the real computed display of the excerpt');
	// Idempotence is NOT asserted on the source shape here. A regex
	// spanning createElement..appendChild matches inside the `if (!out)`
	// guard, so the first version fired on correct code. The real proof
	// is behavioural and lives in tests/verify-measure-title-webkit.py,
	// which re-inits and COUNTS the readouts in the cell -- a stronger
	// claim than any source pattern, because it observes the stack.
	assert(/initMeasureReadout\(\);/.test(runtimeSrc),
		'initMeasureReadout is never called from init(), so it never runs');
});

check('the split stacks below its breakpoint, on purpose', () => {
	// Two columns of text on a phone is two unreadable columns, so the
	// single-column rule is the default and the two-column rule lives
	// inside a min-width query. Reversing that (1fr by default at wide,
	 // stack at narrow) is the regression: it silently ships two cramped
	// columns to every phone.
	const block = comp.slice(comp.indexOf('.cm-split {'), comp.indexOf('.cm-split__aside'));
	assert(/grid-template-columns:\s*1fr\s*;/.test(block),
		'.cm-split must default to a single column, so it stacks before the breakpoint');
	const mq = comp.slice(comp.indexOf('@media (min-width: 700px)'));
	assert(/grid-template-columns:\s*1\.6fr 1fr/.test(mq),
		'the wide case of .cm-split must be inside a min-width query and be 1.6fr/1fr');
	// The breakpoint must not be a raw px in a second place; it is the
	// one value the two rules share.
	assert((comp.match(/min-width:\s*700px/g) || []).length === 1,
		'the split breakpoint must be declared in exactly one media query');
});

/* ================= drift guard ================= */
console.log('\ndrift guard');
check('ships an executable drift checker', () => {
	assert(exists('scripts/check-design-sync.sh'), 'scripts/check-design-sync.sh missing');
	const st = statSync(join(root, 'scripts/check-design-sync.sh'));
	assert(st.mode & 0o111, 'check-design-sync.sh is not executable');
});

check('a trailing slash on the target does not invent drift', () => {
	// THE BUG THIS EXISTS FOR. Measured, not predicted.
	//
	// The shadow-copy scan decides whether a vendored file is already
	// accounted for with a STRING comparison, `[ "$f" = "$t/${pair##*:}" ]`,
	// where "$f" comes from `find "$t"` and so never has a trailing slash.
	// Pass the target as "/root/projects/links/" - which is what a
	// `for d in /root/projects/*/` loop produces, and what this repo's own
	// audit script passes - and the comparison fails, so every copy MAP
	// already owns is reported as an ORPHAN.
	//
	// All three real consumers were reported drifted for files that were
	// byte-identical. The audit that consumes the output counted only lines
	// matching STALE, so it printed the self-contradictory
	// "STALE -- 0 file(s) differ": a failure it could not explain.
	//
	// A check that cries wolf is the same end state as one that never fires
	// - it trains you to ignore the output - so the false positive is the
	// defect, and it needs its own test.
	//
	// BOTH spellings must agree. Asserting only the slashed form would
	// still pass if the script had simply learned to ignore the target it
	// was given.
	const dir = mkdtempSync(join(tmpdir(), 'cm-slash-'));
	try {
		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--public'], {
			encoding: 'utf8',
		});
		assert(inst.status === 0, `installer --public exited ${inst.status}: ${inst.stderr}`);

		// A fully wired consumer: every layer imported, the guard in <head>,
		// the verbatim runtime copy. This is the exact state of oem-links.
		// Every vendored file here sits on a path MAP or ALT already owns, so
		// a correct checker reports NOTHING.
		mkdirSync(join(dir, 'src/pages'), { recursive: true });
		mkdirSync(join(dir, 'src/components'), { recursive: true });
		writeFileSync(join(dir, 'src/styles/site.css'),
			"@import './cli-mono/tokens.css';\n@import './cli-mono/base.css';\n@import './cli-mono/components.css';\n");
		writeFileSync(join(dir, 'src/components/BaseHead.astro'),
			"import themeGuard from '../js/cli-mono-theme-guard.js?raw';\n" +
			'<script is:inline set:html={themeGuard} />\n' +
			'<script is:inline src="/cli-mono.js"></script>\n');
		writeFileSync(join(dir, 'src/pages/index.astro'), '<html></html>\n');

		const env = { ...process.env, OEM_UI_SRC: root };
		const plain = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir],
			{ encoding: 'utf8', env });
		const slashed = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir + '/'],
			{ encoding: 'utf8', env });

		// The consumer really is clean: prove the baseline before blaming
		// the slash, or this test passes for the wrong reason.
		assert(plain.status === 0,
			`a wired consumer must be clean without a slash, got ${plain.status}: ${plain.stdout.trim()}`);

		assert(slashed.status === 0,
			`a trailing slash invented drift on a clean consumer: ${slashed.stdout.trim()}`);
		assert(!/ORPHAN/.test(slashed.stdout),
			`a trailing slash reported an ORPHAN for a file on a mapped path: ${slashed.stdout.trim()}`);
		assert(/in sync/.test(slashed.stdout),
			`expected "in sync" with a trailing slash, got: ${slashed.stdout.trim()}`);

		// AND the check must still FIRE through a trailing slash. A fix that
		// made the script quiet rather than correct would pass everything
		// above, which is the failure mode of every "just relax the
		// assertion" edit.
		writeFileSync(join(dir, 'src/styles/cli-mono/base.css'), '/* drift */\n');
		const drifted = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir + '/'],
			{ encoding: 'utf8', env });
		assert(drifted.status === 1,
			`real drift must still fail through a trailing slash, got ${drifted.status}`);
		assert(/STALE/.test(drifted.stdout),
			`expected STALE through a trailing slash, got: ${drifted.stdout.trim()}`);

		// The no-argument sweep is a SEPARATE branch - it enumerates
		// "$CONSUMER_ROOT"/*/ itself, so a fix applied only to the "$@" path
		// leaves the sweep broken, and the sweep is the one a CI job runs.
		// CONSUMER_ROOT is the documented override that makes this testable
		// without scanning the real projects tree.
		const tree = mkdtempSync(join(tmpdir(), 'cm-tree-'));
		try {
			renameSync(join(dir, 'src'), join(dir, 'src-live'));
			mkdirSync(join(tree, 'links'), { recursive: true });
			renameSync(join(dir, 'src-live'), join(tree, 'links', 'src'));
			// EXTRA_CONSUMER_ROOTS defaults to $HOME/browser-hub, which is a
			// REAL project on this machine. Without pinning it here the sweep
			// test's verdict depended on whether that repo happened to be in
			// sync - a test reading machine state rather than its own fixture.
			const swept = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh')], {
				encoding: 'utf8', env: {
					...process.env, OEM_UI_SRC: root, CONSUMER_ROOT: tree,
					EXTRA_CONSUMER_ROOTS: tree,
				},
			});
			// base.css is still the drifted copy from above, so a correct
			// sweep reports it - which is the point: the sweep has to SEE the
			// consumer at all. An implementation that skipped it would print
			// "no consumer projects found" and exit 0.
			assert(/STALE/.test(swept.stdout),
				`the no-argument sweep did not report the drifted consumer: ${swept.stdout.trim()}`);
			// AND the sweep must not INVENT drift, which is the mutation this
			// exists to catch. Asserting only for STALE was not enough: the
			// real drift above already produced that word, so a sweep that
			// reported STALE *and* a phantom ORPHAN still satisfied the
			// assertion and the mutation read as MISSED.
			assert(!/ORPHAN/.test(swept.stdout),
				`the no-argument sweep invented an ORPHAN on a path it already owns: ${swept.stdout.trim()}`);
		} finally {
			rmSync(tree, { recursive: true, force: true });
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('the drift checker fails on a stale consumer', async () => {
	// Prove the check CAN fail. A sync check that never fails is decoration:
	// silent drift is how 177 lines stayed stale while the site kept building
	// and rendering fine, and nobody noticed for a week.
	const dir = mkdtempSync(join(tmpdir(), 'cm-drift-'));
	try {
		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir], { encoding: 'utf8' });
		assert(inst.status === 0, `installer exited ${inst.status}: ${inst.stderr}`);
		assert(/in sync/.test(
			spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
				encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
			}).stdout,
		), 'a freshly installed consumer should report in sync');

		// Break exactly one file, the way a hand-edit would.
		writeFileSync(join(dir, 'src/styles/cli-mono/base.css'), '/* drift */\n');
		const r = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});
		assert(r.status === 1, `expected exit 1 on drift, got ${r.status}`);
		assert(/STALE/.test(r.stdout), `expected STALE, got: ${r.stdout.trim()}`);
		assert(/install\.sh/.test(r.stdout), 'output should name the fix command');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('the drift checker fails on a vendored-but-never-imported layer', () => {
	// Byte-identical and unreferenced is the drift this check missed for a
	// week. dev-blog vendored all four files, reported "in sync" on every
	// run, and imported NONE of them: the site rendered its own 264-line
	// design system with --ink-faint at 2.66:1 against --bg. `cmp` proved
	// the copy matched the origin, which says nothing about whether a
	// single page ever loaded it. A check that only asks "are the bytes the
	// same?" cannot tell an adopted consumer from a decorative one.
	//
	// Both halves matter, so both are proven here:
	//   1. vendored + imported    -> pass  (no false positive; oem-portfolio
	//      loads the layers with a CSS @import, not a JS import, and the
	//      first version of this check wrongly flagged it. A check that
	//      cries wolf is the same failure as one that never fires.)
	//   2. vendored + NOT imported -> exit 1, naming every layer
	const dir = mkdtempSync(join(tmpdir(), 'cm-reach-'));
	try {
		const run = () => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});
		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir], { encoding: 'utf8' });
		assert(inst.status === 0, `installer exited ${inst.status}: ${inst.stderr}`);

		// Half 1: the layers are on disk and nothing references them. This
		// is the dev-blog state exactly - a clean install, zero imports.
		// A source file must exist for the check to apply: a bare install
		// with no pages is not drifted, it is not built yet.
		mkdirSync(join(dir, 'src/pages'), { recursive: true });
		writeFileSync(join(dir, 'src/pages/index.astro'), '<html></html>\n');
		const orphan = run();
		assert(orphan.status === 1,
			`a consumer that vendors the library and imports none of it must fail, got ${orphan.status}: ${orphan.stdout.trim()}`);
		assert(/UNREACHABLE/.test(orphan.stdout),
			`expected UNREACHABLE, got: ${orphan.stdout.trim()}`);
		// Every layer must be named, not just the first one found: a check
		// that reports one and stops hides the rest.
		for (const f of ['tokens\\.css', 'base\\.css', 'components\\.css']) {
			assert(new RegExp(`UNREACHABLE\\s+${f}\\b`).test(orphan.stdout),
				`${f} should be named as unreachable; output was:\n${orphan.stdout}`);
		}
		// A project with no source files at all is not a drifted consumer,
		// it is an empty one. Flagging it is the false positive that makes
		// people stop reading the output.
		const bare = mkdtempSync(join(tmpdir(), 'cm-bare-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), bare], { encoding: 'utf8' });
			const r = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), bare], {
				encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
			});
			assert(r.status === 0,
				`an installed-but-empty project must not fail, got ${r.status}: ${r.stdout.trim()}`);
		} finally {
			rmSync(bare, { recursive: true, force: true });
		}

		// Half 2: import them the way a real consumer does and the same
		// files must now be accepted. Without this the check would just be
		// "vendoring is an error", which would forbid the layout itself.
		//
		// The guard is wired in with the ?raw import a real Astro consumer
		// uses, because that is the only shape that keeps it INLINE. A
		// script src= would run after the stylesheets, which is the flash.
		mkdirSync(join(dir, 'src/components'), { recursive: true });
		writeFileSync(join(dir, 'src/components/BaseHead.astro'), [
			"import '../styles/cli-mono/tokens.css';",
			"import '../styles/cli-mono/base.css';",
			"import '../styles/cli-mono/components.css';",
			"import themeGuard from '../js/cli-mono-theme-guard.js?raw';",
			'<script is:inline set:html={themeGuard} />',
			'<script is:inline src="/src/js/cli-mono.js"></script>',
		].join('\n'));
		const loaded = run();
		assert(loaded.status === 0,
			`an imported consumer must pass, got ${loaded.status}: ${loaded.stdout.trim()}`);
		assert(/in sync/.test(loaded.stdout), `expected in sync, got: ${loaded.stdout.trim()}`);

		// Half 3: the CSS-@import route must pass too. oem-portfolio is a
		// real consumer that does it this way, not a theoretical one.
		rmSync(join(dir, 'src/components/BaseHead.astro'), { force: true });
		writeFileSync(join(dir, 'src/styles/site.css'),
			"@import './cli-mono/tokens.css';\n@import './cli-mono/base.css';\n@import './cli-mono/components.css';\n");
		// The guard is still required: loading CSS by @import says nothing
		// about the theme, and a site that loads the layers but drops the
		// guard still flashes black for every light-theme visitor.
		writeFileSync(join(dir, 'src/pages/index.astro'),
			'<html>\n<head>\n<script is:inline src="/cli-mono-theme-guard.js"></script>\n</head>\n</html>\n');
		const viaCss = run();
		assert(viaCss.status === 0,
			`a consumer loading the layers by CSS @import must pass, got ${viaCss.status}: ${viaCss.stdout.trim()}`);

		// Half 4: the runtime is advisory. A static site can adopt the
		// design system and want no theme toggle, so a missing script tag
		// is a note, never a non-zero exit. Pin that, because "make it
		// strict" is the obvious next edit and it would be wrong.
		assert(/note:.*vendors cli-mono\.js/.test(viaCss.stdout),
			`a missing runtime reference should be noted, got: ${viaCss.stdout.trim()}`);

		// Half 5: the guard is the ONE vendored file that is not optional.
		// The runtime can go unused in a static site that wants no toggle,
		// but an unused guard is a black flash, and the file sitting there
		// reads as adoption. This is the dev-blog trap exactly, one file
		// down: the layers loaded, the guard did not.
		writeFileSync(join(dir, 'src/pages/index.astro'), '<html></html>\n');
		const noGuard = run();
		assert(noGuard.status === 1,
			`a consumer that vendors the guard but no head loads it must fail, got ${noGuard.status}: ${noGuard.stdout.trim()}`);
		assert(/UNREACHABLE\s+cli-mono-theme-guard\.js/.test(noGuard.stdout),
			`the unused guard must be named, got: ${noGuard.stdout.trim()}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('the drift checker can see a flat, src-less consumer at all', async () => {
	// `--flat` is the installer's documented layout for a project with no
	// src/ tree at all - a plain index.html served from the project root,
	// which is exactly what oem-ngo-brand is. Two defects hid there, and
	// both reported the same comfortable lie: "in sync".
	//
	// DEFECT 1 (js_dir_for). `${d#"$t"/}` returns its input UNCHANGED when
	// there is nothing to strip. In a flat install the vendored JS
	// directory IS the project root, so js_dir_for handed the caller an
	// ABSOLUTE path and every lookup became "$t/$JD/cli-mono.js" =
	// "/a/b//a/b/cli-mono.js", which exists nowhere. Measured: BOTH JS
	// files of a byte-identical flat install reported MISSING, with a
	// recommendation to re-run install.sh - which would have written a
	// second, unserved copy under src/js/ and left the served one just as
	// invisible.
	//
	// DEFECT 2 (reachability). The scan walked `$t/src` and read only
	// .astro/.ts/.js/.css/.mjs. A static consumer has no src/ and no
	// .astro: its pages are plain .html at the root. `sources` came back
	// empty, so the whole reachability pass - the one added because
	// dev-blog imported none of what it vendored - never ran. A flat
	// consumer could vendor the entire library, load NONE of it, and pass
	// every run.
	//
	// Both halves are proven, because a fix for one leaves the other
	// lying: repairing js_dir_for alone still reports "in sync" for an
	// unwired consumer, and teaching the scan about .html alone still
	// reports MISSING for a wired one.
	const dir = mkdtempSync(join(tmpdir(), 'cm-flat-'));
	try {
		const run = (d = dir) => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), d], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});

		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--flat'], {
			encoding: 'utf8',
		});
		assert(inst.status === 0, `installer --flat exited ${inst.status}: ${inst.stderr}`);

		// The layout the flag documents, proven by assertion rather than
		// assumed: JS at the root, CSS in cli-mono/, and NO src/ dir.
		// If this stops holding the test is measuring a different shape
		// than the one it claims to cover.
		assert(!existsSync(join(dir, 'src')),
			'a --flat install must not create a src/ tree, or this test is not covering the flat case');
		for (const f of ['cli-mono.js', 'cli-mono-theme-guard.js', 'cli-mono/tokens.css',
			'cli-mono/base.css', 'cli-mono/components.css']) {
			assert(existsSync(join(dir, f)), `--flat install did not produce ${f}`);
		}

		// Half 1: a flat install with no pages at all is not a drifted
		// consumer, it is an unbuilt one. This is the false positive that
		// would make the check cry wolf, so it is pinned first.
		const unbuilt = run();
		assert(unbuilt.status === 0,
			`an installed-but-unbuilt flat project must not fail, got ${unbuilt.status}: ${unbuilt.stdout.trim()}`);
		assert(/in sync/.test(unbuilt.stdout),
			`expected in sync for an unbuilt flat project, got: ${unbuilt.stdout.trim()}`);

		// Half 2: give it a real page that imports NONE of the library.
		// This is the dev-blog state in flat clothing, and it is the one
		// the reachability pass exists to catch.
		writeFileSync(join(dir, 'index.html'),
			'<!doctype html><html><head><title>flat</title></head><body><h1>hi</h1></body></html>\n');
		const orphan = run();
		assert(orphan.status === 1,
			`a flat consumer that vendors the library and imports none of it must fail, got ${orphan.status}: ${orphan.stdout.trim()}`);
		for (const f of ['tokens\\.css', 'base\\.css', 'components\\.css', 'cli-mono-theme-guard\\.js']) {
			assert(new RegExp(`UNREACHABLE\\s+${f}\\b`).test(orphan.stdout),
				`${f} should be named unreachable for a flat consumer; output was:\n${orphan.stdout}`);
		}

		// Half 2b: and the three CSS layers must FAIL ON THEIR OWN. The
		// guard reports unreachable too, so in half 2 the exit status
		// could be carried entirely by the guard's own stale=1 and the
		// CSS loop could report forever without ever failing anything -
		// which is exactly what a mutation that deletes the CSS stale=1
		// does, and exactly what this half exists to kill. A page that
		// loads the guard but no stylesheet is the only shape that
		// separates the two, so it is the shape used here.
		const cssOnly = mkdtempSync(join(tmpdir(), 'cm-flat-css-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), cssOnly, '--flat'], { encoding: 'utf8' });
			writeFileSync(join(cssOnly, 'index.html'), [
				'<!doctype html><html><head>',
				'<script src="/cli-mono-theme-guard.js"></script>',
				'</head><body><h1>guarded, unstyled</h1></body></html>',
			].join('\n') + '\n');
			const r = run(cssOnly);
			assert(r.status === 1,
				`three unreachable CSS layers must fail on their own, got ${r.status}: ${r.stdout.trim()}`);
			assert(!/UNREACHABLE\s+cli-mono-theme-guard/.test(r.stdout),
				`the guard IS wired here, so it must not be reported: ${r.stdout.trim()}`);
			for (const f of ['tokens\\.css', 'base\\.css', 'components\\.css']) {
				assert(new RegExp(`UNREACHABLE\\s+${f}\\b`).test(r.stdout),
					`${f} should be named unreachable; output was:\n${r.stdout}`);
			}
		} finally {
			rmSync(cssOnly, { recursive: true, force: true });
		}

		// Half 3: wire it the way a flat consumer actually wires it - a
		// plain <link> per layer and the guard as a blocking script src
		// ahead of them, exactly as install.sh --flat documents. If this
		// does not pass, the fix is wrong in the direction that matters:
		// it would make every static consumer unshippable.
		writeFileSync(join(dir, 'index.html'), [
			'<!doctype html><html><head>',
			'<script src="/cli-mono-theme-guard.js"></script>',
			'<link rel="stylesheet" href="/cli-mono/tokens.css" />',
			'<link rel="stylesheet" href="/cli-mono/base.css" />',
			'<link rel="stylesheet" href="/cli-mono/components.css" />',
			'<script src="/cli-mono.js"></script>',
			'</head><body><header class="cm-header"></header></body></html>',
		].join('\n') + '\n');
		const wired = run();
		assert(wired.status === 0,
			`a wired flat consumer must pass, got ${wired.status}: ${wired.stdout.trim()}`);
		assert(/in sync/.test(wired.stdout), `expected in sync, got: ${wired.stdout.trim()}`);

		// Half 4: AND the check must still FIRE on a flat consumer. A fix
		// that made the script quiet rather than correct would pass
		// halves 1-3, which is the failure mode of every "just relax the
		// assertion" edit.
		writeFileSync(join(dir, 'cli-mono/base.css'), '/* drift */\n');
		const drifted = run();
		assert(drifted.status === 1, `real drift in a flat consumer must fail, got ${drifted.status}`);
		assert(/STALE/.test(drifted.stdout),
			`expected STALE for drifted flat CSS, got: ${drifted.stdout.trim()}`);

		// Half 5: the guard INLINED verbatim counts as loaded. This is not
		// a shape I invented for this test: spacetime-rpm pastes the whole
		// file into a <script> element in web/index.html, so no filename
		// appears anywhere in its page. A name-only match called that
		// shipped, wired guard UNREACHABLE - and that false positive is
		// worse than the bug it was reporting, because it is the thing
		// that teaches a reader to ignore the line.
		const inlined = mkdtempSync(join(tmpdir(), 'cm-flat-guard-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), inlined, '--flat'], { encoding: 'utf8' });
			const guard = readFileSync(join(root, 'src/js/cli-mono-theme-guard.js'), 'utf8');
			writeFileSync(join(inlined, 'index.html'), [
				'<!doctype html><html><head>',
				'<script>' + guard + '</script>',
				'<link rel="stylesheet" href="/cli-mono/tokens.css" />',
				'<link rel="stylesheet" href="/cli-mono/base.css" />',
				'<link rel="stylesheet" href="/cli-mono/components.css" />',
				'<script src="/cli-mono.js"></script>',
				'</head><body><header class="cm-header"></header></body></html>',
			].join('\n') + '\n');
			const r = run(inlined);
			assert(r.status === 0,
				`a consumer that inlines the guard verbatim must pass, got ${r.status}: ${r.stdout.trim()}`);
			assert(!/UNREACHABLE\s+cli-mono-theme-guard/.test(r.stdout),
				`a verbatim-inlined guard was called unreachable: ${r.stdout.trim()}`);
		} finally {
			rmSync(inlined, { recursive: true, force: true });
		}

		// Half 6: and a guard that is merely QUOTED in prose is still
		// unreachable. Matching the body must not degrade into matching
		// the word - the previous line of that page is a comment naming
		// the file, and a check satisfied by a filename in a sentence is
		// the dev-blog trap wearing a different hat.
		const quoted = mkdtempSync(join(tmpdir(), 'cm-flat-quoted-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), quoted, '--flat'], { encoding: 'utf8' });
			writeFileSync(join(quoted, 'index.html'), [
				'<!doctype html><html><head>',
				'<!-- this page used to inline cli-mono-theme-guard.js -->',
				'<link rel="stylesheet" href="/cli-mono/tokens.css" />',
				'<link rel="stylesheet" href="/cli-mono/base.css" />',
				'<link rel="stylesheet" href="/cli-mono/components.css" />',
				'<script src="/cli-mono.js"></script>',
				'</head><body><header class="cm-header"></header></body></html>',
			].join('\n') + '\n');
			const r = run(quoted);
			assert(r.status === 1,
				`a guard named only in a comment is not wired; must fail, got ${r.status}: ${r.stdout.trim()}`);
			assert(/UNREACHABLE\s+cli-mono-theme-guard\.js/.test(r.stdout),
				`the unwired guard must be named, got: ${r.stdout.trim()}`);
		} finally {
			rmSync(quoted, { recursive: true, force: true });
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('the reachability scan reads .tsx, so a React consumer is graded whole', async () => {
	// A consumer whose components are .tsx was invisible to this sweep.
	// MEASURED (2026-10-08, the code-spaces migration): that repo holds
	// 87 .tsx files against 50 .ts, and the scan matched only '*.ts' -
	// so the runtime check ran over a third of the project, printed
	// "vendors cli-mono.js but references no script tag" for a site
	// whose main.tsx imports exactly that through the module graph
	// (the correct wiring for a Vite bundle), and steered the next
	// person toward a <script src> the bundler does not even serve.
	// Same shape as the *.py miss recorded in the script's own comments:
	// an extension the sweep never learned is a consumer graded from a
	// partial transcript, and "partial" here reads as comfortable.
	const dir = mkdtempSync(join(tmpdir(), 'cm-tsx-'));
	const run = (d) => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), d], {
		encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
	});
	try {
		spawnSync('bash', [join(root, 'scripts/install.sh'), dir], { encoding: 'utf8' });
		mkdirSync(join(dir, 'src'), { recursive: true });

		// Half 1: the ONLY source file is a .tsx that wires nothing.
		// With '*.tsx' missing from the scan, `sources` is empty, the
		// whole reachability pass is skipped, and an unwired consumer
		// reports success. It must FAIL and name the missing guard.
		writeFileSync(join(dir, 'src/App.tsx'), 'export const App = () => null;\n');
		const bare = run(dir);
		assert(bare.status === 1,
			`a .tsx-only consumer must still be graded, got ${bare.status}: ${bare.stdout.trim()}`);
		assert(/UNREACHABLE\s+cli-mono-theme-guard\.js/.test(bare.stdout),
			`the unwired guard must be named from a .tsx scan, got: ${bare.stdout.trim()}`);

		// Half 2: wire it the way a Vite consumer really does - all five
		// layers through the entry module, the runtime as a side-effect
		// import, the guard resolved by URL. That must read as adoption:
		// no SKIPPED source set, and NO script-tag note, because an ESM
		// import is not a missing <script src>.
		writeFileSync(join(dir, 'src/App.tsx'), [
			"import './styles/cli-mono/tokens.css';",
			"import './styles/cli-mono/base.css';",
			"import './styles/cli-mono/components.css';",
			"import './js/cli-mono.js';",
			"import { guardHref } from './guard';",
			'export const App = () => guardHref;',
		].join('\n') + '\n');
		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'src/guard.ts'), [
			"import { fileURLToPath } from 'node:url';",
			"export const guardHref = fileURLToPath(",
			"  new URL('../js/cli-mono-theme-guard.js', import.meta.url),",
			');',
		].join('\n') + '\n');
		const wired = run(dir);
		assert(wired.status === 0,
			`a fully wired .tsx consumer must pass, got ${wired.status}: ${wired.stdout.trim()}`);
		assert(!/SKIPPED/.test(wired.stdout),
			`the source set must not be empty for a .tsx consumer, got: ${wired.stdout.trim()}`);
		assert(!/vendors cli-mono\.js/.test(wired.stdout),
			`an ESM import is wired; the script-tag note must not fire, got: ${wired.stdout.trim()}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('the drift checker catches a shadow copy of the runtime on an unchecked path', async () => {
	// THE GAP THIS EXISTS FOR.
	//
	// The checker's MAP is a fixed list of five destination paths, so it can
	// only ever compare a copy that sits on one of them. A consumer that
	// serves the runtime VERBATIM keeps a second copy somewhere else -
	// public/ + <script is:inline> is the shape Astro forces, because a
	// variable <script src> is dropped from dist/ entirely - and that copy
	// was invisible to the check.
	//
	// Measured, not hypothesised: oem-portfolio passed "in sync" while the
	// runtime it SERVED over HTTP was 140 lines behind the library, missing
	// initNav, the copy-button rebind guard and the DOM-read key list. The
	// vendored src/js copy stayed current throughout, which is exactly why
	// nobody looked twice.
	//
	// Both spellings must fail, and they are different defects:
	//   differs   -> SHADOW: a drifted second copy
	//   identical -> ORPHAN: adoption on a path nothing compares, which is
	//                          the state the drift then grows out of
	// A test that proved only the first would pass while the second - the
	// actual precondition - stayed unproven.
	const dir = mkdtempSync(join(tmpdir(), 'cm-shadow-'));
	try {
		const run = () => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});
		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--public'], {
			encoding: 'utf8',
		});
		assert(inst.status === 0, `installer --public exited ${inst.status}: ${inst.stderr}`);

		// A wired-up consumer that adopted the library, verbatim copy in
		// place, must be clean. This is half 1 and it is the false-positive
		// guard: a check that cries wolf is the same failure as one that
		// never fires.
		mkdirSync(join(dir, 'src/pages'), { recursive: true });
		mkdirSync(join(dir, 'src/components'), { recursive: true });
		writeFileSync(join(dir, 'src/styles/site.css'),
			"@import './cli-mono/tokens.css';\n@import './cli-mono/base.css';\n@import './cli-mono/components.css';\n");
		writeFileSync(join(dir, 'src/components/BaseHead.astro'),
			"import themeGuard from '../js/cli-mono-theme-guard.js?raw';\n" +
			'<script is:inline set:html={themeGuard} />\n' +
			'<script is:inline src="/cli-mono.js"></script>\n');
		writeFileSync(join(dir, 'src/pages/index.astro'), '<html></html>\n');
		const clean = run();
		assert(clean.status === 0,
			`a consumer with a current public/ copy must pass, got ${clean.status}: ${clean.stdout.trim()}`);

		// Half 2: the copy silently goes stale. The oem-portfolio defect,
		// reproduced in a temp dir. public/ is an ALT path, so it is
		// compared as hard as src/js and reports STALE - the fix message
		// and the failing path are the two things a consumer acts on.
		const pub = join(dir, 'public/cli-mono.js');
		assert(exists(pub), '--public must install the runtime into public/');
		writeFileSync(pub, '/* an old runtime */\n');
		const drifted = run();
		assert(drifted.status === 1,
			`a stale public/ copy must fail, got ${drifted.status}: ${drifted.stdout.trim()}`);
		assert(/STALE\s+public\/cli-mono\.js/.test(drifted.stdout),
			`the stale copy must be named, got: ${drifted.stdout.trim()}`);

		// Half 3: a copy on a path NEITHER map names. MAP and ALT are still
		// a whitelist, and this is the hole that whitelist leaves - a
		// consumer free to put the runtime anywhere. A drifted one is a
		// SHADOW; a current one is an ORPHAN, which is also a failure
		// because a file nothing checks is a file that drifts the first
		// time the library changes. Proving only the drifted case would
		// leave the state that CAUSED the drift unproven.
		//
		// The stale public/ copy is restored FIRST, and this isolation is
		// load-bearing rather than tidiness. Left stale, its own STALE
		// verdict would hold the exit code at 1 on its own, so the shadow
		// case would pass for the wrong reason - and a mutation that made
		// SHADOW advisory while still printing its name would survive. The
		// mutation harness caught exactly that, which is what it is for.
		writeFileSync(pub, read('src/js/cli-mono.js'));
		mkdirSync(join(dir, 'assets'), { recursive: true });
		const odd = join(dir, 'assets/cli-mono.js');
		writeFileSync(odd, '/* a third runtime */\n');
		const shadow = run();
		assert(shadow.status === 1,
			`a copy on an unnamed path must fail, got ${shadow.status}: ${shadow.stdout.trim()}`);
		assert(/SHADOW\s+assets\/cli-mono\.js/.test(shadow.stdout),
			`the shadow copy must be named, got: ${shadow.stdout.trim()}`);
		// Nothing else may be under test here, or the verdict is ambiguous.
		assert(!/STALE|ORPHAN|UNREACHABLE/.test(shadow.stdout),
			`the shadow case must be the only finding, got: ${shadow.stdout.trim()}`);

		// Same copy, made current: it becomes an ORPHAN, still a failure.
		writeFileSync(odd, read('src/js/cli-mono.js'));
		const orphan = run();
		assert(orphan.status === 1,
			`an identical copy on an unnamed path must still fail, got ${orphan.status}: ${orphan.stdout.trim()}`);
		assert(/ORPHAN\s+assets\/cli-mono\.js/.test(orphan.stdout),
			`the orphan copy must be named, got: ${orphan.stdout.trim()}`);
		assert(!/STALE/.test(orphan.stdout),
			`nothing else may be failing here, got: ${orphan.stdout.trim()}`);

		// Removing the unnamed copies returns the consumer to a passing
		// state. Without this, "the check is strict" and "the check is
		// unusable" are indistinguishable, and a check nobody can satisfy
		// gets deleted rather than obeyed.
		rmSync(join(dir, 'assets'), { recursive: true, force: true });
		const fixed = run();
		assert(fixed.status === 0,
			`removing the unnamed copy must return the consumer to in-sync, got ${fixed.status}: ${fixed.stdout.trim()}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// A consumer that does not use the installer's LAYOUT is still a
// consumer, and the previous discovery could not see it at all.
//
// Measured, not hypothesised: oem-cdn compiles its admin assets into the
// binary with include_str!, keeps the layers at web/oem-ui/ and names
// the runtime `runtime.js` after its own asset route. Discovery keyed on
// a directory NAMED `cli-mono` found nothing there and printed five
// MISSING lines for files the project actually ships - and the real
// defect sat directly behind them: that runtime was 175 lines behind the
// library, missing initTooltipClamp, initMeasureReadout and pxOf, and
// was being SERVED (HTTP 200, 23823 bytes) from http://192.168.1.68:8787.
//
// Three claims, and each is a way this could have been done wrong:
//   1. layers in a non-canonical DIRECTORY are found (content, not name)
//   2. a RENAMED runtime is adoption, not drift -> passes when current
//   3. the same renamed copy that has DRIFTED is reported, and named
// Half 2 without half 3 is a check that blesses the defect it exists to
// find; half 3 without half 2 is a check that fails a correct consumer,
// which is the outcome this script's own history calls its worst state.
check('the drift checker finds a consumer that renamed its files and kept them elsewhere', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'cm-rename-'));
	try {
		const inst = spawnSync('bash', [join(root, 'scripts/install.sh'), dir], {
			encoding: 'utf8',
		});
		assert(inst.status === 0, `installer exited ${inst.status}: ${inst.stderr}`);

		// Relocate the layers into a directory of the consumer's own
		// choosing and rename both JS files, which is what a project
		// embedding them does.
		const vend = join(dir, 'web/oem-ui');
		mkdirSync(vend, { recursive: true });
		for (const f of ['tokens.css', 'base.css', 'components.css']) {
			renameSync(join(dir, 'src/styles/cli-mono', f), join(vend, f));
		}
		renameSync(join(dir, 'src/js/cli-mono.js'), join(vend, 'runtime.js'));
		renameSync(join(dir, 'src/js/cli-mono-theme-guard.js'), join(vend, 'theme-guard.js'));
		mkdirSync(join(dir, 'src/pages'), { recursive: true });
		mkdirSync(join(dir, 'src/components'), { recursive: true });
		mkdirSync(join(dir, 'src/styles'), { recursive: true });
		writeFileSync(join(dir, 'src/styles/site.css'),
			"@import '../web/oem-ui/tokens.css';\n"
			+ "@import '../web/oem-ui/base.css';\n"
			+ "@import '../web/oem-ui/components.css';\n");
		writeFileSync(join(dir, 'src/components/BaseHead.astro'),
			"import guard from '../../web/oem-ui/theme-guard.js?raw';\n"
			+ '<script is:inline set:html={guard} />\n'
			+ '<script is:inline src="/oem-ui/runtime.js"></script>\n');
		writeFileSync(join(dir, 'src/pages/index.astro'),
			'<html><header class="cm-header"></header></html>\n');

		const run = () => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});

		// Half 2 first, and it is the half that is easy to get wrong:
		// a consumer that did everything right must PASS. A checker
		// that flags the rename is crying wolf, and the first thing a
		// reader does with a crying-wolf checker is ignore it.
		const clean = run();
		assert(clean.status === 0,
			`a correct consumer that renamed its files must pass, got ${clean.status}: ${clean.stdout.trim()}`);
		// It must not be a silent pass either: the rename is the thing a
		// reader has to be able to see, or the next person assumes the
		// canonical paths are in use.
		assert(/RENAMED\s+.*runtime\.js/.test(clean.stdout),
			`the renamed runtime must still be named, got: ${clean.stdout.trim()}`);
		// ...and the layers must be located, not reported MISSING.
		assert(!/MISSING\s+.*(tokens|base|components)\.css/.test(clean.stdout),
			`the vendored layers must be found in web/oem-ui, got: ${clean.stdout.trim()}`);

		// Half 3: the same shape, with the renamed copy now drifted. The
		// drift is only visible if the comparison FOLLOWS the content to
		// the renamed path - the canonical path does not exist, so
		// comparing it alone would report the consumer as fine forever.
		//
		// Isolated on purpose. Proven by mutation: with the drift
		// reported but the exit code left alone, the suite stayed
		// GREEN, because the renamed copy is also on a path the shadow
		// scan does not own, and that scan's own verdict held rc=1 for
		// an unrelated reason. Two defects, one non-zero exit - which
		// is exactly how a mutation of the one hides behind the other.
		// The assertion below is on the DRIFTED LINE, not merely on a
		// non-zero status, so the only way to satisfy it is to have
		// compared that copy and said so.
		const rt = join(vend, 'runtime.js');
		writeFileSync(rt, read('src/js/cli-mono.js') + '\n// drifted away from the library\n');
		const drifted = run();
		assert(drifted.status === 1,
			`a renamed copy that has drifted must fail, got ${drifted.status}: ${drifted.stdout.trim()}`);
		assert(/web\/oem-ui\/runtime\.js/.test(drifted.stdout),
			`the drifted renamed copy must be named, got: ${drifted.stdout.trim()}`);
		assert(/and that copy has DRIFTED from the library/.test(drifted.stdout),
			`the rename verdict itself must report the drift, got: ${drifted.stdout.trim()}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('--public installs byte-identical copies and documents the verbatim shape', async () => {
	// The flag has to actually produce a usable copy, and the reason it
	// exists has to be written down, or a consumer hits the Astro
	// drop-the-script-tag trap and goes hand-maintaining a copy again -
	// which is the failure this was built to end.
	const dir = mkdtempSync(join(tmpdir(), 'cm-public-'));
	try {
		const r = spawnSync('bash', [join(root, 'scripts/install.sh'), dir, '--public'], {
			encoding: 'utf8',
		});
		assert(r.status === 0, `installer exited ${r.status}: ${r.stderr}`);
		for (const f of ['cli-mono.js', 'cli-mono-theme-guard.js']) {
			assert(read(join(dir, 'public', f)) === read(`src/js/${f}`),
				`public/${f} must be byte-identical to src/js/${f}`);
		}
		// Both copies come from one $FROM, so they cannot disagree with each
		// other. A guard and a runtime cut from different versions is the
		// same class of bug one level down.
		assert(read(join(dir, 'public/cli-mono.js')) === read(join(dir, 'src/js/cli-mono.js')),
			'the public and src copies must not diverge from each other');

		// Without --public, public/ must NOT be created. Creating it
		// unconditionally would hand every consumer an ORPHAN to fail on.
		const plain = mkdtempSync(join(tmpdir(), 'cm-nopub-'));
		try {
			spawnSync('bash', [join(root, 'scripts/install.sh'), plain], { encoding: 'utf8' });
			assert(!exists(join(plain, 'public/cli-mono.js')),
				'a plain install must not create a public/ copy');
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}

		// The README says how many files get copied, in two places. It said
		// "four" after the guard landed as a fifth file, and a count nobody
		// checks is a count that rots again the next time the library gains
		// a file. Counted on disk, from the installer's own output with the
		// ANSI colour stripped - matching the raw stdout finds nothing,
		// because `ok` is wrapped in escape codes.
		// On a FRESH target: a plain install creates exactly the five
		// documented files. On `dir` - which already holds public/ from the
		// --public run above - a plain install now reports SEVEN, because it
		// also refreshes the two copies the target already serves. That is
		// the behaviour that makes the checker's bare `fix:` line correct,
		// so the count the README documents has to be measured where there
		// is nothing to update yet.
		const fresh = mkdtempSync(join(tmpdir(), 'cm-count-'));
		try {
			const plainInstall = spawnSync('bash', [join(root, 'scripts/install.sh'), fresh], {
				encoding: 'utf8',
			});
			assert(plainInstall.status === 0, `plain install exited ${plainInstall.status}`);
			const clean = plainInstall.stdout.replace(/\u001b\[[0-9;]*m/g, '');
			const landed = (clean.match(/^ok\s+\S+\s+->/gm) || []).length;
			assert(landed === 5,
				`a plain install should report 5 files, it reported ${landed}; update the README count too`);
		} finally {
			rmSync(fresh, { recursive: true, force: true });
		}
		// And the same count read off the filesystem, so the number is a
		// fact about the install rather than about a printf format.
		const onDisk = [
			'src/styles/cli-mono/tokens.css',
			'src/styles/cli-mono/base.css',
			'src/styles/cli-mono/components.css',
			'src/js/cli-mono.js',
			'src/js/cli-mono-theme-guard.js',
		];
		assert(onDisk.every((f) => exists(join(dir, f))),
			'a plain install must land exactly these five files');
		const readme = read('README.md');
		assert(/copy five files/.test(readme),
			'the README must state the real file count, which is 5');
		assert(!/copy four files/.test(readme) && !/Copies the four files/.test(readme),
			'the README still says four files; the guard made it five');

		// The output has to teach the shape, and the two facts that make it
		// work: is:inline (or the tag is dropped from dist/) and BASE_URL
		// (or a subpath deploy 404s every asset).
		assert(/is:inline/.test(r.stdout), 'the --public hint must mention is:inline');
		assert(/BASE_URL/.test(r.stdout), 'the --public hint must mention BASE_URL');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

check('a consumer that serves the runtime verbatim runs the drift check in CI', () => {
	// A check nobody runs is a check that has already failed, quietly. This
	// exists because the drift it catches was invisible for three days: the
	// consumer's own comment said the layers are "copied into the repo, not
	// installed from npm, so nothing on GitHub can notice when they drift",
	// and the runtime it served was 140 lines behind the whole time.
	//
	// Scoped to the real consumer, with two things asserted by name. A
	// generic "does some CI mention drift" would be satisfied by an
	// unrelated job, which is the dead-check trap one level down.
	const wf = '/root/projects/oem-portfolio/.github/workflows/ci.yml';
	if (!exists(wf)) {
		// The consumer is not on this machine. Say so rather than passing
		// a vacuous check - a skipped assertion read as green is the exact
		// thing this suite keeps failing to catch.
		console.log('        (skipped: oem-portfolio is not checked out here)');
		return true;
	}
	const ci = read(wf);
	assert(/check-design-sync\.sh/.test(ci),
		'the consumer CI must run the drift checker, or the copies drift silently');
	assert(/public/.test(ci),
		'the drift step must cover the public/ copy, which is the one that was stale');
	// A step that hard-fails on a runner without the oem-ui checkout is a
	// step that gets deleted the first time it blocks someone else.
	assert(/not checked out/.test(ci),
		'the drift step must degrade to a skip when oem-ui is absent from the runner');
});

/* ================= nav: current page + scroll-spy ================= */
console.log('\nnav state');

check('Header can express the current page', () => {
	// The library has shipped `.cm-header__link[aria-current='page']` from the
	// start, and NOTHING could reach it: no component emitted the attribute.
	// Dead CSS that builds, ships and renders is invisible by construction.
	//
	// The `active` prop is now only an ESCAPE HATCH. The prop is still
	// required to exist, but a Header that only honours it is a trap: a
	// multi-page consumer must then hand-write one boolean per page, which is
	// what dev-blog did by forking this file. The nav derives the attribute
	// from the URL instead, so `active` stays optional.
	const h = read('src/astro/Header.astro');
	assert(/active\?:\s*boolean/.test(h), 'Link needs an `active` prop');
	// Scope to the nav link block: `aria-current={...}` appears elsewhere in
	// the file, so a bare /aria-current=/ proves nothing about the NAV.
	const navLink = /aria-current=\{\s*l\.active\s*!==\s*undefined[\s\S]*?isCurrentPage\([\s\S]*?\}/.exec(h);
	assert(navLink,
		'Header must render aria-current="page" from its own URL match when no `active` was passed');
	assert(/isCurrentPage\(/.test(h),
		'Header must use the shared matcher so it cannot disagree with <HeaderLink>');
	// A link with `active: false` is not current even when the URL says it is.
	assert(/l\.active\s*!==\s*undefined\s*\?\s*l\.active/.test(h),
		'an explicit `active: false` must win over the URL match');
});

check('Header hands its links to the runtime scroll-spy', () => {
	// initScrollSpy queries [data-cm-nav] and [data-cm-spy]. The showcase is a
	// one-pager whose links are all #section, so the spy id is INFERRED from the
	// href: a consumer should not have to repeat `spy` on every link.
	const h = read('src/astro/Header.astro');
	// Anchored to the ASSIGNMENT, not the bare name. The mobile burger
	// emits `data-cm-nav-toggle`, and a bare /data-cm-nav/ matches that
	// prefix, so deleting the real attribute left the test green. The
	// attribute under test is the one with a value.
	assert(/data-cm-nav=/.test(h), 'Header never emits data-cm-nav, so the spy never runs');
	assert(/data-cm-spy=/.test(h), 'Header never emits data-cm-spy');
	assert(/href\.startsWith\('#'\)/.test(h),
		'the spy id must be inferred from an in-page href, not required on every link');
});

check('the spy and the current page are DIFFERENT attributes', () => {
	// They are different questions: `active` says where you are, `is-active`
	// says what you are reading. On a one-page site both are true of the same
	// link, so a single attribute would let the first scroll event erase the
	// current page's state.
	// Comments are stripped first: these two names are also the words used to
	// EXPLAIN the distinction, and a test that matches its own comment is a
	// test that passes for the wrong reason.
	const h = read('src/astro/Header.astro')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');
	assert(!/is-active/.test(h),
		"Header must not hardcode the spy's is-active class — the runtime owns it");
	assert(/aria-current/.test(h), 'the page state must be aria-current, not a class');
});

check('the scroll-spy measures from the document, not the nearest positioned parent', () => {
	// `offsetTop` is relative to the nearest POSITIONED ancestor. The spy was
	// never reachable, so this was never noticed: a consumer with any
	// positioned wrapper around its sections gets the wrong section lit.
	assert(!/offsetTop\s*<=\s*probe/.test(runtimeSrc),
		'the spy still compares offsetTop, which is relative to a positioned ancestor');
	assert(/getBoundingClientRect/.test(runtimeSrc),
		'the spy must measure the section rect so the result is document-relative');
});

check('HeaderLink normalises before it compares', () => {
	// Each of these leaves the link dark on the page the reader is actually
	// on, and none of them throws - the nav just quietly stops working.
	//
	// These assert the BEHAVIOUR of the normaliser, not that a pattern appears
	// somewhere in the file. An earlier version regex-matched
	// `replace(/\/+$/, '')` and passed even with the path normaliser deleted,
	// because the BASE_URL line right above it matches the same pattern. A
	// test that can be satisfied by a different line of code is decoration.
	const body = read('src/astro/HeaderLink.astro')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '');

	// The `strip` function is the whole contract, so exercise its BEHAVIOUR.
	// It is extracted from the file and run, rather than pattern-matched: an
	// earlier version asserted that a regex appeared somewhere in the source
	// and passed even with the normaliser deleted, because the BASE_URL line
	// above it matches the same pattern. A test that can be satisfied by a
	// different line of code is decoration.
	//
	// The normaliser MOVED to src/astro/current.ts when <Header> started
	// sharing it with <HeaderLink>. That is the point: two components that
	// each reduced a path their own way is how a nav ends up lighting the
	// wrong link. So the extraction target changed with the code, and the
	// assertion about WHERE it lives moves with it - if the module is
	// deleted, this fails rather than skipping.
	const src = read('src/astro/current.ts');
	const stripSrc = /export const normalise = \(raw(?::\s*string)?,\s*base(?::\s*string)?\)(?::\s*string\s*\|\s*null)?\s*=>\s*\{[\s\S]*?^\};/m.exec(src);
	assert(stripSrc, 'could not find the normalise() reducer in current.ts');
	const js = stripSrc[0]
		.replace(/\(raw(?::\s*string)?,\s*base(?::\s*string)?\)/, '(raw, base)')
		.replace(/:\s*string\s*\|\s*null/g, '');
	// `export const` cannot appear in a `new Function` BODY at all - it is a
	// syntax error there, the constructor throws, and the harness comes back
	// with `undefined` rather than a failure. Rewritten to a plain
	// declaration so the extracted source is the thing actually executed.
	// Assert it: an extraction that silently produced nothing is exactly the
	// "test that passes for the wrong reason" this suite keeps rediscovering.
	const runnable = js.replace(/^export const normalise =/, 'const normalise =');
	assert(!/^\s*(export|import)\s/m.test(runnable),
		'the extracted source still carries a module-level keyword, so new Function cannot run it');
	assert(/const normalise\s*=/.test(runnable),
		'the extracted source does not define normalise, so the harness below would test nothing');
	// One normaliser, two builds: the site root, and a site served under a
	// `base` prefix. The prefix case is the one that silently disables the
	// whole component, so it gets its own instance.
	//
	// The normaliser takes `base` as a PARAMETER, so the harness has to BIND
	// it rather than hand back a closure over a same-named variable. Handing
	// back the bare function passes the path as `raw` and leaves `base`
	// undefined, which silently degrades every case to the no-prefix build -
	// a green prefix assertion that never exercised a prefix. That is why
	// these two lines bind:
	const atRoot = new Function('siteBase', `${runnable}\nreturn (raw) => normalise(raw, siteBase);`)('/');
	const prefixed = new Function('siteBase', `${runnable}\nreturn (raw) => normalise(raw, siteBase);`)('/dev-blog');
	const normalise = atRoot;
	assert(normalise('/blog/') === '/blog', `trailing slash: /blog/ -> ${normalise('/blog/')}`);
	assert(normalise('/blog/?q=1') === '/blog', `query string: /blog/?q=1 -> ${normalise('/blog/?q=1')}`);
	assert(normalise('/blog/#x') === '/blog', `hash: /blog/#x -> ${normalise('/blog/#x')}`);
	assert(normalise('/') === '/', `root: / -> ${normalise('/')}`);
	// Under a base prefix, BOTH sides carry it, so both must lose it.
	assert(prefixed('/dev-blog/about/') === '/about',
		`base prefix: -> ${prefixed('/dev-blog/about/')}`);
	assert(prefixed('/about/') === '/about',
		`base prefix, already-stripped href: -> ${prefixed('/about/')}`);
	// an external link is not this page, whatever its path looks like
	assert(normalise('https://example.com/blog/') === null, 'an external href was treated as a local path');
	assert(normalise('//example.com/blog/') === null, 'a protocol-relative href was treated as a local path');
});

/* Extract BOTH reducers out of current.ts and execute them. `isCurrentPage`
   calls `normalise` by module-scope binding, so the extracted source is
   evaluated once and the pair is read off the same scope - handing back
   `normalise` alone and then re-implementing the comparison here would test
   a copy in this file, which is the exact "two copies that disagree" bug
   the module was created to end. */
const loadCurrentModule = () => {
	const src = read('src/astro/current.ts');
	const body = src
		// strip comments FIRST: a prose mention of the function name in the
		// doc comment must not satisfy the extraction and yield an empty body
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');
	// Both arrows, from `export const NAME =` to its own closing `};` at
	// column 0. `export` is illegal in a `new Function` body, so it is
	// rewritten; the colon annotations are stripped the same way.
	const grab = (name) => {
		const m = new RegExp(
			`export const ${name} = [\\s\\S]*?\\n};`,
		).exec(body);
		assert(m, `could not extract ${name}() from current.ts`);
		return m[0]
			.replace(`export const ${name} =`, `const ${name} =`)
			.replace(/:\s*string/g, '')
			.replace(/:\s*boolean/g, '')
			.replace(/=\s*false/g, '= false')
			.replace(/\):\s*boolean/g, ')')
			.replace(/\|\s*null/g, '');
	};
	const js = `${grab('normalise')}\n${grab('isCurrentPage')}`;
	assert(!/^\s*(export|import)\s/m.test(js),
		'the extracted source still carries a module-level keyword, so new Function cannot run it');
	assert(/\bconst normalise\s*=/.test(js) && /\bconst isCurrentPage\s*=/.test(js),
		'the extracted source defines neither reducer, so the harness would test nothing');
	// bind `base` per-build, exactly as the sibling test does: returning the
	// bare function would pass the path as `raw` and leave `base` undefined.
	return {
		normalise: (b) => new Function('siteBase', `${js}\nreturn (raw) => normalise(raw, siteBase);`)(b),
		isCurrentPage: (b) => new Function('siteBase', `${js}\nreturn (href, p, ms) => isCurrentPage(href, p, siteBase, ms);`)(b),
	};
};

check('isCurrentPage decides WHERE YOU ARE, and never lights an in-page link', () => {
	// `normalise` is tested on its own above. This is the BEHAVIOUR the whole
	// nav depends on, and before this check `isCurrentPage` had no test at
	// all: it shipped a fix - a hash-only href is not a page - with nothing
	// that could fail if the guard were deleted.
	//
	// MEASURED pre-fix, by running the reducer with the guard removed: on the
	// ROOT page, `#nav`, `#`, `#buttons` and `#tables` EVERY returned true,
	// because `normalise` drops the fragment and `/#nav` reduces to `/`,
	// which equals `/`. A single-page site - which is what the showcase is -
	// rendered with `#section` links lit its ENTIRE nav at once, and no
	// screenshot of that reads as broken.
	const { isCurrentPage } = loadCurrentModule();
	const atRoot = isCurrentPage('/');
	const prefixed = isCurrentPage('/dev-blog');

	// --- the bug under test: an in-page link is not the current page ---
	for (const href of ['#nav', '#', '#buttons', '#tables']) {
		assert(atRoot(href, '/') === false,
			`an in-page href lit aria-current on the root page: ${href}`);
	}
	// ...and on a subpage, where it was already false - the all-links-lit bug
	// was specific to the root, because only there does the fragment strip to
	// the same path. Asserting both sides keeps the test from being satisfied
	// by a matcher that is simply broken everywhere.
	assert(atRoot('#nav', '/blog/') === false,
		'an in-page href lit aria-current on a subpage');

	// --- the ordinary cases, so the guard cannot be "fixed" by returning
	//     false for everything ---
	assert(atRoot('/blog', '/blog/') === true, 'a real link is not current on its own page');
	assert(atRoot('/blog/', '/blog') === true, 'trailing slash, both directions');
	assert(atRoot('/', '/') === true, 'the root link is current on the root page');
	assert(atRoot('/', '/blog/') === false, 'the root link is current on EVERY path');
	assert(atRoot('/blog', '/about/') === false, 'a link is current on a different page');
	assert(atRoot('/blog/?q=1', '/blog/') === true, 'a query string is not part of a page');
	// an external href is never this page
	assert(atRoot('https://example.com/blog/', '/blog/') === false,
		'an external href was treated as this page');
	assert(atRoot('//example.com/blog/', '/blog/') === false,
		'a protocol-relative href was treated as this page');

	// --- under a base prefix, both sides carry it and both lose it. A
	//     consumer served from `/dev-blog/` with NO link ever current is the
	//     failure this whole component exists to prevent. ---
	assert(prefixed('/dev-blog/about/', '/dev-blog/about/') === true,
		'base prefix: a real link is not current on its own page');
	assert(prefixed('/about/', '/dev-blog/about/') === true,
		'base prefix: an already-stripped href did not match');
	assert(prefixed('/blog/', '/dev-blog/about/') === false,
		'base prefix: a link is current on a different page');

	// --- the defensive clauses, which the first version of this check
	//     could not reach and the mutation sweep proved it. Both were
	//     reported as SURVIVED; `tests/probe-current-diff.mjs` then showed
	//     both are OBSERVABLE, over exactly the inputs below. Recording how
	//     they were found, because the obvious way to find them - reading
	//     the guard and concluding it is dead - is what produced a false
	//     "DEAD" reading first.
	//
	// `there !== '/'`: without it, a DOUBLE-SLASH pathname makes the root
	// link current on an unrelated path. `normalise('/dev-blog//x',
	// '/dev-blog')` returns `//x` - the base strip plus the leading-slash
	// repair can emit two slashes - and `here.startsWith('//')` is true.
	// MEASURED: false before, true with the guard removed.
	assert(atRoot('/', '/dev-blog//x', true) === false,
		'the root link lit on a double-slash path via matchSegment');
	// Under a base prefix, the same inputs must behave: a prefixed root link
	// is not current on a prefixed page that is not its own child.
	assert(prefixed('/dev-blog', '/dev-blog//x', true) === false,
		'the base root link lit on a double-slash path under its own prefix');
	// the same input WITHOUT matchSegment must still be false, or the
	// assertion above would pass for the wrong reason
	assert(atRoot('/', '/dev-blog//x') === false,
		'the root link lit on a double-slash path without matchSegment');

	// `here === null`: without it, an external/protocol-relative PATHNAME
	// reaches `here.startsWith` and THROWS, because normalise returns null
	// for one. A nav that throws while rendering is a blank header, and the
	// throw only happens on a pathname a real browser cannot even produce -
	// so the only way to see it is to call the reducer directly. MEASURED:
	// returns false with the guard, TypeError without it.
	assert(atRoot('/a', '//x', true) === false,
		'a protocol-relative pathname threw instead of returning false');
	assert(atRoot('/a', 'https://example.com/x', true) === false,
		'an external pathname was treated as a local path');
	// ...and with matchSegment OFF the same inputs must not throw either
	assert(atRoot('/a', '//x') === false, 'a protocol-relative pathname threw without matchSegment');

	// `href.trimStart()`: the guard must tolerate a leading space, which is
	// what a templated href produces (`href={` ${slug}`}`, a CMS field
	// with a stray character). Without it, the fragment guard MISSES, and
	// `normalise` turns ` #` into `/ ` - so an in-page link becomes
	// current on any pathname that happens to normalise the same way.
	// MEASURED: orig false, guard-removed true, for href=" #" against
	// pathname " /".
	assert(atRoot(' #', ' /') === false,
		'a space-prefixed fragment href was treated as a page link');
	// Both matchSegment settings, because the guard sits ABOVE the segment
	// branch and a mutation that only moves it below would survive otherwise.
	assert(atRoot(' #', ' /', true) === false,
		'a space-prefixed fragment href was treated as a page link under matchSegment');

		// --- matchSegment is opt-in, and the opt-in is a decision about the
		//     LINK, not a default. dev-blog needs `/blog` lit on `/blog/a-post`
		//     and `/v2/` lit only on v2, which is the pair that proves it. ---
	assert(atRoot('/blog', '/blog/a-post') === false,
		'a child page must NOT light the section link by default');
	assert(atRoot('/blog', '/blog/a-post', true) === true,
		'matchSegment did not keep the section link lit on its child page');
	// The DEFAULT is the stricter exact match, and that is what a version
	// link needs: `/v2` must light only on `/v2`, not on `/v2/api`. Both
	// halves are asserted, because either one alone is satisfiable by a
	// matcher that just always returns false (or always true).
	assert(atRoot('/v2', '/v2') === true,
		'a version link is not current on its own version');
	assert(atRoot('/v2', '/v2/api') === false,
		'a version link lit on its own children without opting in');
	// ...and with the opt-in it does, so the pair pins the default instead of
	// accidentally hard-coding the answer.
	assert(atRoot('/v2', '/v2/api', true) === true,
		'matchSegment did not opt a link into its children');
	// the root is never a segment parent: `/` must not light on every path
	assert(atRoot('/', '/blog', true) === false,
		'the root link lit on an unrelated path via matchSegment');
	// ...but the root IS the current page on itself, even with matchSegment on
	assert(atRoot('/', '/', true) === true,
		'the root link is not current on the root page when matchSegment is on');
});

check('the fragment guard lives INSIDE isCurrentPage, before it normalises', () => {
	// A guard placed AFTER the normalise is a guard that cannot work:
	// normalising is exactly what erases the difference between `#nav` and
	// `/`. This asserts the ORDER, because both orderings type-check, build
	// and render - and the wrong one silently reintroduces the all-links-lit
	// bug the sibling test measures.
	const src = read('src/astro/current.ts');
	const fn = /export const isCurrentPage = [\s\S]*?^};/m.exec(src);
	assert(fn, 'could not find isCurrentPage() in current.ts');
	const body = fn[0];
	const guard = body.indexOf('startsWith(\'#\')');
	const norm = body.indexOf('normalise(');
	assert(guard !== -1, 'isCurrentPage no longer special-cases a fragment-only href');
	assert(norm !== -1, 'isCurrentPage no longer normalises at all');
	assert(guard < norm,
		'the fragment guard runs AFTER normalise(), which strips the very fragment it is testing for');
	// and the callers must actually route through the shared matcher rather
	// than each re-deriving it - that duplication is what forked dev-blog.
	for (const f of ['src/astro/Header.astro', 'src/astro/HeaderLink.astro']) {
		const s = read(f);
		assert(/from '\.\/current'/.test(s),
			`${f} does not import the shared matcher from ./current`);
		assert(!/aria-current=\{l\.active\s*\?/.test(s) && !/pathname\s*===\s*l?\.?href/.test(s),
			`${f} re-derives the current-page match instead of calling isCurrentPage()`);
	}
});

check('HeaderLink decides only the attribute; the library owns the look', () => {
	// A second rule for the same state in a second layer is a cascade race.
	// The component must emit aria-current and nothing else. Comments are
	// stripped first, or the `<style>` named in the doc comment below would
	// fail its own test.
	const l = read('src/astro/HeaderLink.astro')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '');
	assert(!/<style>/.test(l),
		'HeaderLink ships a <style> block, which duplicates .cm-header__link[aria-current=page] in a second layer');
	assert(/aria-current=\{isActive\s*\?\s*'page'\s*:\s*undefined\}/.test(l),
		'HeaderLink must render aria-current from its own match');
});

check('HeaderLink ships the default nav class so it cannot be unstyled', () => {
	// The class is the styling hook. A consumer writing <HeaderLink href=..>
	// with no class must still get .cm-header__link, or the link renders as
	// body text in the middle of a nav.
	const l = read('src/astro/HeaderLink.astro');
	assert(/class:\s*className\s*=\s*'cm-header__link'/.test(l),
		'HeaderLink must default class to cm-header__link');
});

check('the showcase demonstrates both nav states', () => {
	// A state that is never rendered anywhere is dead the moment it ships.
	// The states exist, so the showcase has to show them, in the nav section
	// so a future rename of the section cannot silently drop the demo.
	const start = showcase.indexOf('id="nav"');
	assert(start !== -1, 'showcase has no nav section');
	const nav = showcase.slice(start, showcase.indexOf('id="lists"'));
	assert(/aria-current="page"/.test(nav), 'the nav section must demo the current-page state');
	assert(/class="cm-header__link is-active"/.test(nav),
		'the nav section must demo the scroll-spy state');
	assert(/<HeaderLink/.test(nav), 'the nav section must demo <HeaderLink>');
	// and the showcase must actually USE the component, not just name it
	assert(/import HeaderLink from/.test(showcase),
		'the showcase must import <HeaderLink>, or the component is never compiled');
});

/* ================= interactive components ================= */
console.log('\ninteractive components');

// A minimal element, enough to exercise the runtime's attribute and
// event work without a DOM library. Comments are stripped before the
// runtime is read, or a word in an explanatory comment satisfies an
// assertion about behaviour.
const rt = runtimeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Builds a fake element. `attrs` is the attribute map, `kids` the child
// nodes. Nodes answer the same queries a real one does — a runtime that
// calls el.querySelectorAll('.x') must not need a document to do it, and
// a fake that returns nothing for a class selector would make every
// behavioural test below pass for the wrong reason.
let ACTIVE = null;
const classesOf = (n) => (n.attrs.class || '').split(/\s+/).filter(Boolean);
const attrOf = (sel) => {
	const m = /^\[([a-z-]+)(?:=["']?([^\]"']*)["']?)?\]$/.exec(sel);
	if (!m) return null;
	return { a: m[1], v: m[2] };
};
const matches = (n, sel) => {
	if (sel.startsWith('.')) return classesOf(n).includes(sel.slice(1));
	const at = attrOf(sel);
	if (at) return at.a in n.attrs && (at.v === undefined || n.attrs[at.a] === at.v);
	return false;
};
const walkAll = (n, out, fn) => {
	if (fn(n)) out.push(n);
	n.kids.forEach((k) => walkAll(k, out, fn));
};
const el = (tag, attrs = {}, kids = []) => {
	const node = {
		tag,
		attrs: { ...attrs },
		dataset: {},
		kids,
		events: {},
		open: false,
		focused: false,
		nodeType: 1,
		parentNode: null,
		get className() { return node.attrs.class || ''; },
		set className(v) { node.attrs.class = v; },
		get id() { return node.attrs.id || ''; },
		getAttribute: (k) => (k in node.attrs ? String(node.attrs[k]) : null),
		setAttribute: (k, v) => {
			node.attrs[k] = String(v);
			if (k === 'class') node.attrs.class = String(v);
		},
		removeAttribute: (k) => { delete node.attrs[k]; },
		hasAttribute: (k) => k in node.attrs,
		// A real appendChild MOVES an already-parented node; it does not
		// clone it into a second slot. A fake that pushes unconditionally
		// invents a duplicate the browser would never produce, and any
		// test that counts children then fails for a reason that has
		// nothing to do with the code under test.
		appendChild: (c) => {
			if (c.parentNode) c.parentNode.removeChild(c);
			node.kids.push(c);
			c.parentNode = node;
			return c;
		},
		removeChild: (c) => {
			const i = node.kids.indexOf(c);
			if (i !== -1) node.kids.splice(i, 1);
			c.parentNode = null;
		},
		remove() { if (node.parentNode) node.parentNode.removeChild(node); },
		addEventListener: (t, fn) => { (node.events[t] = node.events[t] || []).push(fn); },
		// Events BUBBLE. A click lands on the close button and the
		// listener is on the toast that contains it; a fake that only
		// calls the target's own handlers makes every delegated
		// listener in the runtime look broken — and, worse, makes a
		// handler that genuinely never fires look correct.
		fire(t, ev = {}) {
			const event = { target: node, preventDefault() {}, ...ev };
			let n = node;
			while (n) {
				(n.events[t] || []).forEach((fn) => fn(event));
				n = n.parentNode;
			}
		},
		querySelector(sel) {
			const out = [];
			walkAll(node, out, (n) => n !== node && matches(n, sel));
			return out[0] || null;
		},
		querySelectorAll(sel) {
			const out = [];
			walkAll(node, out, (n) => n !== node && matches(n, sel));
			return out;
		},
		focus() { node.focused = true; ACTIVE = node; },
		// The runtime's own dispatch walks up from the event target. A
		// real closest() must find the trigger, or a click on a child
		// glyph silently misses the control that owns it.
		closest(sel) {
			let n = node;
			while (n) {
				if (matches(n, sel)) return n;
				n = n.parentNode;
			}
			return null;
		},
	};
	// dataset mirrors data-* attributes, which is how the runtime reads
	// the idempotence guards and the region/dialog hook attributes.
	for (const [k, v] of Object.entries(node.attrs)) {
		if (!k.startsWith('data-')) continue;
		const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
		node.dataset[camel] = String(v);
	}
	return node;
};

// A document over a set of roots. The runtime's initialisation runs on
// the document, so this has to answer the same queries.
const domOf = (roots) => {
	const d = {
		readyState: 'complete',
		// The runtime reads document.activeElement to know which tab an
		// arrow key came from. A frozen stub makes every arrow test a
		// test of the stub, so it has to track what focus() did.
		get activeElement() { return ACTIVE; },
		documentElement: { getAttribute: () => null, setAttribute: () => {}, dataset: {} },
		body: el('body'),
		createElement: (t) => el(t),
		addEventListener: () => {},
		find(sel) {
			const out = [];
			for (const r of roots) walkAll(r, out, (n) => matches(n, sel));
			return out;
		},
		querySelector(sel) { return this.find(sel)[0] || null; },
		querySelectorAll(sel) { return this.find(sel); },
		getElementById(id) {
			for (const r of roots) {
				const out = [];
				walkAll(r, out, (n) => n.attrs.id === id);
				if (out.length) return out[0];
			}
			return null;
		},
	};
	return d;
};

// Runs the real runtime against a fake document and hands back the API.
const runOn = (roots) => {
	ACTIVE = null; // focus does not survive a fresh document
	const doc = domOf(roots);
	const ctx = {
		document: doc,
		module: { exports: {} },
		localStorage: { getItem: () => null, setItem: () => {} },
		window: { addEventListener: () => {} },
		setTimeout,
		clearTimeout,
		Date,
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	vm.runInContext(rt, ctx);
	// The module self-inits on load, and ACTIVE is the node the runtime
	// would see as focused.
	return { api: ctx.module.exports, doc, focusNode: () => ACTIVE };
};

const tabGroup = () => {
	const mk = (id, panel, selected) => el('button', {
		class: 'cm-tabs__tab', role: 'tab', id, 'aria-controls': panel,
		'aria-selected': selected ? 'true' : 'false', tabindex: '0',
	});
	const panelOf = (id, tabId) => el('div', {
		class: 'cm-tabs__panel', role: 'tabpanel', id, 'aria-labelledby': tabId,
	});
	const tabs = [mk('t1', 'p1', true), mk('t2', 'p2', false), mk('t3', 'p3', false)];
	const panels = [panelOf('p1', 't1'), panelOf('p2', 't2'), panelOf('p3', 't3')];
	panels[1].setAttribute('hidden', '');
	panels[2].setAttribute('hidden', '');
	const list = el('div', { class: 'cm-tabs__list', role: 'tablist' }, tabs);
	return el('div', { class: 'cm-tabs' }, [list, ...panels]);
};

check('cm-tabs: components.css defines the block and all of its parts', () => {
	for (const sel of [
		'.cm-tabs', '.cm-tabs__list', '.cm-tabs__tab', '.cm-tabs__panel',
	]) {
		assert(new RegExp(`${sel.replace('.', '\\.')}\\s*[,{]`).test(compSrc),
			`components.css never defines ${sel}`);
	}
});

check('cm-tabs: the demo page wires a real tablist', () => {
	for (const t of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected', 'aria-controls', 'aria-labelledby']) {
		assert(showcase.includes(t), `the showcase has no ${t}`);
	}
});

check('cm-tabs: every tab points at a panel that exists, and back at it', () => {
	// A tab whose aria-controls names nothing is a control with no
	// effect, and it is invisible in a visual pass: the tab looks
	// selected and the content never changes.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	const controls = [...open.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
	const labelled = [...open.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
	assert(controls.length >= 3, `expected a tablist of at least 3, found ${controls.length}`);
	for (const c of controls) {
		assert(open.includes(`id="${c}"`), `aria-controls="${c}" names no element`);
	}
	for (const l of labelled) {
		assert(open.includes(`id="${l}"`), `aria-labelledby="${l}" names no element`);
	}
});

check('cm-tabs: only one tab is ever selected', () => {
	// Two selected tabs is a tablist that answers two different
	// questions at once; AT reports the set, not the winner.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	const list = /<div class="cm-tabs__list"[\s\S]*?<\/div>/.exec(open);
	assert(list, 'no tablist found in the showcase');
	const tabs = list[0].match(/role="tab"/g) || [];
	const selected = list[0].match(/aria-selected="true"/g) || [];
	assert(tabs.length >= 2, `expected a multi-tab tablist, found ${tabs.length}`);
	assert(selected.length === 1, `${selected.length} tabs are selected; exactly one must be`);
});

check('cm-tabs: the runtime roves the tabindex instead of tabbing the whole row', () => {
	// The WAI-ARIA pattern: one tab in the tab order, arrows move
	// between them. Without this, Tab walks every tab, which is the
	// exact behaviour the pattern exists to prevent.
	const group = tabGroup();
	const { api, doc } = runOn([group]);
	api.init(doc);
	const tabs = group.kids[0].kids;
	assert(tabs.filter((t) => t.getAttribute('tabindex') === '0').length === 1,
		`${tabs.filter((t) => t.getAttribute('tabindex') === '0').length} tabs are in the tab order, want 1`);
	assert(tabs[0].getAttribute('tabindex') === '0', 'the selected tab must be the tabbable one');
	assert(tabs[1].getAttribute('tabindex') === '-1', 'the other tabs must be -1');
});

check('cm-tabs: arrow keys move selection, focus and panel together', () => {
	const group = tabGroup();
	const { api, doc } = runOn([group]);
	const tabs = group.kids[0].kids;
	const panels = group.kids.slice(1);

	tabs[0].focus();
	group.fire('keydown', { key: 'ArrowRight' });
	assert(tabs[1].getAttribute('aria-selected') === 'true', 'ArrowRight did not select the next tab');
	assert(tabs[0].getAttribute('aria-selected') === 'false', 'the previous tab is still selected');
	assert(doc.activeElement === tabs[1], 'ArrowRight did not move focus to the new tab');
	assert(tabs[1].getAttribute('tabindex') === '0', 'the newly selected tab is not the tabbable one');
	assert(!panels[1].hasAttribute('hidden'), 'the panel for the selected tab is still hidden');
	assert(panels[0].hasAttribute('hidden'), 'the previous panel is still visible');
});

check('cm-tabs: the arrow keys wrap, and Home/End jump to the ends', () => {
	const group = tabGroup();
	const { api, doc } = runOn([group]);
	api.init(doc);
	const tabs = group.kids[0].kids;
	tabs[0].focus();
	group.fire('keydown', { key: 'ArrowLeft' });
	assert(tabs[2].getAttribute('aria-selected') === 'true', 'ArrowLeft from the first tab must wrap to the last');
	group.fire('keydown', { key: 'End' });
	assert(tabs[2].getAttribute('aria-selected') === 'true', 'End did not stay on the last tab');
	group.fire('keydown', { key: 'Home' });
	assert(tabs[0].getAttribute('aria-selected') === 'true', 'Home did not select the first tab');
});

check('cm-tabs: a key that is not part of the pattern is left alone', () => {
	// Arrow keys are the pattern; PageUp is not, and swallowing it
	// would break a consumer's own shortcut.
	const group = tabGroup();
	const { api, doc } = runOn([group]);
	api.init(doc);
	const tabs = group.kids[0].kids;
	tabs[0].focus();
	group.fire('keydown', { key: 'PageDown' });
	assert(tabs[0].getAttribute('aria-selected') === 'true', 'an unrelated key changed the selection');
});

check('cm-tabs: a markup mismatch is normalised on bind, not trusted', () => {
	// Two tabs claiming aria-selected="true" is a silent ARIA lie. The
	// runtime owns the normalisation so the component cannot ship one.
	const group = tabGroup();
	group.kids[0].kids[1].setAttribute('aria-selected', 'true');
	const { api, doc } = runOn([group]);
	api.init(doc);
	const tabs = group.kids[0].kids;
	assert(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1,
		'the runtime left more than one tab selected');
	// A tab whose panel is missing must not throw on init.
	const orphan = el('button', {
		class: 'cm-tabs__tab', role: 'tab', id: 't9', 'aria-controls': 'nope',
		'aria-selected': 'true',
	});
	const g2 = el('div', { class: 'cm-tabs' }, [el('div', { class: 'cm-tabs__list' }, [orphan])]);
	const r2 = runOn([g2]);
	r2.api.init(r2.doc);
	assert(true, 'init threw on a tab with a missing panel');
});

check('cm-tabs: init is idempotent, as every astro:page-load requires', () => {
	// A second init re-normalises but must not stack a second listener
	// per group, or one arrow press advances two tabs.
	const group = tabGroup();
	const { api, doc } = runOn([group]);
	api.init(doc);
	api.init(doc);
	const tabs = group.kids[0].kids;
	tabs[0].focus();
	group.fire('keydown', { key: 'ArrowRight' });
	assert(tabs[1].getAttribute('aria-selected') === 'true', 'the first tab should be selected');
	assert(tabs[2].getAttribute('aria-selected') === 'false', 'a double-bound handler skipped a tab');
});

/* ---------- dialog ---------- */

check('cm-dialog: the markup is a real <dialog>, not a div with role=dialog', () => {
	// A div cannot be in the top layer, cannot be made inert-behind, and
	// gets no focus trap from the engine. Each of those is the entire
	// reason to use the element.
	assert(/<dialog class="cm-dialog"/.test(showcase), 'the showcase has no <dialog class="cm-dialog">');
	// A div pretending to be a MODAL gets no top layer, no inert-behind and
	// no focus trap from the engine. The exception is an element that is
	// already a top-layer [popover] and is not modal - that is the
	// platform's own non-modal dialog, and the whole point of the popover
	// API. Each match is checked as a whole tag, not as a bare attribute.
	for (const tag of showcase.match(/<[a-z]+[^>]*role="dialog"[^>]*>/g) || []) {
		assert(/\bpopover\b/.test(tag),
			`a role="dialog" is a hand-rolled modal unless the tag is a top-layer [popover]: ${tag.slice(0, 90)}`);
	}
	assert(/\.cm-dialog::backdrop/.test(compSrc), 'the dialog has no ::backdrop rule');
});

check('cm-dialog: the dialog has an accessible name', () => {
	// A dialog with no name is announced as "dialog" and nothing else,
	// which is useless when three of them can be open.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	for (const m of open.matchAll(/<dialog[^>]*>/g)) {
		assert(/aria-labelledby="/.test(m[0]) || /aria-label="/.test(m[0]),
			`the dialog has no accessible name: ${m[0]}`);
	}
});

check('cm-dialog: the trigger calls showModal, not show', () => {
	// show() gives a non-modal dialog: no top layer, no focus trap, and
	// the page behind it stays live and clickable.
	assert(/dlg\.showModal\(\)/.test(rt), 'the runtime never calls showModal()');
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	assert(/data-cm-open="dlg-demo"/.test(open), 'no trigger is wired to the demo dialog');
});

check('cm-dialog: the scrim is a token, and the two themes give it different values', () => {
	// The same alpha over near-black and over near-white hides the page
	// by very different amounts, so a single literal is wrong in one of
	// the themes by construction. And a literal in components.css is a
	// rebrand bug like any other.
	const scrim = /\.cm-dialog::backdrop\s*\{([^}]*)\}/.exec(compSrc);
	assert(scrim, 'no .cm-dialog::backdrop rule');
	assert(/var\(--scrim\)/.test(scrim[1]), `::backdrop must paint var(--scrim), got: ${scrim[1].trim()}`);
	assert(!/#[0-9a-f]{3,8}\b/i.test(scrim[1]), 'the scrim hardcodes a colour instead of using the token');
	// Every theme block that paints a surface must define the scrim.
	const blocks = [...tokenSrc.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map((m) => ({ sel: m[1].trim(), body: m[2] }))
		.filter((b) => /--(bg|shadow-card):/.test(b.body));
	assert(blocks.length >= 4, `expected the theme blocks to be found, saw ${blocks.length}`);
	for (const b of blocks) {
		assert(/--scrim:/.test(b.body), `theme block ${b.sel} paints surfaces but defines no --scrim`);
	}
	const values = [...tokenSrc.matchAll(/--scrim:\s*([^;]+)/g)].map((m) => m[1].trim());
	assert(new Set(values).size === 2,
		`the scrim is the same in both themes (${[...new Set(values)].join(' / ')}); the same alpha cannot dim both surfaces equally`);
});

check('cm-dialog: the frame survives a consumer reset', () => {
	// The UA sheet centres a modal dialog with `margin: auto`. A
	// consumer's `* { margin: 0 }` reset outranks nothing and silently
	// pins the dialog to the top-left corner, so say it explicitly.
	const rule = /\.cm-dialog\s*\{([^}]*)\}/.exec(compSrc);
	assert(rule, '.cm-dialog is not defined');
	assert(/margin:\s*auto/.test(rule[1]),
		'.cm-dialog does not declare margin:auto, so a `* { margin: 0 }` reset pins it to the corner');
});

/* ---------- toast ---------- */

check('cm-toast: the variants are the same three as .cm-alert, and the glyphs match', () => {
	// A toast is a transient alert. If it invents its own vocabulary it
	// becomes a second alert component, and the two drift.
	for (const v of ['ok', 'warn', 'err']) {
		assert(new RegExp(`\\.cm-toast--${v}\\b`).test(compSrc), `.cm-toast--${v} is missing`);
	}
	const glyphOf = (prefix) => {
		const out = {};
		for (const v of ['ok', 'warn', 'err']) {
			// Selector-list aware, for the same reason as the alert test above:
			// pairing the toast and alert glyphs into one rule is the obvious
			// refactor here, and it is exactly what made this test blind.
			const body = declForSelector(`.${prefix}--${v} .${prefix}__mark::before`);
			assert(body, `.${prefix}--${v} carries no ::before glyph`);
			const m = /content:\s*'([^']*)'/.exec(body);
			assert(m, `.${prefix}--${v} declares no content: for its ::before glyph`);
			out[v] = m[1];
		}
		return out;
	};
	const alert = glyphOf('cm-alert');
	const toast = glyphOf('cm-toast');
	assert(JSON.stringify(alert) === JSON.stringify(toast),
		`the toast glyphs differ from the alert glyphs; they are the same three states.\n`
		+ `alert: ${JSON.stringify(alert)}\ntoast: ${JSON.stringify(toast)}`);
	assert(new Set(Object.values(toast)).size === 3, 'the three toast glyphs must differ from each other');
});

check('cm-toast: the mark is empty in the markup, exactly as the alert mark is', () => {
	// CSS injects the glyph. A literal glyph in the span renders twice
	// and is announced twice. The alert mark already shipped this bug.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	const built = /<span class="cm-toast__mark" aria-hidden="true"><\/span>/g;
	assert(built.test(showcase),
		'the showcase does not render the toast mark as an empty aria-hidden span');
	assert(!/class="cm-toast__mark"[^>]*>\s*[^\s<]/.test(showcase),
		'a literal glyph was left inside a toast mark');
});

check('cm-toast: the region is a live region, and it is not a wall', () => {
	assert(/data-cm-toasts[^>]*role="status"/.test(showcase)
		|| /aria-live="polite"/.test(showcase),
	'the toast region is not a live region, so a toast is never announced');
	// A fixed full-region overlay that took pointer events would eat
	// clicks on the page behind it. pointer-events:none on the region
	// and auto on the toast is the only arrangement that works.
	const region = /^\.cm-toast-region\s*\{([^}]*)\}/m.exec(compSrc);
	assert(region, '.cm-toast-region is not defined');
	assert(/pointer-events:\s*none/.test(region[1]),
		'.cm-toast-region must be pointer-events:none, or the stack blocks the page behind it');
	const toastRule = /^\.cm-toast\s*\{([^}]*)\}/m.exec(compSrc);
	assert(/pointer-events:\s*auto/.test(toastRule[1]),
		'.cm-toast must be pointer-events:auto, or its own close control is unclickable');
});

check('cm-toast: the runtime retires a toast, and dismissal is idempotent', () => {
	// "Transient" is the whole contract, so somebody has to honour it.
	// A double-dismiss must not throw, because a timer and a click can
	// land on the same toast.
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const { api, doc } = runOn([region]);
	const t = el('div', { class: 'cm-toast cm-toast--ok' });
	region.appendChild(t);
	api.toast(t);
	api.dismissToast(t);
	assert(region.kids.length === 0, 'dismiss did not remove the toast from the region');
	api.dismissToast(t);
	assert(true, 'a second dismiss threw');
});

check('cm-toast: a toast with nobody watching still goes away on its own', () => {
	// The timer IS the component. Without this, "transient" is a CSS
	// fade and a toast accumulates on the page until a reload — which
	// a screenshot of the showcase will never show, because the demo
	// removes them by hand.
	// The runtime is given a controlled setTimeout so the 6s elapses
	// on demand rather than by waiting for it.
	let scheduled = null;
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const doc = domOf([region]);
	const ctx = {
		document: doc,
		module: { exports: {} },
		localStorage: { getItem: () => null, setItem: () => {} },
		window: { addEventListener: () => {} },
		setTimeout: (fn, ms) => { scheduled = { fn, ms }; return 1; },
		clearTimeout: () => {},
		Date,
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	vm.runInContext(rt, ctx);
	const t = el('div', { class: 'cm-toast cm-toast--ok' });
	ctx.module.exports.toast(t);
	assert(scheduled, 'toast() scheduled no retirement — a toast would never go away');
	assert(scheduled.ms > 0 && scheduled.ms <= 30000,
		`the retirement is scheduled at ${scheduled.ms}ms, which is not a toast lifetime`);
	assert(region.kids.includes(t), 'the toast was not mounted');
	scheduled.fn();                       // the 6s elapses
	assert(region.kids.length === 0, 'the toast outlived its timer');
});

check('cm-toast: the close control retires it without the timer', () => {
	// A user who dismisses a toast waits for nothing, and the click
	// arrives on the close BUTTON, not the toast — so the handler has
	// to walk up from the event target. A handler bound to the toast
	// with a `target === toast` test silently never fires.
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const toast = el('div', { class: 'cm-toast cm-toast--ok', 'data-cm-toast': '' });
	const btn = el('button', { class: 'cm-toast__close', 'data-cm-toast-close': '' });
	const mark = el('span', { class: 'cm-toast__mark' });
	toast.appendChild(mark);
	toast.appendChild(btn);
	region.appendChild(toast);
	const { api, doc } = runOn([region]);
	api.init(doc);
	// the click really does land on the button
	btn.fire('click');
	assert(region.kids.length === 0, 'the close control did not retire the toast');
	// and a click elsewhere in the toast must NOT retire it
	const t2 = el('div', { class: 'cm-toast', 'data-cm-toast': '' });
	region.appendChild(t2);
	api.init(doc);
	t2.fire('click');
	assert(region.kids.includes(t2), 'any click on the toast dismissed it');
});

check('cm-toast: a toast created AFTER init can still be closed', () => {
	// The bug this catches: binding the close control once inside
	// init(). Every toast in the showcase is created by a click
	// handler, so the listener is bound before the toast exists and the
	// close button is dead — with no error, and with the suite green.
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const { api, doc } = runOn([region]);
	api.init(doc);
	// now the toast is born, long after init walked the document
	const t = api.toast('saved');
	assert(region.kids.includes(t), 'the toast did not mount');
	const btn = el('button', { class: 'cm-toast__close', 'data-cm-toast-close': '' });
	t.appendChild(btn);
	btn.fire('click');
	assert(region.kids.length === 0, 'a toast created after init cannot be closed');
});

check('cm-toast: a close control on a hand-written toast works too', () => {
	// The other direction: markup the author wrote, present at init.
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const t = el('div', { class: 'cm-toast', 'data-cm-toast': '' });
	const btn = el('button', { class: 'cm-toast__close', 'data-cm-toast-close': '' });
	t.appendChild(btn);
	region.appendChild(t);
	const { api, doc } = runOn([region]);
	api.init(doc);
	btn.fire('click');
	assert(region.kids.length === 0, 'a hand-written toast cannot be closed');
	// and init twice must not double-bind
	api.init(doc);
	api.init(doc);
	const t2 = api.toast('again');
	const b2 = el('button', { 'data-cm-toast-close': '' });
	t2.appendChild(b2);
	b2.fire('click');
	assert(region.kids.length === 0, 'a toast left the region');
});

check('cm-toast: a toast is mounted in the live region, not orphaned', () => {
	const region = el('div', { class: 'cm-toast-region', 'data-cm-toasts': '' });
	const { api, doc } = runOn([region]);
	const t = el('div', { class: 'cm-toast cm-toast--ok' });
	api.toast(t);
	assert(region.kids.includes(t), 'toast() did not mount the node in the region');
	assert(region.getAttribute('data-cm-toasts') !== undefined, 'the region lost its hook');
});

check('cm-toast: every toast the showcase can produce is announced exactly once', () => {
	// A role="alert" toast inside a role="status" region is announced
	// twice, because the region announces the insertion AND the alert
	// announces itself. The region owns the announcement; the toast
	// must not double up.
	//
	// The whole page is scanned, not just the section: the showcase
	// BUILDS these toasts in a script, so a section-scoped check reads
	// markup that never exists and passes forever.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	assert(/<div class="cm-toast-region"[^>]*role="status"[^>]*aria-live="polite"/.test(open),
		'the toast region is not role="status" aria-live="polite"');
	// Static markup, anywhere in the page.
	assert(!/class="cm-toast[^"]*"[^>]*role="alert"/.test(showcase),
		'a toast in the markup carries role="alert" inside a live region, so it is announced twice');
	// And the script that builds them, which is where a toast actually
	// comes from at runtime. Match the whole call so the VALUE is
	// checked: a scan of attribute names alone would never see
	// setAttribute('role', 'alert') as a role at all.
	for (const m of showcase.matchAll(/setAttribute\(\s*['"](role|aria-live)['"]\s*,\s*['"]([\w-]+)['"]/g)) {
		const [, attr, value] = m;
		// role="alert", role="log" and a live region on a node the
		// script BUILDS all double-announce: the region already
		// announces the insertion, and each of these announces itself.
		// aria-live="off" is harmless, so only the assertive/polite and
		// alert/log/status cases are rejected.
		const announces = attr === 'aria-live'
			? value === 'assertive' || value === 'polite'
			: value === 'alert' || value === 'log' || value === 'status';
		assert(!announces,
			`the showcase script sets ${attr}="${value}" on a node it builds; `
			+ 'the live region already announces the insertion, so this double-announces');
	}
	// The built markup must be statically checkable. A template literal
	// or an innerHTML string can hide a role from every check above.
	const toastScript = showcase.slice(showcase.indexOf('data-cm-toast-demo'));
	assert(!/innerHTML\s*=\s*`/.test(toastScript),
		'the toast markup is built by a template literal, which is not statically checkable');
});

/* ---------- dropdown ---------- */

check('cm-dropdown: the menu is a real popover with a real invoker', () => {
	// [popover] gives light-dismiss, Escape, focus return and the top
	// layer. A hand-rolled menu gets each of those subtly wrong, and
	// the failure mode (a menu that will not close) is invisible in a
	// static screenshot.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	assert(/popover(>|\s)/.test(open), 'the dropdown menu is not a [popover]');
	assert(/popovertarget="/.test(open), 'the trigger does not carry popovertarget');
	assert(!/data-cm-dropdown|cmDropdown/.test(rt),
		'the runtime re-implements the dropdown; the platform already does it');
});

check('cm-dropdown: a closed menu cannot paint, even against a consumer display rule', () => {
	// The UA sheet hides a closed popover, but any author `display`
	// outranks it. A menu that stays on screen, invisible to the
	// author who closed it, is the classic popover leak.
	const rule = /\.cm-dropdown__menu:not\(:popover-open\)\s*\{([^}]*)\}/.exec(compSrc);
	assert(rule, 'no :not(:popover-open) rule, so a closed menu can still be shown by a consumer reset');
	assert(/display:\s*none/.test(rule[1]), 'the closed-menu rule does not set display:none');
});

check('cm-dropdown: every menu item is reachable and carries a role', () => {
	// A menu of divs is not a menu. A disabled item must be
	// aria-disabled, not just visually dimmed, or it is still a target.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	const menu = /<div class="cm-dropdown__menu"[\s\S]*?<\/div>/.exec(open);
	assert(menu, 'no dropdown menu found in the showcase');
	const items = menu[0].match(/class="cm-dropdown__item"/g) || [];
	assert(items.length >= 2, `expected a menu of at least 2 items, found ${items.length}`);
	assert((menu[0].match(/role="menuitem"/g) || []).length === items.length,
		'every menu item needs role="menuitem"');
	assert(/role="menu"/.test(menu[0]), 'the menu panel needs role="menu"');
	assert(/aria-disabled="true"/.test(menu[0]), 'the disabled item is dimmed but not aria-disabled');
	// and the menu needs a name
	assert(/aria-label="/.test(menu[0]), 'the menu has no accessible name');
});

/* ---------- tooltip ---------- */

check('cm-tooltip: the tip is a real element, not a ::after', () => {
	// aria-describedby must resolve to something in the accessibility
	// tree. Generated content is not there, so a ::after tooltip is
	// invisible to a screen reader no matter how good the text is.
	assert(/<span class="cm-tooltip__tip"[^>]*role="tooltip"/.test(showcase),
		'the tooltip tip is not a real element with role="tooltip"');
	assert(!/\.cm-tooltip[^{}]*::after/.test(compSrc),
		'a ::after tooltip cannot be referenced by aria-describedby');
});

check('cm-tooltip: every tip is described by a real, focusable trigger', () => {
	// An orphan aria-describedby is silently dropped by AT, so the tip
	// never reaches anyone. And a div trigger cannot be focused, so
	// :focus-within never fires and the tip is mouse-only.
	const open = showcase.slice(showcase.indexOf('id="overlays"'), showcase.indexOf('id="prose"'));
	const tips = [...open.matchAll(/id="(tip-[^"]+)"\s+role="tooltip"/g)].map((m) => m[1]);
	assert(tips.length >= 1, 'the showcase demos no tooltip');
	for (const t of tips) {
		assert(open.includes(`aria-describedby="${t}"`), `no trigger describes ${t}`);
	}
	assert(/aria-describedby="(tip-[^"]+)"/.test(open), 'no aria-describedby on any trigger');
	// The trigger must be focusable: :focus-within is the keyboard path.
	const trigger = /<button[^>]*aria-describedby="tip-[^"]*"[^>]*>/.exec(open);
	assert(trigger, 'the tooltip trigger is not a <button>, so it cannot take focus');
});

check('cm-tooltip: a hidden tip is invisible to a pointer AND to AT', () => {
	// opacity:0 alone leaves the tip on top of the trigger swallowing
	// clicks, and still in the layout where AT can reach it.
	const rule = /^\.cm-tooltip__tip\s*\{([^}]*)\}/m.exec(compSrc);
	assert(rule, '.cm-tooltip__tip is not defined');
	assert(/visibility:\s*hidden/.test(rule[1]),
		'a hidden tip must be visibility:hidden, not just transparent');
	assert(/pointer-events:\s*none/.test(rule[1]),
		'a hidden tip must be pointer-events:none, or it swallows a click on the trigger');
	const show = /\.cm-tooltip:hover \.cm-tooltip__tip,\s*\.cm-tooltip:focus-within \.cm-tooltip__tip\s*\{([^}]*)\}/.exec(compSrc);
	assert(show, 'no :hover / :focus-within rule, so the tip never appears');
	assert(/visibility:\s*visible/.test(show[1]), 'the reveal does not restore visibility');
});

/* ---------- shared rules across all five ---------- */

check('the five new components carry no colour of their own', () => {
	// Same rule the state components live under: this palette is
	// greyscale, and a new surface is exactly where that gets broken.
	const blocks = ['cm-tabs', 'cm-dialog', 'cm-toast', 'cm-dropdown', 'cm-tooltip']
		.flatMap((b) => [...compSrc.matchAll(
			new RegExp(`(^|[};])\\s*([^;{}@]*\\b${b}\\b[^{}]*?)\\s*\\{([^{}]*)\\}`, 'gm'),
		)].map((m) => m[2] + ' {' + m[3] + '}'));
	assert(blocks.length > 0, 'no rules found for the new components — is the parse stale?');
	const block = blocks.join('\n');
	const hex = block.match(/#[0-9a-f]{3,8}\b/gi) || [];
	assert(hex.length === 0, `the new components must use tokens, found literal colours: ${hex}`);
	// every colour-ish declaration must go through a var()
	const raw = [...block.matchAll(
		/(?:^|[;{])\s*((?:-webkit-)?[a-z-]*color|(?:-webkit-)?background(?:-color)?|border(?:-[a-z]+)?-color|outline(?:-[a-z]+)?-color|box-shadow|fill|stroke)\s*:\s*([^;}]+)/g,
	)]
		.filter((m) => !/^var\(|^currentColor$|^inherit$|^none$|^transparent$/.test(m[2].trim()))
		.map((m) => `${m[1]}: ${m[2].trim()}`);
	assert(raw.length === 0, `colour must come from a token, found: ${raw.join(', ')}`);
});

check('the new components are floored on mobile like every other one', () => {
	// The exhaustive scan in the base layer rejects ANY selector in this
	// file that renders under 12px and is not in the floor block. The
	// new components must therefore either use max(var(--min-font), …)
	// at their own definition, or be added to the floor. Prove the first.
	for (const sel of [
		'.cm-tabs__tab', '.cm-toast', '.cm-toast__close', '.cm-toast__title',
		'.cm-toast__text', '.cm-dropdown__menu', '.cm-dropdown__item',
		'.cm-tooltip__tip',
	]) {
		const rules = [...compSrc.matchAll(
			new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'),
		)].map((m) => m[1]);
		assert(rules.length > 0, `${sel} is not defined`);
		const declares = rules.filter((r) => /font-size:/.test(r));
		if (!declares.length) continue; // inherits from a floored parent
		for (const d of declares) {
			assert(/max\(var\(--min-font\)/.test(d),
				`${sel} declares a font-size with no --min-font floor: ${d.trim()}`);
		}
	}
});

check('the toast animation is in the reduced-motion block, with the rest', () => {
	// The guard is ONE block and nothing after it: slicing to the end of
	// the file would let a later mention satisfy the check, which is how
	// a real gap stays green.
	const guardAt = compSrc.indexOf('@media (prefers-reduced-motion: reduce)');
	assert(guardAt !== -1, 'no reduced-motion block');
	const close = compSrc.indexOf('\n}', guardAt);
	const guard = compSrc.slice(guardAt, close);
	const stopRules = [...guard.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter((m) => /animation:\s*none\b/.test(m[2]))
		.map((m) => m[1])
		.join(',');
	assert(/\.cm-toast\s*(,|$)/m.test(stopRules),
		'the toast animates in but is not in the reduced-motion block');
});

check('the five new components are documented, and the docs are real', () => {
	// A component nobody can find is a component nobody adopts. This
	// asserts each class is DEMONSTRATED, not merely mentioned: a prose
	// sentence naming .cm-tooltip satisfies nothing, and a stub section
	// listing five class names would satisfy a substring scan.
	const readme = read('README.md');
	const from = readme.indexOf('### Tabs, dialogs, toasts, dropdowns, tooltips');
	const section = readme.slice(from, readme.indexOf('### Everything else', from));
	assert(section.length > 400, 'the README has no section documenting the new components');
	// each component needs a real fenced html example, not just its name
	for (const sel of ['cm-tabs', 'cm-dialog', 'cm-toast', 'cm-dropdown', 'cm-tooltip']) {
		assert(section.includes(`**\`.${sel}\`**`), `the README never introduces .${sel}`);
		const block = /```html\n([\s\S]*?)```/g;
		let shown = false;
		for (const m of section.matchAll(block)) {
			if (m[1].includes(sel)) { shown = true; break; }
		}
		assert(shown, `the README names .${sel} but shows no markup for it`);
	}
	for (const sel of [
		'cm-tabs__tab', 'cm-tabs__panel',
		'cm-dialog__body', 'cm-dialog__foot',
		'cm-toast--ok', 'cm-toast-region',
		'cm-dropdown__menu', 'cm-dropdown__item',
		'cm-tooltip__tip',
	]) {
		assert(section.includes(sel), `the README does not document .${sel}`);
	}
});

check('the new components are reachable from the showcase nav', () => {
	// A section that exists but is not linked is a section nobody
	// scrolls to, and a component that is not demoed is dead CSS.
	assert(showcaseIndex.includes('overlays'), 'the overlays section is not in the section index the nav is built from');
	assert(/id="overlays"/.test(showcase), 'the nav points at a section that does not exist');
});

check('install.sh still lands the layers, scrim included', () => {
	// The scrim is a new token in the contract. A consumer that installs
	// the layers without it gets a dialog with an unstyled backdrop that
	// still LOOKS like it shipped.
	const sh = read('scripts/install.sh');
	assert(/tokens\.css/.test(sh), 'the installer does not copy tokens.css');
	const css = read('src/styles/components.css');
	assert(/\.cm-dialog::backdrop/.test(css), 'the installed layer has no dialog backdrop rule');
	assert(/--scrim:/.test(read('src/styles/tokens.css')), 'the token file defines no --scrim');
});

/* ---------- stat tiles ---------- */

check('cm-stats: the tile count is data, so the grid cannot be a fixed column count', () => {
	// A hardcoded `repeat(3, …)` leaves a stranded half-row at 4 or 5
	// tiles and an empty column at 2. auto-fit is the only column rule
	// that is right for every count.
	const rule = /^\.cm-stats\s*\{([^}]*)\}/m.exec(compSrc);
	assert(rule, '.cm-stats is not defined');
	assert(/grid-template-columns:\s*repeat\(auto-fit/.test(rule[1]),
		'.cm-stats must size its columns with auto-fit, not a fixed count');
	// `min()` inside minmax: without it a single tile sets a 9rem track
	// floor and a 320px screen gains horizontal scroll.
	assert(/minmax\(min\(/m.test(rule[1]),
		'the track minimum must be min(…, 100%) or a narrow screen overflows');
	assert(/list-style:\s*none/.test(rule[1]),
		'.cm-stats is a list; it must suppress its own markers');
});

check('cm-stats: tiles in one row are equal height', () => {
	// A metric row with a one-line label beside a two-line label looks
	// broken unless the tiles stretch to a common height.
	assert(/height:\s*100%/.test(compSrc), '.cm-stat must stretch to the row height');
});

check('cm-stat: the value can never be the loudest thing in its section', () => {
	// The section h2 is 1.45rem. A metric tile is allowed to be emphatic
	// but not louder than the heading that introduces it — that inversion
	// is invisible in code review and obvious on the page.
	//
	// The comparison is against the BARE element default in base.css, not
	// against any `h2` selector: `.cm-prose h2` is a heading inside long
	// form copy and is deliberately a step smaller, so matching it would
	// compare a section tile against the wrong scale entirely.
	const h2 = /(?:^|\n)h2\s*\{([^}]*)\}/.exec(base);
	assert(h2, 'no bare h2 element default found in base.css');
	const h2px = sizeOf(h2[1]);
	assert(h2px, 'the bare h2 default declares no resolvable font-size');
	const val = /^\.cm-stat__val\s*\{([^}]*)\}/m.exec(compSrc);
	assert(val, '.cm-stat__val is not defined');
	const vpx = sizeOf(val[1]);
	assert(vpx, '.cm-stat__val declares no resolvable font-size');
	assert(vpx <= h2px,
		`.cm-stat__val (${vpx}px) must not exceed the section h2 (${h2px}px)`);
	// And a wrapping figure must not widen the grid track.
	assert(/overflow-wrap:\s*break-word/.test(val[1]),
		'a long value must wrap inside its tile, not widen the grid');
});

check('cm-stat: the micro labels are floored, and the tile cannot render under 12px', () => {
	// Same contract as the rest of the library: a 0.72rem label is 11.5px,
	// which is why the exhaustive base-layer scan exists. Each of these
	// must carry the floor at its own definition.
	for (const sel of ['.cm-stat__label', '.cm-stat__note']) {
		const rule = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
		const bodies = [...compSrc.matchAll(rule)].map((m) => m[1]);
		assert(bodies.length > 0, `${sel} is not defined`);
		for (const b of bodies) {
			if (!/font-size:/.test(b)) continue;
			assert(/max\(var\(--min-font\)/.test(b),
				`${sel} declares a font-size with no --min-font floor`);
		}
	}
});

/* ---------- timeline ---------- */

check('cm-timeline: the rail is drawn on the item, not on a wrapper', () => {
	// Drawn on the list, the rail cannot know where the last record is,
	// so it either runs past the final dot (implying a record that is not
	// there) or needs a JS pass to trim. On the item, :last-child ends it.
	//
	// The guard is on the ELEMENT, not on the list's own block: moving the
	// rail to `.cm-timeline::before` leaves the list's rule untouched, so a
	// check that only reads `.cm-timeline { … }` passes while the rail has
	// silently moved somewhere it cannot terminate itself.
	assert(!/\.cm-timeline::(before|after)/.test(compSrc),
		'the rail must not be drawn on .cm-timeline itself');
	const item = /^\.cm-timeline__item\s*\{([^}]*)\}/m.exec(compSrc);
	assert(item && /position:\s*relative/.test(item[1]),
		'.cm-timeline__item must be the positioned element that owns the rail');
	assert(/\.cm-timeline__item::before/.test(compSrc),
		'no ::before rail on the item');
});

check('cm-timeline: the rail stops at the last record', () => {
	// A line that outlives the final dot claims a next entry is coming.
	// The data never makes that claim, so the rule must exist and must
	// target the last item specifically.
	const rule = /\.cm-timeline__item:last-child::before\s*\{([^}]*)\}/.exec(compSrc);
	assert(rule, 'no :last-child rule, so the rail runs past the final record');
	assert(/content:\s*none/.test(rule[1]),
		'the last rail must be removed, not merely shortened');
});

check('cm-timeline: the dot is centred on the rail by construction', () => {
	// The rail is 1px wide at left:0, the dot is 0.5rem wide. Centring it
	// needs the negative half-offset; without it the dot hangs to the
	// right of the line and the two read as unrelated.
	const dot = /^\.cm-timeline__item::after\s*\{([^}]*)\}/m.exec(compSrc);
	assert(dot, 'no ::after dot on the timeline item');
	const w = /width:\s*([0-9.]+)rem/.exec(dot[1]);
	// The offset is read unit-TOLERANT on purpose: `left: 0` is the exact
	// mutation this check exists to catch, and a rem-only pattern would
	// fail to match it and report the wrong defect ("no left offset")
	// instead of the real one (the dot is off the rail).
	const left = /left:\s*(-?[0-9.]+)(rem)?\s*;/.exec(dot[1]);
	assert(w && left, 'the dot must declare a rem width and a left offset');
	const half = parseFloat(w[1]) / 2;
	const offset = parseFloat(left[1]);
	assert(Math.abs(offset + half) < 0.001,
		`the dot left offset (${left[1]}${left[2] || ''}) must be exactly -half its width (-${half}rem) to sit on the rail`);
	assert(/background:\s*var\(/.test(dot[1]),
		'the dot must take its fill from a token, not a literal');
});

check('cm-timeline: "now" is a fill, not a second hue', () => {
	// The palette is greyscale. If the current record were marked with a
	// colour it would be the only colour on the page; a filled dot reads
	// as current in both themes and in a greyscale print.
	const rule = /\.cm-timeline__item--now::after\s*\{([^}]*)\}/.exec(compSrc);
	assert(rule, 'no --now variant, so the current record cannot be marked');
	assert(/background:\s*var\(--ink\)/.test(rule[1]),
		'--now must fill the dot with --ink');
	// Checked across the WHOLE variant block, not just the declaration the
	// rule above matched: a hardcoded colour on `border-color` while
	// `background` stayed tokenised would pass a one-property read.
	assert(!/#[0-9a-f]{3,8}\b/i.test(rule[1]),
		'--now must not introduce a literal colour');
	// Every colour-ish property in the block must go through a token. The
	// value is CAPTURED and inspected rather than guarded with a lookahead:
	// a lookahead after `\s*` is defeated by that quantifier backtracking,
	// so `border-color: var(--ink)` would still trip a naive `color:`
	// pattern and fail a block that is entirely tokenised.
	const raw = [...rule[1].matchAll(
		/(?:^|[;{\s])(?:-webkit-)?(?:[a-z-]*color|background(?:-color)?|border(?:-[a-z]+)?-color|outline(?:-[a-z]+)?-color|box-shadow|fill|stroke)\s*:\s*([^;}]+)/g,
	)]
		.map((m) => m[1].trim())
		.filter((v) => !/^var\(|^currentColor$|^inherit$|^none$|^transparent$/.test(v));
	assert(raw.length === 0, `--now must not hardcode a colour, found: ${raw.join(', ')}`);
});

check('cm-timeline: the record components carry no colour of their own', () => {
	// The same rule the overlays and state components live under: this
	// palette is greyscale, and a new surface is exactly where it breaks.
	//
	// The pattern has to match BEM PARTS, not just the block name: `_` is a
	// word character, so a `\bcm-stat\b` boundary never matches
	// `.cm-stat__label` and the scan would quietly pass over every rule
	// that actually sets a colour. `(?:__[a-z0-9-]+)?` is what makes
	// `.cm-stat`, `.cm-stat__val` and `.cm-timeline__item` all land here.
	const partOf = (b) => new RegExp(
		`(^|[};])\\s*([^;{}@]*\\b${b}(?:__[a-z0-9-]+)?\\b[^{}]*?)\\s*\\{([^{}]*)\\}`, 'gm',
	);
	const blocks = ['cm-stats', 'cm-stat', 'cm-timeline']
		.flatMap((b) => [...compSrc.matchAll(partOf(b))].map((m) => m[2] + ' {' + m[3] + '}'));
	assert(blocks.length > 0, 'no rules found for the record components — is the parse stale?');
	// A three-block parse means the BEM parts are being skipped, which is
	// exactly the silent-pass this check exists to prevent.
	assert(blocks.length >= 8,
		`only ${blocks.length} record rules parsed; the scan is missing the BEM parts`);
	const block = blocks.join('\n');
	const hex = block.match(/#[0-9a-f]{3,8}\b/gi) || [];
	assert(hex.length === 0, `the record components must use tokens, found literal colours: ${hex}`);
	const raw = [...block.matchAll(
		/(?:^|[;{])\s*((?:-webkit-)?[a-z-]*color|(?:-webkit-)?background(?:-color)?|border(?:-[a-z]+)?-color|outline(?:-[a-z]+)?-color|box-shadow|fill|stroke)\s*:\s*([^;}]+)/g,
	)]
		.filter((m) => !/^var\(|^currentColor$|^inherit$|^none$|^transparent$/.test(m[2].trim()))
		.map((m) => `${m[1]}: ${m[2].trim()}`);
	assert(raw.length === 0, `colour must come from a token, found: ${raw.join(', ')}`);
});

check('cm-timeline: the body cannot inherit a bullet or snap under the rail', () => {
	// Two real defects this guards. (1) base.css gives a bare `ul` a
	// ::before marker in the text run, so a wrapped second line snaps back
	// to the container edge and runs UNDER the rail. (2) The list inside
	// the body must not inherit the outer list's own padding.
	const pad = /\.cm-timeline__body ul\s*\{([^}]*)\}/.exec(compSrc);
	assert(pad, '.cm-timeline__body ul has no rule of its own');
	assert(/padding-left:\s*1\.2em/.test(pad[1]), 'the inner list must be indented explicitly');
	assert(/\.cm-timeline__body li::before\s*\{([^}]*)\}/.test(compSrc),
		'the inner list must cancel the inherited ::before marker');
});

check('the record Astro components ship, and hardcode no identity', () => {
	// The same rule every other component lives under: identity comes from
	// props, so a library file can never carry one site's name.
	for (const f of ['Stat.astro', 'TimelineItem.astro']) {
		assert(exists(`src/astro/${f}`), `does not ship src/astro/${f}`);
	}
	for (const f of ['Stat.astro', 'TimelineItem.astro']) {
		const s = read(`src/astro/${f}`);
		assert(!/Omar|omiinaya|oem\.|mrx/i.test(s), `${f} hardcodes a site identity`);
	}
	// The rail/dot classes are structural, so the component MUST emit them
	// itself: a consumer that forgets one gets an un-drawn timeline.
	const t = read('src/astro/TimelineItem.astro');
	assert(/class="cm-timeline__item"/.test(t),
		'TimelineItem does not emit .cm-timeline__item, so it draws no rail');
	assert(/cm-timeline__item--now/.test(t),
		'TimelineItem cannot express the current record');
	assert(/class:list/.test(t),
		'TimelineItem does not use class:list for its --now variant');
	// class:list is what makes the variant CONDITIONAL. Hand-writing
	// `class="cm-timeline__item cm-timeline__item--now"` would satisfy a
	// substring check while marking every record as current, so the rule
	// has to be proven to read the `now` prop rather than be a literal.
	assert(/class:list=\{\{[^}]*'cm-timeline__item--now':\s*now\s*\}\}/.test(t),
		'the --now class must be bound to the now prop through class:list, not hardcoded');
	assert(!/class="[^"]*cm-timeline__item--now/.test(t),
		'TimelineItem hardcodes --now into every item');
});

check('cm-timeline: TimelineItem takes a body as a string or as an array', () => {
	// A data file holding records wants an array; a page template wants a
	// newline-delimited string. Normalising here means the template only
	// ever sees a list. Without the array branch the component called
	// `.split` on an array and the build died with "body.split is not a
	// function" — an error naming no prop, so the consumer went looking in
	// the wrong file.
	const t = read('src/astro/TimelineItem.astro');
	assert(/body\?:\s*string\s*\|\s*string\[\]/.test(t),
		'the body prop is not typed to accept both shapes');
	assert(/Array\.isArray\(body\)/.test(t),
		'no array branch, so an array body reaches .split and throws');
	// The normalisation has to be assigned to something the template
	// actually uses, not computed and then ignored.
	assert(/const paras\s*=/.test(t), 'the normalisation is not assigned');
	assert(/paras\.length > 0/.test(t),
		'the template still branches on the raw prop, so an empty array renders a blank paragraph');
	// The only legitimate .split is the string branch in the frontmatter.
	// What must not exist is the TEMPLATE splitting the raw prop, so the
	// scan is anchored to the markup, not to the whole file.
	const markup = t.slice(t.indexOf('---', t.indexOf('---') + 3) + 3);
	assert(!markup.includes('body.split'),
		'the template still calls .split on the raw prop');
	assert(markup.includes('paras.map'),
		'the template does not render the normalised paragraphs');
});

check('the record components are documented, and the docs are real', () => {
	// A component nobody can find is a component nobody adopts: each class
	// must be DEMONSTRATED with markup, not merely named in a sentence.
	const readme = read('README.md');
	const from = readme.indexOf('### Stat tiles and timeline');
	assert(from !== -1, 'the README has no section documenting the record components');
	const section = readme.slice(from, readme.indexOf('### ', from + 4));
	assert(section.length > 400, 'the README section is a stub');
	// Each class must be documented in the class TABLE, i.e. wrapped in
	// backticks. A bare `includes('cm-stat__note')` is satisfied by the
	// markup example further up the section, so deleting the table row
	// entirely would leave the check green on the example that is left.
	for (const sel of ['cm-stats', 'cm-stat__val', 'cm-stat__label', 'cm-stat__note',
		'cm-timeline__item', 'cm-timeline__role', 'cm-timeline__org', 'cm-timeline__meta',
		'cm-timeline__period', 'cm-timeline__body', 'cm-timeline__item--now']) {
		// The needle is built with concatenation, not a template literal:
		// inside one, the backticks and the $ of `.cm-stat__val` have to be
		// escaped, and a mis-escaped `$$` silently compares the literal
		// text "${sel}" instead of the class name.
		assert(section.includes('`.' + sel + '`'),
			'the README does not document `.' + sel + '` in its class table');
	}
	for (const sel of ['cm-stats', 'cm-timeline']) {
		let shown = false;
		for (const m of section.matchAll(/```html\n([\s\S]*?)```/g)) {
			if (m[1].includes(sel)) { shown = true; break; }
		}
		assert(shown, `the README names .${sel} but shows no markup for it`);
	}
});

check('the record components are reachable from the showcase nav', () => {
	// A section that exists but is not linked is a section nobody scrolls
	// to, and a component that is not demoed is dead CSS.
	assert(showcaseIndex.includes('records'), 'the records section is not in the section index the nav is built from');
	assert(/id="records"/.test(showcase), 'the nav points at a section that does not exist');
});

check('install.sh still lands the layers the record components live in', () => {
	// The components are pure CSS, so they ship inside components.css —
	// but that only helps a consumer who ran the installer.
	const sh = read('scripts/install.sh');
	assert(/components\.css/.test(sh), 'the installer does not copy components.css');
});

/* ================= cards and meters ================= */

check('cm-card is a grid that survives any card count', () => {
	// Same argument as .cm-stats: the count is data. A fixed column
	// count strands a half-row at every count but the designed one.
	const g = /\.cm-cards\s*\{([^}]*)\}/.exec(compSrc);
	assert(g, '.cm-cards has no rule of its own');
	assert(/display:\s*grid/.test(g[1]), '.cm-cards is not a grid');
	assert(/repeat\(auto-fit,\s*minmax\(min\(/.test(g[1]),
		'.cm-cards does not use auto-fit with a min() floor, so a long title forces overflow on a narrow screen');
	// align-items: start, so one tall card does not stretch its whole
	// row into a column of empty boxes.
	assert(/align-items:\s*start/.test(g[1]),
		'.cm-cards does not set align-items: start, so a short card stretches to the tallest one');
});

check('cm-card fills its grid cell, so a ragged row still lines up', () => {
	// height: 100% on the card plus height: 100% on the <li> is what
	// makes two cards in a row share a baseline even when the body
	// copy is a different length. Without it a two-line card ends
	// early and the footers do not line up, which is the single most
	// visible way a card grid looks broken.
	assert(/\.cm-cards > li\s*\{[^}]*min-width:\s*0/.test(compSrc),
		'.cm-cards > li does not guard min-width, so a long word can force the track wider');
	assert(/\.cm-card\s*\{[^}]*height:\s*100%/.test(compSrc),
		'.cm-card has no height: 100%, so cards in a row do not match');
	// The body takes the slack so a card without a footer still pushes
	// its content apart the same way a card with one does.
	assert(/\.cm-card__body\s*\{[^}]*flex:\s*1 1 auto/.test(compSrc),
		'.cm-card__body does not grow, so footers do not sit at the card bottom');
});

check('cm-card: the footer stacks, so a long status cannot land on the link', () => {
	// Measured in a consumer: "no expiry · not verified" is wider than
	// "exam details →", so a wrapping footer puts the link on line two.
	// With `flex-wrap: wrap` + `margin-left: auto` the auto margin then
	// resolves against the NEW line and the two boxes overlap — a real
	// collision, invisible in a source diff and obvious in a screenshot.
	const f = /\.cm-card__foot\s*\{([^}]*)\}/.exec(read('src/styles/components.css'));
	assert(f, '.cm-card__foot has no rule of its own');
	assert(/flex-direction:\s*column/.test(f[1]),
		'the footer wraps instead of stacking, so a long status overlaps the link beside it');
	assert(!/flex-wrap:\s*wrap/.test(f[1]),
		'flex-wrap: wrap brings back the auto-margin overlap this replaced');
	assert(/align-items:\s*flex-start/.test(f[1]),
		'the link needs to align to the start of its own line, not float');
	assert(/gap:\s*var\(--space-2\)/.test(f[1]),
		'the stacked items have no gap, so they read as one line of text');
});

check('cm-card clips its own corners, or the accent rule escapes them', () => {
	// A 2px left border plus border-radius leaves a square nub at the
	// top-left and bottom-left. overflow: hidden is the fix, and it is
	// the reason the accent is safe to ship at all.
	// Read the RAW file, not compSrc: compSrc has comments stripped, so a
	// comment-based marker can never be found in it.
	const raw = /\.cm-card\s*\{([^}]*)\}/.exec(read('src/styles/components.css'));
	assert(/overflow:\s*hidden/.test(raw[1]),
		'.cm-card does not clip, so .cm-card--accent renders a square nub outside the radius');
	// position: relative is what the stretched link below depends on.
	assert(/position:\s*relative/.test(raw[1]),
		'.cm-card is not position: relative, so the whole-card link has nothing to stretch against');
});

check('the whole card is the tap target, not just the link text', () => {
	// A footer link on its own is a ~20px target, far under the --tap
	// floor. The ::after stretch is the fix. It is on the ANCHOR, not
	// the card: an overlay pseudo on the card would sit above the
	// text and kill text selection.
	const a = /\.cm-card__link::after\s*\{([^}]*)\}/.exec(compSrc);
	assert(a, '.cm-card__link has no ::after, so a card link is only as big as its text');
	assert(/position:\s*absolute/.test(a[1]) && /inset:\s*0/.test(a[1]),
		'the stretch does not cover the whole card');
});

check('cm-card keeps its micro-labels above the mobile type floor', () => {
	// .cm-card__sub and .cm-card__text are body copy, and a
	// 0.72rem label is unreadable on a phone. Same rule as every other
	// micro-label in the library.
	for (const sel of ['cm-card__sub', 'cm-card__text', 'cm-meter__label', 'cm-meter__val']) {
		const inFloor = new RegExp(
			'@media \\(pointer: coarse\\)[\\s\\S]*?\\.' + sel + '\\s*\\{[^}]*font-size:\\s*max\\('
		).test(compSrc);
		assert(inFloor, '.' + sel + ' is not floored in the coarse-pointer block');
	}
});

check('cm-card never hardcodes a colour the palette does not have', () => {
	// A rebrand bug, and the one rule the whole library runs on: no
	// hex and no literal anywhere in the card/meter block.
	// The marker is a comment, so this has to read the RAW file. compSrc
	// is the same file with comments stripped, which is exactly why an
	// earlier version of this check silently scanned an empty string and
	// passed on nothing.
	const raw = read('src/styles/components.css');
	const from = raw.indexOf('/* ---------- cards ----------');
	assert(from !== -1, 'the card block is not marked, so this check scans nothing');
	// Slice on RAW so the marker comment is findable, then STRIP COMMENTS
	// from the slice before scanning for colour literals.
	//
	// Both halves are load-bearing and they pull in opposite directions.
	// Locating the marker needs the comment, because the marker IS a
	// comment - a stripped read cannot find it and the check silently
	// scans nothing. Scanning needs the comments gone, because the block's
	// own measurement notes CITE hex values: "a badge filled --bg-2
	// (#101010) sitting on a --panel (#111111) is one 255th of a"
	// is a comment explaining why a token exists, and the hex scan
	// read it as a hardcoded colour.
	//
	// Deleting the note to make the test green would be the wrong repair:
	// the note is why the rule exists, and a rebrand bug left unmeasured
	// is worse than a red suite. The scan is about DECLARATIONS.
	const block = raw.slice(from).replace(/\/\*[\s\S]*?\*\//g, ' ');
	assert(/^\.cm-meter--faint/.test(block.trim()) || block.includes('.cm-meter--faint'),
		'the card block does not actually contain the meter family, so the scan is too narrow');
	assert(!/#[0-9a-f]{3,8}\b/i.test(block), 'the card/meter block contains a hex literal');
	assert(!/rgba?\(|hsla?\(/i.test(block), 'the card/meter block contains a colour function');
	// Every colour must come from a token, so check the actual set.
	const used = [...block.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
	const known = new Set(
		[...read('src/styles/tokens.css').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
	);
	assert(used.length > 10, 'the token scan found suspiciously few var() uses, so it is scanning too little');
	for (const v of new Set(used)) {
		assert(known.has(v), 'the card/meter block uses undefined token ' + v);
	}
});

check('cm-meter draws its bar from the value it prints', () => {
	// The whole point of the component: a bar whose width is set
	// somewhere other than the number beside it is a chart that lies.
	// So the width must come from a custom property the consumer sets
	// from the same pct it printed.
	const f = /\.cm-meter__fill\s*\{([^}]*)\}/.exec(compSrc);
	assert(f, '.cm-meter__fill has no rule of its own');
	assert(/width:\s*var\(--cm-meter-fill,\s*0%\)/.test(f[1]),
		'the fill width is not driven by --cm-meter-fill, so it cannot track the printed value');
	// The 0% default is a hard failure, not a design choice: a meter
	// with no fill renders an empty track and reads as "0".
	assert(/0%/.test(f[1]), 'the fill has no 0% default');
});

check('cm-meter prints its value as text, for a reader who cannot see the bar', () => {
	// A bar is a picture of a number. The number has to be in the DOM
	// as text, not implied by the fill width, or the component is
	// unusable with a screen reader and invisible to a text browser.
	const m = read('src/astro/Meter.astro');
	assert(/class="cm-meter__val"/.test(m), 'Meter.astro does not render the value as text');
	// ...and the bar itself is decorative, so it must be hidden.
	assert(/class="cm-meter__track"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="cm-meter__track"/.test(m),
		'the track is not aria-hidden, so the percentage is announced twice');
});

/* The showcase page scrolled 27px sideways at a 390px viewport, which is
   the width Omar actually reads at. A tooltip is routinely wider than the
   button it describes (measured 288px of tip on a 79px button) and it is
   `position: absolute`, so it widens the document rather than clipping.

   `overflow-x: clip` is the backstop AND it is not sufficient alone:
   with `overflow-y: scroll` beside it, WebKit computes the x axis to
   `hidden`, which is still scrollable. So both halves are asserted —
   the clip on the root, and a width cap on the tip that is derived from
   the viewport rather than pasted as a number.

   The measured 320px case is a CSS limitation, not a bug in this fix:
   a centred tip over a trigger near the right edge has no collision
   detection, so it can still overhang there. The showcase documents
   `--start` / `--end` as the answer. This test pins what IS claimed. */
check('the page cannot scroll sideways on a phone, and the tip is capped', () => {
	const base = read('src/styles/base.css');
	const html = /html\s*\{[^}]*\}/.exec(base)[0];
	assert(
		/overflow-x:\s*clip/.test(html),
		'html must clip horizontal overflow: an absolutely-positioned overlay that escapes its trigger widens the document and the whole page scrolls sideways',
	);
	// `hidden` would also stop the scroll, but it turns the root into a
	// scroll container and silently breaks `position: sticky` on the
	// header. `clip` does not create a scroll container.
	//
	// Comments are stripped first: the rule's own comment explains WHY
	// `hidden` is wrong and names it, so a scan that reads the block as
	// text matches its own documentation. That is the same trap as a
	// ResizeObserver assertion passing on a comment.
	const decls = html.replace(/\/\*[\s\S]*?\*\//g, '');
	assert(
		!/overflow(-x)?:\s*hidden/.test(decls),
		'html must use overflow-x: clip, not hidden - hidden breaks position: sticky for every descendant',
	);
	// The tip is declared in more than one block (the box, the centring
	// transform, the alignment variants), so the assertions run over the
	// class as a whole. Matching only the first block is how a test
	// passes on one half of a rule and misses the other.
	//
	// COMMENTS ARE STRIPPED FIRST, and that is not a nicety. A prose
	// comment that names a sibling class reads as a selector to a naive
	// `\.foo[^{]*\{` scan, so the rule bodies captured here included my
	// own sentence "…the second .cm-tooltip__tip block, further down" and
	// the max-width assertion passed on a comment while the declaration
	// it guards was deleted. That is the same trap as the ResizeObserver
	// assertion in this file, and a mutation proved it here too.
	const bare = comp.replace(/\/\*[\s\S]*?\*\//g, '');
	const tipRules = [...bare.matchAll(/(?:^|[}\s,])\.cm-tooltip__tip\s*\{([^}]*)\}/g)].map((m) => m[1]);
	assert(tipRules.length >= 2, `found ${tipRules.length} .cm-tooltip__tip blocks; the class is split across two`);
	const tip = tipRules.join('\n');
	assert(/max-width:/.test(tip), 'the tip has no width cap');
	// The cap must be a FRACTION OF THE VIEWPORT, and `vw` is the unit
	// that says so. This used to demand `100vw` literally, which was
	// wrong: a viewport cap is only correct for a tip CENTRED on its
	// trigger. The edge-anchored variants start at the trigger, so a
	// trigger at x=131 in a 360px window has 229px of room, not 360 —
	// and a `100vw` cap let a 281px tip run to x=412, scrolling the page
	// sideways by 52px (measured; 92px at 320). `vw` is asserted rather
	// than `100vw` because both the tight no-JS floor (50vw) and the
	// looser one are correct as long as they are viewport-derived.
	assert(
		/\d+vw/.test(tip),
		'the tip cap must be derived from the viewport (a vw fraction), not a bare px value, or it is wrong at every width but the one it was written for',
	);
	assert(
		!/max-width:\s*\d+px/.test(tip),
		'the tip cap is a bare px value, so it is wrong at every width but the one it was written for',
	);
	// The runtime's clamp is what makes the cap exact where CSS cannot
	// be. It is an enhancement over the CSS floor, never a replacement:
	// `verify-no-sideways-scroll.py` asserts 0 sideways scroll with
	// java_script_enabled=False, which is the no-JS contract.
	// A COMMENTS-STRIPPED read, and the call site has to be inside `init`.
	// Reading the raw source satisfied this with a passing mention in a
	// comment: the clamp was deleted and the suite stayed green, which is
	// the same prefix/comment trap that has bitten this file repeatedly.
	const runtime = read('src/js/cli-mono.js').replace(/\/\*[\s\S]*?\*\//g, '');
	assert(
		/\n\s*initTooltipClamp\(root\);/.test(runtime),
		'the runtime no longer clamps a tip to the room its trigger leaves, so a tip near an edge can run off the viewport',
	);
	assert(
		/function initTooltipClamp\(/.test(runtime),
		'the tooltip clamp function is gone; tips near an edge will run off the viewport',
	);
	// The clamp must compare against a REMEMBERED natural width. Comparing
	// the tip's current width oscillates: writing the cap shrinks the tip,
	// which fires the ResizeObserver, which re-runs, now finds the tip
	// already narrow enough, and removes the cap again — leaving it one
	// frame too wide. This is the only thing that stops that, so it is
	// asserted rather than trusted.
	// Anchored to the READ, not to the identifier: `__cmNaturalW` also
	// appears on the reset branch, so a bare existence check passes with
	// the cache removed from the read.
	assert(
		/tip\.__cmNaturalW\s*\|\|\s*\(tip\.__cmNaturalW\s*=/.test(runtime),
		'the clamp compares the tip CURRENT width, so writing the cap re-triggers it and the cap is removed again',
	);
	// It must only ever TIGHTEN the CSS floor, never loosen it, or the
	// no-JS reader gets a wider tip than a JS reader.
	assert(
		/Math\.min\(parseFloat\(cs\.maxWidth\)/.test(runtime),
		'the clamp is not bounded by the CSS cap, so a tip can be WIDER with JS than without it',
	);
	assert(/transform:\s*translateX\(-50%\)/.test(tip), 'a centred tip needs its centring transform');
});

check('cm-meter rejects a pct that is not 0-100 at build time', () => {
	const m = read('src/astro/Meter.astro');
	assert(/throw new Error/.test(m), 'Meter.astro does not throw on a bad pct');
	const g = /if \(!Number\.isFinite\(pct\)\s*\|\|\s*pct < 0\s*\|\|\s*pct > 100\)/.exec(m);
	assert(g, 'the guard does not reject non-finite, negative and over-100 values');
	// ...and the bound must be inclusive, or pct === 100 is rejected.
	assert(/pct > 100/.test(g[0]), 'a full bar would be rejected');
	assert(!/pct >= 100/.test(m), 'pct === 100 is excluded, so a 100% bar throws');
});

check('the card and meter Astro components ship, and hardcode no identity', () => {
	for (const f of ['Card.astro', 'Meter.astro']) {
		assert(exists(`src/astro/${f}`), `does not ship src/astro/${f}`);
		const s = read(`src/astro/${f}`);
		assert(!/Omar|omiinaya|oem\.|mrx/i.test(s), `${f} hardcodes a site identity`);
	}
	// Card.astro must emit its own structural classes, or a consumer
	// that forgets one gets an unboxed card. `cm-card` itself is
	// assembled through class:list, so it cannot be matched as a plain
	// class="…" literal — that is the whole point of the binding.
	const c = read('src/astro/Card.astro');
	for (const sel of ['cm-card', 'cm-card__head', 'cm-card__title', 'cm-card__sub', 'cm-card__body']) {
		const structural = c.includes(`class="${sel}"`) || c.includes(`'${sel}'`);
		assert(structural, `Card.astro does not emit .${sel}`);
	}
	// The accent is conditional, so it must be bound to the prop.
	assert(/class:list/.test(c), 'Card.astro does not use class:list for --accent');
	// Bound to the PROP, not merely present. Hand-writing
	// `const cls = ['cm-card', 'cm-card--accent']` satisfies any
	// substring check while marking every card in the system as the one
	// to read first, which is the whole thing the variant means.
	assert(/'cm-card--accent':\s*accent/.test(c) || /accent\s*&&\s*'cm-card--accent'/.test(c),
		'the --accent class is not bound to the accent prop');
	// And the card must not opt every instance in.
	assert(!/class="[^"]*cm-card--accent/.test(c),
		'Card.astro hardcodes --accent on every card');
	// A named slot cannot supply its own wrapper, so the foot wrapper has
	// to be a real element — otherwise `.cm-card__foot` never reaches the
	// DOM and every rule in that block is dead CSS. This exact mistake
	// shipped in the first draft of this component.
	assert(/<div class="cm-card__foot">[\s\S]*?<slot name="foot"/.test(c),
		'Card.astro renders the foot slot without a .cm-card__foot wrapper, so that CSS is dead');
	assert(/Astro\.slots\.has\('foot'\)/.test(c),
		'the foot wrapper is unconditional, so a card with no footer paints an empty bar');
	// Every part is a slot, so one consumer's data model is not baked in.
	assert(/<slot/.test(c), 'Card.astro has no slot, so its body is fixed markup');
	assert(/slot name="foot"/.test(c), 'Card.astro has no foot slot');
	// The DEFAULT slot is what makes the card a layout primitive rather
	// than a fixed layout. A bare `<slot` check is satisfied by the head
	// and foot slots alone, so deleting the body slot entirely would stay
	// green — the component would then have no way to render content.
	assert(/<div class="cm-card__body">\s*\n\s*<slot \/>/.test(c),
		'Card.astro has no default slot inside .cm-card__body, so a card cannot take content');
});

check('the card and meter components are documented with real markup', () => {
	const readme = read('README.md');
	const from = readme.indexOf('### Cards and meters');
	assert(from !== -1, 'the README has no section documenting cards and meters');
	const section = readme.slice(from, readme.indexOf('### ', from + 4));
	assert(section.length > 400, 'the README section is a stub');
	for (const sel of ['cm-cards', 'cm-card', 'cm-card--accent', 'cm-card__head', 'cm-card__title',
		'cm-card__sub', 'cm-card__body', 'cm-card__text', 'cm-card__foot', 'cm-card__link',
		'cm-meters', 'cm-meter', 'cm-meter__label', 'cm-meter__val', 'cm-meter__track',
		'cm-meter__fill', 'cm-meter--accent', 'cm-meter--faint']) {
		assert(section.includes('`.' + sel + '`'),
			'the README does not document `.' + sel + '` in its class table');
	}
	for (const sel of ['cm-cards', 'cm-meter']) {
		let shown = false;
		for (const m of section.matchAll(/```html\n([\s\S]*?)```/g)) {
			if (m[1].includes(sel)) { shown = true; break; }
		}
		assert(shown, `the README names .${sel} but shows no markup for it`);
	}
});

check('the card and meter components are reachable from the showcase', () => {
	assert(showcaseIndex.includes('cards'), 'the cards section is not in the section index the nav is built from');
	assert(/id="cards"/.test(showcase), 'the nav points at a cards section that does not exist');
	// Both wrappers must be imported, or the showcase shows hand-rolled
	// markup that drifts from the shipped component.
	assert(/import Card from/.test(showcase), 'the showcase does not import <Card>');
	assert(/import Meter from/.test(showcase), 'the showcase does not import <Meter>');
});

/* A component nothing renders is a component `astro build` never
   compiles, so a class it emits can sit undefined in the stylesheet
   forever. <PostHead> was in exactly that state: shipped, listed in
   the docs, never once instantiated, carrying a dead `cm-post-head`.
   The class-vs-selector test catches the dead class, but only a real
   render proves the rules compose the way they read.

   The allowlist is explicit and reasoned. A silent skip is a check that
   quietly stops checking, and the whole point of this test is to notice
   a component that quietly stopped being rendered. */
const NOT_RENDERABLE_BY_A_SHOWCASE_PAGE = {
	// The showcase is ONE page, and its <head> is written inline: it
	// carries its own FOUC guard and its own <title>. It therefore
	// cannot also render <Head>, which would emit a second charset, a
	// second title and a second guard. <Head> is a template a CONSUMER
	// copies into its own layout, and its behaviour is asserted on the
	// file's source by the guard-ordering test above.
	'Head.astro': 'the showcase is a single page with an inline <head>; a second one would double the charset, title and theme guard',
};
check('every shipped Astro component is rendered by the showcase', () => {
	const onDisk = readdirSync(join(root, 'src/astro')).filter((f) => f.endsWith('.astro'));
	assert(onDisk.length >= 12, `only found ${onDisk.length} components in src/astro — the read is broken`);
	for (const f of onDisk) {
		if (NOT_RENDERABLE_BY_A_SHOWCASE_PAGE[f]) continue;
		const name = f.replace(/\.astro$/, '');
		assert(
			new RegExp(`import ${name} from`).test(showcase),
			`src/astro/${f} is shipped but the showcase never imports it, so nothing compiles or renders it`,
		);
		assert(
			new RegExp(`<${name}[\\s/>]`).test(showcase),
			`<${name}> is imported into the showcase but never rendered`,
		);
	}
	// The allowlist must not rot into "everything is exempt".
	const used = new Set([...showcase.matchAll(/import (\w+) from '\.\.\/astro\//g)].map((m) => `${m[1]}.astro`));
	for (const f of Object.keys(NOT_RENDERABLE_BY_A_SHOWCASE_PAGE)) {
		assert(existsSync(join(root, 'src/astro', f)), `the allowlist exempts ${f}, which no longer exists`);
		assert(!used.has(f), `${f} is exempt from this check but the showcase now renders it — drop the exemption`);
	}
});

/* ================= tap targets (WCAG 2.5.5 / 2.5.8) ================= */
console.log('\ntap targets');
// Every interactive component must reach the 44px floor from the token, not
// from its own padding. Padding alone put .cm-btn at 36px, and because the
// suite only ever read the CSS as text, nothing noticed until a real WebKit
// run at an iPhone viewport measured it.
const TAP = 44;
const tapToken = (tokenSrc.match(/--tap:\s*(\d+)px/) || [])[1];
check('the --tap token is the 44px floor', () => {
	assert(tapToken === String(TAP), `--tap is ${tapToken}px, expected ${TAP}px`);
});
// A component is checked by the rule that actually sets its box, so a
// `min-height` on a later, less specific rule cannot mask a missing one.
//
// TWO of these four reach --tap in a MEDIA QUERY rather than in the base
// rule, and reading the base rule alone reports them as failures:
//
//   .cm-tabs__tab   the floor is in the 640px block that turns the nav into
//                   a vertical drawer, because a tab on a phone is a menu
//                   row, not a toolbar tab.
//   .cm-nav-toggle  hidden above 640px entirely (it is a phone-only
//                   control), so it has no base box to put a floor on.
//
// So the check reads the WHOLE stylesheet, not the first match. It is still
// anchored on the exact selector - a bare /min-height:var\(--tap\)/ finds
// some other component's declaration and every one of these would pass for
// the wrong reason, which is the same trap as the "a rule a different
// occurrence of the string can satisfy" case.
//
// `cm-chip` is deliberately NOT in this list, and was added by mistake long
// before the component existed: the name was reserved here, no `.cm-chip`
// rule was ever written, and the `continue` that used to sit here made the
// check vacuous - a silently-skipped check that reports nothing and reads
// as coverage. Now that the component is real the decision is explicit:
// a chip is a mark by default (measured: the --tap floor inflates a status
// row from 39.6px to 60.5px at 390px) and `.cm-chip--action` is the
// interactive form that carries the floor.
// `cm-icon-btn--bare` is the fourth: a <button> that carries its own box, so
// it is the case where inheriting the floor on ONE axis is the bug rather
// than the safety net. Measured at 32x44 on both live sites before the
// variant existed.
const INTERACTIVE = ['cm-btn', 'cm-tabs__tab', 'cm-nav-toggle', 'cm-chip--action', 'cm-icon-btn--bare', 'cm-header__icon-link'];
// `cm-header__icon-link` is the fifth, and it was a real defect rather than
// a bookkeeping entry: base.css's coarse-pointer element floor gives an
// `<a>` a `min-height`, so the header's GitHub link inherited 44px of
// HEIGHT and took its WIDTH from the 18px inline SVG it wraps, measuring
// 18x44 on dev-blog. It belongs in the PINS_BOTH_DIMENSIONS set, because a
// floor satisfied on one axis is the bug the other two members of that set
// were added for.
// Every rule that DECLARES the class - parsed as a rule list, not matched
// with a regex over raw text, because the forms here are exactly the ones a
// regex gets wrong:
//
//   .cm-btn, .cm-btn:hover { }        a selector LIST
//   .cm-js .cm-nav-toggle { }         an ANCESTOR prefix (the real rule)
//   @media (max-width: 640px) { }     the rule lives INSIDE a block
//   /* prose mentioning it */         comments, stripped first
//
// A regex that requires the class at the start of a line misses the
// `.cm-js` form entirely; one that bleeds across a brace picks up a
// neighbour's declarations; and one that ignores at-rules misses every
// conditional rule, which is where TWO of these components keep their floor.
// So walk the stylesheet properly: on an at-rule, recurse into its body;
// on a style rule, test the selector list.
//
// BOTH layers are read. A control does not have to declare its own floor to
// reach 44px, and in fact most of them do not: base.css's coarse-pointer
// block gives `a, button, label, input, textarea, select, [role='button'],
// [role='tab']` the floor by ELEMENT, so .cm-tabs__tab (a <button
// role="tab">) is already at 44px with no rule of its own. Reading
// components.css alone reported that as a failure - a check scoped to the
// wrong layer, which is the same defect as one scoped to the wrong selector.
const declsOf = (sel, src = allCss) => {
	const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
	const out = [];
	const walk = (text) => {
		let i = 0;
		while (i < text.length) {
			const open = text.indexOf('{', i);
			if (open === -1) break;
			const prelude = text.slice(i, open).trim();
			// Find this block's matching close, so a nested at-rule is
			// consumed whole rather than split at its inner brace.
			let depth = 1, j = open + 1;
			while (j < text.length && depth > 0) {
				if (text[j] === '{') depth++;
				else if (text[j] === '}') depth--;
				j++;
			}
			const body = text.slice(open + 1, j - 1);
			if (prelude.startsWith('@')) {
				walk(body);
			} else {
				const own = prelude.split(',').some((s) => {
					const t = s.trim();
					// A selector that IS the class, or a state of it.
					if (t.startsWith('.')) return t === '.' + sel ||
						t.startsWith('.' + sel + ':') || t.startsWith('.' + sel + '[') ||
						t.startsWith('.' + sel + '.');
					// A compound selector names the class CONDITIONALLY,
					// which still styles it, so it counts. An exact match
					// would miss `.cm-js .cm-nav-toggle`, which is the only
					// rule that has ever set that button's box.
					return new RegExp('\\.' + sel + '(?![a-z0-9_-])').test(t);
				});
				if (own) out.push(body);
			}
			i = j;
		}
	};
	walk(css);
	return out.join('\n');
};
// Every rule inside a `pointer: coarse` block that names this class ON ITS
// OWN, as [prelude, body]. Declared HERE, above the tap sweep, because the
// sweep uses it - and a helper referenced before its `const` is a TDZ
// ReferenceError rather than a value, which is a real one this file
// already hit once (see the dist/index.html note above).
//
// Written once and shared by both consumers, because two hand-rolled copies
// of a parse is how one of them ends up quietly checking a different block
// than the other.
const rulesFor = (sel) => {
	const coarse = compSrc.replace(/\/\*[\s\S]*?\*\//g, '')
		.match(/@media \(pointer: coarse\) \{[\s\S]*?\n\}/g) || [];
	return coarse.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
		.filter((m) => m[1].split(',').some((s) => s.trim() === '.' + sel));
};
for (const sel of INTERACTIVE) {
	// A name that matches no rule used to `continue` silently, so the check
	// reported success while examining one name out of three: `cm-tab` and
	// `cm-nav__link` are not classes this library has ever defined (the tab
	// is `.cm-tabs__tab`), and the skip hid that for as long as the list
	// existed. A vacuous pass is worse than a failure because it reports
	// coverage, so an unmatchable name is now a failure.
	//
	// The floor may come from EITHER place, and which one it is differs per
	// component: a rule that names the class, or base.css's coarse-pointer
	// element default. `.cm-tabs__tab` is the second case in full - it
	// declares no min-height at all and is still 44px, because it is a
	// <button role="tab">. So each entry declares WHICH guarantee it relies
	// on, and the check asks about that one. A single mechanism would have
	// to be a union (either place), which is weaker: it cannot tell a
	// control that lost its element default from one that never had a rule.
	// A component can reach the floor three legitimate ways, and the entry
	// says which one it relies on, because a single union would be weaker:
	// it cannot tell a control that lost its element default from one that
	// never had a rule.
	//
	//   IN_THE_BASE_ELEMENT_LAYER  the coarse-pointer block gives it by ELEMENT
	//   PINS_BOTH_DIMENSIONS       the component's own coarse-pointer rule sets
	//                              width AND height from --tap
	//   (default)                  a min-height: var(--tap) in its own rule
	//
	// The middle case is a real one and is not exotic: a square icon button
	// sets both axes so it cannot be stretched into a 44x32 pill. Reading
	// only for min-height reports that as a failure, which is the same
	// defect as a check scoped to the wrong layer.
	const IN_THE_BASE_ELEMENT_LAYER = new Set(['cm-tabs__tab']);
	const PINS_BOTH_DIMENSIONS = new Set(['cm-icon-btn--bare', 'cm-header__icon-link']);
	const all = declsOf(sel);
	// The value, not the substring. `[role='tab']` shares ONE declaration
	// block with `a, button, label, input, textarea, select` and
	// `[role='button']`, so a check that asks "does this block contain
	// var(--tap) anywhere" is satisfied by `a`'s floor and would have
	// passed with `[role='tab'] { min-height: 20px }` - a check that reports
	// a green suite while the tab sits at 20px. (Proven: that exact
	// mutation is in tests/mutate-chip.mjs.) So the element has to be NAMED
	// in the prelude, and then its own declaration read.
	// ALL coarse-pointer blocks, not the first. The focus ring adds one,
	// and `.match(...)?.[1]` reads whichever block comes FIRST in the
	// file - so adding an at-rule silently reassigns what an existing
	// check believes about the tab's element floor. Same defect class as
	// ruleBodies() not seeing inside an at-rule; same fix, read them all.
	const coarseBlock = allAtRuleBodies(read('src/styles/base.css'),
		'@media (pointer: coarse)');
	const elementFloor = (() => {
		for (const m of coarseBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const pre = m[1].trim();
			if (pre.split(',').some((s) => s.trim() === "[role='tab']")) return m[2];
		}
		return '';
	})();
	if (!all && !IN_THE_BASE_ELEMENT_LAYER.has(sel) && !PINS_BOTH_DIMENSIONS.has(sel)) {
		failures.push([`.${sel} meets the tap floor`,
			`no rule in components.css matches .${sel} - is the name misspelled, or does the class not exist?`]);
		console.log(`FAIL  .${sel} meets the tap floor\n        no rule in components.css matches .${sel} - is the name misspelled, or does the class not exist?`);
		continue;
	}
	check(`.${sel} meets the tap floor`, () => {
		if (IN_THE_BASE_ELEMENT_LAYER.has(sel)) {
			// The element default is the claim, so assert the ELEMENT and
			// the media query, not the class - a check that passed on
			// `.cm-tabs__tab { min-height: var(--tap) }` existing would
			// keep passing if the base default were deleted.
			assert(elementFloor,
				`${sel} relies on base.css's coarse-pointer element default for its floor, and [role='tab'] no longer appears in that block`);
			// Read the VALUE, not the substring: `20px` in that block is
			// exactly the mutation this was written to catch, and a
			// `var(--tap)`-present check would sail past it.
			const em = elementFloor.match(/min-height:\s*(\d+)px/);
			if (em) {
				assert(+em[1] >= TAP,
					`[role='tab'] declares min-height:${em[1]}px in the coarse-pointer block, under ${TAP}px`);
				return;
			}
			assert(/min-height:\s*var\(--tap\)/.test(elementFloor),
				`[role='tab'] in the coarse-pointer block declares no min-height, so the tab's box is set by padding alone`);
			// ...and that the class is rendered as one of those elements.
			// Read dist/ directly rather than the shared `built` const: that
			// is declared ~900 lines BELOW this loop, so touching it here is
			// a TDZ ReferenceError, not a value. (A real one, hit while
			// writing this check.)
			const builtNow = existsSync(join(root, 'dist/index.html'))
				? readFileSync(join(root, 'dist/index.html'), 'utf8') : '';
			// The class ATTRIBUTE parsed rather than regex-bounded: `_` is a
			// word character, so a `\b` boundary cannot match a BEM name.
			assert(builtNow.includes(`class="cm-tabs__tab`),
				`${sel} is claimed to be a coarse-pointer element, but the built page renders no <button> carrying it`);
			return;
		}
		if (PINS_BOTH_DIMENSIONS.has(sel)) {
			// The claim is a SQUARE target, so both axes come from the token.
			// Reading only one of them is what let the two live sites serve a
			// 32x44 pill: base.css's floor supplied the height, the glyph box
			// supplied the width, and neither check noticed.
			const own = rulesFor(sel).filter(([, , b]) => /var\(--tap\)/.test(b));
			assert(own.length > 0,
				`${sel} claims to reach the floor by pinning both dimensions, but no rule of its own mentions --tap`);
			for (const [, , b] of own) {
				assert(/width:\s*var\(--tap\)/.test(b),
					`${sel} pins only one axis from --tap; a tap floor needs BOTH dimensions`);
				assert(/height:\s*var\(--tap\)/.test(b),
					`${sel} pins only one axis from --tap; a tap floor needs BOTH dimensions`);
			}
			return;
		}
		const min = all.match(/min-height:\s*(\d+)px/);
		if (min) {
			assert(+min[1] >= TAP, `min-height is ${min[1]}px, under ${TAP}px`);
			return;
		}
		const v = all.match(/min-height:\s*var\(--tap\)/);
		assert(v, `no min-height from --tap, so its box is set by padding alone`);
	});
}
check('the small button is the one documented exception, and says so', () => {
	const sm = compSrc.match(/\.cm-btn--sm\s*\{([^}]*)\}/);
	assert(sm, '.cm-btn--sm is missing');
	// It steps below the floor on purpose on a FINE pointer - but only if it
	// resets the min-height it would otherwise inherit from .cm-btn. On a
	// coarse pointer it takes var(--tap), in a media query that lives in the
	// same file (see the note there about cascade order).
	assert(/min-height:\s*0/.test(sm[1]),
		'.cm-btn--sm inherits the 44px floor, so the small variant is not small');
	// ...and the coarse half has to exist, or the fine-pointer half is a
	// phone regression: `min-height: 0` alone measured 28px on rpm at 390px,
	// which is 64% of the floor.
	const coarse = /@media\s*\(pointer:\s*coarse\)\s*\{[^}]*\}/.test(compSrc);
	const coarseRule = /\.cm-btn--sm\s*\{[^}]*min-height:\s*var\(--tap\)/.test(compSrc);
	assert(coarse && coarseRule,
		'.cm-btn--sm never takes the tap floor back on a coarse pointer');
});
// A component that reaches the floor by hardcoding 44 instead of the token
// passes the rule above and is still wrong: a consumer that retunes --tap
// would get a button stuck at the old size.
for (const sel of INTERACTIVE) {
	const m = compSrc.match(new RegExp('\\.' + sel + '\\s*(?:,[^{]*)?\\{([^}]*)\\}'));
	if (!m || !/min-height:\s*\d+px/.test(m[1])) continue;
	check(`.${sel} takes its tap height from the token`, () => {
		assert(!/min-height:\s*\d+px/.test(m[1]),
			'a hardcoded px min-height ignores --tap');
	});
}

/* ================= the mobile nav disclosure ================= */

/* Read the components.css with its comments STRIPPED, the way the other
   blocks do: a rule named in a comment is not a rule, and a test that can
   match a comment is a test that passes for the wrong reason.

   Anchor on the PANEL rule inside the phone query, not on the burger's first
   rule. Both quirks cost real time here:

   - `.cm-nav-toggle {` is followed almost immediately by the media query
     that REVEALS the burger, so "the first 640px query after the burger" is
     that reveal query, and the slice was 35 characters long. Every
     assertion in it was about the wrong block.
   - `.cm-header__links {` also exists in the DESKTOP rules above the burger,
     so anchoring on that matched the wrong occurrence.
   `.cm-js .cm-header__links {` appears exactly once, inside the phone query,
   and back-searching the media query from it is unambiguous. */
const MC_BURGER_AT = compSrc.indexOf('.cm-nav-toggle {');
/* Both anchors are derived from the burger and walk FORWARD, because the
   panel moved into the phone query that follows it. `indexOf` from position
   0 finds the no-JS `.cm-js .cm-header__links` in the BASE layer at 3255,
   and `lastIndexOf` from there found no query at all (-1) - so the whole
   block went empty and every check below it passed vacuously or failed on
   its own anchor. */
const MC_640_AT = compSrc.indexOf('@media (max-width: 640px)', MC_BURGER_AT);
const MC_PANEL_640_AT = compSrc.indexOf(
	'@media (max-width: 640px)', MC_640_AT + 1
);
const MC_PANEL_AT = compSrc.indexOf(
	'.cm-js .cm-header__links {', MC_PANEL_640_AT
);
/* This used to `throw` at module scope. That turns a moved anchor into a
   crashed runner: every test after it dies as a SyntaxError-style abort
   rather than as a named FAILURE, so a mutation report shows "killed by
   nothing" and you cannot tell a real regression from a broken test.
   Fall back to empty regions and let the individual checks name the defect -
   a suite that reports `FAIL: no .cm-nav-toggle in components.css` is worth
   far more than one that exits 1 with a stack trace. */
const MC_ANCHORS_OK =
	MC_PANEL_AT !== -1 &&
	MC_640_AT !== -1 &&
	MC_PANEL_640_AT !== -1 &&
	MC_BURGER_AT !== -1 &&
	MC_PANEL_640_AT > MC_640_AT &&
	MC_PANEL_AT > MC_PANEL_640_AT;
/* One region: the burger's own rules - default, reveal, the three bars and
   the X morph - from the burger up to the query that opens the panel. */
const MC_BARS = MC_ANCHORS_OK ? compSrc.slice(MC_BURGER_AT, MC_PANEL_640_AT) : '';
const MC_REVEAL = MC_BARS;

/* A real rule parser, not a fragment regex. Regexing `.cm-nav-toggle__bar`
   and expanding outward can only ever see text from that class name onward,
   so for the rule
       .cm-nav-toggle[aria-expanded='true'] .cm-nav-toggle__bar { opacity: 0 }
   the match starts at `__bar` and the `[aria-expanded='true']` qualifier -
   which is the entire reason that rule is different - is BEHIND the match
   start and invisible. Every check then counted the open-state rule as a
   second copy of the base rule. Split the region into (selectors, body)
   pairs and look at the whole selector list. */
function mcRules(css) {
	const out = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(css))) {
		out.push({ sel: m[1].trim(), body: m[2] });
	}
	return out;
}
const MC_RULES = mcRules(MC_BARS);
const MC_BAR_RULES = MC_RULES.filter((r) =>
	/\.cm-nav-toggle__bar(?![\w-])/.test(r.sel)
);
const MC_BAR_BASE = MC_BAR_RULES.filter((r) => !/\[aria-expanded/.test(r.sel));
const MC_BAR_BODIES = MC_BAR_RULES.map((r) => r.body).join(' ');
/* The panel's phone query, up to the next query in the file. */
/* The panel's own phone query: from the query that opens it to the next
   query in the file. Slicing from MC_640_AT (the REVEAL query) produced a
   region that ended before the panel and contained none of its rules. */
const MC_360_AT = MC_ANCHORS_OK
	? compSrc.indexOf('@media (max-width: 360px)', MC_PANEL_AT)
	: -1;
const MC_COMP_640 =
	MC_ANCHORS_OK && MC_360_AT > MC_PANEL_640_AT
		? compSrc.slice(MC_PANEL_640_AT, MC_360_AT)
		: '';

const MC_JS = read('src/js/cli-mono.js');
const MC_HDR = read('src/astro/Header.astro');

check('the header ships a burger toggle', () => {
	if (!MC_ANCHORS_OK)
		throw new Error(
			`burger block not where expected (panel=${MC_PANEL_AT} media=${MC_640_AT} burger=${MC_BURGER_AT})`
		);
	if (!MC_BARS.includes('.cm-nav-toggle')) throw new Error('no .cm-nav-toggle in components.css');
});

// THE BUG THIS BLOCK EXISTS FOR. The burger is drawn with two pseudo-elements
// (the top and bottom bars) and one real child (the middle). The natural way
// to centre the middle bar is `:nth-child(2)`, but pseudo-elements do not
// count toward :nth-child(), so that selector matches nothing: the middle
// bar falls back to `top: 0`, lands exactly on the ::before bar, and the icon
// renders as TWO bars with a gap - which reads as a diagonal arrow, not a
// menu. No positional selector may be used to place the middle bar.
check('the burger bar has exactly one rule block', () => {
	// Only the BASE rule. `.cm-nav-toggle__bar` under [aria-expanded] is a
	// different rule about a different state, and counting it here would
	// make the check fail every time someone added the open state.
	if (MC_BAR_BASE.length !== 1)
		throw new Error(
			`found ${MC_BAR_BASE.length} base rule blocks ` +
			`(${MC_BAR_RULES.length} incl. state rules)`
		);
});

check('the burger bar is not placed with a positional selector', () => {
	// The SELECTOR, not the body. `:nth-child(2)` never appears inside a
	// declaration block, so searching the bodies for it makes this test
	// unfailable: it passed while the exact bug it exists to prevent was
	// re-introduced by mutation. Pseudo-elements (::before / ::after) are
	// not children in the DOM, so a positional selector over a mixed
	// pseudo+real set silently selects nothing.
	const bad = MC_BAR_RULES
		.map((r) => r.sel.match(/:nth-(?:child|type|of|last|of-type)\([^)]*\)/g))
		.filter(Boolean)
		.flat();
	if (bad.length) {
		throw new Error(
			`placed with ${bad.join(', ')}; pseudo-elements do not count ` +
			`toward :nth-child(), so this selects nothing`
		);
	}
	// Belt and braces: a positional selector ANYWHERE in the icon region.
	const anywhere = MC_BARS.match(/:nth-(?:child|type|of|last|of-type)\([^)]*\)/g);
	if (anywhere) throw new Error(`positional selector in the burger: ${anywhere.join(', ')}`);
});

check('the burger bar centres itself with top:50%', () => {
	if (!/top:\s*50%/.test(MC_BAR_BODIES)) throw new Error('no top:50% - the bar has no vertical position');
});

check('the burger bar does not sit on an edge', () => {
	// ::before owns `top: 0` and ::after owns `bottom: 0` - legitimately, and
	// on a DIFFERENT selector. Checked across the whole region this read
	// ::before's own top:0 as a fault in the middle bar. Only the bar's own
	// declarations are evidence here.
	if (/\btop:\s*0(?![\d.])/.test(MC_BAR_BODIES)) throw new Error('middle bar is pinned to the top edge, on top of ::before');
	if (/\bbottom:\s*0\b/.test(MC_BAR_BODIES)) throw new Error('middle bar is pinned to the bottom edge, on top of ::after');
});

// The X morph: both edges rotate, the middle fades out.
check('open state rotates both edges into an X', () => {
	if (!/\.cm-nav-toggle\[aria-expanded='true'\]\s+\.cm-nav-toggle__bars::before[^}]*rotate\(45deg\)/.test(MC_BARS))
		throw new Error('::before is not rotated 45deg when open');
	if (!/\.cm-nav-toggle\[aria-expanded='true'\]\s+\.cm-nav-toggle__bars::after[^}]*rotate\(-45deg\)/.test(MC_BARS))
		throw new Error('::after is not rotated -45deg when open');
});

check('open state hides the middle bar', () => {
	// Match a PARSED rule, not a raw regex over the region. A regex can be
	// satisfied by a rule for a different element that happens to sit in the
	// same block, which is how "the middle bar stays visible" survived a
	// mutation that set its opacity to 0.4.
	const state = MC_BAR_RULES.find((r) => /\[aria-expanded='true'\]/.test(r.sel));
	if (!state) throw new Error('no [aria-expanded] rule for the middle bar at all');
	if (!/\bopacity:\s*0\s*(;|$)/.test(state.body))
		throw new Error(`the middle bar is not hidden when open (${state.body.trim()})`);
});

// A burger is a PHONE control. Revealing it at every width puts a hamburger
// next to a perfectly good inline nav on a desktop.
check('the burger is hidden by default and revealed only under 640px', () => {
	if (!/^\.cm-nav-toggle \{[^}]*display:\s*none/m.test(MC_REVEAL))
		throw new Error('the burger is not hidden by default');
	if (!/\.cm-js \.cm-nav-toggle\s*\{[^}]*display:\s*inline-flex/.test(MC_REVEAL))
		throw new Error('no .cm-js .cm-nav-toggle reveal rule');
	// It must be inside a max-width query, not unconditional.
	const at = MC_REVEAL.search(/\.cm-js \.cm-nav-toggle/);
	const guard = MC_REVEAL.lastIndexOf('@media (max-width: 640px)', at);
	if (guard === -1) throw new Error('the burger is revealed with no width guard at all');
	if (!MC_REVEAL.slice(guard, MC_REVEAL.indexOf('}', guard) + 1).includes('.cm-js .cm-nav-toggle'))
		throw new Error('the reveal is outside the max-width:640px block');
});

// The enhanced path must never be the ONLY path. A no-JS reader still needs
// the navigation, so the collapse is scoped to .cm-js - an unconditional
// display:none would remove the nav from every reader whose runtime failed.
check('the panel collapse is scoped to .cm-js, not unconditional', () => {
	// Parse the phone query and look at EVERY rule that touches the panel.
	// The old check only asked whether `.cm-js .cm-header__links {` appeared
	// SOMEWHERE, so a mutation that stripped the prefix off the CLOSED rule
	// - the one that actually does the hiding - left it green, while a
	// no-JS reader would have lost the navigation entirely.
	const panelRules = mcRules(MC_COMP_640).filter((r) =>
		/\.cm-header__links(?![\w-])/.test(r.sel)
	);
	if (!panelRules.length) throw new Error('no panel rules in the phone query');
	for (const r of panelRules) {
		if (!/display:\s*none/.test(r.body)) continue;
		if (!/^\.cm-js\b/.test(r.sel))
			throw new Error(
				`unconditional hide: "${r.sel}" would remove the nav from a ` +
				`reader whose runtime never ran`
			);
	}
	if (!panelRules.some((r) => /^\.cm-js\b/.test(r.sel) && /display:\s*none/.test(r.body)))
		throw new Error('the panel is never hidden on a phone, even with JS');
});

check('an open panel is shown via [data-open] under .cm-js', () => {
	if (!MC_COMP_640.includes('.cm-js .cm-header__links[data-open] {'))
		throw new Error('the open state is not gated on .cm-js');
});

// Accessibility of the disclosure itself.
check('the toggle carries aria-expanded and aria-controls', () => {
	if (!MC_HDR.includes('aria-expanded="false"')) throw new Error('no aria-expanded');
	if (!MC_HDR.includes('aria-controls="cm-header-links"')) throw new Error('no aria-controls');
});
check('the toggle has an accessible name', () => {
	if (!/aria-label="Menu"/.test(MC_HDR)) throw new Error('the bars are all aria-hidden, so the button needs a name');
});
check('the toggle is a real button', () => {
	if (!/<button[\s\S]*?data-cm-nav-toggle/.test(MC_HDR)) throw new Error('not a <button>');
});
check('the panel has the id the button points at', () => {
	if (!MC_HDR.includes('id="cm-header-links"')) throw new Error('aria-controls points at an id that does not exist');
});
check('the toggle only renders when there are links to disclose', () => {
	// The toggle is its own {cond && (...)} expression, so the guard that
	// matters is the one immediately wrapping `data-cm-nav-toggle`. A
	// file-wide search for `links.length > 0 && (` is satisfied by the LINKS
	// block elsewhere in the header, so removing the toggle's own guard left
	// the test green.
	const at = MC_HDR.indexOf('data-cm-nav-toggle');
	if (at === -1) throw new Error('no burger toggle in the header');
	const before = MC_HDR.slice(Math.max(0, at - 300), at);
	if (!/links\.length > 0/.test(before))
		throw new Error('a burger with nothing behind it is a dead control');
});

/* Runtime checks are scoped to initNavToggle. Searching the whole runtime
   for `setOpen(false)` is satisfied by the Escape path, so mutating the
   link-tap path or the outside-click path changed nothing any test could
   see: two of the behavioural tests were unfailable for that reason. */
const MC_NAV_JS = MC_JS.slice(
	MC_JS.indexOf('function initNavToggle'),
	MC_JS.indexOf('/* ---------- scroll-spy for nav links ---------- */')
);
if (!MC_NAV_JS.includes('initNavToggle'))
	throw new Error('initNavToggle not found in the runtime');

// Runtime behaviour: the pieces a reader on a phone needs.
check('the runtime adds .cm-js only when the toggle is present', () => {
	if (!/if \(!btn \|\| !panel\) return;[\s\S]{0,200}?classList\.add\('cm-js'\)/.test(MC_JS))
		throw new Error('.cm-js must be set after the guard, or a page with no toggle gets the collapse');
});

/* The SPA case, executed rather than pattern-matched.
 *
 * `init()` binds to whatever exists when it runs and nothing ever re-runs it,
 * so in a page whose markup arrives AFTER this module - a React/Vue/Svelte
 * mount, which is every SPA that adopts the library - the burger stays
 * display:none, the sticky header never gets its scrolled state, and
 * `--header-h` is never published. Nothing throws. The page simply looks
 * wired up and is not.
 *
 * MEASURED in WebKit at 390x844 on spacetime-memory's web app: with
 * auto-init alone the burger measured 0x0 and could not be clicked; one
 * manual `cliMono.init(document)` after the commit set `.cm-js`, gave the
 * burger 44x44 and opened the drawer with all 6 links at 781px.
 *
 * So this runs the real runtime against a document that is EMPTY at boot and
 * gains its header afterwards, and asserts the runtime noticed on its own. A
 * regex over the source cannot tell whether the re-run is reachable.
 *
 * The shims below are deliberately explicit about what a node must carry. An
 * earlier draft returned bare `{}` for the button and the suite reported
 * "Cannot read properties of undefined (reading 'cmNavBound')" - which reads
 * like the runtime failing when it is the probe's gap, and is exactly the
 * trap of trusting a failure message without checking the fixture. */
function fakeEl(over = {}) {
	return Object.assign(
		{
			dataset: {},
			attrs: {},
			// initHeader publishes --header-h through documentElement.style
			style: { setProperty: () => {}, removeProperty: () => {} },
			classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
			setAttribute(k, v) {
				this.attrs[k] = v;
			},
			removeAttribute(k) {
				delete this.attrs[k];
			},
			// NOT an arrow: the runtime calls this UNBOUND, as
			// `documentElement.getAttribute(...)`, so an arrow's `this` is
			// undefined and it throws on `this.attrs`. That is a shim bug
			// that reads exactly like a runtime bug.
			getAttribute(k) {
				return k in this.attrs ? this.attrs[k] : null;
			},
			addEventListener: () => {},
			focus() {},
			querySelector: () => null,
			querySelectorAll: () => [],
			appendChild: () => {},
			getBoundingClientRect: () => ({ width: 44, height: 44, top: 0, left: 0 }),
		},
		over,
	);
}

check('a scrim the CONSUMER shipped gets the class, or it stays an unstyled 0-height div', () => {
	// A consumer may ship its own scrim node instead of letting the runtime
	// create one - it belongs inside the React tree, after the header. Two
	// did exactly that: `<div data-cm-nav-scrim />` in spacetime-rpm and
	// spacetime-kanban.
	//
	// Every rule that styles the scrim is `.cm-js .cm-nav-scrim`, a CLASS
	// selector, so the class is load-bearing: without it the element is an
	// empty div with no `inset: 0`, i.e. zero height, i.e. no veil and - the
	// part that actually strands a reader - no tap target to dismiss the
	// drawer with. MEASURED in WebKit at 393x852: 353x0 with className ''.
	//
	// So this runs the REAL runtime, not a regex over its source. A source
	// check cannot see this branch at all: `scrim.className = 'cm-nav-scrim'`
	// sat INSIDE the create-branch, where it was correct and unreachable, and
	// every `cm-nav-scrim` string test in this file matched it happily.
	const html = { attrs: {} };
	const htmlClasses = new Set();
	// The consumer's node: it arrives with the ATTRIBUTE and nothing else.
	// It needs a REAL Set-backed classList, because `fakeEl`'s is a stub whose
	// `contains` is hardcoded false - with that, this assertion could never
	// pass and a green run would have been a lie.
	const scrimClasses = new Set();
	const consumerScrim = fakeEl({
		classList: {
			add: (c) => scrimClasses.add(c),
			remove: (c) => scrimClasses.delete(c),
			contains: (c) => scrimClasses.has(c),
			toggle: (c, on) => (on ? scrimClasses.add(c) : scrimClasses.delete(c)),
		},
	});
	const navBtn = fakeEl();
	const navPanel = fakeEl({ width: 375, height: 547 });
	const doc = {
		documentElement: {
			getAttribute: (k) => (k in html.attrs ? html.attrs[k] : null),
			setAttribute: (k, v) => {
				html.attrs[k] = v;
			},
			removeAttribute: (k) => {
				delete html.attrs[k];
			},
			style: { setProperty: () => {}, removeProperty: () => {} },
			classList: {
				add: (c) => htmlClasses.add(c),
				remove: (c) => htmlClasses.delete(c),
				contains: (c) => htmlClasses.has(c),
				toggle: (c, on) => (on ? htmlClasses.add(c) : htmlClasses.delete(c)),
			},
		},
		body: { style: {}, appendChild: () => {} },
		querySelector: (sel) => {
			if (sel.includes('nav-scrim')) return consumerScrim;
			if (sel.includes('nav-toggle')) return navBtn;
			if (sel.includes('data-cm-header')) return null;
			return null;
		},
		querySelectorAll: () => [],
		addEventListener: () => {},
		createElement: () => fakeEl({ width: 0, height: 0 }),
		readyState: 'complete',
		getElementById: (id) => (id === 'cm-header-links' ? navPanel : null),
	};
	const ctx = {
		document: doc,
		window: {
			addEventListener: () => {},
			scrollY: 0,
			innerHeight: 800,
			requestAnimationFrame: () => {},
			matchMedia: () => ({
				matches: true,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
			}),
		},
		localStorage: { getItem: () => null, setItem: () => {} },
		navigator: {},
		MutationObserver: function () {
			this.observe = () => {};
			this.disconnect = () => {};
		},
		ResizeObserver: function () {
			this.observe = () => {};
		},
		module: { exports: {} },
	};
	ctx.globalThis = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	vm.runInContext(runtimeSrc, ctx);

	// initNavToggle returns before it reaches the scrim unless the burger AND
	// its panel are both present, so the fixture has to be a document that
	// actually has a drawer to draw a scrim behind. Without this the test
	// passes on a runtime that does nothing at all.
	assert(
		consumerScrim.classList.contains('cm-nav-scrim'),
		'the scrim the consumer shipped was found but never given the class, so ' +
			'.cm-js .cm-nav-scrim does not match it: it renders as an unstyled ' +
			'empty div with no height, no veil, and no tap-to-dismiss target',
	);
});

check('markup that arrives after the runtime boots still gets bound', () => {
	const html = { attrs: {} };
	const htmlClasses = new Set();
	const created = [];
	const doc = {
		documentElement: {
			getAttribute: (k) => (k in html.attrs ? html.attrs[k] : null),
			setAttribute: (k, v) => {
				html.attrs[k] = v;
			},
			removeAttribute: (k) => {
				delete html.attrs[k];
			},
			style: { setProperty: () => {} },
			classList: {
				add: (c) => htmlClasses.add(c),
				remove: (c) => htmlClasses.delete(c),
				contains: (c) => htmlClasses.has(c),
				toggle: (c, on) => (on ? htmlClasses.add(c) : htmlClasses.delete(c)),
			},
		},
		// the runtime builds its nav scrim and appends it here
		body: { style: {}, appendChild: () => {} },
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: () => {},
		createElement: () => {
			const el = fakeEl({ width: 0, height: 0 });
			created.push(el);
			return el;
		},
		readyState: 'complete',
		getElementById: () => null,
	};

	// A MutationObserver shim the test drives by hand, because the runtime
	// must ASK for one - it is never handed a chance to bind.
	let observer = null;
	const MO = function (cb) {
		this.cb = cb;
		this.disconnected = false;
		this.disconnect = () => {
			this.disconnected = true;
		};
		// RECORD what it was asked to watch. A shim that ignores this
		// argument cannot tell `subtree: true` from `subtree: false`, so
		// dropping subtree: true would survive as a phantom pass - which is
		// exactly what the first sweep reported. The option is asserted
		// because it is load-bearing: without `subtree`, observing <body>
		// sees only its direct children and a React commit into #root is
		// invisible, so the SPA fix silently stops working.
		this.observe = (target, opts) => {
			this.target = target;
			this.options = opts;
		};
		observer = this;
	};

	const ctx = {
		document: doc,
		window: {
			addEventListener: () => {},
			scrollY: 0,
			innerHeight: 800,
			requestAnimationFrame: () => {},
			// initNavToggle subscribes to the phone breakpoint, so a document
			// that binds the nav needs one.
			matchMedia: () => ({
				matches: true,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
			}),
		},
		localStorage: { getItem: () => null, setItem: () => {} },
		navigator: {},
		MutationObserver: MO,
		ResizeObserver: function () {
			this.observe = () => {};
		},
		module: { exports: {} },
	};
	ctx.globalThis = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	vm.runInContext(runtimeSrc, ctx);

	assert(typeof ctx.window.cliMono === 'object', 'runtime did not expose its handle');

	// Nothing to bind to yet: this is what a SPA mount looks like from here.
	assert(
		!htmlClasses.has('cm-js'),
		'.cm-js was set on an empty document - it must only follow real library markup',
	);

	// The runtime must have armed an observer, because the markup is coming.
	assert(observer, 'the runtime armed no observer, so markup rendered after boot is never bound');
	assert(
		observer.options && observer.options.subtree,
		'the observer must watch the SUBTREE: without it, <body> reports only its direct children and a framework commit into #root is never seen, so the SPA case is not fixed',
	);
	assert(
		observer.target === doc.body,
		'the observer must watch <body>, which is where a framework mounts its root',
	);

	// The SPA commits: a [data-cm-nav-toggle] button and its panel appear.
	const fakeBtn = fakeEl();
	const fakePanel = fakeEl({ width: 300, height: 780 });
	doc.querySelector = (sel) => {
		if (sel.includes('nav-toggle')) return fakeBtn;
		if (sel.includes('cm-header-links')) return fakePanel;
		return null;
	};
	doc.getElementById = (id) => (id === 'cm-header-links' ? fakePanel : null);

	observer.cb();

	assert(
		htmlClasses.has('cm-js'),
		'markup arrived and the runtime did not bind it: .cm-js is still unset, so the burger stays display:none',
	);
	assert(observer.disconnected, 'the observer must disconnect once it has bound, not run for the life of the page');
});

check('a page that already has library markup arms no observer at all', () => {
	const doc = {
		// documentElement needs a REAL attrs store: initHeader and the theme
		// sync write through `setAttribute`/`getAttribute` on it.
		documentElement: fakeEl(),
		body: { style: {}, appendChild: () => {} },
		// A static page: the header is already in the document.
		querySelector: (sel) => (sel.includes('data-cm-header') ? fakeEl({ width: 1200, height: 61 }) : null),
		querySelectorAll: () => [],
		addEventListener: () => {},
		createElement: () => fakeEl(),
		readyState: 'complete',
		getElementById: () => null,
	};
	let armed = false;
	const ctx = {
		document: doc,
		window: { addEventListener: () => {}, scrollY: 0, innerHeight: 800, requestAnimationFrame: () => {} },
		localStorage: { getItem: () => null, setItem: () => {} },
		navigator: {},
		MutationObserver: function () {
			armed = true;
			this.observe = () => {};
			this.disconnect = () => {};
		},
		ResizeObserver: function () {
			this.observe = () => {};
		},
		module: { exports: {} },
	};
	ctx.globalThis = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	vm.runInContext(runtimeSrc, ctx);

	assert(!armed, 'a static page must not pay for an observer - the markup is already there');
});
check('the runtime toggles aria-expanded and the panel attribute together', () => {
	const fn = MC_JS.slice(MC_JS.indexOf('function setOpen'));
	const body = fn.slice(0, fn.indexOf('function isOpen'));
	if (!body.includes("setAttribute('aria-expanded'")) throw new Error('aria-expanded not written');
	if (!/panel\.setAttribute\('data-open'/.test(body)) throw new Error('data-open not set');
	if (!/panel\.removeAttribute\('data-open'/.test(body)) throw new Error('data-open not removed');
});
check('tapping a link inside the panel closes it', () => {
	if (!/closest\('a'\)\)\s*\)?\s*setOpen\(false\)/.test(MC_NAV_JS))
		throw new Error('the menu stays covering the section the reader just asked for');
});
check('Escape closes the panel and restores focus to the button', () => {
	if (!/e\.key === 'Escape'[\s\S]*?setOpen\(false\);[\s\S]*?btn\.focus\(\)/.test(MC_NAV_JS))
		throw new Error('keyboard users would be stranded in a menu that is now invisible');
});
check('a click outside the header closes the panel', () => {
	if (!/closest\('\[data-cm-header\]'\)\)\s*return;[\s\S]{0,160}?setOpen\(false\)/.test(MC_NAV_JS))
		throw new Error('the menu cannot be dismissed by tapping the page');
});
check('rotating to a desktop width clears the open state', () => {
	// Assert the HANDLER, not merely that a 'change' listener exists. The
	// old check passed while the handler was an empty function, because
	// "mq.addEventListener('change'" is still there - which is exactly the
	// state the check was written to prevent.
	if (!/matchMedia\('\(max-width: 640px\)'\)/.test(MC_NAV_JS))
		throw new Error('the nav toggle is not watching the phone breakpoint');
	const handler = MC_NAV_JS.match(/onChange\s*=\s*function[^}]*\}/);
	if (!handler) throw new Error('no onChange handler for the breakpoint');
	if (!/setOpen\(false\)/.test(handler[0]))
		throw new Error(`the breakpoint handler does not close the panel: ${handler[0].trim()}`);
	// And it must be the handler that is actually subscribed.
	if (!/addEventListener\('change',\s*onChange\)/.test(MC_NAV_JS))
		throw new Error('onChange is defined but not the listener that is bound');
});
check('the panel starts closed even if markup is reused', () => {
	if (!/setOpen\(false\);/.test(MC_NAV_JS))
		throw new Error('no initial close');
});
check('the runtime is bound once per button', () => {
	if (!/if \(btn\.dataset\.cmNavBound\) return;/.test(MC_NAV_JS))
		throw new Error('init() runs again on astro:page-load and would double-bind');
});

// Every animation in the system sits inside the reduced-motion guard, and a
// transition is motion too - `animation: none` does not touch it.
check('the burger bars are guarded against motion', () => {
	const g = compSrc.indexOf('@media (prefers-reduced-motion: reduce)');
	if (g === -1) throw new Error('no reduced-motion guard in components.css');
	const guardBlock = compSrc.slice(g, compSrc.indexOf('\n}', g));
	if (!/\.cm-nav-toggle__(?:bar|bars)(?:::?(?:before|after))?[^{]*\{[^}]*transition:\s*none/.test(guardBlock))
		throw new Error('the bars morph to an X and that transition needs a guard');
	// All THREE drawn bars must be named, not just the selector list's first
	// entry. A regex satisfied by `.cm-nav-toggle__bars::before` alone let a
	// mutation that deleted `.cm-nav-toggle__bar` - the MIDDLE bar, the only
	// real element - pass, leaving the one bar that fades on open unguided.
	for (const sel of ['.cm-nav-toggle__bars::before', '.cm-nav-toggle__bars::after', '.cm-nav-toggle__bar']) {
		if (!guardBlock.includes(sel))
			throw new Error(`${sel} is not in the reduced-motion guard; it still transitions`);
	}
});

// The burger IS the control a phone reader has to hit to see the menu at
// all, so the floor applies to the button, not only to the rows it opens.
// A mutation that dropped `.cm-icon-btn { width: var(--tap); ... }` left the
// suite green: the floor test listed `.cm-icon-btn` but only asserted it
// takes its height FROM THE TOKEN, never that the token is applied here.
check('the burger clears the tap floor on a coarse pointer', () => {
	// The burger IS the control a phone reader must hit to see the menu at
	// all, so the floor applies to the button, not only to the rows it
	// opens. A mutation that dropped `.cm-icon-btn { width: var(--tap) }`
	// left the suite green: the floor test listed .cm-icon-btn but only
	// asserted it takes its height FROM THE TOKEN, never that the token is
	// applied here.
	//
	// Search the WHOLE stylesheet, not the burger region: `.cm-icon-btn` is
	// declared in the header section, well before `.cm-nav-toggle`, so a
	// region-scoped search found nothing. Re-measuring the region taught me
	// to ask where the rule really is instead of where I expected it.
	if (!/\.cm-icon-btn\s*\{[^}]*width:\s*var\(--tap\)/.test(compSrc))
		throw new Error('the burger never takes its width from --tap');
});

// The row tap floor: a menu whose links each need two precise taps is not a
// menu.
check('menu rows keep the tap floor on a coarse pointer', () => {
	// Assert the FLOOR, not the padding that used to imply it. Under a
	// drawer the rows are `display: flex` and their height comes from
	// min-height; checking a padding string passed while the real height
	// was 38px.
	if (!/\.cm-header__link[^{]*\{[^}]*min-height:\s*var\(--tap\)/.test(MC_COMP_640))
		throw new Error('menu rows have no min-height: var(--tap)');
});

// The showcase is the library's documentation. A component the showcase
// does not demonstrate is a component nobody can find.
const MC_PAGE = read('src/pages/index.astro');
check('the showcase demonstrates the mobile disclosure', () => {
	if (!MC_PAGE.includes('cm-nav-toggle__bars'))
		throw new Error('the burger is not demonstrated anywhere on the page');
	if (!MC_PAGE.includes('mobile disclosure'))
		throw new Error('the specimen has no section a reader can navigate to');
});
// A second live toggle would be a dead control: the runtime binds the first
// [data-cm-nav-toggle] in the document and ignores the rest, so a body
// specimen carrying that attribute is a button that does nothing.
check('exactly one live nav toggle exists in the document', () => {
	const live = (MC_PAGE.match(/data-cm-nav-toggle/g) || []).length
		+ (MC_HDR.match(/data-cm-nav-toggle/g) || []).length;
	if (live !== 1)
		throw new Error(`${live} elements claim data-cm-nav-toggle; only the first is ever bound`);
	// And the specimen, if present, must be inert.
	if (/cm-nav-toggle--demo[\s\S]{0,400}?data-cm-nav-toggle/.test(MC_PAGE))
		throw new Error('the specimen must not carry data-cm-nav-toggle');
});

// The current-section state must survive the panel being open, or a reader
// cannot see where they are.
check('the active link stays visible when the panel is open', () => {
	if (!MC_COMP_640.includes('.cm-header__link.is-active'))
		throw new Error('the scroll-spy state is dropped in the mobile panel');
	if (!MC_COMP_640.includes(".cm-header__link[aria-current='page']"))
		throw new Error('the current-page state is dropped in the mobile panel');
});

/* ════════���════════ the drawer cannot be trapped ═════════ */

/* A `position: fixed` descendant of an element with `backdrop-filter`,
   `filter`, `transform`, `perspective`, `contain` or `will-change` is
   positioned against THAT element, not the viewport. The drawer is fixed
   and lives inside the header, so any of those on `.cm-header` or on
   `.cm-header__nav` - the drawer's own parent - silently resolved
   `top`/`bottom` against the header box and collapsed the panel to 0px
   tall. The scrim came up, the button turned into an X, and the menu was
   simply not there. Every check above it still passed.

   Measured: with the blur on the bar, the drawer computed
   `position: fixed, top: 63px, bottom: 0, height: 0px`. */
const TRAPS = ['backdrop-filter', 'filter', 'transform', 'perspective', 'contain', 'will-change'];

/* The two elements between the drawer and the viewport, asserted by NAME
   because the chain is short and stable. The GEOMETRY is proven in
   tests/verify-burger-webkit.py, which measures the live panel's height
   and offsetTop - a rule-level check cannot see the collapse, because the
   CSS is identical whether or not an ancestor traps it. */
for (const [sel, what] of [
	['.cm-header {', 'the sticky header'],
	['.cm-header__nav {', "the drawer's own parent"],
]) {
	check(`${what} carries no containing-block trap`, () => {
		const at = compSrc.indexOf(sel);
		if (at === -1) throw new Error(`${sel} is not in components.css`);
		const open = compSrc.indexOf('{', at);
		const close = compSrc.indexOf('}', open);
		const rule = compSrc.slice(open + 1, close);
		for (const prop of TRAPS) {
			const re = new RegExp(`^\\s*${prop}\\s*:\\s*(?!none)`, 'm');
			if (re.test(rule))
				throw new Error(
					`${what} sets \`${prop}\`, which makes it the containing block ` +
					`for the fixed mobile drawer - the panel collapses to 0px`
				);
		}
	});
}

/* The blur was removed, so the header background must be opaque. If it
   went back to a translucent rgba, content scrolls through it visibly. */
check('the header background is opaque now that there is no blur', () => {
	const declares = [...tokenSrc.matchAll(/--header-bg:\s*([^;]+);/g)].map((m) => m[1].trim());
	if (!declares.length) throw new Error('--header-bg is not declared');
	for (const v of declares) {
		if (/rgba\(|hsla\(|\balpha\b/.test(v))
			throw new Error(`--header-bg: ${v} is translucent with no backdrop-filter to frost it`);
	}
});

/* The scrim is created by the runtime and keyed off <html>, so the
   drawer's own region never has to carry a sibling selector. */
check('the scrim is gated on the html element, not a CSS sibling', () => {
	if (!/data-cm-nav-open/.test(MC_JS))
		throw new Error('the runtime never marks the open state on <html>');
	if (!/documentElement\.classList\.add\('cm-nav-open'\)/.test(MC_NAV_JS) &&
		!/documentElement\.setAttribute\('data-cm-nav-open'/.test(MC_NAV_JS))
		throw new Error('the open state is not on <html>, so the scrim cannot be gated on it');
});

/* A drawer over the left edge must stop a tap reaching the content it covers.
 *
 * This used to assert `body.style.overflow = 'hidden'` on open - which
 * encoded a BUG as a requirement. <html> is the scrolling element here, so a
 * body lock never stopped the page, AND an `overflow: hidden` box becomes a
 * scroll container, which unpinned the sticky header (Omar's "gap at the
 * top" with the drawer open). The drawer is position:fixed over a
 * position:fixed scrim, so the page is covered from the first frame and the
 * scrim swallows the taps. See "the drawer must not unpin the header".
 */
check('the drawer blocks taps on the page behind it, without a body lock', () => {
	const code = MC_NAV_JS.replace(/\/\*[\s\S]*?\*\//g, '');
	if (/body\.style\.overflow\s*=\s*'hidden'/.test(code))
		throw new Error('the drawer scroll-locks via body overflow, which unpins the sticky header');
	// Clearing on close is allowed and wanted: it cleans up a value an older
	// build or a consumer may have left inline. What must not exist is a
	// WRITE on the open path. That distinction is the whole fix.
	const openBranch = code.match(/if\s*\(open\)\s*\{([\s\S]*?)\n\s*\}/);
	if (openBranch && /body\.style\.overflow\s*=\s*'hidden'/.test(openBranch[1]))
		throw new Error('the open branch still writes a body overflow lock');
	if (!/body\.style\.overflow\s*=\s*''/.test(code))
		throw new Error('the close path never clears a stale body overflow');
});

/* ================= copy / code bar =================
   The runtime bound [data-cm-copy] long before this section existed, and
   every consumer has it vendored - but no page in the fleet had a single
   button using it. A capability with no surface is a capability nobody can
   reach, and it hid two real defects: a missing bind guard, and a
   textContent write that destroyed the button's own children. */
console.log('\ncopy + code bar');

/* "Is this class defined?" needs the class to be a selector on its own,
   OR a state hook the runtime actually sets. A bare `.cls {` regex is
   satisfied by a COMPOUND selector (`.cm-back:hover .cm-back__arrow {`)
   and by the same name inside a comment above it, which is how two
   mutants in mutate-layout.mjs first reported MISSED. State hooks are
   the deliberate exception: `.cm-copy.is-copied` is how a state hook
   is spelled, and a space-free compound of two classes is still one
   element, not an ancestor. */
function isClassDefined(css, cls) {
	const bare = new RegExp(`^\\.${cls}$`);
	const state = new RegExp(`\\.[A-Za-z0-9_-]+\\.${cls}$`);
	for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
		const sel = m[1].trim();
		if (sel.startsWith('@')) continue; // at-rule prelude, not a selector
		for (const part of sel.split(',')) {
			const one = part.trim();
			// A selector containing a space names an ANCESTOR, so the
			// class is styled conditionally, not defined here.
			if (one && !/\s/.test(one) && (bare.test(one) || state.test(one))) return true;
		}
	}
	return false;
}

/* ---------- grouped rail nav ----------
   rpm's sidebar is grouped (Hosting / Security / Monitoring). The library
   had no element for a group, so the consumer would have had to fake one
   out of a `.cm-header__link`. That inherits the tap floor onto a heading
   that is not a target, which is both a dead 44px box for a screen reader
   and a false positive for the reachability audit. */
check('the grouped rail nav has its own wrapper and label', () => {
	// CONDITIONALLY defined, not bare: the column layout is a rail-width
	// claim (measured in WebKit at 390px, where an unscoped column group
	// overflowed the viewport by 41px). So the class is defined under
	// `.cm-header--rail` and must stay there.
	for (const sel of ['.cm-header--rail .cm-header__group',
	                   '.cm-header--rail .cm-header__group-label']) {
		assert(ruleBodies(comp, sel).length > 0, `${sel} is not defined as a selector of its own`);
	}
});

check('a group label is not a target: it must not inherit the tap floor', () => {
	const bodies = ruleBodies(comp, '.cm-header--rail .cm-header__group-label');
	assert(bodies.length > 0, '.cm-header__group-label has no rule body to read');
	const all = bodies.join('\n');
	assert(/min-height:\s*0/.test(all),
		'.cm-header__group-label must declare min-height: 0 so a heading is not a 44px dead target');
});

check('the group wrapper is a flex column of its own full width', () => {
	const bodies = ruleBodies(comp, '.cm-header--rail .cm-header__group');
	assert(bodies.length > 0, '.cm-header__group has no rule body to read');
	const all = bodies.join('\n');
	assert(/flex-direction:\s*column/.test(all), '.cm-header__group must stack label over links');
	assert(/align-self:\s*stretch/.test(all),
		'.cm-header__group must align-self: stretch, or it shrink-wraps and drifts off the rail edge');
	assert(/width:\s*100%/.test(all), '.cm-header__group must take the full rail width');
});

check('groups are separated by a token step, not a raw rem', () => {
	const bodies = ruleBodies(comp, '.cm-header--rail .cm-header__group + .cm-header__group');
	assert(bodies.length > 0, 'there is no rule separating adjacent groups');
	assert(/margin-top:\s*var\(--space-/.test(bodies.join('\n')),
		'group separation must come from the spacing scale, not a raw rem');
});

/* ---------- a GROUPED rail link is a rail link ----------
   Found by adopting kanban (2026-10-05), which uses rpm's markup shape:
   a `.cm-header__links` nested inside a `.cm-header__group`, inside the
   rail's own list. Every rail link rule was `> .cm-header__link`, so a
   nested link matched NOTHING - and the showcase could not see it,
   because the showcase's grouped specimen nests its links in a plain
   `<div>` and therefore kept them as direct children.

   MEASURED in WebKit at 1280x900, same rail, two nests:
     flat     min-height 44px, padding 0 20px, current marker 2px solid
     grouped  min-height 34px, padding 1.6px 11.2px, marker WIDTH 0px
   Both numbers are asserted below against the SOURCE selector rather
   than the measurement, because a test that needs a browser to notice
   a selector is a test nobody runs.

   The assertions name the GROUPED selector specifically. A check that
   grepped for `.cm-header__link` anywhere in the block would have
   passed against the broken file, which is precisely the gap this
   closes: the flat selector was there the whole time. */
check('the rail row reaches a link nested inside a group', () => {
	const sel = '.cm-header--rail .cm-header__group .cm-header__link';
	assert(ruleBodies(comp, sel).length > 0,
		'no rail rule styles a link inside .cm-header__group, so a GROUPED rail ' +
		'gets no tap floor, no inset and no current-page marker');
});

check('the grouped rail row carries the same declarations as the flat one', () => {
	// ONE rule for both nests, so no declaration can belong to only one of
	// them. Comparing the two bodies is what catches a later edit that
	// adds a property to the flat selector alone.
	const flat = ruleBodies(comp, '.cm-header--rail .cm-header__links > .cm-header__link').join('\n');
	const grouped = ruleBodies(comp, '.cm-header--rail .cm-header__group .cm-header__link').join('\n');
	assert(flat && grouped, 'one of the two rail link selectors has no rule body');
	// Each is the body of the SAME rule (comma-joined), so the strings are
	// expected to be identical; if a future edit splits them, this fails.
	assert(flat === grouped,
		'the flat and grouped rail link rules have DIVERGED - one nest now gets ' +
		'geometry the other does not');
	// And the properties that were measurably missing, named explicitly so
	// the failure says which one went.
	for (const [prop, why] of [
		[/min-height:\s*var\(--tap\)/, 'the tap floor'],
		[/border-left:\s*2px solid transparent/, 'the current-page marker width'],
		[/margin-inline:\s*var\(--space-2\)/, 'the inset that keeps the tick off the rail edge'],
	]) {
		assert(prop.test(grouped), `the grouped rail row is missing ${why}`);
	}
});

check('a current link inside a group paints the marker', () => {
	// The colour alone is a lie: `border-left-color` with no width draws
	// nothing. Measured 0px while the colour was var(--accent), on the one
	// rail whose job is to show you where you are.
	const flat = '.cm-header--rail .cm-header__links > .cm-header__link[aria-current=\'page\']';
	const grouped = '.cm-header--rail .cm-header__group .cm-header__link[aria-current=\'page\']';
	assert(ruleBodies(comp, grouped).length > 0,
		'no rail rule marks the CURRENT link when it sits inside a group');
	assert(ruleBodies(comp, flat).length > 0,
		'the flat current-link rule disappeared');
});

check('the showcase demonstrates the NESTED list a consumer actually writes', () => {
	// The showcase's own grouped specimen used to nest a plain <div>, so
	// its links stayed direct children and every rail rule applied to them.
	// That is the exact reason this class of bug stayed invisible: the demo
	// was not the shape. The fixture below reproduces rpm's nest.
	assert(/data-cm-grouped-rail-fixture/.test(showcase),
		'the nav section has no nested-list fixture, so a grouped rail is never ' +
		'rendered in the shape a consumer writes');
	const fixture = showcase.slice(showcase.indexOf('data-cm-grouped-rail-fixture'));
	const after = fixture.slice(0, fixture.indexOf('</div>\n							</div>') > 0
		? fixture.indexOf('</div>\n							</div>')
		: fixture.length);
	assert(/cm-header__group/.test(after) && /cm-header__links/.test(after),
		'the fixture does not nest a .cm-header__links inside a .cm-header__group');
	assert(/aria-current="page"/.test(after),
		'the fixture has no current link, so the marker cannot be demonstrated');
});

check('the grouped-rail fixture is a REAL rail, not just the nest', () => {
	// Nesting the shape is NECESSARY and not SUFFICIENT, and the first version
	// of this fixture got that wrong in a way every source-level check
	// accepted. The rail geometry is declared under `.cm-header--rail`, so a
	// fixture that is only `<div class=cm-header__links><div class=
	// cm-header__group>` matches NO rail rule and renders the 14px inline
	// links it was built to prove were fixed. MEASURED in WebKit at
	// 1280x900 on the nest-only version: computed min-height `auto`,
	// display `block`, rendered height 14.3px, border-left-width 0px - while
	// the paragraph directly above it claimed the geometry was visible.
	//
	// So the fixture must carry the rail CLASS, and the class is the point:
	// it is what both selectors key on. Asserting the class in the markup is
	// what makes the rendered specimen worth reading.
	const at = showcase.indexOf('data-cm-grouped-rail-fixture');
	assert(at > 0, 'no grouped-rail fixture in the showcase');
	const open = showcase.slice(Math.max(0, at - 400), at);
	const tag = open.slice(open.lastIndexOf('<div'));
	assert(/cm-header--rail/.test(tag),
		'the grouped-rail fixture does not carry .cm-header--rail, so no rail ' +
		'rule applies to it and it renders the unstyled inline links it was ' +
		'added to disprove (measured 14.3px at 1280x900)');
	// And it needs enough rows to look like the labelled rail a consumer
	// ships: a single two-link group cannot show the group separator or a
	// marker that is distinguishable from a neighbour.
	const fixture = showcase.slice(at, showcase.indexOf('cm-spec__val', at) > 0
		? showcase.indexOf('cm-spec__val', at) : showcase.length);
	const groups = (fixture.match(/cm-header__group"/g) || []).length;
	assert(groups >= 2,
		`the fixture has ${groups} group(s); two are needed to demonstrate a ` +
		'rail of labelled groups');
	// A heading wearing a link's class inherits the 44px tap floor and
	// becomes a dead target for a screen reader. The specimen should not
	// quietly demonstrate that.
	assert(/cm-header__group-label/.test(fixture),
		'the fixture renders groups with no label element, so the rail it ' +
		'demonstrates is not the shape a consumer writes');
	// Without a current link the fixture cannot show the MARKER, which is
	// half of what the grouped selector fixes: the active rule set
	// `border-left-color` while the base rule's `border-left: 2px solid
	// transparent` never applied, so the marker measured 0px wide. A fixture
	// with no current page renders five identical rows and hides that.
	//
	// Asserted HERE, on a slice bounded by the specimen's OWN `cm-spec__val`,
	// because the older nest check looks for `aria-current` in a window
	// delimited by a closing-div sequence that its own markup no longer
	// produces. The boundary index then returns -1, the slice runs to the end
	// of the page, and the assertion passes off OTHER specimens' aria-current.
	// MUTATION-VERIFIED: deleting `aria-current="page"` from this fixture
	// survived that check (500 passed / 0 failed) and is killed by this one.
	assert(/aria-current="page"/.test(fixture),
		'the grouped-rail fixture has no current link, so the rail it ' +
		'demonstrates cannot show the marker the grouped selector exists to fix');
});

/* A brace-balanced file is the one property a CSS consumer cannot recover
   from. oem-ui shipped an unbalanced `}` for a full commit: this suite was
   326 passed / 0 failed, every check green, and the consumer's bundler
   refused the file outright ("postcss-import: Unexpected }"), so the whole
   app failed to build. Nothing here parses the file for BALANCE - every
   other check asks a question that a malformed file can still answer,
   which is precisely why they all stayed green. */
check('every stylesheet has balanced braces', () => {
	for (const [name, src] of [['tokens.css', tokens], ['base.css', base], ['components.css', comp]]) {
		const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
		let d = 0;
		for (const ch of bare) {
			if (ch === '{') d++;
			else if (ch === '}') d--;
			assert(d >= 0, `${name} closes a brace that was never opened (depth went negative)`);
		}
		assert(d === 0, `${name} is unbalanced: ${d} unclosed brace(s) at end of file`);
	}
});

check('the copy surface is defined as classes of its own', () => {
	for (const cls of ['cm-copy', 'cm-copy__state', 'cm-codebar', 'cm-codebar__bar', 'cm-codebar__lang']) {
		assert(isClassDefined(comp, cls), `.${cls} is not defined as a selector of its own`);
	}
});

/* The built showcase page, or '' when there is no build.
   Several checks have to read this rather than the source: a component
   that renders from an imported .astro file puts its markup in dist/ and
   nowhere else, so a source-level assertion cannot see it at all. */
function builtHtml() {
	const f = join(root, 'dist/index.html');
	return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

// The component that emits the markup. Several checks below have to read
// THIS rather than the showcase source: the button is not written in
// src/pages/index.astro, so a source-level assertion cannot see it.
const cb = read('src/astro/CodeBlock.astro');

check('the copy button is a house button, not a new visual language', () => {
	// The copy control must COMPOSE the existing button rather than skin a
	// parallel one. A second button implementation is the duplication this
	// library exists to prevent: the bug the first .cm-btn tap-floor fix
	// made would simply recur here, in a control that inherits none of it.
	assert(/\bclass="cm-btn cm-btn--sm cm-copy"/.test(cb),
		'the copy button is not composed from .cm-btn .cm-btn--sm .cm-copy');
	// And the page that renders it must actually carry that class, or the
	// component is correct and nothing uses it. Asserting on the showcase
	// source here would pass on the three inert state specimens while the
	// real button in <CodeBlock> went unstyled - which is exactly what the
	// first mutation of this test proved.
	const built = builtHtml();
	if (built) {
		const btns = built.match(/<button[^>]*data-cm-copy\b[\s\S]*?<\/button>/g) || [];
		assert(btns.length > 0, 'the built page has no copy button to inspect');
		for (const b of btns) {
			assert(/\bclass="[^"]*\bcm-copy\b/.test(b),
				'a rendered copy button does not carry the .cm-copy class');
		}
	}
	// A .cm-copy that re-declared the border or padding would be a second
	// implementation of the button rather than a variant of it.
	const copy = /\.cm-copy\s*\{([^}]*)\}/.exec(comp);
	assert(copy, '.cm-copy rule missing');
	assert(!/border\s*:/.test(copy[1]),
		'.cm-copy re-declares the button border; that is a second button implementation');
	assert(!/padding\s*:/.test(copy[1]),
		'.cm-copy re-declares the button padding; the floor and the padding belong to .cm-btn');
});

check('a copy control is never below the tap floor on touch', () => {
	// The coarse-pointer floor for .cm-copy MUST live in components.css,
	// not in the base.css block. base.css loads first and the .cm-btn--sm
	// min-height:0 is declared later at equal specificity, so a rule in
	// base.css loses the cascade silently and the button measures 2.4rem
	// tall on a phone. The same trap already cost .cm-icon-btn its width.
	const inComponents = /@media \(pointer: coarse\)\s*\{\s*\.cm-copy\s*\{[^}]*min-height:\s*var\(--tap\)/.test(comp);
	assert(inComponents,
		'.cm-copy does not take --tap from a coarse-pointer block in components.css');
	// A hardcoded 44px would measure right and be wrong: a consumer that
	// retunes --tap gets a button stuck at the old size.
	assert(!/\.cm-copy[^{]*\{[^}]*min-height:\s*44px/.test(comp),
		'.cm-copy hardcodes 44px instead of taking the --tap token');
});

check('the copied state has a rule, so a successful copy is visible', () => {
	// The runtime has set .is-copied since it shipped and the library had
	// no rule for it anywhere: the label text changed and the only feedback
	// was the motion. Assert the class in a SELECTOR, not as a substring,
	// so the explanatory comment above the rule cannot satisfy this.
	assert(isClassDefined(comp, 'is-copied'),
		'the runtime sets .is-copied but no rule renders it, so a copy has no confirmation');
	// And the failure path needs one too, for the same reason: the greyscale
	// palette has no hue to carry it.
	assert(isClassDefined(comp, 'is-error'),
		'the failure path has no state class, so a refused copy is indistinguishable');
	// The runtime must actually set the class the CSS styles.
	assert(/classList\.add\('is-error'\)/.test(runtimeSrc),
		'the runtime never sets .is-error, so the failure state is unreachable');
});

check('the copy button keeps its glyph slot when the label changes', () => {
	// Writing btn.textContent DESTROYS the button's children, so a button
	// carrying a reserved glyph slot lost it on the first copy and could
	// never get it back. The label must be written into a slot.
	assert(!/\bbtn\.textContent\s*=\s*'copied'/.test(runtimeSrc),
		'the runtime writes btn.textContent, which destroys the glyph slot');
	assert(/data-cm-copy-label/.test(runtimeSrc),
		'the runtime has no label slot to write into');
	// The slot must be RENDERED, and this has to read the BUILT page. The
	// button comes out of <CodeBlock>, so the markup is not in
	// src/pages/index.astro at all: a source-level assertion here can only
	// ever fail, or (worse) be written against something else and pass
	// forever. The runtime's own lesson, verbatim: a relative
	// <script src> tag compiled fine, was dropped from dist/ entirely, and
	// a source-level test stayed green the whole time.
	const built = builtHtml();
	assert(built, 'dist/index.html is missing — run `npm run build` before the contract tests');
	const buttons = built.match(/<button[^>]*data-cm-copy\b[\s\S]*?<\/button>/g) || [];
	assert(buttons.length > 0, 'the built page has no copy button at all');
	for (const b of buttons) {
		assert(/data-cm-copy-label/.test(b),
			'a rendered copy button has no [data-cm-copy-label] slot, so the '
			+ 'runtime textContent write will destroy the glyph it reserves');
	}
});

/* The guard must SURVIVE the trip into the built page. This is the only
   assertion in the suite that would have caught the shipped bug: the
   source file was valid, the build was green, the source-level tests were
   green, and the guard the browser received was a truncated COMMENT with
   no code in it. A source test cannot see that - the truncation happens in
   the HTML parser, downstream of everything the suite reads.

   So assert the rendered geometry of the head instead: one inline script,
   carrying the real body, positioned before the charset and the first
   stylesheet. */
check('the BUILT page ships a working guard, not a truncated comment', () => {
	const built = builtHtml();
	assert(built, 'dist/index.html is missing — run `npm run build` before the contract tests');
	const headEnd = built.indexOf('</head>');
	assert(headEnd !== -1, 'the built page has no </head>');
	const head = built.slice(0, headEnd);

	// The guard is the first script in the head, and it is INLINE (no src),
	// because an external tag is fetched and run after the stylesheets.
	const firstScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/.exec(head);
	assert(firstScript, 'the built head has no inline script at all');
	assert(!/\bsrc=/.test(firstScript[1]),
		`the first script in the built head has a src= attribute: ${firstScript[1].trim()}. ` +
			'That runs after the stylesheets, which is the flash this prevents.');

	const body = firstScript[2];
	// Strip the JS comment so prose cannot satisfy a code assertion - the
	// real bug was a file that was ALL prose.
	const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

	assert(/\(function\s*\(\)\s*\{/.test(code),
		'the built head script contains no executable IIFE: it shipped as a comment');
	assert(code.trimEnd().endsWith('})();'),
		'the built guard does not invoke itself, so it cannot apply a saved theme');
	for (const probe of [
		'data-cm-theme-key',
		'data-cm-theme-legacy',
		'localStorage.getItem',
		"setAttribute('data-theme', 'light')",
	]) {
		assert(code.includes(probe),
			`the built guard never references ${probe}; the guard is not the one the library ships`);
	}
	// Dark is the default and is applied by CSS, so writing anything but
	// light would be wrong, and writing to storage here would race the
	// runtime's own migration.
	assert(!/localStorage\.setItem/.test(code),
		'the built guard writes to localStorage; that is the runtime\'s job, after the paint');

	// Position, measured on the built bytes.
	const guardEnd = head.indexOf('</script>', firstScript.index) + '</script>'.length;
	const charset = head.indexOf('<meta charset');
	const sheet = head.search(/<link[^>]+rel="stylesheet"/);
	assert(guardEnd <= charset || charset === -1,
		'the built guard does not precede <meta charset>, so a light-theme visitor sees a dark flash');
	assert(guardEnd <= sheet || sheet === -1,
		'the built guard does not precede the first stylesheet, so the flash comes back');
});

check('the copy button is bound once, however often init runs again', () => {
	// init() runs on every astro:page-load and initCopy had no bind guard,
	// so each run attached another click listener: one click, two clipboard
	// writes. Measured in WebKit at 390px before the fix.
	const copy = /function initCopy[\s\S]*?\n\t}/.exec(runtimeSrc);
	assert(copy, 'could not parse initCopy');
	assert(/if \(btn\.dataset\.cmCopyBound\) return;/.test(copy[0]),
		'initCopy has no bind guard, so astro:page-load double-binds every copy button');
	assert(/btn\.dataset\.cmCopyBound\s*=\s*'1';/.test(copy[0]),
		'the guard is never set, so it cannot skip a second bind');
});

check('the showcase demonstrates copy with more than one block', () => {
	// Both defects this section fixes are only observable with two copy
	// buttons on one page. A single specimen would have hidden them, which
	// is exactly what happened for as long as the surface did not exist.
	//
	// Built html, not source: the buttons are emitted by <CodeBlock>, so
	// src/pages/index.astro contains none of them. Counting there would be
	// counting a string that can never grow past the two mentions in the
	// prose.
	const built = builtHtml();
	assert(built, 'dist/index.html is missing — run `npm run build` before the contract tests');
	const targets = [...built.matchAll(/data-cm-copy="([^"]+)"/g)].map(m => m[1]);
	assert(targets.length >= 2,
		`the showcase has ${targets.length} copy button(s); two are needed to exercise per-block resolution`);
	// Each button must target a DISTINCT id, or every button copies the
	// same first block and the specimen is decorative.
	assert(new Set(targets).size === targets.length,
		`two copy buttons target the same block: ${targets.join(', ')}`);
	// And those ids must exist in the markup, or the button copies nothing.
	for (const t of targets) {
		assert(new RegExp(`id="${t.replace('#', '')}"`).test(built),
			`the copy target ${t} has no matching element in the built page`);
	}
});

check('a long language label cannot push the copy button off the row', () => {
	// The bar is a flex row: a long language name wins on min-content width
	// and pushes the button out of the panel. min-width:0 on the label is
	// what lets it shrink, and the ellipsis is what makes the truncation
	// legible. Without min-width:0 the row overflows the section instead.
	const lang = /\.cm-codebar__lang\s*\{([^}]*)\}/.exec(comp);
	assert(lang, '.cm-codebar__lang rule missing');
	assert(/min-width:\s*0/.test(lang[1]),
		'.cm-codebar__lang has no min-width:0, so a long language name widens the row');
	const span = /\.cm-codebar__lang\s*>\s*span\s*\{([^}]*)\}/.exec(comp);
	assert(span, '.cm-codebar__lang has no inner span to truncate');
	assert(/text-overflow:\s*ellipsis/.test(span[1]),
		'the language label does not truncate with an ellipsis');
	assert(/overflow:\s*hidden/.test(span[1]),
		'the language label has overflow:hidden, so the ellipsis never appears');
});

check('the glyph slot reserves its width, so the label never shifts', () => {
	// The runtime replaces "copy" with "copied" and puts a tick in the
	// slot. An unreserved glyph reflows the whole bar on every state
	// change, which is the kind of thing only a screenshot catches and
	// nobody measures. min-width on the slot is the reservation.
	const slot = /\.cm-copy__state\s*\{([^}]*)\}/.exec(comp);
	assert(slot, '.cm-copy__state rule missing');
	assert(/min-width:\s*1\.4em/.test(slot[1]),
		'the glyph slot reserves no width, so the label shifts on every state change');
	assert(/text-align:\s*center/.test(slot[1]),
		'the glyph slot is not centred, so the tick sits off the word');
});

check('the code bar is symmetric, so the copy button is not hugging the edge', () => {
	// `padding: 0 var(--space-2) 0 var(--space-4)` put the language label
	// 16px from the bar's left edge and the copy button 8px from the
	// right. Measured at 390px. Every element was individually placed
	// and the bar still read as off-grid, because a row whose two ends
	// have different insets has no rail to sit on.
	//
	// A `padding` shorthand with a THREE-value form is the shape of this
	// bug: `0 X 0 Y` looks like a deliberate override and is really an
	// asymmetry. Reject that form outright rather than testing the two
	// numbers, so a retune of the token cannot reintroduce it.
	const bar = /\.cm-codebar__bar\s*\{([^}]*)\}/.exec(comp);
	assert(bar, '.cm-codebar__bar rule missing');
	const pad = bar[1].match(/padding(?:-inline)?:\s*([^;]+)/);
	assert(pad, '.cm-codebar__bar has no padding declaration');
	const parts = pad[1].trim().split(/\s+/);
	assert(parts.length !== 3,
		`padding is "${pad[1].trim()}" — a three-value form is an asymmetric row`);
	// CSS box shorthand: 1 value = all, 2 = V H, 3 = T H B, 4 = T R B L.
	// The asymmetry only exists in the 3- and 4-value forms; a 2-value
	// `0 var(--space-2)` is top/bottom 0, both sides --space-2, and is
	// symmetric by definition.
	if (parts.length === 4) {
		assert(parts[1] === parts[3],
			`left inset ${parts[1]} != right inset ${parts[3]}; the bar has no rail`);
	}
	// And it must come from the spacing scale, not a literal.
	assert(/var\(--space-/.test(pad[1]),
		`padding "${pad[1].trim()}" is a literal; spacing must come from --space-*`);
});

check('the code bar corners come from the radius token', () => {
	// A hardcoded 4px here measures fine and is a rebrand bug: retune
	// --radius-sm and this bar keeps the old corner while every other
	// panel in the system moves. Same rule the bordered-block test
	// applies to .cm-section / .cm-card.
	const bar = /\.cm-codebar\s*\{([^}]*)\}/.exec(comp);
	assert(bar, '.cm-codebar rule missing');
	assert(/border-radius:\s*var\(--radius-sm\)/.test(bar[1]),
		'.cm-codebar does not take its radius from --radius-sm');
	assert(!/border-radius:\s*\d/.test(bar[1]),
		'.cm-codebar hardcodes a border-radius instead of using the token');
});

check('the code bar flattens the pre default it wraps', () => {
	// `pre` is an ELEMENT default carrying its own border, left accent rule
	// and radius. Inside a bar those are the panel's chrome, not the body's,
	// and leaving them draws a second border inside the bar. Same reason
	// .cm-term__body pre is flattened.
	const pre = /\.cm-codebar\s*>\s*pre\s*\{([^}]*)\}/.exec(comp);
	assert(pre, '.cm-codebar > pre rule missing');
	assert(/border:\s*0/.test(pre[1]),
		'the wrapped pre keeps its own border, so the bar draws two');
	assert(/border-left:\s*0|border:\s*0/.test(pre[1]),
		'the pre keeps its left accent rule inside the bar');
	assert(/border-radius:\s*0/.test(pre[1]),
		'the wrapped pre keeps its own radius, so the two corners double up');
});

check('a code block without an id fails the build instead of shipping a dead button', () => {
	// The same contract <Meter> has for an out-of-range percentage: a
	// button that copies nothing is worse than no button, and the failure
	// is invisible on the page.
	assert(/throw new Error/.test(cb),
		'<CodeBlock> does not throw on a missing id');
	assert(/if \(!id\)/.test(cb),
		'the throw is not guarded on the id prop');
	// The button must target the id it was given, not a literal.
	assert(/data-cm-copy=\{`#\$\{id\}`\}/.test(cb),
		'the copy button does not target the id it was handed');
});

check('the copy button is a real button a keyboard can reach', () => {
	// It is a <button type="button">, so it is focusable, fires on Enter
	// and Space, and is not submitted as part of a form. A div with a click
	// handler reaches none of that.
	const cbTags = read('src/astro/CodeBlock.astro')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');
	// COMMENT-STRIPPED, and this is not optional. The doc comment above the
	// markup explains that the control is a <button type="button">, so both
	// `/<button/` and `/type="button"/` matched the PROSE: deleting the whole
	// element left this check green. It was reading the explanation of the
	// thing instead of the thing - the same trap the aria-invalid doc
	// comment set, and the same reason the CSS checks strip comments before
	// matching source.
	assert(/<button[\s>]/.test(cbTags),
		'the copy control is not a <button>; it must be focusable and fire on Enter/Space for free');
	// `type="button"` must be ON the tag, not merely somewhere in the file,
	// or a copy button inside a form submits it.
	const btnTag = /<button[\s\S]*?>/.exec(cbTags);
	assert(btnTag, 'could not parse the copy button tag');
	assert(/type="button"/.test(btnTag[0]),
		'the copy button has no type="button", so it submits a form it sits inside');
	assert(!/<(div|span)[^>]*data-cm-copy[\s=]/.test(cbTags),
		'the copy control is a div/span, not a button element');
	// The glyph slot is decorative and must not be announced.
	assert(/class="cm-copy__state" aria-hidden="true"/.test(cbTags),
		'the glyph slot is not aria-hidden, so a screen reader reads the tick');
	// The <pre> scrolls, so it must be focusable for a keyboard user.
	assert(/<pre id=\{id\} tabindex="0">/.test(cbTags),
		'the scrollable <pre> is not focusable, so a keyboard cannot scroll it');
});

/* ================= every defined class is REACHABLE =================
   A class that nothing renders is not a feature, it is a promise nobody
   can check. The audit script reported this by grepping the showcase
   SOURCE, which is wrong twice over: `class:list` in an .astro component
   never puts the string in index.astro (so .cm-meter--accent and
   .cm-status--ok read as dead while rendering on the page), and a
   class named in a comment reads as alive. The only honest question -
   does this class appear in the markup the browser actually got? - is
   answered by the BUILT page. */
const built = builtHtml();
// Only real class TOKENS, not every `cm-` substring on the page. Three
// families collide with this prefix and none of them is a class:
//   --cm-t, --cm-ease, --cm-meter-fill   CSS custom properties
//   data-cm-open, data-cm-toasts          runtime data attributes
//   cm-theme, cm-header-links             the string value of a class
//                                        attribute that holds a name
// So match `class="..."` attributes, split on whitespace, and keep the
// tokens that actually look like component classes. `_` is a word
// character in JS regex, so \b is useless on a BEM name: \bcm-tag\b will
// not match inside `cm-tag--accent`. The lookahead is the boundary.
const renderedClasses = new Set();
for (const m of (built || '').matchAll(/class="([^"]*)"/g)) {
	for (const tok of m[1].split(/\s+/)) {
		// The BEM shape: `cm-block`, `cm-block__part`, `cm-block--variant`.
		// `__` is a DOUBLE underscore, so one `-_` step does not cover it -
		// a pattern that drops the part suffix silently reports every
		// element part of the library as unrendered, which is how this
		// check first answered "133 classes are dead" on a page that
		// renders all of them.
		if (/^cm-[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*$/.test(tok)) renderedClasses.add(tok);
	}
}
// The variants section, read ONCE. A `const` inside a check() is scoped to
// that closure, so a second check that needs it does not see it - and the
// failure mode is a ReferenceError that reads like a typo, not like a
// missing fixture.
const surfaceSection = showcase.slice(showcase.indexOf('id="surface"'),
	showcase.indexOf('id="code"'));

check('every class the library defines is rendered somewhere on the page', () => {
	assert(built, 'dist/index.html is missing — run `npm run build` before the contract tests');
	// `.cm-x` in CSS matches the SELECTOR's class; a compound selector
	// still names a class that is only styled conditionally, so scope the
	// claim: a class defined in CSS and absent from the rendered markup is
	// unreachable on this page.
	const defined = new Set((compSrc.match(/\.(cm-[a-z0-9_-]+)/g) || []).map(s => s.slice(1)));
	assert(defined.size > 150, `only ${defined.size} classes parsed from components.css; the regex is wrong`);
	// cm-js and cm-nav-scrim are injected by the runtime onto <html> and
	// are correct only with JS on, so they cannot be in the served HTML.
	// cm-spec__state is the same case: the runtime creates the readout
	// element, because a specimen that reports its own live width has to
	// be written after layout. Each name is PROVEN here rather than
	// trusted, so the list cannot grow into a place where dead CSS hides.
	// The proof names the CLASS and the CREATION together: a bare
	// /createElement\('span'\)/ is satisfied by any span in the file, so
	// renaming the readout to cm-spec__nope left the suite green with the
	// class now dead -- caught by the mutation 'cm-spec__state is left
	// defined but no longer created'.
	const runtimeOnly = new Map([
		['cm-js', /classList\.add\(\s*'cm-js'\s*\)/],
		['cm-nav-scrim', /cm-nav-scrim/],
		['cm-spec__state', /createElement\('span'\)\s*;?\s*\n\s*out\.className = 'cm-spec__state'/],
		// applied while the pointer is down, removed on release
		['cm-drawer--dragging', /classList\.add\(\s*'cm-drawer--dragging'\s*\)/],
	]);
	for (const [cls, proof] of runtimeOnly) {
		assert(proof.test(runtimeSrc),
			`${cls} is allowlisted as runtime-built, but the runtime no ` +
			`longer creates it - drop it from the list rather than letting ` +
			`real dead CSS pass as an exception`);
	}
	const dead = [...defined].filter(
		(c) => !renderedClasses.has(c) && !runtimeOnly.has(c));
	assert(dead.length === 0,
		`${dead.length} class(es) are defined but never rendered on the built page: ${dead.join(', ')}`);

	// The OTHER direction, and the one that actually bites. Above asks
	// "is everything in the CSS reachable?". This asks "is everything on
	// the page actually styled?" - a class can render and carry NO rule at
	// all, which is the renamed-without-selector bug: the markup moves to
	// a new name, the rule keeps the old one, and the element renders
	// unstyled with a green build. One direction cannot see it, because
	// removing the selector also removes the class from the CSS set and
	// the "defined" side never notices the element is stranded.
	//
	// A modifier is a selector of its own only if it is not merely part
	// of a longer name, so the boundary check is a negative lookahead
	// rather than \b: `_` is a word character, so \bcm-tag\b will not
	// match inside `cm-tag--accent`.
	const styled = (cls) => new RegExp('\\.' + cls + '(?![a-z0-9_-])').test(allCss);
	const unstyled = [...renderedClasses].filter(c => !styled(c));
	// cm-js is set on <html> by the runtime and is the progressive-
	// enhancement hook, not a styled element; it is legitimately in the
	// markup the browser got only when the script has run.
	assert(unstyled.length === 0,
		`${unstyled.length} class(es) render on the page but no rule styles them: ${unstyled.join(', ')}`);
});

check('shadcn-parity: drawer + field wiring', () => {
	const html = read('dist/index.html');
	const js = read('src/js/cli-mono.js');
	const css = read('src/styles/components.css');

	assert(html.includes('id="drawer"'), 'no #drawer section on the built page');
	assert(html.includes('cm-drawer__handle'), 'the drawer has no handle markup');
	assert(/id="drawer-demo"[^>]*cm-drawer|cm-drawer[^>]*id="drawer-demo"/.test(html),
		'the live drawer is not a .cm-drawer');
	assert(html.includes('data-cm-open="drawer-demo"'), 'nothing opens the live drawer');
	assert(css.includes('.cm-drawer__handle'), 'no handle rule');
	assert(css.includes('.cm-drawer--dragging'), 'no dragging rule');
	// The drawer is pinned to the screen bottom: its body must clear the
	// home indicator. env() cannot be faked in a WebKit harness (it
	// resolves to 0 and the rule becomes indistinguishable from no rule),
	// so this contract is the only place that can hold it.
	assert(css.includes('safe-area-inset-bottom'),
		'the drawer body no longer clears the home indicator');
	assert(css.includes('env(safe-area-inset-bottom'), 'the drawer does not clear the home indicator');
	assert(/function cmInitDrawer\(/.test(js), 'cmInitDrawer is not defined');
	assert(/function cmInitFields\(/.test(js), 'cmInitFields is not defined');
	assert((js.match(/cmInitDrawer\(root\);/g) || []).length >= 1, 'cmInitDrawer never runs from init');
	assert((js.match(/cmInitFields\(root\);/g) || []).length >= 1, 'cmInitFields never runs from init');
	// the gesture lives on the HANDLE, not the drawer: a body-started
	// drag would fight the content's own scrolling.
	assert(/handle\.addEventListener\('pointermove'/.test(js),
		'the drag handler is not bound to the handle');
	assert(js.includes('Math.max(0, e.clientY - startY)'), 'the pull is not clamped to downward');
	assert(js.includes('aria-describedby'), 'the field wiring does not build describedby');
	assert(js.includes('keep.concat(generated)'), 'describedby is replaced, not merged');
	assert(js.includes('aria-required'), 'the asterisk does not become aria-required');
	// the merge is provable only if the specimen OWNS a describedby the
	// runtime must keep beside the one it generates.
	assert(/id="f-url"[^>]*aria-describedby="f-url-scheme"|aria-describedby="f-url-scheme"[^>]*id="f-url"/.test(html),
		'f-url lost the hand-written describedby the merge is about');
	assert(html.includes('id="f-url-scheme"'), 'the manual describedby target is missing');
	// A non-open <dialog> is display:none in the UA sheet: without this
	// rule every static preview on the page paints NOTHING while prose
	// describes it. The class is what opts a preview in.
	assert(css.includes('dialog.cm-dialog--spec:not([open]) { display: block; }'),
		'the dialog specimens are UA-hidden with no override');
	assert((html.match(/cm-dialog--spec/g) || []).length >= 5,
		'fewer than 5 static dialog previews are tagged cm-dialog--spec');
});

check('shadcn-parity: datepicker + scrollarea', () => {
	const html = read('dist/index.html');
	const js = read('src/js/cli-mono.js');
	const css = read('src/styles/components.css');
	assert(html.includes('id="datepicker"'), 'the datepicker section is missing');
	assert(html.includes('id="scrollarea"'), 'the scrollarea section is missing');
	// both entry points - field and caret - name the SAME panel
	assert(html.split('popovertarget="dp-panel"').length - 1 === 2,
		'exactly the input and the caret must target the panel');
	assert(/id="dp-input"[\s\S]{0,200}aria-haspopup="dialog"[\s\S]{0,160}popovertarget="dp-panel"/.test(html),
		'the readonly input must declare haspopup before its target');
	// the panel is a [popover] in the .cm-popover frame: that is what makes
	// it belong to the EXISTING popover machinery instead of a new one
	assert(/id="dp-panel" popover class="cm-popover cm-datepicker__panel"/.test(html),
		'the panel must be a [popover] wearing the cm-popover frame');
	assert(html.split('data-cm-cal-mode="single"').length - 1 === 2,
		'the showcase owns exactly two single calendars (calendar section + picker)');
	// the composition's glue lives in the cal click path
	assert(js.includes("cal.getAttribute('data-cm-cal-selected') || ''"),
		'the pick is not written back into a datepicker input');
	assert(/function cmInitDatepickers\(/.test(js) && js.includes('cmInitDatepickers(root);'),
		'the field-click open must be bound from init');
	assert(js.includes('dpPanel.hidePopover()'),
		'a completed pick does not close the panel');
	assert(js.indexOf('function calPick(') !== -1 &&
		js.indexOf('dpPanel.hidePopover()') > js.indexOf('function calPick('),
		'the glue must sit inside calPick - the one path a pick takes - not outside the runtime');
	const sa = /\.cm-scrollarea\s*{([^}]*)}/.exec(css);
	assert(sa, '.cm-scrollarea is not defined');
	assert(/max-height: var\(--scroll-h/.test(sa[1]), 'scrollarea must take the --scroll-h knob');
	assert(/overflow-y: auto/.test(sa[1]), 'the scrollarea must be a scrollport');
	assert(/overscroll-behavior: contain/.test(sa[1]), 'the scrollarea must contain its gesture');
});

check('shadcn-parity: the drawn shortcut, the toast vocabulary, the sticky chrome', () => {
	const html = read('dist/index.html');
	const js = read('src/js/cli-mono.js');
	const css = read('src/styles/components.css');

	// The ⌘K glyph is drawn on the trigger; a glyph without a handler
	// is a promise the page cannot keep.
	assert(js.includes('e.metaKey || e.ctrlKey'), 'no modifier-key check in the runtime');
	assert(js.includes(".toLowerCase() !== 'k'"), 'the shortcut does not test the k key');
	assert(js.includes('function cmInitShortcuts'), 'no shortcut function');

	// The new severities exist in BOTH vocabularies, each with a
	// static emitter (a CSS class nothing renders is dead CSS).
	assert((html.split('data-cm-toast-kind').length - 1) === 4, 'the four runtime toast demos are missing');
	assert(html.includes('cm-toast--info') && html.includes('cm-toast--loading'),
		'static info/loading toast specimens missing');
	assert(html.includes('cm-alert--info') && html.includes('cm-alert--loading'),
		'static info/loading alert specimens missing');
	assert(html.includes('data-cm-toast-action'), 'the static action emitter is missing');
	// The hand-written specimens carry close/action controls; without
	// data-cm-toast init() never binds them - the controls LOOK live and
	// do nothing (which is how five dead x buttons shipped once).
	const specToasts = (html.match(/<div class="cm-toast cm-toast--/g) || []).length;
	const bindable = (html.match(/class="cm-toast cm-toast--[a-z]+" data-cm-toast/g) || []).length;
	assert(specToasts >= 5 && bindable === specToasts,
		`${bindable}/${specToasts} spec toasts are bindable`);

	// Toast machinery.
	assert(js.includes('function toastPromise'), 'no toast.promise implementation');
	assert(js.includes('toast.promise = toastPromise'), 'toast.promise not exported on the API');
	assert(js.includes("setAttribute('aria-busy'"), 'loading does not announce aria-busy');
	assert(js.includes('opts.sticky'), 'the sticky lifetime opt-in is gone');
	assert(js.includes('cm:action'), 'the action event is gone');
	assert(js.includes('box.__cmAction'), 'the action callback has no ride to the binder');

	// Sticky dialog chrome - scoped to the LINE-START selector so the
	// sheet's own (0,2,0) rule cannot answer for the base rule.
	const head = /^\.cm-dialog__head \{[^}]*\}/m.exec(css);
	assert(head && head[0].includes('position: sticky') && head[0].includes('background'),
		'the dialog head is not sticky-with-a-background');
	const foot = /^\.cm-dialog__foot \{[^}]*\}/m.exec(css);
	assert(foot && foot[0].includes('position: sticky') && foot[0].includes('bottom: 0'),
		'the dialog foot is not stuck to the bottom');

	const info = /^\.cm-toast--info \{[^}]*\}/m.exec(css);
	assert(info && info[0].includes('--ink-faint'), 'info has no border tone');
	assert(css.includes(".cm-toast--info .cm-toast__mark::before { content: '\\2139"), 'info draws no mark');
	assert(css.includes('.cm-toast--loading .cm-toast__mark::before'), 'loading draws no mark in CSS');
	assert(/\.cm-toast--loading \.cm-toast__mark::before,?[\s\S]{0,200}cm-spin/.test(css),
		'the loading mark does not spin');
	const act = /^\.cm-toast__action \{[^}]*\}/m.exec(css);
	assert(act && act[0].includes('margin-left: auto'), 'the action is not pushed to the far edge');
});

	/* --- shadcn parity: the utils pair and the validating forms ---
	   scroll-fade must be scroll-LINKED (not a static mask wearing the
	   name), shimmer must stay clipped behind its @supports gate and be
	   listed in the ONE reduced-motion block, the table wrappers must
	   carry the utility, and validation must be opt-in per form and
	   wired by init(). */
	check('shadcn-parity: scroll-fade, shimmer, validating forms', () => {
		const html = read('dist/index.html');
		const js = read('src/js/cli-mono.js');
		const css = read('src/styles/components.css');

		assert(/animation-timeline: scroll\(self block\)/.test(css),
			'scroll-fade has no vertical scroll timeline');
		assert(/animation-timeline: scroll\(self inline\)/.test(css),
			'scroll-fade has no inline scroll timeline');
		// the RULE, not the name: the doc comment above the block also
		// says '@property --sf-p', and a substring assert read prose.
		assert(css.includes('@property --sf-p { syntax: "<number>"; inherits: true; initial-value: 0; }'),
			'the edge stops are not registered');
		assert(css.includes('@supports (animation-timeline: scroll())'),
			'no animation-timeline gate for the static fallback');
		assert(css.includes('.cm-scroll-fade--none'), 'scroll-fade-none missing');
		assert(css.includes('@supports ((background-clip: text) or (-webkit-background-clip: text))'),
			'shimmer is not behind its background-clip gate');
		assert(css.includes('--shimmer-duration'), 'the shimmer duration knob is missing');
		assert(css.includes('.cm-cursor,\n\t.cm-shimmer,'),
			'shimmer is not listed in the reduced-motion block');
		assert(!css.includes('#000 92%'), 'the static table mask is still hardcoded');

		assert((html.match(/cm-scroll-fade-x/g) || []).length >= 4,
			'table wrappers or the x specimen lost the utility class');
		assert(html.includes('id="utilities"'), 'no utilities section');
		assert(html.includes('href="#utilities"'), 'utilities not registered in the nav');
		assert(/class="[^"]*cm-shimmer[^"]*"/.test(html), 'no shimmer specimen');

		assert(js.includes('function cmInitForms'), 'no cmInitForms');
		assert(/cmInitForms\(root\)/.test(js), 'cmInitForms is not called by init()');
		assert((html.match(/data-cm-validate(?![-a-z])/g) || []).length >= 2,
			'fewer than two forms opt into validation');
		assert(html.includes('data-cm-validate-mode="blur"'), 'the blur-mode form is gone');
	});


check('a variant is only called demonstrated if it differs from its base', () => {
	// The trap this closes: `.cm-tag--accent { color: var(--ink) }` beside
	// `.cm-tag { color: var(--ink-dim) }` LOOKS like a variant, ships to
	// oem-portfolio, and would be green in every existence test. So the
	// showcase must carry a BASE and a MODIFIER of the same block, and
	// the modifier must declare a declaration the base does not.
	const variants = [
		['cm-tag', 'cm-tag--accent'],
		['cm-status', 'cm-status--ok'],
		['cm-status', 'cm-status--warn'],
		['cm-status', 'cm-status--err'],
		['cm-toast', 'cm-toast--ok'],
	];
	const section = surfaceSection;
	assert(section.length > 200, 'the variants section is missing or empty');
	// The modifier must be rendered WITH its base class on the same
	// element, or it is a standalone style and not a variant at all.
	for (const [base, mod] of variants) {
		assert(new RegExp(`class="[^"]*\\b${base}\\b[^"]*\\b${mod}\\b`).test(section),
			`the variants section must render ${mod} together with ${base}`);
	}
	// And the CSS must give the modifier something the base lacks.
	//
	// Walk the rule's whole SELECTOR LIST, not `sel {`. Most of these
	// variants are not declared on their own element at all: `.cm-status--ok`
	// is a compound selector, `.cm-status--ok .cm-status__value::before`,
	// because the state is a glyph on a child. A `sel {` lookup reports
	// "no rule body of its own" for a variant that is very much alive -
	// the same false negative as the `.cm-back:hover .cm-back__arrow` case.
	// The class merely has to be ONE of the selectors on the rule.
	const propsFor = (cls) => {
		const out = new Set();
		for (const m of compSrc.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
			const sels = m[1].split(',').map(s => s.trim());
			if (!sels.some(s => new RegExp('\\.' + cls + '(?![a-z0-9_-])').test(s))) continue;
			for (const d of (m[2].match(/([-a-z]+)\s*:/g) || [])) out.add(d.slice(0, -1).trim());
		}
		return out;
	};
	for (const [base, mod] of variants) {
		const b = propsFor(base), m = propsFor(mod);
		assert(m.size > 0, `.${mod} is styled by no rule whose selector names it`);
		const only = [...m].filter(p => !b.has(p));
		assert(only.length > 0,
			`.${mod} declares nothing .${base} does not, so the variant renders identically to its base`);
	}
});

	/* --- shadcn parity: the conversation family (bubble, message, marker) ---
	   Pure composition: every tone is a border/ink treatment, reactions
	   announce once as a single image, the marker icon stays decorative,
	   and the family introduces no motion, no stacking, and no rounding. */
	check('shadcn-parity: bubble, message, marker compose without hues', () => {
		const html = read('dist/index.html');
		const css = read('src/styles/components.css');

		for (const v of ['default', 'secondary', 'muted', 'tinted',
			'outline', 'ghost', 'danger'])
			assert(css.includes('.cm-bubble--' + v) || v === 'default',
				'bubble variant missing: ' + v);
		assert(/--bubble-max: 80%/.test(css), 'the documented 80% cap is not a token');
		assert(/\.cm-bubble--ghost \{[^}]*max-width: none/.test(css),
			'ghost must span the full row');
		assert(/\.cm-bubble--danger \{[^}]*inset 0 0 0 1px/.test(css),
			'danger carries the house double-rule mark');
		assert(html.includes('id="chat"'), 'no chat section');
		assert(html.includes('href="#chat"'), 'chat is not registered in the nav');
		// reactions announce ONCE - their a11y contract for emoji rows.
		// Assert BOTH rows by their own label: with one shared regex a
		// mutant that kills a single row survives behind its twin.
		assert(
			/role="img" aria-label="reacted with eyes and rocket, plus 2"/.test(html),
			'the reactions row lost its single-image label'
		);
		assert(
			/role="img" aria-label="reacted with a thumbs up"/.test(html),
			'the end-aligned reactions row lost its label'
		);
		// the marker icon stays decorative; the author supplies the role
		assert(/cm-marker__icon" aria-hidden/.test(html),
			'marker icon is not hidden from assistive tech');
		assert(html.includes('cm-bubble--end') && html.includes('cm-msg--end'),
			'end alignment is unrendered');
		assert(html.includes('cm-msg-group') && html.includes('cm-bubble-group'),
			'group wrappers are unrendered');
		// the family is pure composition: no motion, no stacking, no radius
		assert(!/\.cm-bubble[^,{]*\{[^}]*animation/.test(css),
			'bubbles must not animate');
		assert(!/\.cm-(msg|marker)[^,{]*\{[^}]*z-index/.test(css),
			'the conversation family must not stack');
		assert(!/\.cm-(bubble|msg|marker)[^,{]*\{[^}]*border-radius/.test(css),
			'sharp corners only - no radius in the chat family');
	});
	/* --- shadcn parity: attachment + questionnaire --- */
	check('shadcn-parity: attachment composes with the utilities, quiz binds', () => {
		const html = read('dist/index.html');
		const css = read('src/styles/components.css');
		const js = read('src/js/cli-mono.js');
		for (const c of ['cm-attach', 'cm-attach__media', 'cm-attach__content',
			'cm-attach__title', 'cm-attach__desc', 'cm-attach__actions',
			'cm-attach__action', 'cm-attach__trigger', 'cm-attach-group',
			'cm-attach--sm', 'cm-attach--xs', 'cm-attach--vertical',
			'cm-attach--image', 'cm-attach--uploading', 'cm-attach--processing',
			'cm-attach--error', 'cm-attach--done']) {
			assert(html.includes(c), 'attachment part unrendered: ' + c);
		}
		// the lifecycle states are styling, not colour: shimmer in flight,
		// the house double-rule on error, reason kept in the description
		assert(/cm-attach--uploading[\s\S]{0,220}cm-shimmer/.test(html),
			'uploading does not shimmer the title');
		assert(/cm-attach--error[\s\S]{0,400}failed - /.test(html),
			'error keeps its reason in text (meaning beyond colour)');
		assert(/\.cm-attach--error \{[^}]*outline: 1px solid var\(--ink\);[^}]*outline-offset: -4px;/.test(css),
			'error must carry a true double rule: two lines with a gap');
		assert(/\.cm-attach__actions \{[^}]*gap: var\(--space-2\);/.test(css),
			'the action pair keeps its breath');
		// the trigger paints above content, below actions - by paint order:
		// absolute trigger, relative actions LATER in DOM, no z-index ladder
		assert(/\.cm-attach__trigger \{[^}]*position: absolute[^}]*inset: 0/.test(css),
			'the trigger does not cover the card');
		assert(/\.cm-attach__actions \{[^}]*position: relative/.test(css)
			&& !/\.cm-attach__actions \{[^}]*z-index:\s*\d/.test(css),
			'the actions must rely on paint order, not a stacking value');
		// the media slot is a sub-frame of the card (their Media styling)
		assert(/\.cm-attach__media \{[^}]*border: 1px solid var\(--line-soft\)/.test(css),
			'the media slot lost its frame');
		// the group is scrollable, snapping and composed with the batch-15 fade
		assert(/\.cm-attach-group \{[^}]*overflow-x: auto/.test(css)
			&& /scroll-snap-align: start/.test(css),
			'the group is not a snapping scroll row');
		assert(/cm-attach-group cm-scroll-fade/.test(html),
			'the group does not compose cm-scroll-fade');
		assert(/cm-attach-group[^>]*tabindex="0"[^>]*role="group"/.test(html)
			|| /role="group"[^>]*tabindex="0"/.test(html),
			'a presentational group is not keyboard-reachable');
		for (const m of html.match(/class="cm-attach__action"[^>]*>/g) || []) {
			assert(/aria-label=/.test(m), 'icon-only attachment action without a label: ' + m);
		}
		// questionnaire: the a11y contract is fieldset+legend+progressbar
		assert((html.match(/<fieldset class="cm-quiz__item"/g) || []).length >= 3,
			'quiz items are not fieldsets');
		// EVERY item's legend must be focusable - one dead item is a dead
		// navigation step, so count them (a single-match regex hides it)
		assert((html.match(/<legend class="cm-quiz__title" tabindex="-1">/g) || []).length
			=== (html.match(/<fieldset class="cm-quiz__item"/g) || []).length,
			'an item legend is not focusable for navigation');
		assert(/role="progressbar" aria-label="Questionnaire progress"/.test(html),
			'progress is not a named progressbar');
		assert(/data-cm-quiz/.test(html), 'the quiz is not marked for init');
		// their a11y line: the freeform input needs a NAME - a placeholder
		// is not a label
		assert(/class="cm-quiz__input"[^>]*aria-label="Another answer"/.test(html),
			'the freeform answer has no accessible name');
		assert((html.match(/data-shortcut="/g) || []).length >= 5,
			'answer shortcuts are unrendered');
		assert((html.match(/class="cm-quiz__error" role="alert" hidden>/g) || []).length >= 2,
			'per-item errors must exist, be alerts, and start hidden');
		assert(js.includes('function cmInitQuiz(root)'), 'cmInitQuiz missing');
		assert(js.includes('cmInitQuiz(root);'), 'cmInitQuiz is not registered in init');
		assert(js.includes('[data-cm-quiz]'), 'the late-markup observer list omits the quiz');
		assert(js.includes("form.reset()"), 'submit must wipe with a full form.reset()');
		assert(js.includes("questionnaire submitted - "), 'submit must toast');
		// sharp corners hold for the new family
		assert(!/\.cm-(attach|quiz)[^{]*\{[^}]*border-radius/.test(css),
			'sharp corners only - no radius in attachment/quiz');
	});


/* --- shadcn parity: the message scroller --- */
check('shadcn-parity: message scroller mirrors their state contract', () => {
	const html = read('dist/index.html');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	// late markup: the observer list is the second owner of this component,
	// so forgetting the scroller there is a real regression, not a nit
	assert(/\[data-cm-quiz\], \[data-cm-scroller\],/.test(js),
		'the late-markup observer must own the scroller');
	for (const c of ['cm-scroller', 'cm-scroller__viewport', 'cm-scroller__content',
		'cm-scroller__item', 'cm-scroller__bar', 'cm-scroller__status',
		'cm-scroller__pill', 'cm-scroller__outline', 'cm-scroller__outline-title',
		'cm-scroller__link']) {
		assert(html.includes(c), 'scroller part unrendered: ' + c);
	}
	// the viewport is THEIR accessibility contract: labelled, focusable,
	// and a log so additions announce without token-by-token streaming
	assert(/class="cm-scroller__viewport" role="region" aria-label="Messages" tabindex="0"/.test(html),
		'the viewport is not a labelled focusable region');
	assert(/class="cm-scroller__content" role="log" aria-relevant="additions"/.test(html),
		'the transcript is not a live log region');
	// rows are addressable; anchors mark turn starts
	assert((html.match(/data-message-id="/g) || []).length >= 12,
		'rows are not addressable by message id');
	// every outline target must be an anchored turn - the outline IS
	// their TOC, which highlights the current anchored turn
	const outline = [...html.matchAll(/data-jump-to="([^"]+)"/g)].map((m) => m[1]);
	assert(outline.length >= 6, 'the outline lost its entries');
	for (const id of outline) {
		assert(new RegExp('data-message-id="' + id + '" data-scroll-anchor').test(html),
			'outline target is not an anchored turn: ' + id);
	}
	// controls ship in the state they claim (inert until scrolled)
	assert(/data-scroller-start data-active="false" tabindex="-1"/.test(html),
		'the start button must ship inert (nothing to scroll toward at the edge)');
	// the runtime owns the three mirrors + the commands
	for (const frag of ['data-scrollable', 'data-following', 'data-current-anchor',
		'scrollToMessage', 'scrollToEnd', 'scrollToStart', 'inert = !s',
		'data-track-visible', 'data-start-at-end']) {
		assert(js.includes(frag), 'runtime missing: ' + frag);
	}
	assert(js.includes('function cmInitScroller(root)'), 'cmInitScroller missing');
	assert(js.includes('cmInitScroller(root);'), 'not registered in init');
	assert(js.includes('[data-cm-scroller]'), 'observer list omits the scroller');
	// rows skip off-screen paint work; the frame has no hue of its own
	assert(/\.cm-scroller__item \{[^}]*content-visibility: auto/.test(css),
		'rows must opt into content-visibility');
	assert(!/\.cm-scroller[^,{]*\{[^}]*border-radius/.test(css),
		'sharp corners only in the scroller');
});

check('.cm-tag survives a word too long for its column', () => {
	// Measured in WebKit at 390 and 320: a long single-word tag laid out at
	// its max-content width and pushed 26px past a 220px row, because
	// inline-flex is a BFC root and nothing let the word break. Three
	// declarations are load-bearing and only work together.
	const rule = /^\.cm-tag \{([^}]*)\}/m.exec(compSrc);
	assert(rule, 'no .cm-tag rule found');
	const body = rule[1];
	for (const decl of ['min-width:\\s*0', 'max-width:\\s*100%', 'overflow-wrap:\\s*break-word']) {
		assert(new RegExp(decl).test(body),
			`.cm-tag lost ${decl} — a long tag overflows its column without it`);
	}
	// `break-word` and NOT `anywhere`: anywhere also shrinks min-content
	// sizing, which starves a value column, and splits `.cm-*` identifiers
	// mid-token. A sibling check bans it; this pins the right replacement.
	assert(!/overflow-wrap:\s*anywhere/.test(body),
		'.cm-tag uses overflow-wrap:anywhere, which shrinks min-content sizing and splits identifiers');
	// The showcase must prove the case with a specimen that is actually
	// long, or the rule is defending against nothing and can be deleted.
	assert(/cm-tag[^"]*">infrastructureascodeverylong/.test(surfaceSection),
		'the variants section must render a genuinely long tag');
});

/* ================= state chip =================
   Added because a real consumer needed it and could not build it from the
   library. hermes-hearth's console carries four states (ok/warn/err/idle)
   in a hand-rolled .pill family whose ONLY differentiator is hue, on a
   palette the library declares greyscale. So the chip is not a convenience
   wrapper around .cm-tag: it is the rule that a state must carry a second,
   non-hue cue. The checks below are the ways that can fail. */
console.log('\nstate chip');

// Scoped to the chip's own block on purpose. A bare content search, or a
// class-name substring, is satisfied by .cm-status and .cm-toast, which
// carry the same three glyphs - so a chip that dropped its content
// ENTIRELY would still pass, because its siblings say it.
//
// `[^}]*` cannot span to the base rule: `.cm-chip::before` is its own block,
// and a regex loose enough to find it from the variants section would find
// .cm-status's content instead. Anchored, then the content read from inside
// the captured body.
// The escape set is written as `[.*+?^$|]` plus a separately-escaped `[` and
// `]` - a character class cannot contain its own brackets unescaped, and
// `/[.*+?^${}()|[\]\\]/g` is the form that actually works. Getting that
// wrong produces a regex that matches nothing, which here reads as "no
// rule found" rather than "broken helper" - a NO-OP masquerading as a
// verdict. (A real one, hit while writing this check.)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chipGlyphOf = (selector) => {
	const m = new RegExp('^' + escapeRe(selector) + '\\s*\\{([^}]*)\\}', 'm').exec(compSrc);
	if (!m) return null;
	const g = /content:\s*'([^']+)'/.exec(m[1]);
	return g ? g[1] : null;
};

check('a state chip carries a non-hue cue, not just a colour step', () => {
	// The whole reason the block exists. A chip that differentiates only by
	// brightness is invisible on a greyscale screen, in a print, and to a
	// reader with deuteranopia - and it is the answer every consumer
	// invents by default, which is why it is worth a test.
	// The base chip has NO glyph, and that is the design: a state-free chip
	// has no state to signal. So "no ::before rule" and "a ::before rule
	// with no content" are different verdicts, and conflating them reports a
	// correct component as missing one. `chipGlyphOf` returns the content or
	// null; the base is asserted to have the RULE, and its three variants to
	// have the CONTENT.
	const hasChipBeforeRule = new RegExp('^' + escapeRe('.cm-chip::before') + '\\s*\\{', 'm').test(compSrc);
	const glyphs = new Set();
	assert(hasChipBeforeRule,
		'no .cm-chip::before rule found, so no variant can hang a glyph off it');
	for (const v of ['--ok', '--warn', '--err']) {
		const g = chipGlyphOf(`.cm-chip${v}::before`);
		assert(g, `.cm-chip${v} has no ::before content, so it differs from its base by colour alone`);
		glyphs.add(g);
	}
	assert(glyphs.size === 3,
		`the three states share ${glyphs.size} distinct glyph(s) (${[...glyphs]}) - a state that looks like another state is not a state`);
});

check('a state chip cannot fall below the 12px text floor', () => {
	// A chip lives in a table cell, which is dense by definition, and the
	// size every other inline mark in the system uses is 0.7rem - 11.2px
	// at the default 16px root, UNDER --min-font. A chip that inherits it
	// is sub-floor in the one place a consumer will never think to look.
	// Asserted against the TOKEN, not 12px, so a retune of --min-font does
	// not leave the chip pinned to a number that no longer means anything.
	// The rule is FLOORING A SCALE TOKEN, not a literal: the token
	// carries the value and the floor keeps it honest. Pinning the
	// literal (as this check did) meant it broke the moment the scale
	// was introduced, and it was reading a number that no longer
	// described anything.
	const rule = /^\.cm-chip \{([^}]*)\}/m.exec(compSrc);
	assert(rule, 'no .cm-chip base rule found');
	const fs = /font-size:\s*max\(\s*var\(--min-font\)\s*,\s*(var\(--[a-z0-9-]+\))\s*\)/.exec(rule[1]);
	assert(fs, '.cm-chip must floor its font-size at var(--min-font) via max()');
	assert(fs[1], '.cm-chip must size itself from the type scale, not a raw rem literal');
	// ...and the step it names must itself sit at or above the floor.
	const step = resolveSize(fs[1]);
	const floor = resolveSize('12px');
	assert(step >= floor,
		`.cm-chip names ${fs[1].trim()} = ${step}px, which is under the ${floor}px floor`);
	// The same floor the rest of the system asserts, so the two cannot
	// disagree about what the floor is.
	assert(/--min-font:\s*12px/.test(tokenSrc),
		'--min-font is not 12px; the chip floor is only meaningful against this value');
});

check('a chip is a mark by default and a control only when it is the target', () => {
	// The one place in this repo where the obvious "make it 44px like
	// everything else" edit is WRONG, so it gets a test. Measured in
	// WebKit at 390px inside a real .cm-table cell: a bare chip is 22.4px
	// and the row is 39.6px; adding min-height:var(--tap) makes the chip
	// 44px and the row 60.5px. +53% of row height, in exchange for making
	// a mark look tappable. WCAG 2.5.8 exempts a target whose size is
	// constrained by the line-height of the non-target text around it,
	// which is exactly a chip inside a table cell.
	//
	// So the base must NOT carry the floor, and the INTERACTIVE form must.
	// Both halves, because "no floor anywhere" and "floor everywhere" are
	// each a real way to get this wrong.
	const base_ = /^\.cm-chip \{([^}]*)\}/m.exec(compSrc);
	assert(base_, 'no .cm-chip base rule found');
	assert(!/min-height:\s*var\(--tap\)/.test(base_[1]),
		'.cm-chip must not carry the --tap floor: measured, it inflates a status row by 53%');
	assert(/display:\s*inline-flex/.test(base_[1]), '.cm-chip must stay an inline-flex box');

	// The escape hatch for a chip that IS the target. Without it, a
	// consumer with a tappable chip has to hand-write the floor, and the
	// obvious place they write it is on the base - which is the bug above.
	const act = /^\.cm-chip--action \{([^}]*)\}/m.exec(compSrc);
	assert(act, 'no .cm-chip--action rule found');
	assert(/min-height:\s*var\(--tap\)/.test(act[1]),
		'.cm-chip--action must reach var(--tap) from the token, not a hardcoded 44px');
	assert(!/min-height:\s*44px/.test(act[1]),
		'.cm-chip--action hardcodes 44px, so a retune of --tap leaves it at the old size');
});

check('every chip variant is demonstrated against its own base', () => {
	// The presence-only trap: a chip variant can be in the markup, in the
	// CSS, and still render exactly like its base. Reuse the variants
	// table's mechanism rather than a presence assertion.
	//
	// The class ATTRIBUTE is parsed, not regex-matched. `\b` is useless on a
	// BEM name because `_` is a word character, so a boundary-delimited
	// search for `cm-chip--ok` also matches inside `cm-chip--okay`; and an
	// unordered one matches a chip in some OTHER element's class list.
	// Split the attribute and compare tokens, which is the same discipline
	// the reachability check uses on the built page.
	const renderedVariants = new Set();
	for (const m of surfaceSection.matchAll(/class="([^"]*)"/g)) {
		const toks = m[1].split(/\s+/);
		if (toks.includes('cm-chip')) toks.filter(t => t.startsWith('cm-chip--')).forEach(t => renderedVariants.add(t));
	}
	for (const v of ['cm-chip--ok', 'cm-chip--warn', 'cm-chip--err', 'cm-chip--set']) {
		assert(renderedVariants.has(v),
			`${v} is not rendered on an element that also carries cm-chip in the variants section ` +
			`(found: ${[...renderedVariants].join(', ') || 'none'})`);
	}
	// And the plain base, so "state vs no state" is a comparison the page
	// can actually make.
	assert(/class="cm-chip">/.test(surfaceSection),
		'the variants section must render a plain .cm-chip to compare the states against');
	// --action is the fourth form, and it is the one a reviewer is most
	// likely to believe is just a styling hint.
	assert(renderedVariants.has('cm-chip--action'),
		'cm-chip--action is not demonstrated, so the tap-floor escape hatch is a promise');
});

check('a chip modifier that renders like its base is not a modifier', () => {
	// The presence check above is necessary and not sufficient, and the gap
	// is real: `.cm-chip--set` declared `border-style: dashed` AND
	// `color: var(--ink-dim)`, the latter of which its base also declares.
	// Deleting the dashed border leaves the modifier with declarations, so a
	// "is it rendered with its base" assertion still passes while the chip
	// is visually identical to the plain one. That is the same
	// "declares nothing its base does not" idea the variants table
	// already applies to cm-tag/cm-status, applied to the family that was
	// added this cycle.
	const chipBase = (() => {
		const m = /^\.cm-chip \{([^}]*)\}/m.exec(compSrc);
		assert(m, 'no .cm-chip base rule found');
		return new Set(m[1].split(';').map((d) => d.trim()).filter(Boolean));
	})();
	// A modifier may hang its difference off the ELEMENT (--set) or off a
	// pseudo-element (--ok's ::before glyph), and both are real variants.
	// Requiring a bare `.cm-chip--ok { }` block would report the three
	// glyph states as unstyled, which is the same false negative as a
	// class-scoped search that ignores at-rules: the selector exists, it
	// just has a ::before on it.
	for (const v of ['cm-chip--ok', 'cm-chip--warn', 'cm-chip--err', 'cm-chip--set', 'cm-chip--action']) {
		const sel = '.' + v;
		const hasOwn = new RegExp('^' + escapeRe(sel) + '\\s*\\{', 'm').test(compSrc);
		const hasBefore = new RegExp('^' + escapeRe(sel + '::before') + '\\s*\\{', 'm').test(compSrc);
		assert(hasOwn || hasBefore, `no rule styles .${v}, by element or by ::before`);
		if (!hasOwn) continue; // the glyph variant; asserted by the glyph check
		const m = new RegExp('^' + escapeRe(sel) + ' \\{([^}]*)\\}', 'm').exec(compSrc);
		const decls = m[1].split(';').map((d) => d.trim()).filter(Boolean);
		const only = decls.filter((d) => !chipBase.has(d));
		assert(only.length > 0,
			`.${v} declares nothing .cm-chip does not, so it renders identically to its base`);
	}
});

check('a chip in a table cell cannot widen the table past the viewport', () => {
	// The reason .cm-tag needed min-width/max-width/break-word: an
	// inline-flex is a BFC root, so a long single word lays out at its own
	// max-content width and pushes past the column. A chip repeats that
	// shape. white-space:nowrap means the chip itself will not break, so it
	// has to be allowed to SHRINK instead - otherwise one long state name
	// drags the whole table sideways, the defect this library already
	// fixed once in .cm-table-wrap.
	const rule = /^\.cm-chip \{([^}]*)\}/m.exec(compSrc);
	assert(rule, 'no .cm-chip base rule found');
	assert(/max-width:\s*100%/.test(rule[1]),
		'.cm-chip needs max-width:100% so a long state name cannot widen its column');
	assert(/white-space:\s*nowrap/.test(rule[1]),
		'.cm-chip must be nowrap: a state name that wraps inside a chip breaks the cell rhythm');
});

/* ================= the bare icon button ================= */
console.log('\nbare icon button');

check('.cm-icon-btn--bare is a defined, demonstrated variant', () => {
	// A class in components.css that no page renders is dead code the next
	// person cannot trust, so the demonstration is part of the contract,
	// not a nicety. Read the BUILT page: a showcase edit that never reached
	// dist/ builds fine and demonstrates nothing.
	assert(/^\.cm-icon-btn--bare\s*\{/m.test(compSrc),
		'.cm-icon-btn--bare is not defined in components.css');
	const built = existsSync(join(root, 'dist/index.html'))
		? readFileSync(join(root, 'dist/index.html'), 'utf8') : '';
	assert(built.includes('cm-icon-btn--bare'),
		'the built showcase renders no .cm-icon-btn--bare, so the variant is undocumented in practice');
});

check('.cm-icon-btn--bare renders DIFFERENTLY from its base', () => {
	// Presence in the stylesheet is not a variant. The failure this guards
	// is the one .cm-chip--set hit: a modifier that declares a property its
	// base also declares is visually identical to the base, so every
	// consumer swapping to it changes nothing and the migration is a no-op
	// that still looks like an adoption.
	//
	// Read the VALUE, and read it from the bare rule - not "does this
	// selector's block mention border", which the base's own block also
	// satisfies at a different class.
	const stripped = compSrc.replace(/\/\*[\s\S]*?\*\//g, '');
	const base = /^\.cm-icon-btn \{([^}]*)\}/m.exec(stripped);
	assert(base, 'no .cm-icon-btn base rule found');
	const bare = /^\.cm-icon-btn--bare \{([^}]*)\}/m.exec(stripped);
	assert(bare, 'no .cm-icon-btn--bare rule found');
	const baseDecls = new Set(base[1].split(';').map((d) => d.trim()).filter(Boolean));
	const only = bare[1].split(';').map((d) => d.trim()).filter(Boolean)
		.filter((d) => !baseDecls.has(d));
	assert(only.length > 0,
		'.cm-icon-btn--bare declares nothing .cm-icon-btn does not, so it renders identically to its base');
	// The specific difference, asserted as values: the whole point of the
	// variant is that it has NO frame, and the base has a 1px one.
	assert(/border:\s*0/.test(bare[1]),
		'.cm-icon-btn--bare must set border:0 - the variant exists to drop the frame');
	assert(/border:\s*1px/.test(base[1]),
		'.cm-icon-btn no longer has a 1px border, so --bare has nothing to drop');
});

check('an icon button cannot be shrunk below its own target', () => {
	// The flex-shrink trap, which NO stylesheet-reading check can see.
	//
	// Measured in WebKit at 390px: with `width: var(--tap)` correctly
	// applied in the coarse-pointer block, the bare toggle still rendered
	// 37.89x44. `.cm-spec__sample` is `flex: 1; min-width: 0` and the button
	// inherited the default `flex-shrink: 1`, so a tight row squeezed the
	// box BELOW its declared width. The declaration was applied and then
	// overridden by layout - reading the CSS reports the fix as present
	// while the page renders a 44-tall, 38-wide pill.
	//
	// So the rule must not allow the control to give way. A control whose
	// size IS the measurement cannot be the thing that shrinks. This is the
	// same reasoning the file already applies to .cm-spec children.
	//
	// A comment is NOT a declaration. The first version of this check
	// matched the rule body with a plain `[^}]*`, so the comment directly
	// above the declaration - which QUOTES `flex: 0 0 auto` while explaining
	// the fix - satisfied the assertion. Deleting the declaration left the
	// suite green and the mutation reading MISSED, on exactly the trap this
	// file has been bitten by three times. Strip comments, and anchor on the
	// rule that NAMES the class so a sibling rule cannot stand in for it.
	const cls = '.cm-icon-btn';
	// Parse the file once, comments gone, and find the rule whose OWN
	// selector is this class - a compound or descendant selector names it
	// conditionally, which is not the rule being asserted on.
	const rule = new RegExp('(^|\\})\\s*' + escapeRe(cls) + '\\s*\\{([^}]*)\\}', 'm')
		.exec(compSrc.replace(/\/\*[\s\S]*?\*\//g, ''));
	assert(rule, `no ${cls} base rule found in components.css`);
	assert(/(^|;)\s*flex:\s*0 0 auto\s*(;|$)/.test(rule[2]),
		`${cls} has no flex: 0 0 auto - measured at 37.89x44 in WebKit, because a flex row shrank the box below its own declared width`);
});

check('the bare icon button pins BOTH dimensions on a coarse pointer', () => {
	// THE TAP FLOOR NEEDS BOTH DIMENSIONS, and this is the case that proves
	// it. Measured in WebKit at an iPhone viewport against the two live
	// sites: links.oem.ngo and log.oem.ngo both served a theme toggle
	// measuring 32x44 - base.css's coarse-pointer block gives `button` a
	// min-height: var(--tap), and the hand-rolled class declared width and
	// height but no coarse-pointer override, so the floor stretched the box
	// on one axis only. Tall enough to pass a height-only check, still 12px
	// too narrow to hit comfortably.
	//
	// So the override must set BOTH width and height, and it must name the
	// VARIANT rather than the base class. A check that asked only "is there
	// a min-height from --tap" passes on a 44x32 pill, which is the bug.
	const rules = rulesFor('cm-icon-btn--bare');
	assert(rules.length > 0,
		'.cm-icon-btn--bare has no pointer:coarse rule of its own, so a consumer keeping a hardcoded width gets a 44x32 pill - exactly what the two live sites measured');
	for (const [, , body] of rules) {
		assert(/width:\s*var\(--tap\)/.test(body),
			'.cm-icon-btn--bare must pin WIDTH from --tap too, not only height');
		assert(/height:\s*var\(--tap\)/.test(body),
			'.cm-icon-btn--bare must pin HEIGHT from --tap');
		// A hardcoded 44 measures right and is still wrong: a consumer that
		// retunes --tap would be stuck at the old size.
		assert(!/width:\s*\d+px/.test(body),
			'a hardcoded px width ignores --tap; the floor must come from the token');
	}
});

check('the bare icon button reaches the tap floor like every other control', () => {
	// The generic sweep asserts the floor for a fixed list of classes. The
	// bare variant is on a <button>, so it inherits base.css's element
	// floor - but it also carries its own box, and the list is the only
	// thing keeping a new interactive class from being added without a
	// tap-target claim. Add it explicitly rather than trusting inheritance
	// silently, and pin the element it is rendered as.
	assert(INTERACTIVE.includes('cm-icon-btn--bare'),
		'cm-icon-btn--bare is interactive and must be in the INTERACTIVE list the tap sweep checks');
});

/* ================= auth surfaces =================
   A sign-in screen is the card, the field, the alert and the button the
   showcase already demonstrates, arranged for credentials. The first
   draft of this surface invented a parallel vocabulary alongside all of
   them (.cm-login__field, __label, __error, __submit, .cm-submit,
   .cm-totp, .cm-pass, .cm-user) - the exact duplication the migration
   rules warn about, where a fix in one place never reaches the other.
   These checks make the composition structural rather than advisory. */

// Comment-stripped source, because every assertion below is a claim about
// a DECLARATION and prose in this file discusses those declarations by
// name. A check that can be satisfied by a comment is a check that
// reports green forever.
const compNoComment = comp.replace(/\/\*[\s\S]*?\*\//g, '');
const baseNoComment = base.replace(/\/\*[\s\S]*?\*\//g, '');

check('the auth card head and body share one left edge', () => {
	// The card carries the padding, so BOTH children must give it up.
	// Zeroing only the head left the title 16px left of the first
	// field - measured in WebKit at 390px and 1100px, in both cards. A
	// heading that does not line up with the form under it reads as a
	// rendering fault even when every other edge is right.
	//
	// The bug was invisible to a screenshot's caption and obvious to a
	// measurement, which is the whole reason this is a check.
	const body = (compNoComment.match(/\.cm-card--auth[^}]*\{([^}]*)\}/g) || []).join('\n');
	assert(body !== '', '.cm-card--auth is missing from components.css');
	assert(/\.cm-card--auth\s+\.cm-card__body\s*\{[^}]*padding:\s*0/.test(compNoComment),
		'the auth card body must zero its own padding, or it sits 16px inside the head');
	// The descendant form is load-bearing: a bare `.cm-card__head`
	// would flatten the padding of EVERY card on the site. A PRESENCE
	// check is worthless here - deleting the scoped rule leaves the
	// unscoped one, and the scoped selector still appears in the
	// `.cm-card--auth .cm-card__head,` line of the shared group.
	//
	// It must also be about the DECLARATION, not the selector: the
	// base `.cm-card__head { ... }` is legitimate and must not trip
	// this. So scan each rule body for the padding reset, and require
	// the selector carrying it to be scoped.
	const zeroed = [];
	for (const m of compNoComment.matchAll(
		/(^|\n)([^{}\n]*?)\s*\{([^}]*)\}/g)) {
		if (!/\bpadding:\s*0\b/.test(m[3])) continue;
		const sel = m[2].trim();
		if (sel.includes('.cm-card__head') || sel.includes('.cm-card__body')) {
			zeroed.push(sel);
		}
	}
	for (const sel of zeroed) {
		for (const part of ['.cm-card__head', '.cm-card__body']) {
			if (sel.includes(part)) {
				assert(sel.startsWith('.cm-card--auth'),
					`${part} has padding:0 under an UNSCOPED selector (${sel}), which flattens every card on the site`);
			}
		}
	}
	assert(zeroed.length >= 1, 'no padding:0 reset found for the auth card parts at all');
});

check('the auth surface composes existing components instead of re-declaring them', () => {
	// STRUCTURAL, not a list of names. The first version enumerated the
	// seven names the first draft happened to use and matched them with
	// /\.cm-login[\s{,]/ - which cannot match `cm-login__field` at all,
	// because `_` is a word character and the character after `cm-login`
	// is an underscore, not a space. Three mutations sailed straight
	// through it, including a differently-NAMED private class.
	//
	// The real invariant: the auth block may define a class ONLY if it
	// is one of the new auth surface, or if that class is also defined
	// elsewhere in the layer (i.e. it is a deliberate override of an
	// existing component, not a new private name). A new block family
	// introduced here is a second vocabulary by definition, whatever it
	// is called.
	const ALLOWED_NEW = new Set([
		'cm-auth', 'cm-auth--wide', 'cm-card--auth', 'cm-code-input', 'cm-divider',
	]);
	const block = compNoComment.slice(compNoComment.indexOf('.cm-auth {'));
	assert(block !== '', 'the auth block is missing from components.css');
	const rest = compNoComment.slice(0, compNoComment.indexOf('.cm-auth {'));
	const definedIn = (cls, src) =>
		new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}[\\s,{:]`).test(src)
		|| new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}\\s*:`).test(src);

	const privateNames = new Set();
	for (const m of block.matchAll(/\.(cm-[a-z0-9_-]+)/g)) {
		const c = m[1];
		// A class this block DEFINES (selector position, followed by a
		// combinator or brace) and does not also define elsewhere. The
		// allowlist must cover the VARIANT too: `cm-auth--wide` is a
		// sibling of `cm-auth`, and a regex that matched only the base
		// name reported the new surface as a private vocabulary.
		if (!/^cm-(auth|code-input|divider)(--[a-z0-9-]+)?$/.test(c)
			&& c !== 'cm-card--auth'
			&& !definedIn(c, rest) && !definedIn(c, block.slice(0, m.index))) {
			privateNames.add(c);
		}
	}
	assert(privateNames.size === 0,
		`the auth block defines a private vocabulary instead of composing the system: ${[...privateNames].join(', ')}`);

	// And the same claim about the showcase: a section may only use
	// classes the layer actually defines. `cm-submit` is gone from the
	// CSS, so a button still carrying it is a consumer of a dead name.
	const section = showcase.slice(showcase.indexOf('id="auth"'), showcase.indexOf('id="readme"'));
	assert(section !== '', 'the auth section is missing from the showcase');
	for (const m of section.matchAll(/class="([^"]*)"/g)) {
		for (const tok of m[1].split(/\s+/)) {
			if (!/^cm-[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*$/.test(tok)) continue;
			assert(definedIn(tok, compNoComment) || tok === 'cm-js',
				`the auth section uses .${tok}, which components.css does not define - it is a dead or private name`);
		}
	}
});

check('the code field cannot re-break the 16px form-text floor', () => {
	// iOS zooms the viewport on focus for any form text under 16px, and
	// the whole page is unreadable at that zoom. The base input rule is
	// max(var(--min-font), 1rem) = 16px.
	//
	// Note the shape of the claim. The first version asserted that
	// .cm-code-input DECLARES that font-size, which is the opposite of
	// the truth: it is (0,1,0) and LOSES to the base rule's (0,3,1), so
	// any font-size it declares is dead code. Verified in WebKit at
	// 390px - deleting all ten restated properties left every computed
	// value byte-identical and the box still 201.63x44. So the invariant
	// is the opposite one: the class must NOT declare a font-size at
	// all, and must inherit the floor from the element default.
	const body = (compNoComment.match(/\.cm-code-input\s*\{([^}]*)\}/) || [, ''])[1];
	assert(body !== '', '.cm-code-input is not defined in components.css');
	assert(!/font-size/.test(body),
		'cm-code-input declares a font-size; it is (0,1,0) and loses to the base (0,3,1) input rule, so it is dead');
	// And the floor it inherits must still be the 16px form one.
	//
	// The selector is matched with the `:not(...)` chain REDUCED to a
	// wildcard-per-argument form, because the chain is not fixed: it
	// grows every time a component claims an input the base layer sizes
	// (`--inline__input`, then `--search__input`). Hard-coding the exact
	// chain made this test fail the moment the search field was added,
	// which is the signature of a probe watching a shape rather than a
	// rule. `(?:...)*` keeps the invariant (still the base INPUT rule,
	// still the one carrying the floor) while tolerating a longer chain.
	// The char class MUST include `_` and digits: BEM element names carry a
	// double underscore (`.cm-search__input`), and `[a-z-]` silently stops
	// at the first one, so the pattern fails on the very selector this
	// rewrite exists to tolerate. That is a probe that reads as "the base
	// rule is gone" when the base rule is fine.
	//
	// Every repeated group needs its OWN colon inside the `(?:` - the form
	// is `(?::not\(...\))*`, not `(?:not\(...\))*`. The latter is a
	// well-formed regex that simply matches the literal text "not(", so the
	// pattern returns null and the check reports "the base rule is gone"
	// with the rule sitting right there in the file. Measured: this exact
	// typo cost three rebuild cycles before it was read out char by char.
	const base = baseNoComment.match(/input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)(?::not\(\.[a-z0-9_-]+\))*\s*,\s*textarea(?::not\(\.[a-z0-9_-]+\))*\s*,\s*select(?::not\(\.[a-z0-9_-]+\))*\s*\{([^}]*)\}/);
	assert(base, 'the base input selector was not found; this test is watching the wrong rule');
	assert(/font-size:\s*max\(var\(--min-font\),\s*1rem\)/.test(base[1]),
		'the base input rule no longer carries the 16px form-text floor the code field inherits');
});

check('the code field states only what differs, and nothing it cannot win', () => {
	// A restated property here is not merely redundant - it is DEAD,
	// because this (0,1,0) class loses to the base input rule's (0,3,1)
	// (:not() counts its argument). Ten of them shipped in the first
	// draft. Any property that is not a real difference from a prose
	// field is a copy of the element default that can only drift.
	const body = (compNoComment.match(/\.cm-code-input\s*\{([^}]*)\}/) || [, ''])[1];
	for (const prop of ['font-family', 'color:', 'background', 'border',
		'border-radius', 'padding', 'width:', 'line-height', 'font-size']) {
		assert(!body.includes(prop),
			`cm-code-input restates ${prop}; the base input default owns it and a (0,1,0) class cannot win the cascade`);
	}
	// The three that genuinely differ from a prose field, and the tap
	// floor. These are what the class is FOR.
	for (const [prop, why] of [
		['min-height: var(--tap)', 'the code field is a primary target, typed with a thumb'],
		['text-align: center', 'a code read digit by digit must not read as a sentence'],
		['letter-spacing', 'the digits need to be separable at a glance'],
	]) {
		assert(body.includes(prop.replace(' var(--tap)', '')),
			`cm-code-input must keep ${prop} - ${why}`);
	}
	assert(/min-height:\s*var\(--tap\)/.test(body),
		'the code field must reach the tap floor from the token, not a literal');
});

check('the check row is the tap target, not the 17px box', () => {
	// The library already draws `input[type=checkbox]` down to the tick, so
	// the control is correct with no class at all. The gap this fills is the
	// ROW: measured at 390px, a 1.05rem box is a target you can miss, and
	// the word beside it is what a person actually aims at. That only works
	// if the label itself carries the floor and the pointer.
	const row = (compSrc.match(/\.cm-check\s*\{([^}]*)\}/) || [, ''])[1];
	assert(row, '.cm-check is not defined');
	assert(/min-height:\s*var\(--tap\)/.test(row),
		'the row must carry the tap floor; without it the only target is a 17px box and the word is dead space');
	assert(/cursor:\s*pointer/.test(row),
		'the row is the control, so it must advertise that it can be clicked');
	assert(/display:\s*flex/.test(row) && /align-items:\s*center/.test(row),
		'the box and the label must sit on one optical line, or a 17px box reads as sitting above the text');
	assert(/gap:\s*var\(--space-/.test(row),
		'the gap between box and word is a step on the scale, not a number');
	// A hover that lightens the box but not the word leaves the affordance
	// on the part that is not the target.
	assert(/cm-check:hover[^{]*\{[^}]*color:\s*var\(--ink\)/.test(compSrc),
		'hover must lighten the LABEL too; highlighting only the box points at the part that is hard to hit');
});

/* A z-index may be a named layer now (`var(--z-header)`) rather than a
   literal. Resolve it through tokens.css instead of narrowing the
   assertion to digits: a literal-only regex fails on the correct
   tokenised form AND cannot catch the defect that actually matters -
   a reference to a token nobody defines, which the browser silently
   drops to `auto`. Resolving catches both. */
const resolveLayer = (raw, where) => {
	const value = String(raw).trim();
	const m = /var\(\s*(--[\w-]+)\s*\)/.exec(value);
	if (!m) {
		const n = Number(value);
		if (!Number.isFinite(n))
			throw new Error(`${where}: z-index "${value}" is neither a number nor a var()`);
		return n;
	}
	const tokens = read('src/styles/tokens.css');
	const tok = tokens.match(new RegExp(m[1] + ':\\s*(-?\\d+)\\s*;'));
	if (!tok)
		throw new Error(`${where}: ${m[1]} is not defined in tokens.css, so the browser drops this z-index to auto`);
	return Number(tok[1]);
};

check('the action toolbar sticks to the bottom and survives a scroll', () => {
	// The count lives at the top of the page and the actions belong where the
	// thumb already is, so this bar is bottom-sticky. Everything else here is
	// the part a consumer gets wrong when it writes this shape by hand: a
	// border strong enough to read as a separate surface (it FLOATS over the
	// list, so it needs an edge that survives a dark page), and a z-index,
	// because sticky without one is painted under the rows it covers.
	const bar = (compSrc.match(/\.cm-toolbar\s*\{([^}]*)\}/) || [, ''])[1];
	assert(bar, '.cm-toolbar is not defined');
	assert(/position:\s*sticky/.test(bar) && /bottom:\s*0/.test(bar),
		'the toolbar must stick to the BOTTOM; a top-sticky bar pushes the selection count off screen');
	// `z-index: auto` contains the substring "z-index", so a presence check
	// passes on exactly the value that removes the stacking. The claim is that
	// it is a NUMBER above the content it covers.
	const barZ = /z-index:\s*([^;]+);/.exec(bar);
	assert(barZ, 'a sticky bar needs a z-index; sticky without one is painted under the list it covers');
	const z = resolveLayer(barZ[1], '.cm-toolbar');
	assert(z >= 1,
		`a sticky bar must resolve to a z-index above the rows (>= 1); got ${z}`);
	assert(/box-shadow:\s*var\(--/.test(bar),
		'a floating bar needs a themed shadow, not a hardcoded rgb(); on a dark page a hardcoded one disappears');
	assert(/border:\s*1px solid var\(--ink-dim\)/.test(bar),
		'the bar floats over content, so its border must be the strong edge, not the faint one');
	// The count is how the user knows what they are about to act on.
	assert(/aria-live|role="toolbar"/.test(JSON.stringify(showcase)) || /cm-toolbar__count/.test(showcase),
		'the showcase must render the count, or the bar is a row of anonymous buttons');
	const count = (compSrc.match(/\.cm-toolbar__count\s*\{([^}]*)\}/) || [, ''])[1];
	assert(count && /color:\s*var\(--ink-dim\)/.test(count),
		'the count is a label, not a value: it must read dim, or it competes with the buttons beside it');
});

check('the inline-edit display half is an affordance, not a box', () => {
	// The claim: a value you can change in place announces itself with a
	// dotted underline and a text cursor, NOT with a border and padding on
	// every cell. A box per cell turns a table into a form, and the editing
	// affordance disappears into the chrome. Each mutation below deletes one
	// of the three parts that make that true.
	const disp = (compSrc.match(/\.cm-inline\s*\{([^}]*)\}/) || [, ''])[1];
	assert(disp, '.cm-inline is not defined');
	assert(/border-bottom:\s*1px dotted/.test(disp),
		'the display half must carry the dotted underline; without it the value reads as static text');
	assert(/cursor:\s*text/.test(disp),
		'the display half must set a text cursor, or it does not advertise that it is editable');
	// `max-width: none` still contains the substring "max-width", so a
	// presence check passes on the very value that removes the bound. The
	// claim is that it is BOUNDED, which means a length, not a keyword.
	assert(/text-overflow:\s*ellipsis/.test(disp), 'the display half must ellipsize');
	assert(/max-width:\s*[\d.]+rem/.test(disp),
		'the display half must be bounded by a LENGTH; max-width: none is not a bound, and a long value then pushes the row wider than the viewport');
	// The wide measure is for a hostname; the default is for a label.
	const wide = (compSrc.match(/\.cm-inline--wide\s*\{([^}]*)\}/) || [, ''])[1];
	assert(wide && /max-width:\s*32rem/.test(wide),
		'the wide variant must be wider than the default measure');
});

check('the editing half inherits the field treatment', () => {
	// The input REPLACES the span in place. If it does not carry a box, a
	// border and the ink, the value changes size and contrast the instant
	// you click it - the row jumps under the pointer mid-edit.
	// Anchored to line start: a derived selector (e.g. `.cm-inline:has(> .cm-icon-btn)`
	// `.cm-inline__input`) also contains `.cm-inline__input {` and would otherwise be
	// matched FIRST, letting a new layout rule silently answer for the base one.
	const inp = (compSrc.match(/^\.cm-inline__input\s*\{([^}]*)\}/m) || [, ''])[1];
	assert(inp, '.cm-inline__input is not defined');
	assert(/border:\s*1px solid/.test(inp),
		'the editing half needs a box; a bare field on a bare cell is not clickable');
	assert(/max-width:\s*inherit/.test(inp),
		'the editing half must inherit the display half\'s measure, or the value changes width on edit');
	assert(/font:\s*inherit/.test(inp),
		'the editing half must inherit the font, or the row changes height mid-edit');
});

check('a selected row is a left rule and a tint, not an outline', () => {
	// The whole point of the class is that the three declarations below are
	// what distinguish it from its base. A suite that only proves the class
	// EXISTS and RENDERS lets every one of them be deleted in silence.
	const rule = (compSrc.match(/\.cm-section--on\s*\{([^}]*)\}/) || [, ''])[1];
	assert(rule, '.cm-section--on is not defined');
	assert(/box-shadow:\s*inset 3px 0 0/.test(rule),
		'a selected row needs the inset left rule; an outline would compete with the row\'s own border');
	assert(/background:\s*var\(--bg-2\)/.test(rule),
		'a selected row needs a tint distinct from the panel background');
});

check('the state mark reads on and off by weight, not by hue', () => {
	const off = (compSrc.match(/\.cm-dot\s*\{([^}]*)\}/) || [, ''])[1];
	const on = (compSrc.match(/\.cm-dot--on\s*\{([^}]*)\}/) || [, ''])[1];
	assert(off, '.cm-dot is not defined');
	assert(on, '.cm-dot--on is not defined');
	assert(/background:\s*transparent/.test(off),
		'the "off" mark must be hollow, or it is indistinguishable from "on" in greyscale');
	assert(/background:\s*var\(--ink\)/.test(on),
		'the "on" mark must be FILLED; weight, not hue, is what carries the state');
	// A mark nobody can see is not a mark.
	assert(/width:\s*0\.5rem/.test(off) && /height:\s*0\.5rem/.test(off),
		'the state mark must be large enough to read at a glance');
});

check('the auth frame owns the measure on its child, not on itself', () => {
	// A max-width on the FRAME fights the padding: with `width: 100%`
	// plus padding and a max-width, the box overflows its own padding
	// by exactly the difference. Putting the measure on the child means
	// the frame can only ever hand out a card that fits inside it.
	const frame = (compNoComment.match(/\.cm-auth\s*\{([^}]*)\}/) || [, ''])[1];
	assert(!/max-width/.test(frame),
		'.cm-auth declares max-width; the measure belongs on its child so the padding cannot be fought');
	const child = (compNoComment.match(/\.cm-auth > \*\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/max-width:\s*26rem/.test(child),
		'the auth child must carry the standard measure');
	assert(/\.cm-auth--wide > \*\s*\{\s*max-width:\s*34rem/.test(compNoComment),
		'the wide variant must widen the CHILD, not the frame');
});

check('the divider rules are flex-grown, not a border on the label', () => {
	// A border-top on the label itself leaves the label's own box above
	// the line, so the rule is flush with the text top and reads as a
	// strike-through. Two flex children that grow put the line on the
	// optical centre of the row.
	const body = (compNoComment.match(/\.cm-divider\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/display:\s*flex/.test(body), '.cm-divider must be a flex row to centre the label');
	assert(/align-items:\s*center/.test(body), '.cm-divider must centre the label on the rule');
	assert(!/border-top/.test(body),
		'.cm-divider uses border-top; that leaves a gap beside the label no padding closes');
	const bef = (compNoComment.match(/\.cm-divider::before,\s*\n\.cm-divider::after\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/flex:\s*1 1 auto/.test(bef),
		'the two rules must grow to fill the row, or the divider stops spanning it');
});

check('the showcase demonstrates both auth frames', () => {
	// A variant nobody can see is not a variant. The standard frame and
	// the wide one are both rendered, and the section is in the nav index
	// so the scroll-spy reaches it.
	for (const c of ['cm-auth', 'cm-auth--wide', 'cm-card--auth', 'cm-code-input', 'cm-divider']) {
		assert(renderedClasses.has(c), `the showcase never renders .${c}`);
	}
	const section = showcase.slice(showcase.indexOf('id="auth"'), showcase.indexOf('id="readme"'));
	assert(section !== '' && section !== showcase.slice(showcase.indexOf('id="auth"')),
		'the auth section is missing or empty');
	assert(/class="cm-auth cm-auth--wide"/.test(showcase),
		'the wide auth frame is not demonstrated as a sibling of the standard one');
});

check('the auth section composes the system components, not private ones', () => {
	// The specimen must BE the composition it claims, or the section is
	// prose with a card in it. Each of these is a component the library
	// already demonstrated earlier on the page.
	const section = showcase.slice(showcase.indexOf('id="auth"'), showcase.indexOf('id="readme"'));
	for (const [cls, what] of [
		['cm-card', 'the card surface'],
		['cm-field', 'the field layout'],
		['cm-alert--err', 'the error state'],
		['cm-btn--primary', 'the submit button'],
		['cm-btn--block', 'the full-width action'],
	]) {
		assert(new RegExp(`class="[^"]*${cls}`).test(section),
			`the auth section does not compose ${what} (.${cls})`);
	}
});

check('the auth frame is centered without a consumer stylesheet', () => {
	// The point of the frame: a consumer writes no CSS. The centring
	// must be a grid + place-items in the component layer, and it must
	// be a DYNAMIC viewport unit so a mobile browser's collapsing URL
	// bar does not cut the card off.
	const frame = (compNoComment.match(/\.cm-auth\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/display:\s*grid/.test(frame) && /place-items:\s*center/.test(frame),
		'.cm-auth must center its own card; a consumer should write no CSS for it');
	assert(/min-height:\s*100dvh/.test(frame),
		'.cm-auth must use 100dvh; 100vh is cut off by a mobile URL bar');
});

/* ================= the consumer's install root is DISCOVERED ==========
   The checker hardcoded `src/styles/cli-mono/`. spacetime-rpm serves its
   admin console from web/, so it keeps the layers at
   web/src/styles/cli-mono/ and the bare scan never saw it at all - the
   audit listed rpm as "NOT on oem-ui" while rpm was, in fact, a consumer
   carrying four .cm-* rules the library did not own.

   So both halves are proven, because a check that cries wolf is the same
   failure as one that never fires:
     1. a nested, byte-identical consumer -> in sync, exit 0
     2. the same consumer with one file broken -> exit 1, naming the REAL
        nested path rather than the assumed src/ one                */
check('the drift checker discovers a consumer\'s install root, not just src/', () => {
	const mk = (nested) => {
		const dir = mkdtempSync(join(tmpdir(), 'cm-prefix-'));
		const p = nested ? join(dir, 'web/src') : join(dir, 'src');
		mkdirSync(join(p, 'styles/cli-mono'), { recursive: true });
		mkdirSync(join(p, 'js'), { recursive: true });
		for (const f of ['tokens.css', 'base.css', 'components.css']) {
			writeFileSync(join(p, 'styles/cli-mono', f), readFileSync(join(root, 'src/styles', f)));
		}
		for (const f of ['cli-mono.js', 'cli-mono-theme-guard.js']) {
			writeFileSync(join(p, 'js', f), readFileSync(join(root, 'src/js', f)));
		}
		// A source file that LOADS the layers, so reachability is satisfied
		// and this test measures the prefix question and nothing else.
		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'src/app.tsx'), [
			"import './" + (nested ? 'web/src/' : 'src/') + "styles/cli-mono/tokens.css';",
			"import './" + (nested ? 'web/src/' : 'src/') + "styles/cli-mono/base.css';",
			"import './" + (nested ? 'web/src/' : 'src/') + "styles/cli-mono/components.css';",
			"import './" + (nested ? 'web/src/' : 'src/') + "js/cli-mono.js';",
			"import './" + (nested ? 'web/src/' : 'src/') + "js/cli-mono-theme-guard.js';",
		].join('\n'));
		return dir;
	};
	const run = (dir) => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
		encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
	});
	// (a) THE BARE SCAN must FIND a nested consumer at all. Passing the
	// directory explicitly proved nothing about discovery - it only proved
	// that the comparison honours a prefix once one has been resolved.
	// Without this, mutating the scan loop is caught by some other
	// assertion and the test claims a guard it does not have.
	{
		const scanRoot = mkdtempSync(join(tmpdir(), 'cm-scan-'));
		const fakeRoot = join(scanRoot, 'projects');
		mkdirSync(fakeRoot, { recursive: true });
		const nestedDir = join(fakeRoot, 'rpm-like');
		mkdirSync(join(nestedDir, 'web/src/styles/cli-mono'), { recursive: true });
		mkdirSync(join(nestedDir, 'web/src/js'), { recursive: true });
		for (const f of ['tokens.css', 'base.css', 'components.css']) {
			writeFileSync(join(nestedDir, 'web/src/styles/cli-mono', f), readFileSync(join(root, 'src/styles', f)));
		}
		for (const f of ['cli-mono.js', 'cli-mono-theme-guard.js']) {
			writeFileSync(join(nestedDir, 'web/src/js', f), readFileSync(join(root, 'src/js', f)));
		}
		mkdirSync(join(nestedDir, 'src'), { recursive: true });
		writeFileSync(join(nestedDir, 'src/app.tsx'), [
			"import './web/src/styles/cli-mono/tokens.css';",
			"import './web/src/styles/cli-mono/base.css';",
			"import './web/src/styles/cli-mono/components.css';",
			"import './web/src/js/cli-mono.js';",
			"import './web/src/js/cli-mono-theme-guard.js';",
		].join('\n'));
		const scan = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh')], {
			encoding: 'utf8',
			env: { ...process.env, OEM_UI_SRC: root, CONSUMER_ROOT: fakeRoot },
		});
		assert(/rpm-like/.test(scan.stdout),
			`the bare scan must FIND a consumer whose layers are nested, got: ${scan.stdout.trim()}`);
		// Only DISCOVERY is claimed here. Whether it then passes is the
		// per-layout claim below, which passes the directory explicitly -
		// asserting both in one place made a discovery mutant die on the
		// wrong message and read as an unnamed kill.
		assert(!/no consumer projects found/.test(scan.stdout),
			`the scan must not report an empty consumer root, got: ${scan.stdout.trim()}`);
		rmSync(scanRoot, { recursive: true, force: true });
	}

	for (const nested of [false, true]) {
		const label = nested ? 'nested (web/src)' : 'canonical (src)';
		const dir = mk(nested);
		try {
			const ok = run(dir);
			assert(ok.status === 0,
				`${label}: a byte-identical consumer must report in sync, got ${ok.status}: ${ok.stdout.trim()}`);
			assert(/in sync/.test(ok.stdout), `${label}: expected "in sync", got: ${ok.stdout.trim()}`);

			// Break one file and prove the SAME nested path is named.
			const cssPath = nested
				? join(dir, 'web/src/styles/cli-mono/base.css')
				: join(dir, 'src/styles/cli-mono/base.css');
			writeFileSync(cssPath, '/* drift */\n');
			const bad = run(dir);
			assert(bad.status === 1, `${label}: expected exit 1 on drift, got ${bad.status}`);
			assert(/STALE/.test(bad.stdout), `${label}: expected STALE, got: ${bad.stdout.trim()}`);
			assert(!/\bMISSING\b/.test(bad.stdout),
				`${label}: no file is missing, so MISSING would be a false alarm: ${bad.stdout.trim()}`);
			assert(!/ORPHAN/.test(bad.stdout),
				`${label}: the vendored copies ARE compared, so ORPHAN would be a false alarm: ${bad.stdout.trim()}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

/* ================= surface built INSIDE a vendored layer ==============
   rpm carried cm-check, cm-toolbar and cm-toolbar__count inside its
   vendored components.css - .cm-* names the library does not own, in the
   one file no consumer imports. Nothing on the fleet could use them and no
   library fix could reach them. `cmp` reported the copy as merely "ahead",
   which names neither the fact nor the classes.

   Both directions again, because the false positive is the expensive one:
     1. a .cm-* rule the library does NOT own -> RESERVED, naming it
     2. a consumer OVERRIDING a library part   -> silent, which is legal  */
check('the drift checker names surface built inside a vendored layer', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cm-reserved-'));
	try {
		for (const f of ['tokens.css', 'base.css', 'components.css']) {
			mkdirSync(join(dir, 'src/styles/cli-mono'), { recursive: true });
			writeFileSync(join(dir, 'src/styles/cli-mono', f), readFileSync(join(root, 'src/styles', f)));
		}
		for (const f of ['cli-mono.js', 'cli-mono-theme-guard.js']) {
			mkdirSync(join(dir, 'src/js'), { recursive: true });
			writeFileSync(join(dir, 'src/js', f), readFileSync(join(root, 'src/js', f)));
		}
		mkdirSync(join(dir, 'src'), { recursive: true });
		const rel = './src/styles/cli-mono/';
		writeFileSync(join(dir, 'src/app.tsx'),
			[`import '${rel}tokens.css';`, `import '${rel}base.css';`,
			 `import '${rel}components.css';`, "import './src/js/cli-mono.js';",
			 "import './src/js/cli-mono-theme-guard.js';"].join('\n'));
		const run = () => spawnSync('bash', [join(root, 'scripts/check-design-sync.sh'), dir], {
			encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root },
		});

		const base = run();
		assert(base.status === 0, `a clean consumer must be silent, got ${base.status}: ${base.stdout.trim()}`);

		// (1) a library-prefixed class the library does not own.
		appendFileSync(join(dir, 'src/styles/cli-mono/components.css'),
			'\n.cm-not-in-the-library {\n\tcolor: var(--ink);\n}\n');
		const rogue = run();
		assert(rogue.status === 1, `expected exit 1 on a reserved-prefix class, got ${rogue.status}`);
		assert(/RESERVED/.test(rogue.stdout),
			`expected RESERVED, got: ${rogue.stdout.trim()}`);
		assert(/cm-not-in-the-library/.test(rogue.stdout),
			`the offending class must be NAMED, got: ${rogue.stdout.trim()}`);

		// (2) a class named only in the LIBRARY's PROSE is not a definition.
		//
		// Without comment stripping the library's own prose satisfies the
		// comparison: a name mentioned in a note reads as "the library
		// owns it", the real rogue class is excused, and RESERVED stays
		// silent. So the fixture must make the library MENTION the class
		// while DEFINING nothing, and the check must still report it.
		const libCss = join(root, 'src/styles/components.css');
		writeFileSync(join(dir, 'src/styles/cli-mono/components.css'),
			readFileSync(libCss) +
			'\n.cm-prose-only { color: var(--ink); }\n');
		const proseDefined = run();
		assert(/cm-prose-only/.test(proseDefined.stdout),
			`a class the library does not define must be reported, got: ${proseDefined.stdout.trim()}`);

		// The mirror image, and the one comment stripping exists for: a
		// class that appears ONLY inside a CSS comment must not be read as
		// a definition on EITHER side. The library gets the name in a
		// comment; the consumer's copy does not define it. A parser that
		// does not strip comments reads the library's prose as ownership,
		// excuses the consumer, and RESERVED goes quiet on a real defect.
		const libWithProse = readFileSync(libCss, 'utf8').replace(
			/\n(\.cm-header\s*\{)/,
			'\n/* deliberately NOT .cm-comment-only */\n$1');
		if (libWithProse === readFileSync(libCss)) {
			throw new Error('fixture anchor .cm-header not found - the prose case would silently pass');
		}
		writeFileSync(join(dir, 'src/styles/cli-mono/components.css'), libWithProse);
		const prose = run();
		assert(!/RESERVED/.test(prose.stdout),
			`nothing is rogue when the only difference is a comment, but RESERVED fired: ${prose.stdout.trim()}`);

		// (3) the check must name the RIGHT classes and no others. A
		// comparison that trims the suffix would report a BLOCK part as
		// rogue; one that is too coarse would miss a variant.
		writeFileSync(join(dir, 'src/styles/cli-mono/components.css'),
			readFileSync(libCss) +
			'\n.cm-toolbar__group { color: var(--ink); }\n' +
			'\n.cm-not-a-library-part-xyz { color: var(--ink); }\n');
		const named = run();
		const outText = named.stdout;
		assert(/cm-toolbar__group/.test(outText),
			`a BEM variant the library does not define must be reported, got: ${outText.trim()}`);
		assert(/cm-not-a-library-part-xyz/.test(outText),
			`and so must a wholly new name, got: ${outText.trim()}`);
		// Scope this to the RESERVED class LIST, not the whole stdout.
		// The advisory ".cm-header is defined but no source emits it"
		// note is a separate, legitimate line and it NAMES cm-header;
		// grepping the transcript for the bare word trips on the
		// advice instead of the report. (It started appearing once the
		// reachability scan learned .tsx: the fixture's app.tsx was
		// previously invisible, the pass was skipped, and no note
		// could print at all - a passing assertion that was passing
		// because nothing had run.)
		const rogueList = /the library does not:\s*\n\s+([^\n]+)/.exec(outText)?.[1] ?? '';
		assert(/RESERVED/.test(outText) && /cm-toolbar__group/.test(rogueList),
			`expected a RESERVED report listing the rogue classes, got: ${outText.trim()}`);
		assert(!/\bcm-header\b/.test(rogueList),
			`an EXISTING library class must not be reported as rogue, got: ${rogueList}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/* ================= one element, one spacing, one spelling ================= */

check('a kicker owns its own gap, and one modifier means one thing', () => {
	const comp = read("src/styles/components.css");
	const page = read("src/pages/index.astro");

	// The kicker bug, in the shape it had: a MODIFIER carried the only
	// bottom margin, so whether a label had space under it depended on
	// which spelling the author typed. Measured on the showcase at 402px:
	// 31 kickers at 12px, 5 at 0px or 24px, on one page.
	const kicker = comp.match(/^\.cm-kicker\s*\{([^}]*)\}/m);
	assert(kicker, 'no base .cm-kicker rule');
	const kBody = kicker[1];
	assert(/margin-bottom:\s*var\(--/.test(kBody) || /margin:\s*0 0 var\(--/.test(kBody),
		`the BASE kicker must own its bottom margin from a token; if the gap lives in a modifier, a consumer that forgets it gets a flush label. Got: ${kBody.trim()}`);

	// The flush case is allowed, and only for a label sitting directly on a
	// SPECIMEN (a breadcrumb, an empty-state panel). Named, so it is
	// reviewable in markup rather than implied by which class was omitted.
	const flush = comp.match(/^\.cm-kicker--flush\s*\{([^}]*)\}/m);
	assert(flush, 'a kicker that labels a specimen needs a named flush variant');
	assert(/margin-bottom:\s*0/.test(flush[1]),
		`--flush must zero the gap it opts out of, got: ${flush[1].trim()}`);

	// A modifier must mean ONE thing. `--plain` suppresses the `~/`
	// prefix; it must not also carry spacing, or the two ideas drift
	// apart again the moment someone edits one of them.
	const plain = comp.match(/^\.cm-kicker--plain\s*\{([^}]*)\}/m);
	if (plain) {
		assert(!/margin/.test(plain[1]),
			`--plain means "no ~/ prefix"; spacing on it is the defect this block exists to catch. Got: ${plain[1].trim()}`);
	}
	assert(!/^\.cm-kicker--plain\s*\{[^}]*margin-bottom/m.test(comp),
		'no rule may give a kicker its gap through the --plain modifier');

	// And the page must not need the modifier for spacing: a bare kicker
	// is the normal case, and --flush is the only spacing opt-out.
	const kickers = [...page.matchAll(/<h3 class="([^"]*cm-kicker[^"]*)">([^<]*)<\/h3>/g)];
	assert(kickers.length > 20, `expected many kickers on the showcase, found ${kickers.length}`);
	for (const [, cls, txt] of kickers) {
		const tokens = cls.split(/\s+/);
		assert(tokens.every(t => t === 'cm-kicker' || t.startsWith('cm-kicker--')),
			`a kicker must be one class plus optional modifiers, got "${cls}" on "${txt.trim()}"`);
		const mods = tokens.filter(t => t.startsWith('cm-kicker--'));
		assert(new Set(mods).size === mods.length,
			`a kicker repeats a modifier, which means two spellings of one state: "${cls}" on "${txt.trim()}"`);
	}
});

/* ---------- record stack: the contract, asserted on the real rule ---------- */

check('the record stack is a flex column whose gap is off the scale', () => {
	const comp = read('src/styles/components.css');
	// Key on the SELECTOR LIST that contains .cm-stack, never on the literal
	// '.cm-stack {'. A grouped rule ('.cm-stack, .cm-rows {') is the same
	// block with a second target, and that second target is exactly the
	// opt-in break the next check hunts for - so the two must not collide.
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-stack[^{}\n]*)\{([^}]*)\}/g)][0];
	assert(rule, '.cm-stack must have its own rule body');
	assert(comp.indexOf(rule[0]) < comp.indexOf('.cm-auth {'),
		'.cm-stack must be defined before .cm-auth so the auth surface stays last');

	const body = rule[2];
	// Two claims, two messages. A shared message makes the own-claim
	// detector mislabel which assertion actually fired.
	assert(/display:\s*flex/.test(body),
		'the stack must be a flex container');
	assert(/flex-direction:\s*column/.test(body),
		`a stack whose flex-direction is not column lays records out in a ROW, got: ${body.trim()}`);
	// Pin the VALUE. /gap/ alone also matches `gap: 0`, which is not a stack.
	// The gap must come off a token - either the raw scale (--space-N) or a
	// rhythm token (--stack-gap/--stack-section), which is what the layout
	// primitive uses so a project can retune the whole vertical rhythm in
	// one declaration. What it must NOT be is a literal: a hardcoded rem
	// here is exactly the per-project number that made five projects
	// disagree about the same gap.
	// Comments are documentation, not declarations. The measured numbers
	// in this rule's own comment ("320px", "524px") are the evidence for
	// the rule existing, so a regex that cannot tell a comment from a
	// declaration would forbid the library from explaining itself.
	// Strip block and line comments before hunting for a literal value.
	const bodyNoComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	assert(/gap:\s*var\(--(space-\d|stack-[a-z]+)\)/.test(bodyNoComments),
		`the gap must come off the spacing or rhythm scale, got: ${bodyNoComments.trim()}`);
	assert(!/[\d.]+(rem|em|px)/.test(bodyNoComments),
		`the stack carries a hardcoded value; use --space-* or --stack-*: ${bodyNoComments.trim()}`);
});

check('a stack is opt-in, so a list that never asked for one is still flush', () => {
	const comp = read('src/styles/components.css');
	// The break is not "the selector is spelled .cm-stack" - renaming it to
	// .cm-rows.cm-stack renders identically and is not a defect. The break
	// is any rule that reaches a plain <ul class="cm-rows"> that never asked
	// to be stacked, because that list's rows are already separated by their
	// own border and a gap would space them twice.
	const rules = [...comp.matchAll(/([^{}\n]*\.cm-stack[^{}\n]*)\{([^}]*)\}/g)];
	assert(rules.length > 0, '.cm-stack must have its own rule body');
	const stackRule = rules[0];
	assert(!/(^|[^-])\.cm-rows\b/.test(stackRule[1]),
		`the stack rule also targets a plain .cm-rows list: "${stackRule[1].trim()}"`);

	// Every rule that targets the LIST element itself. A descendant rule
	// ('.cm-rows--column .cm-row__body') styles something inside a row, and
	// a cm-rows VARIANT is opt-in by name - neither is the bare list.
	for (const m of comp.matchAll(/^(\.[^{}\n]*cm-rows[^{}\n]*)\{([^}]*)\}/gm)) {
		const sel = m[1].trim();
		const bare = /^\.cm-rows$/.test(sel);
		const rows = /^\.cm-rows\s*,/.test(sel) || /,\s*\.cm-rows(\s*,|\s*$)/.test(sel);
		if (!bare && !rows) continue;
		assert(!/\bgap\s*:/.test(m[2]),
			`"${sel}" reaches a list that never asked for a stack; it carries a gap: ${m[2].trim()}`);
	}
});

/* ---------- choice + disclosure: the contract, asserted on the real rules ---------- */

check('a segmented option is marked by an inset rule, not a thicker border', () => {
	// Match the rule by its selector list, never by the literal '.cm-seg__opt {':
	// a grouped selector is the same block with a second target, and the
	// literal is blind to exactly that.
	const rule = [...compSrc.matchAll(/([^{}\n]*\.cm-seg__opt[^{}\n]*)\{([^}]*)\}/g)]
		.find(m => /aria-pressed/.test(m[0]));
	assert(rule, 'the selected segmented option must be styled off [aria-pressed]');
	const body = rule[2];
	// Pin the VALUE. A thicker border is the anti-pattern this replaces:
	// it widens the box by its own delta and walks the whole row sideways.
	assert(/box-shadow:\s*inset/.test(body),
		`the selected option marks itself with an inset rule, got: ${body.trim()}`);
	assert(!/border-width:\s*[2-9]|border:\s*[2-9]/.test(body),
		`a thicker border on the selected option widens the box and walks the row sideways: ${body.trim()}`);
	// The state is an attribute, not a class, so the look cannot drift
	// from what assistive tech is told.
	assert(!/\.[^{}\n]*--on\b|\.[^{}\n]*--active\b/.test(rule[1]),
		`the selected option must be marked by an attribute, not an author class: "${rule[1].trim()}"`);
});

check('a segmented control is a group of real buttons, one row, wrapping not clipping', () => {
	const seg = [...compSrc.matchAll(/([^{}\n]*\.cm-seg[^{}\n]*)\{([^}]*)\}/g)];
	const root = seg.find(m => /^\s*\.cm-seg\s*$/.test(m[1]));
	assert(root, '.cm-seg must have its own rule body');
	assert(/display:\s*inline-flex/.test(root[2]),
		'a segmented control is an inline control inside a form row, not a block');
	// A long option set wraps rather than running off a 390px screen.
	assert(/flex-wrap:\s*wrap/.test(compSrc.match(/\.cm-seg \{[\s\S]*?\}/)[0]),
		'a segmented control must wrap its options instead of clipping them');
	// Coarse pointers get the same floor as every other control. Scope the
	// search to the coarse-pointer BLOCK: /min-height: var(--tap)/ matches a
	// dozen unrelated rules, so a whole-file test passes with this one gone.
	// There are five coarse-pointer blocks, and this one is the last. Taking
	// the FIRST matches .cm-copy's floor and passes while the segmented
	// control's is gone - so select the block that mentions the class.
	const coarse = [...compSrc.matchAll(
		/@media \(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/g)]
		.find(m => m[1].includes('.cm-seg__opt'));
	assert(coarse, 'the segmented control must carry a coarse-pointer block');
	assert(/\.cm-seg__opt[^\n{]*\{[^}]*min-height:\s*var\(--tap\)/.test(coarse[1]),
		`a coarse pointer must get the tap floor on each option, got: ${coarse[1].trim()}`);
});

check('the disclosure hides the native marker and draws its own affordance', () => {
	// <details> gives keyboard and find-in-page free, but the marker is a
	// browser triangle the library cannot restyle into the mono look.
	// Pin the DECLARATION, not the two halves separately: `display: none`
	// appears many times in the file, so two loose tests pass while the
	// marker rule itself is untouched.
	const marker = /\.cm-disclosure__summary::-webkit-details-marker\s*\{([^}]*)\}/.exec(compSrc);
	assert(marker, 'the native marker rule must exist to be hidden');
	assert(/display:\s*none/.test(marker[1]),
		`the native marker must be hidden, or the mono affordance sits beside a browser triangle: ${marker[1].trim()}`);
	const mark = [...compSrc.matchAll(/([^{}\n]*\.cm-disclosure__mark[^{}\n]*)\{([^}]*)\}/g)];
	assert(mark.length, '.cm-disclosure__mark must have its own rule body');
	// The glyph turns with state, so it points at the thing it opens.
	// The rotation lives in the OPEN rule. Searching the file finds the
	// transition declaration on the mark, which mentions transform too.
	const open = /\.cm-disclosure\[open\][^{]*\{([^}]*)\}/.exec(compSrc);
	assert(open, 'the rotation must be scoped to the open state, so the open rule must exist');
	assert(/transform:\s*rotate\(/.test(open[1]),
		`the disclosure affordance must turn with state, or it points away from the panel it opens: ${open[1].trim()}`);
});

check('a closed disclosure panel is really hidden, not merely un-rendered', () => {
	// The mechanism is `hidden`, and any author `display` outranks the UA
	// sheet - so a panel open at paint stays visible after it closes
	// unless the rule says so. `.cm-tabs__panel[hidden]` already had to
	// learn this; a disclosure is the same trap.
	// `hidden` on the DISCLOSURE panel specifically. /\[hidden\]/ also
	// matches .cm-tabs__panel[hidden], which is a different component - so
	// the disclosure check would pass on the tabs rule alone.
	const panel = /\.cm-disclosure__body[^{]*\[hidden\][^{]*\{([^}]*)\}/.exec(compSrc);
	assert(panel, 'a closed disclosure panel must be styled, or it survives its own close');
	assert(/display:\s*none/.test(panel[1]),
		`a hidden panel must be stated as display:none, got: ${panel[1].trim()}`);
});

check('no rule is declared inside another rule body', () => {
	// A NESTED rule is brace-balanced, so the balance check passes while
	// the stylesheet means something else entirely. This has happened
	// twice here, both times from a targeted insert that landed between a
	// rule's last declaration and its closing brace.
	//
	// Walk braces by hand. The scan must NOT use `\{([^{}]*)\}`: a body
	// that CONTAINS a nested rule has braces in it, so that pattern skips
	// the very case it is looking for. The nested rule's text starts at the
	// START OF ITS SELECTOR LINE, not at its opening brace - slicing from
	// the brace cuts the selector off and the test can never see what it
	// is hunting for.
	//
	// An @media block legitimately contains rules, so nesting is only a
	// DEFECT when the immediate parent is a plain style rule.
	const AT_RULE = /^@(media|supports|container|layer)/;
	// Track at-rule nesting on a STACK rather than slicing backwards to the
	// previous `}`: the source has its comments stripped, so a comment that
	// used to separate a rule from the next one is gone and the backward
	// slice can land inside an @media block and misread it as a style rule.
	const stack = [];
	let open = -1;
	for (let i = 0; i < compSrc.length; i++) {
		const c = compSrc[i];
		if (c === '{') {
			const sel = compSrc.slice(
				compSrc.lastIndexOf('}', i) + 1, i).trim();
			stack.push(AT_RULE.test(sel));
			if (stack.length === 2) open = i;
		} else if (c === '}') {
			// `pop` is the rule being CLOSED, so the PARENT is what is now
			// on top. Reading the popped value tests the child and misses
			// exactly the case under test.
			stack.pop();
			const parentWasAtRule = stack[stack.length - 1];
			if (stack.length === 1 && open !== -1) {
				if (!parentWasAtRule) {
					const lineStart = compSrc.lastIndexOf(NL_, open) + 1;
					const inner = compSrc.slice(lineStart, i).trim();
					assert(!/^\.[a-zA-Z][\w-]*/.test(inner),
						`a rule is declared inside a style rule: ${inner.slice(0, 60)}. ` +
						'Braces still balance, so only this check sees it.');
				}
				open = -1;
			}
		}
	}
});

check('a disclosure action is walked to the end of the summary row', () => {
	// The delete button is the one legal interactive child a <summary> may
	// hold. Without `margin-left: auto` it sits hard against the last
	// chip, and the row stops reading as one line of summary text.
	const comp = read('src/styles/components.css');
	const m = /((?:^|[,{}\s])[^{}\n]*\.cm-disclosure__action[^{}\n]*)\{([^}]*)\}/.exec(comp);
	assert(m, 'the disclosure action slot must have its own rule');
	assert(/margin-left:\s*auto/.test(m[2]),
		`the action must be walked to the far end of the row, got: ${m[2].trim()}`);
	// `align-self` only matters once the summary is allowed to wrap, and at
	// 390px it is: without it the button sits on the first line while the
	// text flows to the second, which looks detached rather than aligned.
	assert(/align-self:\s*center/.test(m[2]),
		`the action must stay centred on its own line when the summary wraps, got: ${m[2].trim()}`);
});

/* ---------- page head badge: ink only, and it holds its box ---------- */

check('the page head badge is marked with an inset rule, not a gradient', () => {
	const comp = read('src/styles/components.css');
	// Take the rule that PAINTS the badge, not merely the first rule that
	// mentions it: `.cm-head-row__text > .cm-head__badge` is a layout
	// exemption (do not squash the icon) and declares no paint at all, so
	// reading "the first match" silently graded a layout rule as if it were
	// the style - and reported a broken badge while the badge was perfect.
	const rules = [...comp.matchAll(
		/([^{}\n]*\.cm-head__badge[^{}\n]*)\{([^}]*)\}/g)]
		.map(r => ({ sel: r[1].trim(), body: r[2] }));
	const rule = rules.find(r => /box-shadow|background|border/.test(r.body))
		|| rules.find(r => !/[>]/.test(r.sel));
	assert(rule, '.cm-head__badge must have its own rule body');
	assert(!/[>]/.test(rule.sel),
		`the badge's own paint rule must be a bare class, not a descendant rule (got ${rule.sel})`);
	// Read the BODY. A whole-file /gradient/ search matches the two comments
	// that explain why the library has none, which is the opposite failure.
	assert(!/gradient/.test(rule.body),
		'the badge paints a gradient; the library marks state with an inset rule, not a hue');
	// `inset` may lead the shorthand (`inset 3px 0 0 var(--ink)`) or trail
	// it (`3px 0 0 var(--ink) inset`); pinning the order would have failed
	// a perfectly good declaration - the trap this check exists to catch.
	assert(/box-shadow:[^;]*inset/.test(rule.body),
		'the badge has no inset rule, so it reads as an unlabelled grey square');
});

check('the page head badge sizes its glyph in CSS, not in markup', () => {
	const comp = read('src/styles/components.css');
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-head__badge\s*>\s*svg[^{}\n]*)\{([^}]*)\}/g)][0];
	assert(rule, '.cm-head__badge > svg must carry its own dimensions');
	assert(/width:\s*1rem/.test(rule[2]) && /height:\s*1rem/.test(rule[2]),
		'the badge glyph is sized in markup instead of CSS, so a consumer ' +
		'that omits the class renders an icon at its default 24px');
});

/* ---------- page title row: it lays out, and its action reaches the end ---------- */

check('the page title row is a flex row, not a document head block', () => {
	const comp = read('src/styles/components.css');
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-head-row\s*\{[^}]*\})/g)][0];
	assert(rule, '.cm-head-row must have its own rule body');
	assert(/display:\s*flex/.test(rule[1]),
		'the title row has no display:flex, so the badge, the title and the ' +
		'action stack as three block children instead of sharing one line');
});

check('the title row action is pushed to the end of the row', () => {
	const comp = read('src/styles/components.css');
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-head-row__action\s*\{[^}]*\})/g)][0];
	assert(rule, '.cm-head-row__action must have its own rule body');
	assert(/margin-left:\s*auto/.test(rule[1]),
		'the action is not walked to the far end of the row, so it sits ' +
		'beside the title however long the title grows');
});

check('a narrow title row wraps instead of squeezing the title', () => {
	const comp = read('src/styles/components.css');
	// A rule-inside-a-rulebreak; [^{}]* cannot match it because the body
	// itself has braces. Slice from the media opener to the end of its block.
	const at = comp.indexOf('@media (max-width: 420px)');
	assert(at >= 0, 'no media query adapts .cm-head-row for a narrow viewport');
	const block = comp.slice(at, comp.indexOf('\n}', at));
	assert(/flex-wrap:\s*wrap/.test(block),
		'.cm-head-row never wraps, so at 320px the badge, title and a ' +
		'full-word button all compete for one line');
});

/* ---------- the title is styled in BOTH containers ----------
   `.cm-head .cm-head__title` is a DESCENDANT selector. A title inside
   `.cm-head-row` matched nothing, fell back to the UA default, and the row
   measured 119px instead of one line - while the showcase rendered fine
   because its specimen happened to sit inside a `.cm-head`. A green
   rendering test would not have caught it; only measuring the row did. */
check('a page title is styled inside the row container, not only the head', () => {
	const comp = read('src/styles/components.css');
	// Find the rule that actually DECLARES the size, and require it to
	// carry the row selector. A bare presence test for the selector is
	// vacuous: a margin-only rule mentioning it satisfies that while the
	// size is still unset, and the mutant then dies on a different
	// assertion with the wrong claim.
	const sized = [...comp.matchAll(/([^{}\n]*\.cm-head__title[^{}\n]*)\{([^}]*)\}/g)]
		.filter(m => /font-size/.test(m[2]));
	assert(sized.length, '.cm-head__title has no rule that declares a font-size');
	assert(sized.some(m => /\.cm-head-row/.test(m[1])),
		'.cm-head__title is only styled as a descendant of .cm-head, so a ' +
		'title inside .cm-head-row inherits the UA default size');
	assert(sized.some(m => /font-size:\s*var\(--head-h1\)/.test(m[2])),
		'the row-scoped title rule does not carry the same --head-h1 as the head');
});

/* ---------- SectionHead: the second step of the type scale ----------
   `.cm-section__title` and `.cm-section__sub` shipped for rpm and were
   rendered NOWHERE, so the library's own suite reported them as dead CSS
   while rpm carried 18 hand-written copies of the same block. The class was
   never the fix; the block needed an owner.

   These read the BUILT page, not the showcase source, because the whole
   defect this component exists for is a class that exists and is never
   used. A source-level test would pass on a component nobody renders. */

check('SectionHead: the built page renders the section title it defines', () => {
	assert(built, 'dist/index.html is missing - run `npm run build` first');
	const titles = [...built.matchAll(/<h([2-4]) class="cm-section__title">/g)];
	assert(titles.length >= 20,
		`only ${titles.length} section titles rendered; the component exists to be used`);
	// The scale is the POINT. A section title that computes to the same
	// size as the page title is the defect the class was added to fix, and
	// it is invisible to a test that only checks the class is present.
	const rule = /^\.cm-section__title\s*\{([^}]*)\}/m.exec(compSrc);
	assert(rule, '.cm-section__title is not defined');
	const size = /font-size:\s*([^;]+)/.exec(rule[1]);
	assert(size, '.cm-section__title declares no font-size, so it inherits the page scale');
	// It must NOT be --head-h1, and must not be the bare h2 rule's value.
	// Assert the REFERENCE, not the property's presence: a declaration of
	// `font-size: 1.15rem` next to the token would satisfy a presence test
	// while the token drift went unnoticed.
	assert(!/var\(--head-h1\)/.test(size[1]),
		'.cm-section__title wears --head-h1, which is the PAGE title size; that is the bug it replaced');
	assert(/--cm-h2|--head-h2/.test(size[1]),
		`.cm-section__title sizes itself from a literal (${size[1]}) rather than a heading token, ` +
		'so the scale step cannot be retuned in one place');
});

check('SectionHead: the sub is the SECTION sub, not the page-head class', () => {
	// `.cm-head__sub` is a page-head class. The showcase used it for every
	// section lede too, so a section subtitle and a page lede were the same
	// declaration for two different jobs - the second implementation this
	// component replaced.
	assert(built, 'dist/index.html is missing');
	const subs = [...built.matchAll(/<p class="cm-section__sub">/g)];
	assert(subs.length >= 20, `only ${subs.length} section subs rendered`);
	// And the sub must be INSIDE the title's row, or the two are siblings
	// by accident and the row layout has nothing to hold.
	assert(/class="cm-head-row__text">\s*<h2 class="cm-section__title">[^<]*<\/h2>\s*<p class="cm-section__sub">/
		.test(built.replace(/\s+/g, ' ')),
	'the title and its sub are not siblings inside .cm-head-row__text');
});

check('SectionHead: the action slot renders the control, and the title keeps its row', () => {
	// rpm hand-writes this block 18 times with a button in it. Without a
	// demonstrated action, the slot is an untested branch and the component
	// does not cover the shape that motivated it.
	assert(/class="cm-head-row__action"><span><button[^>]*class="cm-btn/.test(built),
		'the action slot never renders a control on the built page');
	// A section title beside an action must not push the action under
	// itself: the action is pushed to the far end with margin-left:auto.
	const rule = /^\.cm-head-row__action\s*\{([^}]*)\}/m.exec(compSrc);
	assert(rule, '.cm-head-row__action is not defined');
	assert(/margin-left:\s*auto/.test(rule[1]),
		'.cm-head-row__action does not push to the far end, so a title and its button share a line instead of opposing');
});

check('SectionHead: the slot renders the caller markup, and does not escape it', () => {
	// The reason `sub` is a slot and not a string prop. 14 of the 22 section
	// subs on the page carry a real <code> element for a class name; a
	// string prop would print the tag as visible text. Assert both
	// directions: the markup is LIVE, and no escaped tag text leaked in.
	const subs = [...built.matchAll(/<p class="cm-section__sub">([\s\S]*?)<\/p>/g)]
		.map(m => m[1]);
	assert(subs.some(s => s.includes('<code>')),
		'no section sub renders a real <code> element - the slot is escaping the caller markup');
	assert(!subs.some(s => /&lt;code&gt;|class=&quot;/.test(s)),
		'a section sub contains literal escaped markup, so a caller string reached a slot as text');
	// And the component must not hardcode an identity, like every other
	// component in the library.
	const src = read('src/astro/SectionHead.astro');
	assert(!/omiinaya|mrxlab/.test(src), 'SectionHead must not hardcode site identity');
});


/* ---------- the side sheet is a modifier, not a second component ---------- */

check('the side sheet is a modifier on the native dialog, not its own element', () => {
	const comp = read('src/styles/components.css');
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-dialog--sheet\s*\{[^}]*\})/g)][0];
	assert(rule, '.cm-dialog--sheet must have its own rule body');
	// Anchored to the right edge. Without this the sheet renders as a
	// centred modal, which is a different interaction dressed as the same.
	assert(/margin:\s*0 0 0 auto/.test(rule[1]),
		'the sheet is not anchored to the right edge, so it renders centred ' +
		'instead of beside the page it describes');
	assert(/height:\s*100%/.test(rule[1]),
		'the sheet is not full height, so it floats in the middle of the ' +
		'backdrop instead of running the full edge');
});

check('the sheet goes full-bleed on a phone', () => {
	const comp = read('src/styles/components.css');
	// Same trap as the coarse-pointer checks: there are several max-width
	// blocks. Match the one that mentions the sheet.
	// Start at the MEDIA OPENER, not at the rule: the 100% lives inside a
	// nested block and a slice to the first '\n}' stops short of it.
	// There are three @media (max-width: 640px) blocks in this file, so a
	// plain indexOf finds a block 15k characters AWAY that happens to carry
	// the same selector. Anchor on the adaptation itself, not on the query.
	const blocks = [...comp.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\n/g)]
		.map(m => m[1]);
	const block = blocks.find(b => /\.cm-dialog--sheet\s*\{[\s\S]*?width:\s*100%/.test(b));
	assert(block, 'the sheet never goes full width on a narrow viewport, so a 30rem panel is centred in a 390px screen with backdrop showing either side');
	assert(/\.cm-dialog--sheet/.test(block) && /width:\s*100%/.test(block),
		'the sheet never goes full width on a narrow viewport, so a 30rem ' +
		'panel is centred in a 390px screen with backdrop showing either side');
});

/* ---------- the switch is a real control, not a painted div ---------- */

check('the switch keeps a real checkbox as its control', () => {
	const comp = read('src/styles/components.css');
	// A div with a click handler has no role, no name, no form value and no
	// keyboard path. The input must exist and must cover the control.
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-switch > input\[type='checkbox'\][^{}\n]*\{[^}]*\})/g)][0];
	assert(rule, 'the switch has no styled checkbox: it is a div, not a control');
	assert(/position:\s*absolute/.test(rule[1]) && /inset:\s*0/.test(rule[1]),
		'the real checkbox is not laid over the control, so the visible track ' +
		'is what gets clicked and the input is only reachable by keyboard');
	assert(/opacity:\s*0/.test(rule[1]),
		'the real checkbox is not transparent, so it draws a second box on ' +
		'top of the track instead of the track being the whole control');
});

check('the switch knob lands flush at both ends of its track', () => {
	const comp = read('src/styles/components.css');
	const tok = read('src/styles/tokens.css');
	// The on-state transform is computed from the token, not typed in. If
	// someone hardcodes a distance the knob drifts when the track changes.
	const on = [...comp.matchAll(/([^{}\n]*\.cm-switch > input:checked[^{}\n]*\{[^}]*\})/g)]
		.map(m => m[1]).join('\n');
	assert(/translateX\(calc\(/.test(on),
		'the on-state knob position is a literal, so it drifts out of the ' +
		'track the moment the track token changes');
	assert(/var\(--track-w\)/.test(on) && /var\(--knob-d\)/.test(on) && /var\(--knob-inset\)/.test(on),
		'the on-state knob position does not derive from the track and knob ' +
		'tokens, so the two ends cannot both be flush');
	// And the knob must be smaller than the track, or there is no travel.
	const d = /--knob-d:\s*calc\(([^)]*)\)/.exec(tok);
	assert(d, '--knob-d is a literal, not a calc, so the knob and the track are two independent numbers that can disagree');
	assert(/--track-h/.test(d[1]),
		'--knob-d is not derived from --track-h, so the knob and the track ' +
		'are two independent numbers that can disagree');
});

check('the switch state is drawn by position and weight, not by hue', () => {
	const comp = read('src/styles/components.css');
	const knob = /([^{}\n]*\.cm-switch__knob\s*\{[^}]*\})/.exec(comp);
	assert(knob, 'no .cm-switch__knob rule');
	assert(!/#[0-9a-f]{3,8}\b/.test(knob[1]),
		'the knob hardcodes a colour, so the switch is signalling by hue');
	// On means "filled": the track takes the ink token. Off stays neutral.
	const on = [...comp.matchAll(/([^{}\n]*\.cm-switch > input:checked ~ \.cm-switch__track\s*\{[^}]*\})/g)][0];
	assert(on, 'the on-state track colour is never declared');
	assert(/var\(--ink\)/.test(on[1]),
		'the on-state track does not fill with the ink token, so "on" is not ' +
		'carried by weight');
});

/* ---------- a selected row signals with an inset rule, not a tint ---------- */

check('a selected row is marked with an inset rule, never a colour', () => {
	const comp = read('src/styles/components.css');
	const rule = /([^{}\n]*\.cm-row--on\s*\{[^}]*\})/.exec(comp);
	assert(rule, 'no .cm-row--on rule: a selected row has no treatment at all');
	// Same claim as cm-section--on, which is the treatment being reused. The
	// whole point is that a tinted row vanishes in greyscale print.
	assert(/box-shadow:\s*inset/.test(rule[1]),
		'a selected row is not marked with an inset rule, so the only thing ' +
		'distinguishing it is a background tint that disappears in greyscale print');
	assert(!/#[0-9a-f]{3,8}\b/.test(rule[1]),
		'the selected row hardcodes a colour instead of using the ink token');
});

check('a row that is itself a control keeps the row geometry', () => {
	const comp = read('src/styles/components.css');
	const rule = /([^{}\n]*button\.cm-row\s*\{[^}]*\})/.exec(comp);
	assert(rule, 'no button.cm-row rule: every consumer hand-writes background, ' +
		'border and padding in a style prop, which is what a stylesheet is for');
	assert(/width:\s*100%/.test(rule[1]),
		'a clickable row does not fill its container, so it is narrower than the ' +
		'list it sits in and the tap target stops at the text');
	assert(/background:\s*transparent/.test(rule[1]),
		'a clickable row does not clear the UA button background, so it renders ' +
		'as a raised grey box in the middle of the list');
	assert(/border:\s*0/.test(rule[1]),
		'a clickable row keeps the UA button border, so it draws a second edge ' +
		'beside the row divider');
});

/* ---------- the log table scrolls sideways, not the page ---------- */

check('the table scrolls inside its own wrapper, not the page', () => {
	const comp = read('src/styles/components.css');
	const wrap = /([^{}\n]*\.cm-table-wrap\s*\{[^}]*\})/.exec(comp);
	assert(wrap, 'no .cm-table-wrap rule, so the table has no frame to scroll in');
	assert(/overflow-x:\s*auto/.test(wrap[1]),
		'the table wrapper does not scroll horizontally, so a wide log grows ' +
		'the page instead of scrolling and the whole UI drifts sideways on a phone');
	// The scroll must be on the WRAPPER. On the table itself, `overflow` is
	// ignored for a table box, so the rule reads as if it worked and the
	// page still grows.
	assert(!/^\.cm-table\s*\{[^}]*overflow/.test(comp),
		'overflow is set on .cm-table itself, which a table box ignores, so the ' +
		'horizontal scroll silently does nothing');
});

check('the log table header stays put while the body scrolls', () => {
	const comp = read('src/styles/components.css');
	const th = /([^{}\n]*\.cm-table th\s*\{[^}]*\})/.exec(comp);
	assert(th, 'no .cm-table th rule');
	assert(/position:\s*sticky/.test(th[1]),
		'the header row is not sticky, so once a log is longer than a screen ' +
		'every row is read without knowing which column it belongs to');
	// A sticky header with a transparent background lets rows show through
	// it. `/background:/` alone is satisfied by `transparent`, which is
	// precisely the mutant, so the check demands a real token.
	assert(/background:\s*var\(--[a-z0-9-]+\)/.test(th[1]),
		'the sticky header background is not an opaque token, so the rows ' +
		'scroll visibly through the header as they pass under it');
});

check('a status code is marked by weight and glyph, not by hue', () => {
	const comp = read('src/styles/components.css');
	const block = comp.slice(comp.indexOf('/* ---------- status code'), comp.indexOf('/* ---------- the flush disclosure'));
	assert(block.length > 100, 'the status-code surface is missing entirely');
	assert(!/#[0-9a-f]{3,8}\b/.test(block),
		'the status code hardcodes a colour, so a log is readable only by hue');
	assert(!/\b(red|green|emerald|amber|blue|orange|yellow)\b/i.test(block.replace(/never a hue[\s\S]*/i, '')),
		'the status-code surface names a hue, so the rule it replaced is back');
	// The three tiers must be distinguishable without colour, so each needs
	// a declaration that is NOT a colour.
	const tiers = block.match(/\.cm-status-code--(?:ok|warn|err)\s*\{[^}]*\}/g) || [];
	assert(tiers.length === 3, 'the three status tiers are not all defined');
	assert(tiers.filter(t => /text-decoration/.test(t)).length >= 1,
		'no status tier differs by anything but colour, so a 4xx and a 2xx are ' +
		'indistinguishable in greyscale');
});

/* ---------- the sticky header that was silently not sticky ----------
   `position: sticky` on the `th` was green for a whole cycle while the
   header visibly rode the page. Measured cause: `overflow-x: auto` on
   the wrapper computes `overflow-y` to `auto` as well (CSS overflow rule
   - only `visible` is forced to the other axis), so the wrapper is a
   scrollport on BOTH axes. `th` is therefore sticky to the WRAPPER, and
   the wrapper only ever scrolls sideways, so there is nothing for the
   header to stick to. Measured drift: exactly the page scroll distance.

   Viewport-sticky inside a horizontally scrolling ancestor is impossible,
   so the fix is to make the wrapper a REAL vertical scrollport via
   max-height. This test asserts the cause, not the effect, because the
   effect (`position: sticky`) is exactly the thing that lied. */
check('the table wrapper can actually scroll vertically', () => {
	const comp = read('src/styles/components.css');
	const wrap = /([^{}\n]*\.cm-table-wrap\s*\{[^}]*\})/.exec(comp);
	assert(wrap, 'no .cm-table-wrap rule, so the table has no frame to scroll in');
	assert(/max-height:\s*var\(--table-max-h/.test(wrap[1]),
		'the table wrapper has no max-height, so it is a scrollport that never ' +
		'scrolls vertically: `overflow-x: auto` already forced overflow-y to ' +
		'`auto`, which makes the sticky header resolve against the wrapper ' +
		'instead of the viewport, and the header then rides the page down ' +
		'(measured: header drift exactly equal to the scroll distance)');
});

check('the sticky header resolves against a scrollport that scrolls', () => {
	const comp = read('src/styles/components.css');
	const wrap = /([^{}\n]*\.cm-table-wrap\s*\{[^}]*\})/.exec(comp);
	const th = /([^{}\n]*\.cm-table th\s*\{[^}]*\})/.exec(comp);
	assert(wrap && th, 'no .cm-table-wrap / .cm-table th rule');
	assert(/position:\s*sticky/.test(th[1]),
		'the header row is not sticky, so once a log is longer than the cap ' +
		'every row is read without knowing which column it belongs to');
	// The pairing is the invariant, not either half. Sticky with no
	// scrollable ancestor and a scrollable ancestor with no sticky are
	// both the original bug in opposite directions, and either passes a
	// test that checks only one of the two properties.
	assert(/max-height:\s*var\(--table-max-h/.test(wrap[1]) &&
		/position:\s*sticky/.test(th[1]),
		'the header is sticky but its scrollport cannot scroll (or the ' +
		'wrapper scrolls but the header is not sticky): a sticky header ' +
		'outside a bounded scrollport is decoration');
	// A sticky header with a transparent background lets rows show through.
	// `/background:/` alone is satisfied by `transparent`, which is exactly
	// the mutant, so demand a real token.
	assert(/background:\s*var\(--[a-z0-9-]+\)/.test(th[1]),
		'the sticky header background is not an opaque token, so the rows ' +
		'scroll visibly through the header as they pass under it');
});

check('a numeric column outranks the cell rule to align on the digit', () => {
	const comp = read('src/styles/components.css');
	// A bare `.cm-table__num` is specificity 0,1,0 and `.cm-table td` is
	// 0,1,1, so the cell rule wins and every duration renders
	// left-aligned with a ragged right edge. That shipped green: the
	// source READS correct, only the computed value disagreed.
	const num = /([^{}\n]*cm-table__num[^{}\n]*\{[^}]*\})/.exec(comp);
	assert(num, 'no .cm-table__num rule, so a numeric column cannot align');
	const sel = num[1].slice(0, num[1].indexOf('{'));
	assert(/\btd\b|\bth\b/.test(sel),
		`the numeric rule is scoped "${sel.trim()}" with no element, so ` +
		"`.cm-table td` (specificity 0,1,1) beats it and the column is " +
		'left-aligned with a ragged right edge');
	assert(/text-align:\s*right/.test(num[1]),
		'the numeric column does not align right, so durations of different ' +
		'lengths cannot be compared without reading each one');
	// The header must match the cells, or the column reads as misaligned
	// even when the values line up.
	assert(/th[^{}\n]*cm-table__num/.test(sel) || /cm-table__num[^{}\n]*th/.test(sel),
		'the numeric rule covers the cells but not their column header');
});

check('the log specimen is long enough to scroll inside its own cap', () => {
	const page = read('src/pages/index.astro');
	const spec = /id="table"[\s\S]*?<\/section>/.exec(page);
	assert(spec, 'no table showcase section');
	// A sticky header on a table that fits is a sticky header nobody has
	// tested, and it passes every assertion above. The specimen must
	// actually overflow the cap, which at 30rem is more rows than a
	// casual 3-row sample provides.
	const rows = /const LOG = Array\.from\(\{ length: (\d+)/.exec(page);
	assert(rows, 'the log specimen is not generated from a row count');
	assert(Number(rows[1]) >= 10,
		`the log specimen renders ${rows[1]} rows, too few to overflow the ` +
		'30rem cap, so the sticky header is never exercised in the showcase');
});

/* ---------- a ranked meter row: the bars must share a left edge ---------- */

check('the row meter grows its TRACK, not its label', () => {
	const comp = read('src/styles/components.css');
	const track = /([^{}\n]*\.cm-meter--row \.cm-meter__track\s*\{[^}]*\})/.exec(comp);
	assert(track, 'no .cm-meter--row .cm-meter__track rule');
	assert(/flex:\s*1 1 0\b/.test(track[1]),
		'the track does not take the free space, so in a ranked list the ' +
		'bars start wherever the longest label happened to end and two ' +
		'lengths can no longer be compared by their left edge');
	const label = /([^{}\n]*\.cm-meter--row \.cm-meter__label\s*\{[^}]*\})/.exec(comp);
	assert(label, 'no .cm-meter--row .cm-meter__label rule');
	// The label must not also grow: if it did, the track would only get
	// what is left over and the bars would be ragged again.
	assert(!/flex:\s*1 1 0\b/.test(label[1]),
		'the label grows too, so the track gets only the leftover space and ' +
		'the bars are a different length for a different reason');
});

check('the row meter is a row', () => {
	const comp = read('src/styles/components.css');
	const row = /([^{}\n]*\.cm-meter--row\s*\{[^}]*\})/.exec(comp);
	assert(row, 'no .cm-meter--row rule');
	assert(/flex-direction:\s*row/.test(row[1]),
		'--row does not set flex-direction: row, so the meter stacks into ' +
		'the default column form and the bar gains a screen of labels');
	// Explicit ordering: without it, DOM order decides, and a consumer
	// writing track-first markup (which is what this showcase does) gets
	// the value before the bar.
	const orders = [...comp.matchAll(/\.cm-meter--row \.cm-meter__(label|track|val|note)\s*\{[^}]*order:\s*(\d)/g)];
	assert(orders.length === 4,
		'--row does not order all four parts, so the row renders in DOM ' +
		'order and the same markup lays out differently per consumer');
});

/* ---------- a row action must be a real control, at the tap floor ---------- */

check('the in-table action is a control, not a bare <tr onClick>', () => {
	const comp = read('src/styles/components.css');
	const rule = /([^{}\n]*\.cm-table__action\s*\{[^}]*\})/.exec(comp);
	assert(rule, 'no .cm-table__action rule, so a clickable row is a <tr> with ' +
		'an onClick and nothing else');
	// Without these the UA gives a button its own grey box and border, and
	// the grid stops reading as a grid.
	assert(/background:\s*none/.test(rule[1]) || /background:\s*transparent/.test(rule[1]),
		'the in-table action keeps the UA button background, so it renders as ' +
		'a raised box in the middle of a flat grid');
	assert(/border:\s*0\b/.test(rule[1]),
		'the in-table action keeps the UA button border, so it draws a second ' +
		'edge beside the table rule');
	assert(/min-height:\s*var\(--tap\)/.test(rule[1]),
		'the in-table action has no tap floor, so on a phone the only ' +
		'clickable thing in a row is a line of 12px text');
	assert(/cursor:\s*pointer/.test(rule[1]),
		'the in-table action does not show a pointer, so it does not read as ' +
		'clickable on a desktop');
});

check('the in-table action keeps a visible focus ring', () => {
	const comp = read('src/styles/components.css');
	const focus = /\.cm-table__action:focus-visible\s*\{[^}]*\}/.exec(comp);
	assert(focus, 'no :focus-visible rule for the in-table action');
	assert(/outline:/.test(focus[0]),
		'the in-table action has no focus outline, so a keyboard user cannot ' +
		'tell which row they are on');
});

check('the in-table action hint is always visible without hover', () => {
	const comp = read('src/styles/components.css');
	// A touch device has no hover, so `opacity: 0` there would leave the
	// row looking like plain text with no indication it does anything.
	const coarse = comp.slice(comp.indexOf('@media (pointer: coarse), (max-width: 680px) {'));
	const window_ = coarse.slice(0, coarse.indexOf('}'));
	assert(/\.cm-table__action\s+svg/.test(window_) && /opacity:\s*1/.test(window_),
		'the arrow that marks a row as a control is opacity:0 with no ' +
		'coarse-pointer override, so on a phone every action row looks like ' +
		'plain text');
});

/* ---------- two equal columns, not a main-plus-aside ---------- */

check('cm-cols--2 is two EQUAL columns', () => {
	const comp = read('src/styles/components.css');
	const at = comp.indexOf('@media (min-width: 760px)');
	assert(at > 0, 'cm-cols--2 never becomes two columns, so the pair stacks ' +
		'at every width');
	// Slice from THIS media block: the file has several `@media (min-width`
	// openers and the first of them belongs to something else.
	// Slice the WHOLE media block, not to the first `}`: `.cm-cols--2` is
	// a one-line rule, so the block's closing brace on the next line is
	// what ends it and a `slice(at, indexOf('}', at))` cuts the rule in half.
	const end = comp.indexOf('\n}', at);
	const block = comp.slice(at, end > at ? end : comp.indexOf('}', at));
	const rule = /\.cm-cols--2\s*\{([^}]*)\}/.exec(block);
	assert(rule, 'no .cm-cols--2 rule inside the 760px block');
	assert(/grid-template-columns:\s*1fr 1fr/.test(rule[1]),
		'cm-cols--2 is not equal columns; `cm-split` is 1.6fr/1fr on purpose ' +
		'because it models main-plus-aside, and a reader comparing two ' +
		'answers to the same question reads the wider one as more important');
});

check('the meter note is a fixed-width column, not loose text', () => {
	const comp = read('src/styles/components.css');
	const note = /([^{}\n]*\.cm-meter--row \.cm-meter__note\s*\{[^}]*\})/.exec(comp);
	assert(note, 'no .cm-meter--row .cm-meter__note rule');
	// Without a width the shares are ragged, and a column of percentages
	// that cannot be scanned is decoration.
	// `flex: 0 0 auto` is NOT enough: that is the default `flex` and it
	// lets the column shrink to its content, so two rows of different
	// percentage widths still ragged. The claim is a width, so demand one.
	assert(/min-width:\s*(?!0)\S/.test(note[1]),
		'the meter note has no fixed width, so a column of percentages ' +
		'rags and the reader cannot scan it for the one they want');
	assert(/text-align:\s*right/.test(note[1]),
		'the meter note is not right-aligned, so the decimals do not line ' +
		'up and "96.0%" reads differently from "3.0%"');
	assert(/font-variant-numeric:\s*tabular-nums/.test(note[1]),
		'the meter note uses proportional figures, so the digits in a ' +
		'column of percentages are all a different width');
});

/* ---------- the count tile and the inline navigation word ---------- */

/* ---------- the count tile and the inline navigation word ---------- */

// Every declaration block that mentions this selector, wherever it is in
// the file. The library groups related selectors into one rule, so a
// helper that returns only the first match silently misses the half that
// carries the claim.
function declsFor(src, selector) {
	const out = [];
	let at = -1;
	while ((at = src.indexOf(selector, at + 1)) > -1) {
		// Skip a hit that is only a substring of a longer class name:
		// `.cm-tile__val` must not match a search for `.cm-tile`.
		const after = src[at + selector.length];
		if (after && /[\w-]/.test(after)) continue;
		const before = src[at - 1];
		if (before && /[\w-]/.test(before)) continue;
		const brace = src.indexOf('{', at);
		if (brace === -1) continue;
		// The selector list ends at the `{`, so everything from the start
		// of the line-ish back to the previous `}` is the full selector.
		const selStart = Math.max(src.lastIndexOf('}', brace), src.lastIndexOf('{', brace)) + 1;
		const close = src.indexOf('}', brace);
		out.push(src.slice(selStart, brace).trim() + ' {' + src.slice(brace + 1, close) + '}');
	}
	return out.join('\n');
}

check('the count tile is centred', () => {
	const src = read('src/styles/components.css');
	assert(/align-items:\s*center/.test(declsFor(src, '.cm-tile')),
		'the tile is not centred, so a column of bucket counts does not ' +
		'read as a column and the reader must read each one on its own');
});
check('the tile value is tabular, so a column of them lines up', () => {
	const src = read('src/styles/components.css');
	assert(/font-variant-numeric:\s*tabular-nums/
		.test(declsFor(src, '.cm-tile__val')),
		'the tile number is not tabular, so stacked counts have ragged widths');
});
// The claim is that an EMPTY bucket is quiet. Checking only that the tier
// glyphs exist would be satisfied by a page where every bucket is amber,
// so this asserts the absence of the underline too: without it a tile at
// zero still wears the err mark and reads as a failure.
check('an empty tile is quieter than a marked one', () => {
	const src = read('src/styles/components.css');
	const empty = declsFor(src, '.cm-tile--empty');
	assert(/background:\s*transparent/.test(empty),
		'the empty tile is still filled, so a bucket with nothing in it ' +
		'looks occupied');
	assert(/text-decoration:\s*none/.test(empty),
		'the empty tile keeps the tier underline, so a zero still reads ' +
		'as a fault');
	assert(/color:\s*var\(--ink-faint\)/.test(empty),
		'the empty tile does not recede, so a healthy system still draws ' +
		'the eye');
});
check('a tile tier is a glyph, never a tint', () => {
	const src = read('src/styles/components.css');
	// This system has no colour token for "warning" at all - cm-alert and
	// cm-chip both mark a warning with a filled triangle in --ink-dim. A
	// tint here would mean a hue literal, which the contract forbids.
	assert(/content:\s*'\\25b2/.test(declsFor(src, '.cm-tile--warn .cm-tile__label::before')),
		'the warning tile has no glyph, so its tier is carried by nothing');
	assert(/content:\s*'\\2716/.test(declsFor(src, '.cm-tile--err .cm-tile__label::before')),
		'the error tile has no glyph, so its tier is carried by nothing');
});
// An inline navigation word rendered as a <span onClick> has no role and
// no tab stop. These three are what make it a control at all; drop any one
// and it is decorative text that happens to answer a mouse.
check('the inline navigation word is a real control', () => {
	const src = read('src/styles/components.css');
	const link = declsFor(src, 'button.cm-link');
	assert(/display:\s*inline(?!-)/.test(link),
		'the inline link is not display:inline, so it breaks the prose line box');
	// `padding: 0` must be checked as the VALUE 0, not as the string "0".
	// `/padding:\s*0/` also matches `padding: 0.5em 1em`, which boxes the
	// link and breaks the prose line - the exact defect this rule exists
	// to prevent, and it survived a mutation run because of it.
	assert(/padding:\s*0\s*;/.test(link) && /border:\s*0\s*;/.test(link),
		'the inline link still carries a button box, so it breaks the prose');
	// The focus ring is a SEPARATE `button.cm-link:focus-visible` rule, so
	// it is deliberately not in `link`. Asking `link` for it would fail
	// forever and be "fixed" by deleting the check; the honest read is the
	// pseudo-class rule, matched on its own.
	assert(/outline:\s*\d/.test(declsFor(src, 'button.cm-link:focus-visible')),
		'the inline link has no focus ring, so a keyboard user cannot see ' +
		'where they are');
});

/* ---------- the container decides the icon size ---------- */

// An icon set ships every glyph at a 24x24 viewBox and no intrinsic size,
// so an <svg> with no width and no height renders at the replaced-element
// default. The first consumer of this system fought that by putting a
// utility class on all 179 of its icons, which is the tell that the size
// belongs to the container.
//
// `1em` not a rem: the point is that the glyph tracks the TEXT beside it,
// so it inherits the control's font size rather than being pinned to a
// step on the type scale. A check for `1em` is a check for that claim.
check('a button sizes the icon inside it, so the markup need not', () => {
	const src = read('src/styles/components.css');
	const btn = declsFor(src, '.cm-btn > svg');
	assert(btn, 'no .cm-btn > svg rule, so a bare lucide icon in a button ' +
		'renders at the replaced-element default instead of at the text size');
	assert(/width:\s*1em/.test(btn) && /height:\s*1em/.test(btn),
		'the button icon is not sized in em, so it is pinned to a scale ' +
		'step instead of tracking the label beside it');
	// flex-shrink, or a long label squeezes the glyph to nothing while
	// the text wraps. The glyph is the fixed thing; the label is not.
	assert(/flex:\s*0 0 auto/.test(btn),
		'the button icon can shrink, so a long label squashes the glyph ' +
		'instead of the text wrapping');
});
// The rule has to reach the icon THROUGH the row, because the row button
// puts its glyph inside a span next to the title. Missing that span is a
// rule that reads correct and renders nothing.
check('the row button reaches its icon through the title span', () => {
	const src = read('src/styles/components.css');
	const row = declsFor(src, 'button.cm-row > span > svg');
	assert(row, 'no button.cm-row > span > svg rule; the row button nests ' +
		'its glyph inside a span beside the title, so the direct-child ' +
		'selector alone matches nothing and the icon renders unsized');
});
check('a chip sizes its own icon, slightly tighter than a button', () => {
	const src = read('src/styles/components.css');
	const chip = declsFor(src, '.cm-chip > svg');
	assert(chip && /width:\s*0\.9em/.test(chip),
		'the chip icon is not sized, so a chip with a glyph and a chip ' +
		'without one have different visual weights');
});

/* ---------- a sortable column header is a real control ---------- */

check('a sorted column is a button in a th, not a clickable th', () => {
	const comp = read('src/styles/components.css');
	// The button has to exist as its own element, not as a `th:hover`
	// rule: a `<th onClick>` is not focusable and Enter does nothing.
	assert(/button\.cm-table__sort\s*\{/.test(comp),
		'there is no button.cm-table__sort rule, so a sortable column has ' +
		'to be a th with a click handler - not focusable, no Enter, no ' +
		'role, and nothing for a screen reader to announce');
	// ...and the th must be able to drop its own padding, or the button
	// cannot be stretched across the cell.
	assert(/th\.cm-table__sortcol\s*\{/.test(comp),
		'no th.cm-table__sortcol rule, so the cell keeps its padding and ' +
		'only the text itself is clickable');
	const btn = /button\.cm-table__sort\s*\{([^}]*)\}/.exec(comp);
	assert(/width:\s*100%/.test(btn[1]),
		'the sort button does not fill its cell, so the target is the few ' +
		'pixels of the label rather than the whole header');
	assert(/min-height:\s*var\(--tap\)/.test(btn[1]),
		'the sort button can drop below the tap floor, so on a phone the ' +
		'only way to re-sort is to hit a sub-44px target');
	assert(/cursor:\s*pointer/.test(btn[1]),
		'the sort button does not say it is clickable');
	assert(/button\.cm-table__sort:focus-visible\s*\{/.test(comp),
		'the sort button has no focus ring, so a keyboard user sorting a ' +
		'column cannot see where they are');
});

check('the sort direction is drawn from aria-sort, never from a colour class', () => {
	const comp = read('src/styles/components.css');
	// The visible mark and the announced state must be one source. If
	// the dot were its own class the two could drift: a header that
	// announces "ascending" and draws nothing.
	assert(/button\.cm-table__sort\[aria-sort='descending'\]::after\s*\{/.test(comp),
		'the sort mark is not drawn from aria-sort, so the direction a ' +
		'screen reader announces and the direction a reader sees can ' +
		'disagree');
	const dot = /button\.cm-table__sort\[aria-sort='descending'\]::after\s*\{([^}]*)\}/.exec(comp);
	assert(/background:\s*var\(--ink-dim\)/.test(dot[1]),
		'the active sort mark uses a hardcoded or absent colour, so it is ' +
		'tinted rather than drawn from the palette');
	// An unsorted column must be visibly unsorted, or the reader cannot
	// tell which column the table is currently ordered by.
	const idle = /button\.cm-table__sort::after\s*\{([^}]*)\}/.exec(comp);
	assert(idle && /background:\s*transparent/.test(idle[1]),
		'an unsorted header draws the same mark as a sorted one, so the ' +
		'table never says which column it is ordered by');
});

// An invalid field is marked with the ink, not a red border: the page
// already prints the message, and red is the one hue that does not
// survive a dark theme, a greyscale print, or red-green colour blindness.
check('an invalid .cm-code field is marked with the ink, never a hue', () => {
	const m = /\.cm-code\[aria-invalid='true'\]\s*\{([^}]*)\}/.exec(compSrc);
	assert(m, 'no .cm-code[aria-invalid="true"] rule');
	// The hue check must run FIRST, or a replacement that breaks the ink
	// token will fire the ink assert and this guard never executes - a
	// classic dead code defect in the test itself.
	const decls = m[1].split(';').map((d) => d.trim()).filter(Boolean);
	const hue = decls.filter((d) => /(red|#[0-9a-f]{3,8}\b|rgb\(|hsl\()/i.test(d)
		&& !/var\(--/.test(d));
	assert(hue.length === 0,
		'the invalid field carries a literal colour, not a palette token: '
		+ hue.join('; '));
	assert(/border-color:\s*var\(--ink\)/.test(m[1]),
		'the invalid field does not mark with ink');
	assert(/box-shadow:\s*inset/.test(m[1]),
		'the invalid field has no underline mark, so it differs from the ' +
		'rest field by border colour alone');
});

// A spinning GLYPH needs the animation to actually be there, and to be
// the same keyframes .cm-spinner uses - a second keyframe would drift out
// of step with the ring beside it.
check('cm-glyph-spin reuses the library keyframes', () => {
	const g = /\.cm-glyph-spin\s*\{([^}]*)\}/.exec(compSrc);
	assert(g, 'no .cm-glyph-spin rule');
	const a = /animation:\s*([^;]+);/.exec(g[1]);
	assert(a, '.cm-glyph-spin declares no animation');
	assert(/cm-spin\b/.test(a[1]) && /infinite/.test(a[1]),
		`.cm-glyph-spin must reuse the cm-spin keyframes and loop forever, `
		+ `got: ${a[1].trim()}`);
	// the keyframes it names must exist
	assert(/@keyframes cm-spin\b/.test(compSrc),
		'cm-glyph-spin names cm-spin but that keyframe is not defined');
});

// A focus ring that is technically present but 1px is not a visible
// indicator on a phone: at arm's length, against a 1px border of similar
// weight, with no cursor to imply "something is focused here", the reader
// is looking for a change and cannot find one. The existing checks assert
// the outline is not `none`; none of them assert it is HEAVY enough to
// see, which is why 1px has been the value all along without anyone
// deciding it.
//
// The DESKTOP value stays 1px - that is the house style and changing it
// would be a design decision, not a fix. So this asserts the coarse
// pointer only, and reads it out of the at-rule: the base declaration is
// still 1px and a naive grep would score that as the answer.
check('the focus ring is heavy enough to see on a coarse pointer', () => {
	const base = baseSrc.replace(/\/\*[\s\S]*?\*\//g, '');
	const fv = /:focus-visible\s*\{([^}]*)\}/.exec(base);
	assert(fv, 'no :focus-visible rule to measure');
	const coarse = allAtRuleBodies(baseSrc, '@media (pointer: coarse)');
	const cf = /:focus-visible\s*\{([^}]*)\}/.exec(coarse);
	assert(cf,
		'no coarse-pointer focus rule: 1px is the desktop house style and '
		+ 'stays, but a phone held at arm\'s length needs a heavier ring');
	const w = /outline(?:-width)?:\s*([\d.]+)px/.exec(cf[1]);
	assert(w, `cannot read the coarse focus outline width from: ${cf[1].trim()}`);
	// The OFFSET is asserted on the COARSE body, not the base: the base
	// keeps its own offset, so a check reading the base stays green while
	// the phone loses the gap - and a ring drawn flush against the control
	// reads as a second border, which is the failure this whole rule is
	// about. Proven: `focus-coarse-loses-offset` survived reading the base body instead.
	assert(/outline-offset:\s*([\d.]+)px/.test(cf[1]),
		'the coarse-pointer focus ring is not offset from the control, so it '
		+ 'reads as a second border rather than a ring around it');
	assert(Number(w[1]) >= 2,
		`the coarse-pointer focus ring is ${w[1]}px - the same weight as the `
		+ '1px border it sits outside, so a reader looking for a change '
		+ 'cannot see one');
	// and the desktop idiom must NOT have been quietly rewritten, since
	// that was the thing being preserved
	const dw = /outline(?:-width)?:\s*([\d.]+)px/.exec(fv[1]);
	assert(dw && Number(dw[1]) < 2,
		'the desktop focus ring was changed; it is the house style and only '
		+ 'the coarse pointer was in scope');
});

/* ---------- search ---------- */

// Every var() in a rule must RESOLVE. An undefined custom property inside a
// declaration invalidates it at computed-value time, and in a SHORTHAND that
// takes the whole shorthand with it - so `outline: 2px solid var(--focus)`
// with `--focus` undeclared does not paint a ring in the wrong colour, it
// paints NO ring, and the computed outline-style is `none`.
//
// This is the one defect class in this library that every existing check
// structurally cannot see: a regex over the CSS reads
// `outline: 2px solid var(--focus)` as perfectly well-formed, and the
// "focus ring is not none" checks read base.css, which is a different rule.
// It shipped. MEASURED in WebKit at 390, 375 and 1440 before the fix:
// outlineStyle was `none` on the search field in all three.
//
// So this asserts RESOLUTION, not presence: every var() referenced by a
// component rule must name a token that some layer actually declares.
check('every var() a component rule names resolves to a declared token', () => {
	const tokens = new Set(
		[...read('src/styles/tokens.css').matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
	);
	// 139 DECLARATIONS but ~69 unique NAMES: the dark and light blocks each
	// redeclare the same names with different values, which is the point of
	// a theme pair. Assert against the declaration count, not the name count,
	// or this self-check fires on a perfectly healthy sheet.
	assert([...read('src/styles/tokens.css').matchAll(/^\s*--[a-z0-9-]+\s*:/gm)].length > 100,
		'the token declaration scan found suspiciously few declarations');
	assert(tokens.size > 40, `only ${tokens.size} unique token names parsed; the regex is wrong`);
	const bare = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
	// A var() WITH a fallback is not a dangling reference - `var(--x, 4rem)`
	// is a documented pattern in this sheet (the header height, the table cap,
	// the meter fill, the grid column counts), where the consumer sets the
	// property and the default is the sane answer when they do not. So the
	// scan only flags a var() with NO fallback: that one is genuinely
	// unresolved and invalidates its declaration. Getting this wrong in
	// either direction is bad - flagging the fallbacks cries wolf on 5
	// correct rules, and ignoring every var() would miss the real defect.
	const refs = [...bare.matchAll(/var\(\s*(--[a-z0-9-]+)(\s*,)/g)]
		.filter((m) => m[2])
		.map(() => true);
	const dangling = [...bare.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
	assert(refs.length + dangling.length > 50,
		'the var() scan found suspiciously few uses, so it is scanning too little');
	const missing = [...new Set(dangling)].filter((v) => !tokens.has(v));
	assert(missing.length === 0,
		`components.css references ${missing.length} undeclared token(s) with NO `
		+ `fallback: ${missing.join(', ')}. An undefined var() invalidates its `
		+ 'declaration, and inside a shorthand it takes the whole declaration with it.');
	// base.css too: the same trap in the layer that owns element defaults,
	// with the same fallback carve-out.
	//
	// `--cm-box` is declared in base.css, NOT tokens.css, so the set has to
	// include custom properties declared in EITHER layer - a token is
	// declared wherever it is declared, not only where the palette lives.
	const baseBare = baseSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');
	const baseDeclares = new Set(
		[...baseBare.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
	);
	for (const m of baseBare.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
		assert(tokens.has(m[1]) || baseDeclares.has(m[1]),
			`base.css references undeclared token ${m[1]}`);
	}
});

// A search field is a TEXT input, so iOS zooms the viewport on focus for
// anything under 16px and leaves the reader panned into a layout they
// cannot get back from. The base layer enforces max(var(--min-font), 1rem)
// for every input - but base.css now EXCLUDES .cm-search__input by name
// (to win the padding fight at (0,6,1)), which means that exclusion also
// removed the ONLY font-size the field would otherwise have inherited.
//
// The two exclusions are coupled and a change to either one can silently
// remove the floor. Proven: at `var(--text-sm)` (14px) the field computed
// 14px in WebKit at 390 and 375, and the floor was gone with nothing else
// reporting it.
check('the search field keeps the 16px form-text floor the base rule gives up', () => {
	const inp = declsFor(compSrc, '.cm-search__input');
	assert(inp, '.cm-search__input has no rule of its own');
	assert(/font-size:\s*max\(var\(--min-font\),\s*1rem\)/.test(inp),
		'the search field does not carry the 16px form-text floor. base.css '
		+ 'excludes .cm-search__input from its input rule to win the padding '
		+ 'specificity fight, and that exclusion also removes the floor this '
		+ 'class has to declare for itself. iOS zooms the viewport under 16px.');
	// And the exclusion really is there - if someone "simplifies" base.css
	// back, the field would be fine but the PADDING would break, which is a
	// different bug. Assert the pairing so the two cannot be half-reverted.
	const baseBare = baseSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');
	assert(/:not\(\.cm-search__input\)/.test(baseBare),
		'base.css no longer excludes .cm-search__input from its (0,6,1) input '
		+ 'rule; the component is (0,1,0) and will lose the padding battle');
	// The focus ring, asserted as a RESOLVABLE reference and at a weight a
	// thumb can see. This is the one the shipped bug hid behind: the rule
	// read `outline: 2px solid var(--focus)` and --focus was never declared,
	// so the whole shorthand went invalid at computed-value time and
	// `outline-style` computed to `none` - MEASURED in WebKit at 390, 375
	// and 1440. A hairline is the same failure at lower severity: the token
	// resolves but the ring is invisible on a phone.
	const infocus = (compSrc.match(/\.cm-search__input:focus-visible\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/outline[^;]*var\(--focus\)/.test(infocus),
		'the search focus ring no longer references --focus, so an undefined '
		+ 'token can silently drop the entire outline');
	const rw = /outline(?:-width)?:\s*([\d.]+)px/.exec(infocus);
	assert(rw && Number(rw[1]) >= 2,
		`the search focus ring is ${rw ? rw[1] + 'px' : 'unreadable'} - a 1px ring `
		+ 'against a 1px border is not a focus indicator a reader can see');
	// The glyph must be SIZED in the CSS, not left to the replaced-element
	// default. `.cm-search__input`'s left gutter is derived from a 1em
	// glyph; a default-size svg is 24px, which is wider than the gutter
	// assumes and pushes the placeholder back under it. Same rule
	// `.cm-btn > svg` already states.
	const svg = (compSrc.match(/\.cm-search__icon > svg\s*\{([^}]*)\}/) || [, ''])[1];
	assert(/width:\s*1em/.test(svg) && /height:\s*1em/.test(svg),
		'the search glyph is not sized in em, so it renders at the '
		+ 'replaced-element default and the gutter arithmetic is wrong');
});

// The clear button sits INSIDE the field, over its right edge, so the input
// needs a right gutter big enough to keep a typed value from running under
// the X. Both numbers come from one token precisely so they cannot drift.
check('the search gutter is derived from the clear button, not guessed', () => {
	const inp = declsFor(compSrc, '.cm-search__input');
	assert(inp, '.cm-search__input has no rule of its own');
	assert(/padding-right:[^;]*var\(--search-clear\)/.test(inp),
		'padding-right is not derived from --search-clear, so the value can '
		+ 'run under the X as soon as the button changes size');
	const clr = declsFor(compSrc, '.cm-search__clear');
	assert(clr, '.cm-search__clear has no rule of its own');
	assert(/width:\s*var\(--search-clear\)/.test(clr) && /height:\s*var\(--search-clear\)/.test(clr),
		'the clear button does not take its size from --search-clear, so the '
		+ 'gutter and the button it clears are two independent numbers');
	// The token must be a length, and not a tap floor: a 44px X inside a
	// 44px field is the whole field, which is a control the reader aims at
	// nowhere. It grows to the floor under `pointer: coarse` instead.
	const tok = /--search-clear:\s*([^;]+);/.exec(read('src/styles/tokens.css'));
	assert(tok, '--search-clear is not declared in tokens.css');
	assert(!/var\(--tap\)/.test(tok[1]),
		'--search-clear aliases --tap, so the clear button IS the tap floor '
		+ 'and a token that can only equal another token is a knob that '
		+ 'cannot be turned');
	assert(/px/.test(tok[1]), `--search-clear is not a length: ${tok[1].trim()}`);
});

// 32px of chrome is a fine mouse target and under the tap floor a thumb can
// aim at. Same doctrine as .cm-btn--sm: the floor is a property of the
// POINTER, so it is answered in a media query, not in the token.
check('the clear button takes the tap floor on a coarse pointer only', () => {
	const coarse = allAtRuleBodies(read('src/styles/components.css'), '@media (pointer: coarse)');
	const c = /\.cm-search__clear\s*\{([^}]*)\}/.exec(coarse);
	assert(c,
		'no coarse-pointer rule for .cm-search__clear; it is --search-clear '
		+ '(32px) of chrome, which is under the --tap floor a thumb needs');
	assert(/width:\s*var\(--tap\)/.test(c[1]) && /height:\s*var\(--tap\)/.test(c[1]),
		'the coarse clear button does not take the tap floor in BOTH axes - a '
		+ 'wide-but-short target is still a short target');
});

// Ten rpm pages emit this exact class quartet. A library component that no
// page demonstrates is dead CSS the next person cannot trust, and this one
// was defined, wrong, and undemonstrated for a cycle.
check('the search family is demonstrated on the page before it is trusted', () => {
	assert(built, 'dist/index.html is missing - run `npm run build` first');
	for (const cls of ['cm-search', 'cm-search__input', 'cm-search__icon',
		'cm-search__clear', 'cm-search--wide']) {
		assert(renderedClasses.has(cls),
			`.${cls} is defined in the library but never rendered on the built `
			+ 'page. rpm emits all five; the showcase has to show the markup a '
			+ 'consumer actually ships.');
	}
	// The glyph is decorative AND it carries a shape: without aria-hidden a
	// screen reader announces "magnifying glass" before every field.
	const icon = /<span class="cm-search__icon"([^>]*)>/.exec(built);
	assert(icon, 'the search icon is not a span in the built markup');
	assert(/aria-hidden="true"/.test(icon[1]),
		'the search glyph is not aria-hidden, so it is announced before every '
		+ 'field it labels');
	// The clear button needs a name, since a bare X is announced as "button".
	const clr = /<button[^>]*class="cm-search__clear"([^>]*)>/.exec(built);
	assert(clr, 'the clear button is not in the built markup');
	assert(/aria-label="[^"]{3,}"/.test(clr[1]),
		'the clear button has no aria-label; an icon-only control is announced '
		+ 'as just "button"');
});

// An affordance that acts ON a control (a reveal toggle, a clear button)
// belongs inside that control's box. `.cm-field-row` is the grid for two
// FIELDS side by side, so a button dropped into it wraps to a second row
// and stops lining up with the value it acts on - which is exactly what
// the sign-in page was doing before this existed.
check('.cm-field__control keeps its affordance on the control, not a new row', () => {
	const ctl = ruleBodies(compSrc, '.cm-field__control')[0];
	assert(ctl && /position:\s*relative/.test(ctl),
		'.cm-field__control is not a positioning context, so its affordance ' +
		'cannot sit on the control it belongs to');
	const btn = ruleBodies(compSrc, '.cm-field__control > .cm-icon-btn')[0];
	assert(btn && /position:\s*absolute/.test(btn) && /right:\s*0/.test(btn),
		'the affordance is not pinned to the control\'s right edge');
	assert(btn && /top:\s*50%/.test(btn) && /translateY\(-50%\)/.test(btn),
		'the affordance is not centred on the control, so it drifts when the ' +
		'control is taller than one line');
	// the control itself must not lose width to the overlay
	const inp = ruleBodies(compSrc, '.cm-field__control > input')[0];
	assert(inp && /flex:\s*1 1 auto/.test(inp) && /min-width:\s*0/.test(inp),
		'the control does not absorb the overlay, so text runs under it');
	// ...and it must not only absorb the overlay but RESERVE room for it:
	// the base input padding is 0.7rem and the overlay is a full --tap
	// square, so a long value scrolls under the glyph and its last
	// characters are unreadable.
	//
	// The assertion is SPECIFICITY, not the presence of the string. A plain
	// grep for `padding-right: calc(var(--tap)` is satisfied by a rule that
	// loses the cascade: the doubled class is what carries it past the base
	// `input:not()x3` selector, and dropping that class still leaves the
	// declaration sitting in the file looking correct. Measured in WebKit:
	// the one-class version parses, `:has()` is supported, the suite is
	// green, and the computed padding-right is still 11.2px. Proven by the
	// `reserve-loses-specificity` mutant, which survived the string check.
	const baseSel = "input:not([type='checkbox']):not([type='radio'])"
		+ ":not([type='range'])";
	// Specificity as this library already counts it - `:not()` contributes
	// its ARGUMENT - PLUS the class selectors that argument-counting alone
	// misses. Counting only :not() and [] scores the reserve rule 0 and the
	// base rule 6, which INVERTS the real comparison: the doubled class is
	// exactly what carries this declaration past the base. `:has()`
	// contributes its most specific argument, so its inner class counts here
	// as it does in a browser. Verified against a real WebKit cascade.
	const spec = (sel) => {
		const flat = sel.replace(/:not\(([^)]*)\)/g, '$1');
		const hasInner = (sel.match(/:has\(([^)]*)\)/g) || [])
			.map((h) => h.slice(5, -1));
		const count = (t) => (t.match(/\.[\w-]+/g) || []).length
			+ (t.match(/\[[^\]]+\]/g) || []).length
			+ (t.match(/:not\(/g) || []).length;
		return count(flat) + hasInner.reduce((n, inner) => n + count(inner), 0);
	};
	const reserveSel = /(\.cm-field__control[^\n{]*:has\([^)]*\)[^\n{]*)>\s*input\s*\{/.exec(compSrc);
	assert(reserveSel,
		'the control reserves no room for its affordance: base padding is '
		+ '0.7rem and the overlay is var(--tap) wide, so the end of a long '
		+ 'value runs under the glyph');
	const rSel = reserveSel[1].trim();
	assert(spec(rSel) > spec(baseSel),
		`the reserve rule (${rSel}) has specificity ${spec(rSel)}, which does `
		+ `not outrank the base input rule (${spec(baseSel)}): the `
		+ 'declaration is present but never applies. Pad :not() counts its '
		+ 'argument, so the base scores three attribute selectors.');

	// and the reserve must cover the overlay PLUS a gap, or the last
	// character clears the box but touches the glyph. Scoped to the
	// reserve rule's OWN body: grepping compSrc finds some other rule's
	// perfectly good declaration and reports a pass.
	const reserveBody = /\.cm-field__control\.cm-field__control[^\n{]*>\s*input\s*\{([^}]*)\}/.exec(compSrc);
	const pr = reserveBody
		&& /padding-right:\s*calc\(var\(--tap\) \+ ([^)]+)\)/.exec(reserveBody[1]);
	assert(pr,
		'the reserve does not leave a gap beside the glyph: it must be the '
		+ 'overlay width PLUS a gap, read from the reserve rule itself');
	// and the tap target stays a full square - an absolutely positioned
	// button defaults to shrink-to-fit, which is how a 44px rule quietly
	// becomes a 20px one.
	// The tap size lives INSIDE `@media (pointer: coarse)` and under the
	// VARIANT, not the base class - so it has to be read out of the at-rule
	// body, and it has to name `--bare`. Two ways this silently rots: the
	// floor moves to the base class only (a desktop box, and a consumer
	// that hand-rolls its own width gets 32x44), or it stays on the base
	// class (a consumer that swaps the base class out loses the square).
	// Assert it where it is declared, on the class as rendered.
	const coarse = allAtRuleBodies(compSrc, '@media (pointer: coarse)');
	assert(/\.cm-icon-btn--bare\s*\{[^}]*width:\s*var\(--tap\)/.test(coarse),
		'the bare icon button is not sized to the tap floor on a coarse pointer');
	assert(/\.cm-icon-btn--bare\s*\{[^}]*height:\s*var\(--tap\)/.test(coarse),
		'the bare icon button is sized in width but not height, so its target ' +
		'is a letterbox rather than a square');
	// the overlay must not be what makes it small: absolutely positioned
	// buttons shrink to fit their glyph unless something pins the box.
	assert(/\.cm-field__control > \.cm-icon-btn/.test(compSrc),
		'the affordance inside .cm-field__control is not the class that ' +
		'carries the tap floor');
	assert(/button\s*\{[^}]*background:\s*none/.test(baseSrc),
		'a bare <button> keeps the UA button face: the library never resets ' +
		'background on a bare button, so WebKit paints #c0c0c0 on every ' +
		'nav row, tab, chip and row');
	assert(/button\s*\{[^}]*(?:-webkit-)?appearance:\s*none/.test(baseSrc),
		'the bare <button> reset clears appearance but not the native ' +
		'-webkit-appearance, which is the one WebKit actually honours on a ' +
		'button - the UA face comes back');
	assert(/button\.cm-row--on\s*[,{][^{}]*\{[^}]*background/.test(compSrc),
		'a selected button row (cm-row--on) cannot outrank the element ' +
		'default `button.cm-row { background: transparent }`, so the "on" ' +
		'state paints nothing - measured transparent in WebKit');
	assert(/\.cm-tag\s*\{[^}]*flex:\s*0\s+0\s+auto/.test(compSrc),
		'a tag is shrinkable as a flex item, so a .cm-head-row squeezes it ' +
		'below its content width and it wraps - measured 43px vs 24px');
	assert(/\.cm-row__meta--wrap\s*\{[^}]*flex-wrap:\s*wrap/.test(compSrc),
		'a meta slot holding a CONTROL (a select, an inline edit) has no ' +
		'wrapping variant, so .cm-row__body { overflow: hidden } clips it ' +
		'and the control is unreachable on a phone');
	assert(/\.cm-row__body--wrap\s*\{[^}]*flex-wrap:\s*wrap/.test(compSrc),
		'a row body carrying a control has no wrapping variant, so the ' +
		'meta slot and the button group fight for one line and the control ' +
		'ends up covered at 390px');
	assert(/\.cm-row__body--wrap\s*>\s*\.cm-row__meta--wrap\s*\{[^}]*flex:\s*1\s+0\s+100%/.test(compSrc),
		'the wrapped meta slot is not given a line of its own, so it ' +
		'competes with the title for the same line and the control ends up ' +
		'under it');

/* Same specificity, so source order decides. Its OWN check because the two
   showcase-coverage checks would otherwise fire first on a rename and
   mask it. */
check('a short inline input keeps its own width', () => {
	const tight = compSrc.indexOf('.cm-inline__input--tight {');
	const base = compSrc.indexOf('.cm-inline__input {');
	assert(tight > base,
		'.cm-inline__input--tight is not declared after .cm-inline__input, ' +
		'so a short field renders full width - measured 386px instead of 11ch');
});
check('a bare field is still full width after the width split', () => {
	// `width: 100%` moved out of the (0,6,1) element-default block into
	// its own single-declaration rule that steps aside for the one class
	// that sizes itself.
	//
	// Parsed, not regex-matched: a comment inside the element-default body
	// contains the text `width: 100%`, so any regex loose enough to find
	// the split also matches the block ABOVE it - the assertion then passes
	// against the wrong rule and guards nothing. Strip comments first, take
	// only the rules that declare a width, and require exactly the three
	// element defaults the split is allowed to cover.
	const bare = baseSrc.replace(/\/\*[\s\S]*?\*\//g, '');
	const widthRules = [];
	for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (/\bwidth:\s*100%/.test(m[2]) && /\b(input|textarea|select)\b/.test(m[1]))
			widthRules.push(m[1].trim());
	}
	assert(widthRules.length === 1,
		'the bare field width split should be one rule covering the ' +
		'element defaults, found ' + widthRules.length + ': ' +
		JSON.stringify(widthRules));
	const only = widthRules[0];
	// `only` still holds the newlines from the multi-line selector list.
	// Flatten it, or the `(^|[,\s])` boundary never matches at a line
	// start and the check reports the wrong assertion.
	const sel = only.replace(/\s+/g, ' ');
	for (const el of ['input', 'textarea', 'select']) {
		assert(new RegExp('(^|[, ])' + el + ':not\\(').test(sel),
			'a bare ' + el + ' must still be full width, but the width ' +
			'rule does not cover it: ' + only);
	}
	assert(only.includes(':not(.cm-inline__input)'),
		'the bare field width rule no longer steps aside for ' +
		'.cm-inline__input, so a short input cannot size itself - ' +
		'measured 386px instead of 11ch');
	assert(!/\[class\*=/.test(only),
		'the bare field width rule skips EVERY element carrying a cm- ' +
		'class, so any component input without cm-inline__input silently ' +
		'loses its full width');
});
check('the fill shell releases the prose measure, not just the cap', () => {
	// `.cm-shell--rail` centres `--maxw` in the space beside the rail -
	// right for a content page. An application shell needs the whole
	// column, or the page drifts right as the window widens (measured
	// x=336 at 1280px, x=416 at 1440px).
	//
	// `width: auto` is the part that is easy to miss: base.css gives
	// `main` `width: var(--maxw)`, so relaxing only `max-width` leaves
	// the box 860px wide while COMPUTED max-width reads `none` - which
	// looks fixed and is not.
	const rule = compSrc.match(
		/\.cm-shell--rail--fill,\s*\.cm-shell--rail--fill > \*\s*\{([^}]*)\}/);
	assert(rule,
		'.cm-shell--rail--fill has no combined rule for the shell and ' +
		'its children; the two were fixed separately and drifted');
	assert(/width:\s*auto/.test(rule[1]),
		'.cm-shell--rail--fill no longer sets width: auto, so base.css ' +
		'width: var(--maxw) still pins the column - measured 860px in a ' +
		'1440px shell with max-width computed to none');
	assert(/max-width:\s*none/.test(rule[1]),
		'.cm-shell--rail--fill no longer releases the prose max-width');
	assert(/margin-inline:\s*0/.test(rule[1]),
		'.cm-shell--rail--fill no longer un-centres the column');
});

});

/* ================= async checks (installer) ================= */
for (const [name, fn] of pending.splice(0)) {
	try {
		await fn();
		passed++;
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures.push([name, e.message]);
		console.log(`FAIL  ${name}\n        ${e.message}`);
	}
}

/* ================= the header must stay pinned ================= */
{
	// The runtime test tests/verify-sticky-scroll.py drives this with a REAL
	// wheel gesture. These are the source-level invariants it depends on, so
	// a regression is caught by the contract suite too, not only by WebKit.
	const css = read("src/styles/components.css");
	const base = ruleBodies(css, ".cm-header").join("\n");
	check("the header is sticky, not static", () => {
		if (!/position:\s*sticky/.test(base)) throw new Error("no position: sticky on .cm-header");
	});
	check("the header is pinned to the top of the viewport", () => {
		if (!/top:\s*0/.test(base)) throw new Error("no top: 0 on .cm-header");
	});
	check("the header is painted above the page, so content scrolls under it", () => {
		const z = base.match(/z-index:\s*([^;]+);/);
		if (!z) throw new Error("no z-index on .cm-header");
		const level = resolveLayer(z[1], ".cm-header");
		if (level < 1) throw new Error("header z-index " + z[1].trim() + " resolves to " + level + ", not above the page");
	});
	check("the rail variant is fixed, so it is pinned independently of sticky", () => {
		// Sticky inside a horizontally scrolling ancestor, or a rail whose
		// containing block moves, both silently unpin it. `fixed` cannot.
		if (!/\.cm-header--rail[^{]*\{[^}]*position:\s*fixed/.test(css))
			throw new Error("the rail is not position: fixed");
	});
	check("nothing above the header creates a containing block or scroll box", () => {
		// transform / filter / overflow on an ANCESTOR breaks sticky, and the
		// header must be the first thing painted in <body> for the sticky bar
		// to sit against the viewport edge. Check the SOURCE for the
		// structural intent and the SHIPPED HEADER for the real constraint.
		//
		// Not the <body> regex: in an Astro page the first tag inside <body>
		// is the <Header COMPONENT call, not a literal <header>, so a source
		// regex reads "the header is not first" on a perfectly correct page.
		const page = read("src/pages/index.astro");
		const body = page.match(/<body[^>]*>\s*\n?\s*<(\w+)/);
		if (!body) throw new Error("cannot find <body> in the showcase");
		if (body[1] !== "Header")
			throw new Error("<body> starts with <" + body[1] + ">, not <Header>");
		// The sticky header itself must not create a scroll container: the
		// root clip is what keeps the tooltip from widening the document, and
		// `hidden` there would unpin this bar. See base.css.
		// Strip block comments PROPERLY: these comments open at column 0
		// with `/* ===`, so a line filter looking for a leading `*` strips
		// nothing and the prose `overflow-x: hidden` - the sentence that
		// explains why hidden is wrong - matches as if it were the rule.
		const base = read("src/styles/base.css").replace(/\/\*[\s\S]*?\*\//g, "");
		if (/overflow-x:\s*hidden/.test(base))
			throw new Error("the root uses overflow-x: hidden, which silently breaks position: sticky");
		if (!/overflow-x:\s*clip/.test(base))
			throw new Error("the root no longer uses overflow-x: clip");
	});
}

/* ================= the config is actually the config ================= */
{
	// `src/astro/config.ts` says it is "the ONE place to set your identity".
	// While that was true in the comment and false in the code, the showcase
	// hardcoded its own GitHub URL on the Header line and config.ts still
	// said `github.com/you` - so the file that advertised itself as the
	// single source of truth was the one thing the page never read. A config
	// nothing reads is a comment.
	const config = read("src/astro/config.ts");
	const page = read("src/pages/index.astro");

	check("the showcase imports SITE from the shared config", () => {
		if (!/import\s*\{\s*SITE\s*\}\s*from\s*['"][^'"]*astro\/config['"]/.test(page))
			throw new Error("src/pages/index.astro does not import SITE from astro/config");
	});

	check("the showcase takes its GitHub link from SITE, not a literal", () => {
		const header = page.slice(page.indexOf("<Header"), page.indexOf("<Header") + 600);
		if (/extraLinks/.test(header) && /github\.com\/[a-z]/i.test(header))
			throw new Error("the Header block hardcodes a github.com URL instead of reading SITE.github");
	});

	check("the starter config ships the real identity, not a placeholder", () => {
		// It is a copy-and-edit template, so placeholders are legal in a
		// comment - but the VALUES are what a consumer copies verbatim.
		const body = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
		if (/github\.com\/you\b/.test(body))
			throw new Error("SITE.github is still the placeholder github.com/you");
		if (/you@example\.com/.test(body))
			throw new Error("SITE.email is still the placeholder you@example.com");
		if (/https:\/\/example\.com/.test(body))
			throw new Error("SITE.url is still the placeholder example.com");
	});

	check("the deployed header's GitHub href is the configured one", () => {
		const gh = config.match(/github:\s*'([^']+)'/);
		if (!gh) throw new Error("cannot read SITE.github out of config");
		if (!gh[1].startsWith("https://github.com/omiinaya/"))
			throw new Error("SITE.github does not point at the project's own repository: " + gh[1]);
	});
}

/* ================= the drawer must not unpin the header ================= */
{
	// Omar: "scroll the background with sidebar open... the gap is at the top."
	//
	// The runtime used to scroll-lock the page behind the open drawer with
	// `body.style.overflow = 'hidden'`. That was wrong twice over:
	//   * <html> is the scrolling element here, so a body lock locked nothing;
	//   * an `overflow: hidden` box BECOMES A SCROLL CONTAINER, so body became
	//     the containing block for the sticky header and the bar rode the
	//     document out of the viewport (measured headerTop -1800).
	//
	// These pin the SOURCE so the lock cannot come back. The runtime proof is
	// tests/verify-drawer-sticky.py.
	const js = read("src/js/cli-mono.js");
	// Comments must be stripped first: the explanation of WHY the lock is
	// wrong necessarily names the lock, and a regex that reads the comment
	// reports the fixed file as broken.
	const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

	check("the runtime never sets an overflow scroll-lock on body", () => {
		if (/body\.style\.overflow\s*=\s*['"]hidden['"]/.test(jsCode))
			throw new Error("body.style.overflow = 'hidden' makes body a scroll container and unpins the sticky header");
	});

	check("the drawer open path writes no overflow at all", () => {
		// The lock is gone entirely on open; only the close path clears any
		// value a consumer or an older build may have left behind.
		if (/if\s*\(open\)\s*\{[^}]*body\.style\.overflow/.test(jsCode))
			throw new Error("the open branch still writes an overflow lock");
	});

	check("the drawer is fixed, so the page is covered and needs no lock", () => {
		const css = read("src/styles/components.css");
		// The drawer must be position:fixed at mobile width; that is what makes
		// removing the scroll-lock safe.
		const drawer = ruleBodies(css, ".cm-header__links").join("\n");
		if (!/position:\s*fixed/.test(drawer))
			throw new Error("the drawer is not position:fixed, so dropping the lock would expose the page");
	});

	check("the scrim covers the viewport, so a tap cannot reach the page behind", () => {
		const css = read("src/styles/components.css");
		// The full-bleed rule is gated on `.cm-js` (the runtime adds the class
		// only when it actually creates the scrim), so look it up there. A bare
		// `.cm-nav-scrim` lookup finds only the transition reset and reads a
		// correctly-built scrim as missing.
		const scrim = ruleBodies(css, ".cm-js .cm-nav-scrim").join("\n");
		if (!/position:\s*fixed/.test(scrim))
			throw new Error("the scrim is not position:fixed");
		if (!/inset:\s*0|top:\s*0/.test(scrim))
			throw new Error("the scrim does not cover the viewport from the top edge");
	});
}

/* ================= a thumb can hit the action ================= */
{
	// `.cm-btn--sm` sets min-height: 0 ON PURPOSE - it is for a dense row. But
	// the action inside an EMPTY STATE is the only way out of it, and measured
	// on a 390px coarse pointer it was a 27px target against --tap: 44px, as
	// the only control in its specimen.
	const css = read("src/styles/components.css");

	check("the empty-state action takes the tap floor on a touch viewport", () => {
		const rule = /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.cm-state__actions\s+\.cm-btn\s*\{[^}]*min-height:\s*var\(--tap\)/.exec(css);
		if (!rule)
			throw new Error("no (pointer: coarse) rule giving .cm-state__actions .cm-btn min-height: var(--tap)");
	});

	check("the coarse-pointer floor on the small variant is the one the phone owes", () => {
		// THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal was the
		// right call on a measurement, so the reasoning is recorded here
		// rather than in a commit message someone will have to dig for.
		//
		// It previously forbade any `(pointer: coarse)` min-height on
		// `.cm-btn--sm`, on the grounds that doing so "resizes every dense
		// toolbar row on a phone". MEASURED in WebKit at 402 and 375: the
		// floor costs 16px of extra height in one `.cm-btn-group` and adds
		// ZERO extra wrap lines - every group wraps to the same 3 lines
		// either way. So the density the variant protects does not
		// actually collapse, and the test was defending a cost that is
		// 16px against a benefit that is a 28px target on a phone.
		//
		// Worse, it had become unfalsifiable in the dangerous direction: the
		// suite went red only because the previous cycle's CSS disagreed
		// with it, and the cheapest way to green it was to delete the fix.
		// What it should have guarded is SCOPE - a floor that leaks onto
		// every button in the library. So it now asserts the rule is
		// pinned to `.cm-btn--sm` alone and comes from the token.
		const coarseBlocks = [...css.matchAll(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/g)]
			.map(m => m[1]);
		assert(coarseBlocks.length > 0, 'there is no coarse-pointer block to inspect');
		const leaky = coarseBlocks.filter(b => /\.cm-btn--sm\s*\{[^}]*min-height/.test(b));
		assert(leaky.length === 1,
			`exactly one coarse-pointer block may set .cm-btn--sm min-height, found ${leaky.length} ` +
			'- a floor that reached more than the small variant would resize every button in the library');
		assert(/\.cm-btn--sm\s*\{[^}]*min-height:\s*var\(--tap\)/.test(leaky[0]),
			'the coarse-pointer floor on .cm-btn--sm must come from var(--tap), not a literal');
		// And the fine-pointer half has to be the one that steps below, or
		// the coarse rule is overriding a base that never opted out.
		const base = /\.cm-btn--sm\s*\{([^}]*)\}/.exec(css);
		assert(base && /min-height:\s*0/.test(base[1]),
			'.cm-btn--sm no longer steps below the floor on a fine pointer, so the coarse rule has nothing to restore');
	});

	check("the tap floor is a token, not a literal", () => {
		if (!/min-height:\s*var\(--tap\)/.test(css))
			throw new Error("the coarse-pointer floor does not use var(--tap)");
	});

	check("the small variant still documents that it steps below the floor", () => {
		// The dense-row decision, asserted as TEXT because it is a decision
		// about a media query rather than a declaration: `.cm-btn--sm` sets
		// min-height:0 for a fine pointer and takes var(--tap) for a thumb.
		//
		// If this ever silently becomes 44px everywhere the dense-row decision
		// is gone and nobody will notice, because the page still looks fine -
		// which is exactly what `--tap-sm: 44px` did: every `.cm-btn--sm`
		// measured EXACTLY `.cm-btn`'s 44px while the class stayed defined,
		// stayed rendered, and every existence test stayed green.
		if (!/\.cm-btn--sm\s*\{[^}]*min-height:\s*0/.test(css))
			throw new Error(".cm-btn--sm no longer steps below the tap floor on a fine pointer");
	});

	check("the small variant is not the same size as the button it modifies", () => {
		// The invariant that would have caught `--tap-sm: 44px`, and the
		// reason a modifier has to differ from its base at all.
		//
		// Asserted in the SOURCE, because the geometry is asserted in WebKit
		// by tests/verify-btn-variant-webkit.py: a test here cannot know which
		// pointer the reader is on, and the failure this guards is a claim
		// ("this variant changes something") that source can check directly.
		// `.cm-btn` sets min-height: var(--tap) and `.cm-btn--sm` sets
		// min-height: 0, so the two differ unless a token makes them equal.
		//
		// Scoped to the rule whose selector IS `.cm-btn`, and that scoping
		// is the whole point, twice over.
		//
		// `/\.cm-btn\s*\{([^}]*)\}/` searches the whole file, and there are
		// TWO rules matching `.cm-btn` that carry a
		// `min-height: var(--tap)` - the base at line 441 and the copy-button
		// composition further down. A mutation that flattened the BASE to
		// `min-height: 0` left this assertion green, because the regex
		// matched the second one and never looked at the first. That is the
		// last-in-source-order read the skill warns about, in a place nobody
		// would think to look for it.
		//
		// The SECOND half is subtler and bit anyway: the regex above matches
		// the TAIL of any selector that ends in `.cm-btn`, so
		// `.cm-head-row__action .cm-btn { white-space: nowrap }` - added
		// later, by a different cycle, for an unrelated fix - became "the
		// first `.cm-btn` rule" and carried no min-height at all. The suite
		// went red on a component that was correct. So walk the rule's whole
		// SELECTOR LIST and require `.cm-btn` to be one of the selectors,
		// which is the only reading that means "the base button rule".
		//
		// `want` is the WHOLE selector, compared as an EQUALITY against each
		// selector in the rule's list - not a substring, and not with the
		// trailing brace attached. Both of those looser readings fail
		// here, and both failed for real:
		//
		//   `.cm-btn {` never matches, because the matcher's captured
		//   "selector" group is everything between the previous `}` and
		//   this `{`, so a `{` inside it never appears.
		//
		//   `.cm-btn` as a SUBSTRING matches `.cm-head-row__action .cm-btn`
		//   - a rule added by a later cycle for an unrelated fix - and
		//   `includes` reported the BASE button as having whatever that
		//   rule declares. The suite went red on a correct component.
		//   "The rule whose selector IS `.cm-btn`" is the only reading
		//   that means what the check claims.
		//
		// Read from the COMMENT-STRIPPED source: a `{` or `}` inside a CSS
		// comment desyncs this matcher, so a rule boundary lands in the
		// wrong place and a correct rule reads as absent. Same reason
		// every other block here strips comments before asserting.
		const baseBtn = declForSelector('.cm-btn', compSrc, true);
		assert(baseBtn && /min-height:\s*var\(--tap\)/.test(baseBtn),
			'.cm-btn no longer takes its height from the --tap token, so the small variant has nothing to differ from');
		// And --tap must not have acquired a twin that a consumer could set
		// to the same value and silently flatten the variant.
		//
		// Comments are stripped first, and this is the same trap the card
		// block hit in the other direction: the note in tokens.css that
		// explains WHY --tap-sm was deleted has to name it, so the raw text
		// contains `--tap-sm: 44px` and the check fired on the explanation
		// of the fix rather than on the thing being fixed.
		const tokens = read('src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
		if (/--tap-sm\s*:/.test(tokens))
			throw new Error(
				"--tap-sm exists again; a token that can only equal --tap is a no-op knob, " +
				"and it made .cm-btn--sm render the same 44px box as .cm-btn"
			);
	});
}

/* ============ the standalone installer-layout suite ============ */
//
// tests/install-layout.test.mjs is a SELF-CONTAINED runner (it does its own
// pass/fail tally), because it drives the installer by RUNNING it into temp
// dirs and comparing bytes -- which needs its own execFileSync-based tree
// walk. It was written standalone and never wired into this file, so
// `npm test` never ran it: 11 tests, all of them guarding the embedded
// install layout, were invisible to the suite that ships the library.
//
// A test that nothing runs is a comment. It runs here, and its non-zero exit
// is a failure of THIS suite -- so the tally below is derived from the
// child's exit status, never from parsing its stdout for "passed", which is
// how a suite reports success for a child that crashed before printing.
{
	const standalone = join(root, 'tests', 'install-layout.test.mjs');
	check('the standalone installer-layout suite runs inside npm test', () => {
		assert(existsSync(standalone), `tests/install-layout.test.mjs is missing -- the embedded-layout tests are not being run at all`);
		const r = spawnSync('node', [standalone], { encoding: 'utf8', timeout: 180000 });
		if (r.status !== 0) {
			// Surface the child's own failure lines: a bare "exited 1" tells
			// the reader nothing about WHICH layout broke.
			const detail = (r.stdout || '').split('\n').filter((l) => l.includes('FAIL')).join('\n');
			throw new Error(`exited ${r.status}\n${detail || r.stderr || '(no output)'}`);
		}
	});
}

/* ============ the breadcrumb ============ */
//
// The trail above a detail page. It exists because a CONSUMER needed it:
// gantree and gantree-ui-icons each carry a byte-identical 14-line
// hand-rolled copy (.crumbs / .crumb-sep / .crumb-here), and nothing in
// the library owned the shape. So each check below is about a defect
// that copy actually had, not a hypothetical.
//
// The three that matter are all things a value-shaped test would miss:
//
//   - the floor must be var(--tap) and NOT a literal, because an inert
//     `min-height: 44px` passes /min-height/ and is a second source of
//     truth for a number the token already owns;
//   - the separator must be a ::after on the LINK, because a markup
//     separator is announced and that cannot be checked from CSS text
//     alone - so the DEMONSTRATION has to prove it, which is why the
//     showcase trail is read here too;
//   - the current crumb must be aria-current="page", which is not
//     visible in any stylesheet, so it is asserted on the page.
{
	const crumbsSrc = compSrc;
	const page = read('src/pages/index.astro');

	check('the breadcrumb trail is defined', () => {
		assert(/\.cm-crumbs\s*\{/.test(crumbsSrc), '.cm-crumbs is not defined');
	});

	check('the trail wraps rather than scrolling', () => {
		// A trail grows with depth. Overflow-x on a breadcrumb means the
		// FIRST crumb - the only guaranteed way out of the page - is the
		// one pushed out of sight on the narrowest viewport.
		const block = /\.cm-crumbs\s*\{([^}]*)\}/.exec(crumbsSrc);
		assert(block, '.cm-crumbs rule not found');
		assert(/flex-wrap:\s*wrap/.test(block[1]), 'the trail does not wrap');
		assert(!/overflow-x/.test(block[1]), 'the trail scrolls sideways instead of wrapping');
		assert(!/white-space:\s*nowrap/.test(block[1]), 'the trail is nowrap, so it overflows instead of wrapping');
	});

	check('every crumb link reaches the tap floor from the token', () => {
		// The defect this replaces, measured on the hand-rolled copy: bare
		// text at 0.78rem is ~16px tall against a 44px floor.
		const m = /\.cm-crumbs__link\s*\{([^}]*)\}/.exec(crumbsSrc);
		assert(m, '.cm-crumbs__link rule not found');
		assert(/min-height:\s*var\(--tap\)/.test(m[1]),
			'.cm-crumbs__link has no min-height: var(--tap)');
		// The inert-value mutant: 44px is DECLARED, so /min-height/ matches
		// and the check above would pass. Assert the var() reference.
		assert(!/min-height:\s*44px/.test(m[1]),
			'the tap floor is a literal 44px rather than var(--tap)');
	});

	check('the current crumb reaches the floor too', () => {
		// It is the row a thumb lands on when backing OUT of a page, so it
		// is not exempt just because it is not a link.
		const m = /\.cm-crumbs__here\s*\{([^}]*)\}/.exec(crumbsSrc);
		assert(m, '.cm-crumbs__here rule not found');
		assert(/min-height:\s*var\(--tap\)/.test(m[1]),
			'.cm-crumbs__here has no min-height: var(--tap)');
	});

	check('the separator is aria-hidden in the MARKUP, and that is the whole reason', () => {
		// This check was originally "the separator is a ::after, so it cannot
		// be announced". MEASURED over CDP with
		// Accessibility.getFullAXTree, that is FALSE: a ::after is part of
		// name-from-content, so the link's accessible name came back
		// "store>" - the separator is spoken. Both aria-hidden shapes read
		// "store". The `ignored` flag was false, so it was not a reporting
		// artifact. So the requirement is the ATTRIBUTE, not the technique,
		// and it has to be asserted on the markup because no stylesheet
		// can carry it.
		const trails = [...page.matchAll(/<nav class="cm-crumbs"[^>]*>([\s\S]*?)<\/nav>/g)];
		assert(trails.length >= 1, 'no cm-crumbs trail in the showcase');
		let seps = 0;
		for (const [, body] of trails) {
			const found = [...body.matchAll(/<span class="cm-crumbs__sep"([^>]*)>/g)];
			for (const [, attrs] of found) {
				seps++;
				assert(/aria-hidden="true"/.test(attrs),
					'a cm-crumbs__sep has no aria-hidden="true", so a screen reader speaks the chevron');
			}
		}
		assert(seps > 0, 'no separator is demonstrated, so its accessibility is untested');
	});

	check('the separator lives INSIDE its link, so it can never wrap alone', () => {
		// MEASURED, not reasoned: with the separator as a SIBLING flex item,
		// the 5-level trail at 393px put a lone chevron at the start of row 2
		// and another at the end, and the wrapped row began at left 56px
		// instead of 40px. The separator is its own flex child, so flex-wrap
		// is free to break on either side of it. Nesting it inside the link
		// makes link+separator one unbreakable box.
		//
		// Left edges went from [40, 56, 107, 213] to [40, 107, 225], so every
		// row now starts on the margin. Assert the SHAPE rather than the
		// pixels: the geometry probe owns the numbers, and a test that
		// hardcodes left edges would fail on any font change and pass on a
		// regression that moved them the other way.
		const trails = [...page.matchAll(/<nav class="cm-crumbs"[^>]*>([\s\S]*?)<\/nav>/g)];
		assert(trails.length >= 1, 'no cm-crumbs trail in the showcase');
		for (const [, body] of trails) {
			// every separator must be preceded by link text and closed by </a>,
			// i.e. no separator may sit between two sibling elements
			const siblings = body.match(/<\/a>\s*<span class="cm-crumbs__sep"/g) || [];
			assert(siblings.length === 0,
				`${siblings.length} separator(s) are a sibling of the links, so one can wrap onto a row of its own`);
			const inLink = body.match(/<span class="cm-crumbs__sep"[^>]*>[\s\S]*?<\/span>\s*<\/a>/g) || [];
			const total = (body.match(/cm-crumbs__sep/g) || []).length;
			assert(inLink.length === total,
				`only ${inLink.length} of ${total} separators are inside their link`);
		}
	});

	check('the separator is a real element, because ::after would be spoken', () => {
		// The pairing with the check above, and the reason the two must not
		// be collapsed into one. Either shape silences the separator, but
		// only one of them also survives a wrap. And a ::after is not silent
		// at all.
		assert(/\.cm-crumbs__sep\s*\{/.test(compSrc), '.cm-crumbs__sep is not styled by the library');
		// A ::after separator is the LOUD variant. Asserting its ABSENCE
		// guards against the regression being reintroduced, because it is
		// the shape that looks like an improvement and measures as a bug.
		assert(!/\.cm-crumbs__link[^{}]*::after/.test(compSrc),
			'the separator is back on a ::after, which name-from-content reads aloud');
	});

	check('the breadcrumb uses aria-current, the marker the header already uses', () => {
		// A second private "active" convention is how the header and the
		// trail end up disagreeing about what "you are here" means. The
		// stylesheet alone cannot prove this - aria-current is markup - so
		// it is asserted on the demonstration.
		assert(/\.cm-header__link\[aria-current='page'\]/.test(compSrc),
			'the header no longer marks the current page with aria-current, so this is not the shared convention');
		// Scoped to the TRAIL, not to the page. This check was originally
		// /aria-current="page"/.test(page), and the page carries 7 of them -
		// 6 in the header nav - so deleting the breadcrumb's own marker
		// still left 6 and the check stayed green. A mutation proved it:
		// the marker removed from the specimen was MISSED. An unscoped
		// existence check on a page that has another component using the
		// same attribute measures the other component.
		const trails = [...page.matchAll(/<nav class="cm-crumbs"[^>]*>([\s\S]*?)<\/nav>/g)];
		assert(trails.length >= 1, 'no cm-crumbs trail in the showcase');
		for (const [, body] of trails) {
			assert(/aria-current="page"/.test(body),
				'a demonstrated breadcrumb does not mark its current crumb with aria-current="page"');
		}
	});

	check('the demonstration proves the current crumb is NOT a link', () => {
		// The whole point of the current crumb is that it goes nowhere. A
		// demonstration that renders it as an <a href> proves the opposite
		// of what it documents, and it would still look right.
		const trail = /<nav class="cm-crumbs"[^>]*>([\s\S]*?)<\/nav>/.exec(page);
		assert(trail, 'no cm-crumbs nav in the showcase');
		assert(/<span class="cm-crumbs__here"[^>]*>/.test(trail[1]),
			'the demonstrated trail has no cm-crumbs__here crumb');
		assert(!/<a[^>]*class="cm-crumbs__here"/.test(trail[1]),
			'the current crumb is demonstrated as a link');
	});

	check('the trail is a nav with a label, so it is announced as one', () => {
		const navs = page.match(/<nav class="cm-crumbs"[^>]*>/g) || [];
		assert(navs.length >= 1, 'the trail is not demonstrated');
		for (const n of navs) {
			assert(/aria-label=/.test(n), `a cm-crumbs nav has no aria-label: ${n}`);
		}
	});

	check('the showcase demonstrates a deep trail, not just the two-crumb case', () => {
		// A fixture that cannot wrap proves nothing about the wrap. Three
		// levels fit on every phone; the defect this component exists to
		// fix only appears at depth.
		const deep = /aria-label="Breadcrumb, deep">([\s\S]*?)<\/nav>/.exec(page);
		assert(deep, 'no deep trail specimen in the showcase');
		const links = (deep[1].match(/cm-crumbs__link/g) || []).length;
		assert(links >= 4, `the deep trail has only ${links} links; a short trail never wraps`);
	});

	check('the breadcrumb is demonstrated before it is trusted', () => {
		assert(/id="crumbs"/.test(page), 'the showcase has no breadcrumb section');
		assert(/class="cm-crumbs"/.test(page), 'the breadcrumb is defined but never demonstrated');
	});
}

/* ================= prose table: `.cm-prose-table` =================
   A table INSIDE prose, as opposed to `.cm-table`, which is a data grid.

   The reason this is its own component is a MEASURED difference, and the
   tests below assert the measurements' causes rather than their effects:

   - `.cm-table` is `nowrap` + sticky header inside a capped scrollport.
     That is right for a log you scan across, and wrong for an article:
     the article page owns the vertical scroll, so the sticky header
     sticks to a wrapper that never scrolls and is never seen.
   - `width: 100%` on a table is ADVISORY against the cells' intrinsic
     min-content width. With a 6-column sentence table, `table-layout:
     auto` laid it out at 1074px inside a 739px column - 335px past the
     edge. `table-layout: fixed` is what makes `width: 100%` real.

   Each assertion below was mutation-checked; the mutation for each is
   written in the comment beside it, and `scripts/mutate-prose-table.mjs`
   runs them all and prints a kill count derived from the same variable
   it reports. */
{
	const PT = 'cm-prose-table';
	// Comments STRIPPED, and this is the point: the prose in the source
	// names `nowrap`, `word-break` and `overflow-wrap: anywhere` while
	// explaining why it does NOT use them. A regex over the raw file
	// reads that explanation as a declaration and the suite fails on
	// prose. Assert DECLARATIONS, never text.
	const comp2 = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const page2 = read('src/pages/index.astro');

	check('the prose table is a DIFFERENT component from the data grid', () => {
		// Both exist, and neither is defined in terms of the other. If the
		// prose table were built on `.cm-table` it would inherit `nowrap`
		// and the sticky header, which is the whole bug.
		assert(/\.cm-prose-table\s*\{/.test(comp2), `.${PT} is not defined`);
		assert(/\.cm-table\s*\{/.test(comp2), '.cm-table is missing - the comparison is meaningless');
		// It must not be an alias.
		assert(!/\.cm-prose-table\s*,\s*\.cm-table\b/.test(comp2),
			`${PT} is grouped with .cm-table, so it inherits the grid's nowrap and sticky header`);
	});

	check('the prose table does not inherit the data grid\'s nowrap or sticky header', () => {
		// SCOPED, and the scope matters: the visually-hidden `thead` in the
		// stacked layout carries `white-space: nowrap` on purpose - it is a
		// 1px clip box, and letting it wrap would make its box grow and
		// paint. Asserting nowrap over the WHOLE component flags that
		// correct declaration and trains you to distrust the check. So
		// the rule is skipped when its own block clips it.
		const rules = [...comp2.matchAll(
			new RegExp(`(\\.${PT}[^{]*)\\{([^}]*)\\}`, 'g'))].map((m) => [m[1], m[2]]);
		assert(rules.length > 0, `.${PT} has no rules`);
		for (const [sel, decl] of rules) {
			const isClipped = /clip-path:\s*inset/.test(decl) || /clip:\s*rect/.test(decl);
			if (isClipped) continue;
			assert(!/white-space:\s*nowrap/.test(decl),
				`${PT} declares nowrap on a VISIBLE box (${sel.trim()}): a six-column table gets a scrollbar per table`);
			assert(!/position:\s*sticky/.test(decl),
				`${PT} is sticky (${sel.trim()}): the article page owns the vertical scroll, so a sticky header never shows`);
		}
	});

	check('the prose table has no max-height, because the page owns the vertical scroll', () => {
		// The data grid's 30rem cap belongs to the grid. Here it would put
		// a second scrollbar inside a paragraph and cut a table off
		// mid-row. Assert the pairing the other way too: if a consumer
		// copies .cm-table-wrap here, this catches it.
		const rules = [...comp2.matchAll(new RegExp(`\\.${PT}[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
		for (const r of rules) {
			assert(!/max-height/.test(r),
				`${PT} declares a max-height: a second scrollbar inside a paragraph`);
		}
	});

	check('the prose table honours width:100% instead of overflowing its column', () => {
		// THE cause of the 335px overflow. `width: 100%` alone is advisory
		// against the cells' min-content floor; `table-layout: fixed` is
		// what makes it real. MUTATION: delete the table-layout
		// declaration - a value-shaped test would still pass on
		// `width: 100%`, which is why this asserts the LAYOUT.
		const rule = /\.cm-prose-table\s*\{([^}]*)\}/.exec(comp2);
		assert(rule, `.${PT} has no rule block`);
		assert(/table-layout:\s*fixed/.test(rule[1]),
			`${PT} has no table-layout: fixed, so width:100% stays advisory against min-content and a wide table overflows its column (measured 335px past the edge)`);
		assert(/width:\s*100%/.test(rule[1]),
			`${PT} does not declare width: 100%`);
	});

	check('the prose table wraps cells rather than holding them on one line', () => {
		// Assert the rule that owns the property, and scope it: `.cm-table`
		// legitimately declares nowrap, so a file-wide /nowrap/ scan would
		// fail on the grid for the right reason and read as the wrong one.
		const rules = [...comp2.matchAll(
			new RegExp(`\\.${PT}\\s+(th|td)[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[2]);
		assert(rules.length > 0, `${PT} declares no cell rule`);
		assert(rules.some((r) => /overflow-wrap:\s*break-word/.test(r)),
			`${PT} cells declare no overflow-wrap, so a long URL runs past the column`);
		// And the banned sibling must not appear. The suite already bans
		// `anywhere` globally; this asserts the CELL rule did not sneak
		// `word-break: break-word` in, which shreds a sentence to 44
		// lines per row (measured).
		for (const r of rules) {
			assert(!/word-break:\s*break-(word|all)/.test(r),
				`${PT} cells use word-break: break-word/all, which shreds prose to one word per line`);
		}
	});

	check('the prose table is floored to the minimum font size', () => {
		// A bare `0.94em` under the library base font resolves to ~11.7px
		// on a phone - under the 12px floor every other component is held
		// to, and components.css loads after base.css so a floor there
		// loses. MUTATION: swap max(var(--min-font), 0.94em) for 0.94em -
		// the existing exhaustive floor scan fails, which is the proof.
		const rule = /\.cm-prose-table\s*\{([^}]*)\}/.exec(comp2);
		assert(rule && /font-size:\s*max\(var\(--min-font\)/.test(rule[1]),
			`${PT} has no --min-font floor on its font-size; it renders at ~11.7px on a phone`);
	});

	check('the stacked phone layout is a media query, not a base rule', () => {
		// Stacking at every width would be wrong just as surely as not
		// stacking on a phone. Assert the query and the breakpoint, so
		// "always stacked" and "never stacked" both fail.
		assert(/@media \(max-width: \d+px\) \{\s*\.cm-prose-table thead/.test(comp2.replace(/\n\s+/g, ' ')),
			`${PT} has no stacked-row media block on the thead`);
		assert(/\.cm-prose-table thead\s*\{[^}]*position:\s*absolute/.test(comp2),
			`${PT} hides thead with display:none in the stacked layout, which removes it from the accessibility tree; it must be clipped instead`);
		assert(/clip-path:\s*inset\(50%\)/.test(comp2),
			`${PT} does not clip the visually-hidden thead, so it still paints`);
	});

	check('every stacked cell reads its label from data-label, in the CSS', () => {
		// The invariant is the PAIRING. `content: attr(data-label)` in the
		// stacked block means a consumer CANNOT switch this layout on
		// without the text being there - there is no way to get a
		// headerless table of values by accident. MUTATION: delete the
		// ::before rule - this fails, which is the point.
		assert(/td::before\s*\{[^}]*content:\s*attr\(data-label\)/.test(comp2),
			`${PT} stacked cells do not render their data-label, so a stacked row is a list of values with no column names`);
		assert(/td:not\(\[data-label\]\)::before\s*\{\s*content:\s*none/.test(comp2),
			`${PT} renders an empty label line for an unlabelled cell`);
	});

	check('the showcase demonstrates the prose table before it is trusted', () => {
		assert(/id="prosetable"/.test(page2), 'the showcase has no prose-table section');
		assert(new RegExp(`class="${PT}"`).test(page2),
			`${PT} is defined but never rendered in the showcase`);
	});

	check('the demonstrated prose table is one the stacked layout can actually carry', () => {
		// A fixture that FITS proves nothing. Three columns fit everywhere,
		// so a `data-label`-less or nowrap regression would look perfect in
		// a screenshot of it. Six columns of sentences is the case.
		const sec = /<section id="prosetable"[\s\S]*?<\/section>/.exec(page2);
		assert(sec, 'no prose-table section to inspect');
		const block = sec[0];
		const cols = (block.match(/<th scope="col"/g) || []).length;
		assert(cols >= 5,
			`the prose-table fixture has only ${cols} columns; a narrow table fits at every width and never exercises the wrap or the stacking`);
		// Every body cell labelled, or the stacked layout drops its headers.
		const cells = block.match(/<td/g) || [];
		const labelled = block.match(/<td data-label=/g) || [];
		assert(cells.length === labelled.length,
			`${cells.length - labelled.length} prose-table cells carry no data-label, so they lose their column name when stacked`);
	});

	check('the prose table keeps its table semantics - a table, not a pile of divs', () => {
		// The stacked layout is CSS only. If a consumer "fixed" the phone
		// layout in markup, every row/column association for a screen
		// reader is gone and this fails.
		const sec = /<section id="prosetable"[\s\S]*?<\/section>/.exec(page2);
		assert(sec, 'no prose-table section');
		assert(/<table class="cm-prose-table">/.test(sec[0]),
			'the prose table is not rendered as a <table>');
		assert(/<thead>/.test(sec[0]) && /<tbody>/.test(sec[0]),
			'the prose table has no thead/tbody, so row and column association is lost');
		assert(/<caption>/.test(sec[0]),
			'the prose table has no caption, so a table read out of context has no name');
	});
}

/* ================= generated table labels =================
   `data-label` on every body cell is what `.cm-prose-table` renders
   beside a stacked value, and the check above makes sure the SHOWCASE's
   own table carries it. It cannot make a GENERATED table carry it: the
   consumer that needs this renders 397 markdown pipe-tables from a
   converter that emits `<th scope="col">` and nothing else.

   So the runtime derives the labels from the header row, and these
   checks execute the real runtime against a DOM strict enough to fail
   if the code drifts onto an API the probe does not implement - a mock
   that quietly returns [] for an unknown selector is how a probe ends
   up asserting that a broken function is fine. */
console.log('\ngenerated table labels');
	{
		/* `page2` is scoped to the prose-table block above, and reading the
		   showcase again here is one `read()` call - cheaper than hoisting a
		   variable that six other blocks do not need. */
		const pageLbl = read('src/pages/index.astro');
		/* A DOM built from a literal spec. Every accessor the runtime can
		   reach is implemented; anything else is a hard error, so the probe
		   cannot silently answer a question the DOM does not have. */
		const mkCell = (tag, text, attrs = {}) => ({
			tag,
			textContent: text,
			attrs: { ...attrs },
			children: [],
			// The runtime's idempotence guard reads `dataset`, not
			// getAttribute: `table.dataset.cmLabels` is `data-cm-labels`.
			// A mock without `dataset` throws on the FIRST line of the
			// function, which looks like a broken runtime and is really a
			// broken probe.
			dataset: {},
			hasAttribute(n) { return n in this.attrs; },
			setAttribute(n, v) { this.attrs[n] = v; },
			getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
			// Cell-level lookups. The runtime asks the header ROW for its
			// `th, td` and the TABLE for its `tbody tr`, so both live one
			// level down from what a bare cell would answer - and a mock
			// that only implements the top level throws halfway through
			// the function, which reads as a broken runtime.
			querySelector: () => null,
			querySelectorAll(sel) {
				if (sel === 'th, td') return this.children.filter((c) => c.tag === 'th' || c.tag === 'td');
				return [];
			},
		});
	const mkTable = (headers, rows, opt = {}) => {
		const head = mkCell('tr', '');
		head.children = headers.map((h) => mkCell('th', h));
		const thead = mkCell('thead', '');
		thead.children = [head];
		const tbody = mkCell('tbody', '');
		tbody.children = rows.map((r) => {
			const tr = mkCell('tr', '');
			tr.children = r.map((c) => (typeof c === 'object' ? mkCell('td', c.text ?? '', c.attrs ?? {}) : mkCell('td', c)));
			return tr;
		});
		const table = mkCell('table', '');
		table.attrs = { class: 'cm-prose-table' };
		table.children = opt.noHead ? [tbody] : [thead, tbody];
		if (!opt.noHead) table.querySelector = (s) => (s === 'thead tr' ? head : null);
		table.querySelectorAll = (s) => {
			if (s === 'th, td' && opt.noHead !== undefined) return head.children;
			if (s === 'tbody tr') return opt.noHead ? [] : tbody.children;
			return [];
		};
		table.__head = head;
		table.__tbody = tbody;
		return table;
	};
	const labelsOf = (table) =>
		table.__tbody.children.map((tr) => tr.children.map((c) => c.getAttribute('data-label')));

	const harness = (tables, opt = {}) => {
		const tablesInScope = tables.filter(() => !(opt.unopted ?? false));
		const doc = {
			documentElement: {
				attrs: {},
				style: { setProperty: () => {} },
				getAttribute(n) { return this.attrs[n] ?? null; },
				setAttribute(n, v) { this.attrs[n] = v; },
			},
			readyState: 'complete',
			addEventListener: () => {},
			querySelector: () => null,
			// The REAL selector the runtime uses. If the runtime drifts to a
			// different selector this returns [] and the labels come back
			// empty, so the assertion below fails - it does not pass on a
			// mock that answers "no tables" the same way it answers
			// "labelled every table".
			querySelectorAll: (sel) => {
				if (sel === '[data-cm-table-labels] .cm-prose-table') return tablesInScope;
				return [];
			},
		};
		const ctx = {
			module: { exports: {} },
			document: doc,
			window: { addEventListener: () => {}, scrollY: 0, innerHeight: 800, requestAnimationFrame: () => {} },
			localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
		};
		ctx.globalThis = ctx;
		vm.createContext(ctx);
		vm.runInContext(runtimeSrc, ctx);
		return ctx;
	};

	check('a generated table gets its column names from the header row', () => {
		const t = mkTable(['Model', 'Input', 'Output'], [['a', '1', '2'], ['b', '3', '4']]);
		harness([t]);
		const labels = labelsOf(t);
		assert(labels[0].join('|') === 'Model|Input|Output',
			`row 1 labelled ${JSON.stringify(labels[0])}, expected the header row's own text`);
		assert(labels[1].join('|') === 'Model|Input|Output',
			`row 2 labelled ${JSON.stringify(labels[1])}`);
	});

	check("an author's own data-label is never overwritten by the derived one", () => {
		const t = mkTable(
			['Model', 'Input', 'Output'],
			[[{ text: 'a', attrs: { 'data-label': 'CHOSEN' } }, '1', '2']],
		);
		harness([t]);
		const labels = labelsOf(t);
		assert(labels[0][0] === 'CHOSEN',
			`the hand-written label was rewritten to ${JSON.stringify(labels[0][0])}`);
		assert(labels[0][1] === 'Input' && labels[0][2] === 'Output',
			`the UNLABELLED cells beside it were not derived: ${JSON.stringify(labels[0])}`);
	});

	check('a gapped row is labelled by INDEX, not shifted by the missing cell', () => {
		// A markdown row can have an EMPTY cell in the MIDDLE
		// (`| a |  | c |`), which renders three <td>s with a blank one -
		// or, for a short row, fewer <td>s than the header has <th>s.
		// Both are the same trap: any implementation that drops the empty
		// cell before labelling shifts every later cell's name one column
		// left, so `c` renders under a heading called 'Output'.
		//
		// MUTATION: filter the row's empty cells out before labelling, and
		// this fails. A short-row-only fixture does NOT catch it - the gap
		// at the end shifts nothing after it - which is why the gapped row
		// is here and not instead of it.
		const short = mkTable(['A', 'B', 'C'], [['only-a']]);
		const gapped = mkTable(['Engine', 'Cold start', 'Verdict'], [['a', '', 'ship it']]);
		harness([short, gapped]);
		assert(labelsOf(short)[0][0] === 'A', `short row: ${JSON.stringify(labelsOf(short)[0])}`);
		// The EMPTY cell still gets its column's name. It is a value that
		// happens to be blank, not a missing value - so the renderer draws
		// "Cold start" with nothing under it, which is honest. Skipping it
		// is what breaks the layout: that is the shift this asserts against.
		assert(labelsOf(gapped)[0][2] === 'Verdict',
			`the cell AFTER an empty one was labelled ${JSON.stringify(labelsOf(gapped)[0][2])}, want 'Verdict' - ` +
			`the labels shifted by the empty cell, so a value renders under the wrong heading`);
	});

	check('the derivation is opt-in, so a table a person wrote is left alone', () => {
		const t = mkTable(['Model', 'Input'], [['a', '1']]);
		harness([t], { unopted: true });
		assert(labelsOf(t)[0][0] === null,
			`a table outside [data-cm-table-labels] was rewritten anyway: ${JSON.stringify(labelsOf(t)[0])}`);
	});

	check('a table with no header row is not labelled from nothing', () => {
		// A headerless table has no source of truth, so deriving from an
		// absent header would put a WRONG name on a cell. Skip it.
		const t = mkTable([], [['a', '1']], { noHead: true });
		harness([t]);
		assert(labelsOf(t)[0][0] === null,
			`a headerless table was given labels: ${JSON.stringify(labelsOf(t)[0])}`);
	});

	check('the showcase demonstrates the derivation on a table with no data-label', () => {
		// A specimen that already carries data-label proves nothing: it
		// would look correct with the runtime deleted. Assert the NEGATIVE
		// - the section's table carries none - so the only thing that can
		// put a label on it is the runtime.
		const sec = /<section id="tablelabels"[\s\S]*?<\/section>\s*<\/section>/.exec(pageLbl);
		assert(sec, 'no generated-table-labels section in the showcase');
		/* The attribute must be on the OPENING TAG, not merely somewhere in
		   the section. The section's own lede names `[data-cm-table-labels]`
		   in prose, so a `/data-cm-table-labels/.test(section)` check is
		   satisfied by the EXPLANATION and goes green with the opt-in
		   deleted - the specimen then demos nothing and the check passes,
		   which is a test that cannot fail. MUTATION: drop the attribute
		   from <section>, and this fails. */
		const openTag = /<section id="tablelabels"[^>]*>/.exec(sec[0]);
		assert(openTag, 'the section has no opening tag to carry the opt-in');
		assert(/data-cm-table-labels/.test(openTag[0]),
			`the opt-in is not on the <section> element, so nothing in the specimen is labelled: ${openTag[0].slice(0, 120)}`);
		const table = /<table class="cm-prose-table">[\s\S]*?<\/table>/.exec(sec[0]);
		assert(table, 'the section has no .cm-prose-table');
		const bodyCells = table[0].split(/<tbody>/)[1] ?? '';
		const cells = (bodyCells.match(/<td/g) || []).length;
		const labelled = (bodyCells.match(/data-label/g) || []).length;
		assert(cells > 0, 'the specimen has no body cells to label');
		assert(labelled === 0,
			`${labelled} of the specimen's ${cells} cells carry data-label, so it demonstrates the hand-written form and not the derivation`);
	});

	check('the runtime reaches generated tables from init, not only from a helper', () => {
		// `labelTable` existing and `initTableLabels` calling it is worth
		// nothing if init() never calls initTableLabels: nothing runs on a
		// real page and every unit test above still passes.
		assert(/initTableLabels\(root\)/.test(runtimeSrc),
			'init() does not call initTableLabels, so no page ever gets its labels');
	});
}

/* ================= footer separator =================
   `.cm-footer__meta` is `flex-wrap: wrap`, so a separator that is its own
   flex item can be the LAST thing on a wrapped line with nothing after it -
   "© 2026 omiinaya ·" on line one, the fragments on line two. MEASURED in
   WebKit on the showcase before the fix: stranded at 320, 360, 390, 402
   and 430, i.e. every phone width tried.

   The separator is therefore not an element. It is generated by the item
   it PRECEDES, so it belongs to that item and the two cannot be split
   across a wrap. tests/verify-footer-sep-webkit.py measures the rendered
   geometry at five widths; the checks below pin the CAUSE, which is what
   makes the measurement meaningful. Each is mutation-checked in
   scripts/mutate-footer-sep.mjs. */
{
	// Comments stripped: the prose above and beside the rule names
	// `content: none`, `:first-child` and `.cm-footer__bar` while
	// explaining them, and a regex over the raw file reads the
	// explanation as the declaration.
	const footCss = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const footSrc = read('src/astro/Footer.astro');

	check('the footer separator is generated, not an element', () => {
		// The defect: a `<span class="cm-footer__bar">·</span>` between
		// every fragment. Each is a flex item, so any of them can strand.
		assert(!/cm-footer__bar/.test(footSrc),
			'Footer.astro still emits a cm-footer__bar element; a separator that is its own flex item strands at the end of a wrapped line');
		// And the row must still wrap - a one-line footer never exercises
		// the bug, so the fixture has to be wide enough to be the case.
		assert(/\.cm-footer__meta\s*\{[^}]*flex-wrap:\s*wrap/.test(footCss),
			'.cm-footer__meta is no longer flex-wrap: wrap, so the stranded-separator case cannot occur - re-measure before trusting this test');
	});

	check('the footer separator hangs off the item it PRECEDES', () => {
		// `::before` on `:not(:first-child)`. Three things are load-bearing
		// and each has its own mutation:
		//  - ::before, so the dot belongs to what comes after it;
		//  - :not(:first-child), so the row does not LEAD with a dot;
		//  - a generated `content`, so the separator still exists.
		const m = /\.cm-footer__meta\s*>\s*\*:not\(:first-child\)[^{]*::before\s*\{([^}]*)\}/.exec(footCss);
		assert(m,
			'no .cm-footer__meta > *:not(:first-child)::before rule - the separator is an element again');
		assert(/content:\s*['"]?·['"]?/.test(m[1]),
			`the footer separator rule declares no \`content\`, so the row renders bare gaps: ${m[1].trim()}`);
		// A separator whose glyph is empty is invisible but still declared.
		assert(!/content:\s*none/.test(m[1]),
			'the footer separator is set to content:none - the dots vanish entirely');
	});

	check('the footer separator is gone from the library surface entirely', () => {
		// The class is DELETED, not kept as a back-compat shim. It used to
		// be a flex item of its own, which is the defect, and the two
		// consumers that still emitted it (sullen.sh, oem-portfolio) are
		// migrated. A shim for a markup nobody ships is dead CSS with a
		// comment explaining why it is dead - the exact thing the
		// reachability check exists to refuse.
		assert(!/\.cm-footer__bar\b/.test(footCss),
			'.cm-footer__bar is still defined in components.css but nothing renders it');
		assert(!/cm-footer__bar/.test(footSrc),
			'Footer.astro still emits a cm-footer__bar element; a separator that is its own flex item strands at the end of a wrapped line');
		// And the consumers that used to emit it. This is the half that
		// matters: deleting the class while one consumer still ships the
		// markup silently strands its separator, so the migration is only
		// proven by the EMITTERS being gone, not by the CSS being clean.
		for (const consumer of ['sullen.sh/index.html', 'oem-portfolio/src/components/Footer.astro']) {
			const p = `/root/projects/${consumer}`;
			let body = '';
			try { body = readFileSync(p, 'utf8'); } catch { /* not present on this host */ }
			assert(!/class="cm-footer__bar"/.test(body),
				`${consumer} still emits a cm-footer__bar separator element, and the class it styled has been deleted - its gaps render bare`);
		}
	});
}
/* ================= footer status row =================
   `.cm-footer__status` used to be a bare text line with no layout at all, so
   `status` could only ever be ONE fragment. A site that wants a sequenced
   status ("● all systems nominal │ ● sig: static only") - which is what
   dev-blog hand-rolled - had to build the separators itself, and the shape
   it built is the one this library deleted in d2ec654: a `::after` on
   `:not(:last-child)`, so every wrapped line but the last ENDS with a
   separator. MEASURED on dev-blog's live footer before this change, in
   WebKit: 2 stranded dots at 390x844, 402x874, 360x640 and 320x667, and 1
   at 430x932. Five of six viewports, every phone width.

   The fix is the SAME PAIRING as the meta row, and that pairing is the
   whole invariant: a separator that is a `::before` on the fragment it
   PRECEDES cannot be the last thing on a line, because whatever follows it
   belongs to the same flex item. Asserting "there is a ::before rule" is
   not enough on its own - a `::before` with no `content` renders nothing,
   and `content: none` still matches a /content:/ search. Mutation-checked
   in scripts/mutate-footer-sep.mjs. */
{
	const footCss = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	const footSrc = read('src/astro/Footer.astro');

	check('the status line is a wrapping row, or the separator case cannot occur', () => {
		// The fixture must be able to WRAP. A status row that fits on one
		// line never exercises the bug, so this asserts the precondition
		// rather than the fix - and says so, so a future reader who removes
		// `flex-wrap` knows this suite stopped covering anything.
		const m = /\.cm-footer__status\s*\{([^}]*)\}/.exec(footCss);
		assert(m, '.cm-footer__status is not defined in components.css');
		assert(/display:\s*flex/.test(m[1]),
			'.cm-footer__status is not display:flex, so the fragments are not flex items and the separator pairing means nothing');
		assert(/flex-wrap:\s*wrap/.test(m[1]),
			'.cm-footer__status no longer wraps - a single-line status cannot strand a separator, so this suite is no longer measuring anything');
	});

	check('the status separator hangs off the fragment it PRECEDES', () => {
		// Scoped to the `-part` rule. A regex over the whole file matches the
		// META separator too, and this test would pass with the status rule
		// deleted - which is the defect - because the meta row still has a
		// correct `::before` sitting right there.
		const m = /\.cm-footer__status-part\s*>\?\s*\*?\s*:not\(:first-child\)[^{]*::before\s*\{([^}]*)\}/.exec(footCss)
			|| /\.cm-footer__status-part:not\(:first-child\)[^{]*::before\s*\{([^}]*)\}/.exec(footCss);
		assert(m,
			'no .cm-footer__status-part:not(:first-child)::before rule - the status separator is attached to the wrong side, so it strands on a wrapped line');
		assert(/content:\s*['"]?[│|]['"]?/.test(m[1]),
			`the status separator declares no glyph, so the row renders bare gaps: ${m[1].trim()}`);
		// `content: none` MATCHES a /content/ search. Assert the value, not
		// the property, or a declared-but-invisible separator passes.
		assert(!/content:\s*none/.test(m[1]),
			'the status separator is content:none - the separators vanish entirely');
		// And the direction is the point of the whole thing: `::after` is
		// the exact shape this library deleted, so it must not come back.
		assert(!/\.cm-footer__status-part[^{]*::after/.test(footCss),
			'a ::after status separator exists; ::after strands at the end of a wrapped line - it must be ::before');
	});

	check('the status row accepts an ARRAY of fragments, not just a string', () => {
		// A string prop is a silent capability regression: a caller with two
		// fragments has nowhere to put the separator. Assert the prop TYPE
		// is a union, because "renders something" is true of both shapes and
		// proves nothing.
		assert(/status\?:\s*string\s*\|\s*string\[\]/.test(footSrc),
			'Footer.astro status prop is not `string | string[]` - a multi-part status cannot be expressed');
		// And the template must actually branch on it. A union type nobody
		// branches on is a type, not a feature.
		assert(/Array\.isArray\(status\)/.test(footSrc),
			'Footer.astro never branches on Array.isArray(status), so an array prop would render as a single joined string');
		// Each fragment gets its own element, or the ::before pairing has
		// nothing to attach to.
		assert(/statusParts\.map/.test(footSrc),
			'Footer.astro does not map statusParts, so the fragments are not separate flex items');
	});

	check('only the FIRST fragment carries the leading dot', () => {
		// `.cm-footer__dot` existed in the stylesheet from the initial
		// release but nothing emitted it, so it was dead CSS the
		// reachability check should have caught. It renders for the first
		// fragment only: a dot before EVERY fragment is a glyph per row, and
		// the old string form rendered exactly one.
		assert(/i === 0 && <span class="cm-footer__dot">/.test(footSrc.replace(/\s+/g, ' ')),
			'Footer.astro no longer emits .cm-footer__dot for the first fragment');
		const emitted = (footSrc.match(/cm-footer__dot/g) || []).length;
		assert(emitted === 1,
			`cm-footer__dot appears ${emitted} time(s) in Footer.astro; a dot per fragment is not a leading dot`);
	});

	check('the showcase demonstrates the multi-fragment status before it is trusted', () => {
		// An excuse is not a demonstration. The prop accepting an array is
		// not evidence that the row lays out; the showcase page has to carry
		// two real fragments, and the built page has to carry both.
		assert(/status=\{\[/.test(read('src/pages/index.astro')),
			'the showcase still passes status a single string, so the array form is never rendered');
		const dist = (() => { try { return read('dist/index.html'); } catch { return ''; } })();
		assert(dist === '' || (dist.match(/cm-footer__status-part/g) || []).length >= 2,
			'the built page renders fewer than two status fragments');
	});
check('the leading dot is the COMPONENT\'s, so a caller cannot double it', () => {
		// Measured on the built page before this check existed: the
		// showcase read `●● all systems nominal`, because the fixture passed
		// a literal `●` AND the component prepends one. Every DOM assertion
		// above still passed - a doubled glyph is not a missing class - and a
		// screenshot of a footer is exactly the kind of thing nobody reads
		// closely. So the fixture must not carry a leading `●`: the dot
		// belongs to the component, which is why it is emitted at all.
		const page = read('src/pages/index.astro');
		const m = /status=\{\[([\s\S]*?)\]\}/.exec(page);
		assert(m, 'the showcase does not pass an array status, so this fixture is not the one being measured');
		assert(!/●/.test(m[1]),
			`the showcase status fragment carries a literal ● (${m[1].trim()}), and the component already prepends one - the footer renders ●●`);
		// And the rendered page must not contain the doubled glyph either,
		// so this fails on the OUTPUT rather than only on the source.
		const dist = (() => { try { return read('dist/index.html'); } catch { return ''; } })();
		if (dist !== '') {
			assert(!/cm-footer__dot[^>]*>●(?!<)/.test(dist) || !/●\s*●/.test(dist),
				'the built footer contains a doubled ● - the component dot and a literal one are both rendering');
		}
	});
}
/* ================= project card =================
   The last component promoted out of a consumer (oem-portfolio). It is the
   clearest case yet of the class this repo keeps hitting: a shape one site
   needed, hand-rolled, and shipped - 100 lines of CSS no library fix could
   ever reach.

   Each check below is scoped to the rule that OWNS the property, because
   three of these selectors are prefixes of each other (`.cm-project`,
   `.cm-project__stack`, `.cm-project--pending`) and a loose scan picks up
   the sibling. That is not hypothetical: `.cm-card__link:hover` and
   `.cm-project:hover` both match /cm-project/, and the reachability test
   already failed once here by reading a build that predated the markup. */
{
	const projCss = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');

	check('the project grid counts its columns rather than fixing a pair', () => {
		const body = declForSelector('.cm-projects', compSrc, true);
		assert(body, '.cm-projects is not defined');
		assert(/display:\s*grid/.test(body), '.cm-projects must be a grid');
		// auto-fit, not a hardcoded `repeat(2, ...)`: the project count is
		// data. A fixed pair strands a card on an odd total, and `1fr` alone
		// stretches a lone card across the whole page.
		const t = /grid-template-columns:\s*([^;}]+)/.exec(body);
		assert(t, '.cm-projects sets no grid-template-columns');
		assert(/auto-fit/.test(t[1]),
			`.cm-projects must resolve columns with auto-fit, got \`${t[1].trim()}\``);
		// The floor is in `rem` and capped by `min(…, 100%)`. Without the
		// min() a 17rem floor is 272px, which is wider than a 320px phone
		// once the gutter is in, and the grid overflows the page.
		assert(/minmax\(\s*min\(/.test(t[1]),
			`the column floor must be min(Xrem, 100%), got \`${t[1].trim()}\``);
	});

	check('the project card fills its cell, so the stack has something to pin to', () => {
		// The pairing is the invariant. `height: 100%` on the card with a
		// `li` that does NOT stretch is inert and reads as pinned in the CSS
		// while the cards end at three different heights - which is the whole
		// reason this component exists. Either half alone is the bug.
		const li = declForSelector('.cm-projects > li', compSrc, true);
		assert(li, '.cm-projects does not style its own <li>');
		assert(/display:\s*flex/.test(li),
			'.cm-projects > li must be flex, or the card cannot fill the cell');
		const card = declForSelector('.cm-project', compSrc, true);
		assert(card, '.cm-project is not defined');
		assert(/height:\s*100%/.test(card),
			'.cm-project needs height: 100% - without it the tag stack has no row height to pin to');
		assert(/flex-direction:\s*column/.test(card),
			'.cm-project must be a column, or `margin-top: auto` pushes down nothing');
		// And the pin itself, in the stack rule and nowhere else. `margin-top: auto`
		// in `.cm-project` would push the BLURB down and pin nothing.
		const stack = declForSelector('.cm-project__stack', compSrc, true);
		assert(stack, '.cm-project__stack is not defined');
		assert(/margin:\s*auto\s+0\s+0/.test(stack),
			`the tag stack must pin itself with \`margin: auto 0 0\`, got \`${(/margin:[^;}]*/.exec(stack) || [''])[0].trim()}\``);
	});

	check('the project blurb owns its em dash, so a caller cannot double it', () => {
		// Same failure class as the footer separator and the status row: a
		// literal in the markup next to a generated one renders twice. Read
		// the ::before rule through declForSelector - the generated content
		// lives on the element, so an anchored /::before\s*{/ matches nothing
		// and reports "no glyph" against a rule that renders one.
		const before = declForSelector('.cm-project__blurb::before', compSrc, true);
		assert(before, '.cm-project__blurb has no ::before rule');
		const c = /content:\s*'([^']*)'/.exec(before);
		assert(c, '.cm-project__blurb::before declares no content:');
		// The trailing \00a0 is the deliberate non-breaking space that keeps
		// the dash attached to its first word; the visible glyph is the em dash.
		assert(c[1].replace(/\\00a0/g, '').trim() === '\\2014',
			`the blurb's leading glyph must be an em dash, got ${JSON.stringify(c[1])}`);
		// And the showcase must not carry a literal one.
		const lits = (showcase.slice(showcase.indexOf('id="cards"'),
			showcase.indexOf('id="tiles"')).match(/cm-project__blurb">\s*[—–-]/g) || []);
		assert(lits.length === 0,
			`a project blurb carries a literal dash in the markup (${lits.length}), and the component prepends one - it renders twice`);
	});

	check('the reserved project slot is not a link, so it is not a tab stop', () => {
		const pending = declForSelector('.cm-project--pending', compSrc, true);
		assert(pending, '.cm-project--pending is not defined');
		// Dashed, because it has to read as "nothing here yet" rather than as
		// a card that failed to load. A solid border reads as a broken card.
		assert(/border-style:\s*dashed/.test(pending),
			'.cm-project--pending must be dashed; a solid border reads as a broken card');
		// The markup is a <div> and carries aria-hidden: a focusable
		// placeholder is a tab stop that goes nowhere.
		const sec = showcase.slice(showcase.indexOf('id="cards"'), showcase.indexOf('id="tiles"'));
		const m = /<div class="cm-project cm-project--pending"[^>]*>/.exec(sec);
		assert(m, 'the showcase renders no reserved project slot');
		assert(/aria-hidden="true"/.test(m[0]),
			'the reserved project slot must be aria-hidden - it holds no information');
		assert(!/<a class="[^"]*cm-project--pending/.test(sec),
			'the reserved project slot is an <a>: a placeholder that is focusable is a tab stop that goes nowhere');
	});

	check('the project card and the aside tag list are NOT one rule', () => {
		// `.cm-project__stack` pins itself to the bottom of a flex card.
		// Reusing it in a detail-page aside would carry an inert
		// `margin-top: auto` that reads as pinned in the CSS while the list
		// sits at the top. Two names, two rules, and the reason is recorded
		// in both - otherwise the next person "simplifies" it back.
		const aside = declForSelector('.cm-project-tags', compSrc, true);
		assert(aside, '.cm-project-tags is not defined');
		assert(!/margin:\s*auto/.test(aside),
			'.cm-project-tags must not inherit the card stack\'s bottom pin');
		const stack = declForSelector('.cm-project__stack', compSrc, true);
		assert(stack && /margin:\s*auto/.test(stack),
			'.cm-project__stack lost its bottom pin');
		// Both must actually be rendered, or one of them is dead CSS. The
		// reachability test proves the CLASS is on the page; this proves the
		// shape is the one the rule describes.
		const sec = showcase.slice(showcase.indexOf('id="cards"'), showcase.indexOf('id="tiles"'));
		assert(/<ul class="cm-projects">/.test(sec), 'the showcase renders no project grid');
		assert(/<ul class="cm-project-tags">/.test(sec),
			'the showcase renders no detail-page tag list, so .cm-project-tags is dead CSS');
		// The grid is a <ul> of <li>, not a div soup: it is a list of works
		// and a screen reader should be able to say how many.
		assert(/<ul class="cm-projects">\s*<li>/.test(sec),
			'the project grid is not a <ul> of <li>');
	});

	check('the back link takes the tap floor it claims to take', () => {
		// The comment on `.cm-back` had claimed it took the --tap floor on a
		// coarse pointer since the day it shipped. MEASURED in WebKit against
		// an ISOLATED control host - not against the siblings it happened to
		// sit beside, since align-items:normal would fill the row from the
		// tallest sibling and hide the defect - `.cm-back` computed to
		// 27.19px at BOTH 390px and 1440px against a 44px floor, and no such
		// rule existed anywhere in the sheet. The claim was true in a comment
		// and false in the cascade.
		//
		// Assert the var() REFERENCE inside the coarse block, not the bare
		// property: `min-height: 0` would be DECLARED and a value-shaped
		// test would pass it while shipping the exact bug this fixes.
		const blocks = [...projCss.matchAll(/@media[^{]*pointer:\s*coarse[^{]*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
			.map(m => m[1]).join('\n');
		assert(blocks, 'no coarse-pointer block found - is the parse stale?');
		const rules = [...blocks.matchAll(/([^{}]*cm-back[^{}]*)\{([^{}]*)\}/g)];
		assert(rules.length === 1,
			`expected exactly one coarse-pointer rule for .cm-back, found ${rules.length} - a second one makes the effective value a question of source order`);
		const sel = rules[0][1];
		assert(!/__|--/.test(sel), `the coarse rule must target .cm-back itself, got \`${sel.trim()}\``);
		assert(/min-height:\s*var\(--tap\)/.test(rules[0][2]),
			`the coarse .cm-back rule must set min-height: var(--tap), got \`${rules[0][2].trim()}\``);
		// And the display has to be one min-height applies to. An `inline`
		// box ignores min-height entirely, so this is the second half of the
		// same invariant: a floor declared on a box that cannot honour it.
		const card = declForSelector('.cm-back', compSrc, true);
		assert(card && /display:\s*inline-flex/.test(card),
			'.cm-back must be inline-flex - an inline box ignores min-height, so the floor would be dead');
		// The showcase must render one, or the rule is unreachable surface.
		const sec = showcase.slice(showcase.indexOf('id="cards"'), showcase.indexOf('id="tiles"'));
		assert(/class="cm-back"/.test(sec), 'the showcase renders no back link, so the coarse floor is unreachable');
	});

	check('the prose measure column takes the token, not a typed 68ch', () => {
		// The consumer that needed this (oem-portfolio's project page) wrote
		// `max-width: 68ch` by hand, which is exactly what `--measure` already
		// holds. A class that hardcodes the number is a class that cannot be
		// re-themed, so assert the var() REFERENCE - `max-width: 68ch` is
		// DECLARED and a value-shaped assertion would sail past it.
		const card = declForSelector('.cm-prose-measure', compSrc, true);
		assert(card, '.cm-prose-measure is not defined in components.css');
		assert(/max-width:\s*var\(--measure\)/.test(card),
			`.cm-prose-measure must take var(--measure), got \`${card.trim()}\``);
		// Exactly one declaration of the column, or the effective width is a
		// question of source order.
		const all = [...compSrc.matchAll(/^\.cm-prose-measure\s*\{([^}]*)\}/gm)];
		assert(all.length === 1,
			`expected one .cm-prose-measure rule, found ${all.length}`);
		// The first-child reset is load-bearing, not tidiness: MEASURED 40px of
		// dead space above the first paragraph on the migrated page without it.
		assert(/\.cm-prose-measure\s*>\s*:first-child\s*\{[^}]*margin-top:\s*0/.test(compSrc),
			'.cm-prose-measure must zero the first child\'s top margin');
		assert(/class="[^"]*cm-prose-measure/.test(showcase),
			'the showcase renders no .cm-prose-measure, so it is unreachable surface');
	});

	check('the inline prose link takes the tap floor on a box that can hold it', () => {
		// A measured bug: the coarse block in base.css puts
		// `min-height: var(--tap)` on bare `a`, and min-height does NOTHING on
		// an inline box. Every link inside running prose escaped the floor -
		// MEASURED 34px in WebKit at an iPhone viewport. So this asserts BOTH
		// halves of one invariant: the floor is declared, and the display is
		// one that honours it. Either alone passes and together the bug returns.
		const card = declForSelector('.cm-inline-link', compSrc, false);
		assert(card, '.cm-inline-link is not defined in components.css');
		assert(/display:\s*inline-block/.test(card),
			`.cm-inline-link must be inline-block - an inline box ignores min-height, so the floor would be dead; got \`${card.trim()}\``);
		assert(/min-height:\s*var\(--tap\)/.test(card),
			`.cm-inline-link must take min-height: var(--tap), got \`${card.trim()}\``);
		// The negative margin is what stops the fix loosening the paragraph.
		// A plain `padding` here is a page of visibly looser prose on a phone,
		// and it still passes both assertions above.
		assert(/margin:\s*calc\(var\(--space-3\)\s*\*\s*-1\)/.test(card),
			`.cm-inline-link must cancel its vertical padding with a matching negative margin; got \`${card.trim()}\``);
		// The affordance. MEASURED in WebKit: bare `a` is --ink-dim and
		// `.cm-prose` is --ink, so a link inside a paragraph sat at 2.24:1
		// against the text around it in dark (2.16:1 in light) - quieter than
		// its own sentence - while still clearing AA against the PAGE at
		// 7.21:1 / 8.36:1. Both readings pass; only the first describes
		// whether a reader sees a link, because the comparison that matters
		// is the paragraph, not the page. Underline is the fix: it reads as a
		// link without relying on colour at all.
		assert(/text-decoration:\s*underline/.test(card),
			`.cm-inline-link must be underlined - inheriting base.css leaves it quieter than its own paragraph; got \`${card.trim()}\``);
		// And the underline is TINTED, not the link's own colour: a solid
		// underline at the link's weight draws a line as heavy as the text it
		// sits under, which is the reason this system tints every other one.
		assert(/text-decoration-color:\s*var\(--ink-faint\)/.test(card),
			`.cm-inline-link must tint its underline with --ink-faint; got \`${card.trim()}\``);
		assert(/class="[^"]*cm-inline-link/.test(showcase),
			'the showcase renders no .cm-inline-link, so it is unreachable surface');
	});

	/* ================= article body: reset-safe element defaults =========
	 * Two element defaults existed only as a UA default, which every CSS
	 * reset in existence declares to `none`/`inherit`. Measured in WebKit at
	 * 390px with a Tailwind v3 preflight loaded ahead of base.css:
	 *
	 *     ul  list-style-type: disc     ->  none
	 *     ol  list-style-type: decimal  ->  none
	 *     th  font-weight: 700          ->  400
	 *
	 * The indent survived at 1.4em, so a bulleted list still LOOKED like a
	 * list while carrying nothing. Across hermes-articles' corpus that is
	 * 1,772 bullet items and 818 numbered ones in 35 articles. The header
	 * cell kept its background, so it still looked like a header while every
	 * cell in the table weighed the same.
	 *
	 * These assert the DECLARATION, because that is the thing that survives a
	 * reset. Asserting the computed value would need a browser, and
	 * computed style with no reset present is exactly the state that hid the
	 * bug.
	 */
	check('a list keeps its marker without a class, because a reset erases the UA default', () => {
		// The OWNING declaration, via owningDecl. Both halves of that
		// matter and both were got wrong first:
		//   - declForSelector's default is `includes`, which resolved 'th'
		//     against `.switch` - the first selector in the sheet merely
		//     CONTAINING those letters - so the test read a switch's
		//     border-radius as a header's weight.
		//   - switching to EXACT then reads `th, td`, declared before `th`,
		//     which carries padding and no weight at all.
		const ulType = owningDecl('ul', 'list-style-type', baseSrc);
		assert(ulType === 'disc',
			`a bare ul must DECLARE list-style-type: disc. Inherited from the user agent, every reset in existence erases it - measured none behind a Tailwind preflight at 390px, with the indent still at 1.4em so it looked like a list. Got \`${ulType}\``);
		const olType = owningDecl('ol', 'list-style-type', baseSrc);
		assert(olType === 'decimal',
			`a bare ol must DECLARE list-style-type: decimal. Inheriting it from the shared ul, ol rule gives it disc - bullets on a numbered list, and resets it to none. Got \`${olType}\``);
		// The named element, not a substring. `ul` appears inside the
		// comment directly above this rule explaining exactly why it exists,
		// so a loose test scores that prose as the definition - which is
		// what happened the first time this was written.
		assert(isElementDeclared(baseSrc, 'ul') && isElementDeclared(baseSrc, 'ol'),
			'ul/ol must be bare ELEMENT selectors: a markdown renderer emits them with no class, and that is the case these defaults exist for');
	});

	check('a header cell keeps its weight without a class, because a reset erases the UA default', () => {
		const weight = owningDecl('th', 'font-weight', baseSrc);
		assert(weight === '700',
			`a bare th must DECLARE font-weight: 700. Inherited from the UA, a Tailwind preflight measured it at 400 - identical to every td beside it, so the header row became a row of equal cells while still looking like a header. Got \`${weight}\``);
		// And the data cells must NOT have been dragged along: bolding th
		// is only a header cue while the body stays regular.
		assert(owningDecl('td', 'font-weight', baseSrc) === null,
			'td must not declare a font-weight - bolding the data cells removes the distinction the header weight exists to make');
		assert(isElementDeclared(baseSrc, 'th'),
			'th must stay a bare ELEMENT selector; .cm-prose-table th and .cm-table th carry their own weight deliberately');
	});

	check('the article-body specimen renders what the defaults are for', () => {
		const sec = /<section id="proselists"[\s\S]*?<\/section>/.exec(showcase);
		assert(sec, 'the showcase has no #proselists section, so these defaults are unproven surface');
		assert(/<ul>[\s\S]*?<li>/.test(sec[0]),
			'the specimen has no classless <ul><li>, so it proves nothing about a bare list');
		assert(/<ol>[\s\S]*?<li>/.test(sec[0]),
			'the specimen has no classless <ol>, so the decimal default is unproven');
		assert(/<th scope="col">/.test(sec[0]),
			'the specimen has no bare <th>, so the header weight is unproven');
		// A specimen that puts a class on the element stops testing the
		// element default, which is the whole claim.
		assert(!/<ul class=/.test(sec[0]) && !/<ol class=/.test(sec[0]) && !/<th class=/.test(sec[0]),
			'the specimen must leave <ul>/<ol>/<th> unclassed - that is the case the defaults exist for');
		// And the section is in the nav, or a reader cannot reach it.
		assert(/'proselists'/.test(showcase) && /SECTION_ORDER/.test(showcase),
			'#proselists is not registered in SECTION_ORDER, so the section is unreachable from the page nav');
	});

	check('the library still ships its own markerless lists', () => {
		// The fix must not put bullets on a component that is a list for
		// layout. `.cm-rows` and friends declare `list-style: none` at
		// (0,1,0) against the new (0,0,1) rule, so they win - but a rule
		// that silently depends on a specificity gap is exactly the kind
		// of thing a later edit removes, so it is asserted rather than
		// assumed.
		for (const c of ['.cm-rows', '.cm-cards', '.cm-stats']) {
			const decls = ruleBodies(compSrc, c);
			assert(decls.length, `${c} is not defined in components.css`);
			assert(decls.some((b) => /list-style:\s*none/.test(b)),
				`${c} must keep list-style: none - the bare-list default would otherwise put a bullet on every row of every list component`);
		}
	});

	/* ---- the load-order half ----
	   The bare `ul, ol` rule is (0,0,1) and Tailwind v3 preflight's
	   `ol,ul,menu{list-style:none}` is ALSO (0,0,1). Equal specificity means
	   the winner is decided by source order, so the reset WINS whenever it
	   loads after the library. MEASURED in WebKit at 390px against a real
	   preflight: preflight-first -> ul computes `disc`; preflight-after ->
	   ul computes `none`. One of the two orderings silently erases every
	   bullet in every article, with the indent still at 1.4em so it looks
	   like a deliberate list.

	   The fix cannot simply raise specificity. `.cm-prose ul` is (0,1,1) and
	   beats every markerless rule above at (0,1,0) - MEASURED, it gives a
	   `.cm-rows` nested in prose a bullet. What ships is
	   `.cm-prose ul:not([class])` at (0,2,1): it beats the reset in EITHER
	   order and cannot match a list that carries a class, because a classed
	   list belongs to whoever gave it the class.

	   These assertions are about the SELECTOR, not the property: a
	   `list-style-type: disc` that survived while the specificity guarantee
	   was dropped would pass every value-shaped check and reintroduce the
	   load-order bug. That is the same shape as the `max-height: none`
	   mutant the skill records - an inert value that matches the property
	   name. */
	check('the prose marker rule outranks a reset by selector, not by load order', () => {
		const selectors = [
			'.cm-prose ul:not([class])',
			'.cm-prose ol:not([class])',
		];
		for (const sel of selectors) {
			const decls = ruleBodies(baseSrc, sel);
			assert(decls.length,
				`${sel} is not defined in base.css. Without it the bare \`ul, ol\` rule ties with a Tailwind preflight at (0,0,1) and loses whenever the consumer's reset loads after the library - measured: every ul computes list-style-type: none, with padding-left still at 1.4em so it renders as a deliberate list with nothing in it`);
			assert(decls.some((b) => /list-style-type:\s*disc/.test(b)),
				`${sel} must declare list-style-type: disc. Got a rule with the right selector and the wrong value`);
		}
		// `:not([class])` is the whole mechanism. A flat `.cm-prose ul` wins
		// the reset and loses `.cm-rows`; only excluding classed elements
		// does both.
		for (const sel of selectors) {
			assert(/:not\(\[class\]\)/.test(sel),
				`${sel} must keep :not([class]). A flat .cm-prose ul is (0,1,1), which beats the reset but also beats every (0,1,0) markerless component rule - measured: .cm-rows inside .cm-prose goes from list-style-type none to disc, putting a bullet on every row`);
		}
		// And the exclusivity has to hold in the OTHER direction too: a
		// bare-element descendant selector (`.cm-prose ul`, `.cm-prose li`)
		// anywhere in the file can undo the whole thing without touching
		// the rules above. The `(?!\()` after the element name is what
		// separates them from the shipped rule: `:not([class])` also
		// matches "a `:`, an element name, then end-of-selector", so a
		// guard written without it fails on the fix it is meant to police,
		// and a reader then relaxes the guard instead of the CSS.
		const bareProseLists = [...baseSrc
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.matchAll(/([^{}]+)\{/g)]
			.flatMap((m) => m[1].split(',').map((s) => s.trim()))
			.filter((s) => /^\.cm-prose\s+(ul|ol|li)(\s*$|\s+|:not\(|\+|~)/.test(s))
			.filter((s) => !/^(.*)\b(ul|ol|li):not\(\[class\]\)$/.test(s));
		assert(bareProseLists.length === 0,
			`these .cm-prose list selectors are (0,1,1) and will reach lists that carry a class: ${[...new Set(bareProseLists)].join(', ')}. Scope them with :not([class]) like the marker rule, or a .cm-rows inside prose grows bullets`);
	});

	check('the ordered list reaches decimal through its own :not([class]) rule', () => {
		// `ul` and `ol` share the disc declaration, so ol needs a later,
		// equally-specific rule of its own. Inheriting from the pair gives
		// ol `disc` - bullets on a numbered list.
		const olBodies = ruleBodies(baseSrc, '.cm-prose ol:not([class])');
		const decimal = olBodies.find((b) => /list-style-type:\s*decimal/.test(b));
		assert(decimal,
			'.cm-prose ol:not([class]) must DECLARE list-style-type: decimal. Sharing the ul declaration leaves ordered lists bulleted - measured: ol computed disc');
	});

	check('the load-order specimen shows both the rule and what it must not reach', () => {
		const sec = /<section id="proselists-order"[\s\S]*?<\/section>/.exec(showcase);
		assert(sec,
			'the showcase has no #proselists-order section, so the load-order guarantee is unproven surface');
		assert(/<ul>\s*\n\s*<li>/.test(sec[0]),
			'the specimen needs a CLASSLESS <ul> inside .cm-prose - that is the element the reset erases and the marker rule claims');
		assert(/<ol>\s*\n\s*<li>/.test(sec[0]),
			'the specimen needs a classless <ol> to show the decimal default survives the same fight');
		// The counter-example is the load-bearing half: a rule that only
		// proves it can add bullets would also pass with the naive flat
		// selector that breaks .cm-rows.
		assert(/<ul class="cm-rows"/.test(sec[0]),
			'the specimen must render a classed .cm-rows list inside the same .cm-prose column. Without the counter-example, this section demonstrates only that markers can be added - which the rejected flat selector also does, while breaking every markerless component');
		assert(/'proselists-order'/.test(showcase),
			'#proselists-order is not registered in SECTION_ORDER, so the section is unreachable from the page nav');
	});
}
/* These tests RUN the generator and assert on its real output.
   The first draft of them matched the generator's SOURCE TEXT, and the
   mutation sweep killed 4 of 8: a source-shaped assertion goes stale the
   moment the generator is refactored without changing what it emits, so it
   reports a kill or a pass that has nothing to do with the guarantee.

   The invariant is about the EMITTED FILE: what a consumer's build will
   see. So the tests run the generator into a temp dir with a real
   components.css beside it and read the result.

   A fixture that cannot fail is a test that cannot fail. The temp dir
   gets a REAL components.css (copied from the library, so the import
   resolves) and a real tokens.css, because the generator reads
   tokens.css from ITS OWN repo - the fixture only has to satisfy the
   --components path check.
*/
const GENERATOR = join(root, 'scripts/make-scoped-entry.mjs');

/** Run the generator into a throwaway tree; returns {out, err, code}. */
function runGenerator(genPath, { components = 'cli-mono/components.css', extraArgs = [], make = false } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'cm-scoped-'));
	try {
		mkdirSync(join(dir, 'cli-mono'), { recursive: true });
		copyFileSync(join(root, 'src/styles/components.css'), join(dir, 'cli-mono', 'components.css'));
		// `make: true` is for a path the generator is supposed to ACCEPT.
		// The default fixture only satisfies the default path; without this
		// a custom-path probe asks the generator to bless a file that does
		// not exist and fails on the guard instead of on the property under
		// test - a probe that reports the thing you already believed.
		if (make) {
			mkdirSync(join(dir, components, '..'), { recursive: true });
			copyFileSync(join(root, 'src/styles/components.css'), join(dir, components));
		}
		const out = join(dir, 'entry.css');
		let code = 0;
		let stdout = '';
		let stderr = '';
		try {
			stdout = execFileSync('node', [genPath, '--out', out, '--components', components, ...extraArgs], {
				cwd: root,
				stdio: 'pipe',
				encoding: 'utf8',
			});
		} catch (e) {
			code = e.status === undefined ? 1 : e.status;
			stdout = e.stdout || '';
			stderr = e.stderr || '';
		}
		let text = null;
		try {
			text = readFileSync(out, 'utf8');
		} catch {}
		return { dir, out, text, code, stdout, stderr };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

check('the scoped entry generator emits an @import that actually resolves', () => {
	const r = runGenerator(GENERATOR);
	assert(r.code === 0,
		`the generator exited ${r.code} on a valid path: ${r.stderr}`);
	assert(r.text, 'the generator wrote no file');
	// The path in the emitted @import must be the one that was asked for,
	// and it must name components.css - the file whose rules the consumer
	// is adopting.
	const imports = [...r.text.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
	assert(imports.length >= 1,
		'the generated entry contains no @import at all, so it ships no library rules');
	assert(imports.some((p) => p.endsWith('components.css')),
		`the generated entry imports ${JSON.stringify(imports)} but never components.css`);
	// A hardcoded path is what broke the real migration: the vendored copy
	// is at web/cli-mono/, not web/src/cli-mono/. The generator must take
	// the path as an argument.
	const custom = runGenerator(GENERATOR, { components: 'somewhere/else/components.css', make: true });
	assert(custom.code === 0, `the generator rejected a valid custom path: ${custom.stderr}`);
	assert(custom.text && /@import\s+"somewhere\/else\/components\.css"/.test(custom.text),
		'the emitted @import is not the --components path that was passed. A hardcoded path is the silent failure: the vendored location differs per consumer, and a wrong guess drops the import with only a warning');
});

check('a scoped entry whose @import cannot resolve is a LOUD failure', () => {
	// The whole reason the path is verified: PostCSS drops an @import whose
	// target is missing, with only a warning, so the consumer's build stays
	// green and ships none of the library. Measured on the real migration:
	// the built CSS contained 0 occurrences of `cm-prose-table`.
	const r = runGenerator(GENERATOR, { components: 'cli-mono/NOT-HERE.css' });
	assert(r.code !== 0,
		'the generator wrote a file whose @import points at a path that does not exist. Vite/PostCSS drops such an import with a warning, so the build stays green and the page renders the consumer\'s own styles - the library silently does not ship');
	assert(/NOT FOUND/.test(r.stderr),
		`the failure must SAY which path was missing, or it is a bare non-zero exit: ${JSON.stringify(r.stderr)}`);
});

check('the scoped entry emits its @import BEFORE any declaration block', () => {
	// PostCSS: `@import must precede all other statements (besides @charset
	// or empty @layer)`. An @import emitted after a rule is DROPPED with a
	// warning - a green build that ships nothing. Measured here: with the
	// import last, the built CSS held 0 occurrences of `cm-prose-table`.
	const r = runGenerator(GENERATOR);
	assert(r.text, 'the generator wrote no file');
	const importAt = r.text.indexOf('@import');
	assert(importAt !== -1, 'the generated entry has no @import');
	// The first DECLARATION - a selector followed by `{` - must come after.
	const firstRule = /[^{}]*\{[^{}]*\}/.exec(r.text);
	assert(firstRule, 'the generated entry has no rule at all, so the probe is vacuous');
	const ruleAt = firstRule.index + (firstRule[0].indexOf('{'));
	// Comments are not statements, so compare against the first real rule.
	assert(importAt < ruleAt,
		`the @import sits at offset ${importAt} and the first rule at ${ruleAt}. `
		+ 'An @import after a declaration block is dropped by PostCSS with only a warning');
});

check('the scoped entry GENERATES its colour tokens rather than importing tokens.css', () => {
	// Importing tokens.css is the obvious way to get --ink and it is wrong:
	// tokens.css's bare `:root` then applies to the DOCUMENT, overwriting
	// the consumer's own --accent (a neutral grey against the app's blue)
	// and --radius (10px against 0.5rem). MEASURED on the migration: with
	// tokens.css imported, the document root resolved the library's --ink
	// too, so the app's own subtree read library colours.
	const r = runGenerator(GENERATOR);
	assert(r.text, 'the generator wrote no file');
	assert(!/@import\s+"[^"]*tokens\.css"/.test(r.text),
		'the scoped entry imports tokens.css. Its bare :root block leaks onto the consumer\'s document root and overwrites the consumer\'s own --accent and --radius; the colour blocks must be GENERATED, scoped');
	// And they must actually be there, or the prose resolves var(--ink) to
	// nothing: measured, --ink came back an empty string on the element.
	for (const theme of ['dark', 'light']) {
		const sel = `[data-cm-theme='${theme}']`;
		assert(r.text.includes(sel),
			`the generated entry has no ${sel} block, so the scoped subtree resolves no colours`);
	}
	const inkDecls = [...r.text.matchAll(/--ink:\s*([^;]+);/g)].map((m) => m[1].trim());
	assert(inkDecls.length === 2,
		`expected one --ink per theme, found ${inkDecls.length}: ${JSON.stringify(inkDecls)}`);
	assert(new Set(inkDecls).size === 2,
		`both themes declare the same --ink (${JSON.stringify(inkDecls)}), so the light theme is a second dark theme`);
});

check('a scoped adoption still gets the reset-safe list markers', () => {
	// base.css is NOT imported in a scoped adoption - it is the bare-element
	// layer and the reason this path exists - so its
	// `.cm-prose ul:not([class])` never arrives. The generator reproduces it
	// as a scoped twin, and the guarantee is the SPECIFICITY, not the
	// presence of the value: preflight's `ol,ul,menu{list-style:none}` is
	// also (0,0,1), so only the selector outranks it.
	const r = runGenerator(GENERATOR);
	assert(r.text, 'the generated entry has no file');
	assert(/\[data-cm-theme\][^{}]*:not\(\[class\]\)[^{}]*\{/.test(r.text),
		'the scoped twin lost its :not([class]). That selector is (0,2,1) and is what beats the consumer\'s preflight in either load order; without it every bullet in every article renders at list-style-type: none with padding-left intact');
	assert(/\[[^{}]*:not\(\[class\]\)[^{}]*\{[^{}]*list-style-type:\s*disc/.test(r.text),
		'the scoped twin declares no disc marker on a classless list');
	// Anchor on the RULE's own selector, not on a bare `ol` substring: the
	// combined rule above reads `[data-cm-theme] :is(ul, ol):not([class])`,
	// and a loose /ol[^{]*:not\(\[class\]\)/ matches the `ol)` INSIDE that
	// :is() and then reads `list-style-type: disc` as the ordered-list rule.
	// That is a probe reporting a defect that does not exist, which is worse
	// than no probe.
	const olRule = /^\[data-cm-theme\][ 	]+ol:not\(\[class\]\)[ 	]*\{([^{}]*)\}/m.exec(r.text);
	assert(olRule, 'no top-level scoped `ol:not([class])` rule');
	assert(/list-style-type:\s*decimal/.test(olRule[1]),
		`the scoped ol rule does not declare decimal (it reads ${JSON.stringify(olRule[1])}) - sharing the ul declaration leaves ordered lists bulleted`);
});

check('the scoped entry and the library tokens cannot drift apart', () => {
	// A hand-typed scale was measured wrong in 17 of 44 values, which is why
	// the file is generated. But a generated file still drifts the moment
	// someone edits it, so `--check` re-derives and must fail on a
	// difference. This asserts the CHECK, by mutating the emitted file and
	// requiring a non-zero exit.
	const r = runGenerator(GENERATOR);
	assert(r.code === 0 && r.text, 'the generator did not produce a file to check');
	// Re-run against a doctored copy in the same fixture layout.
	const dir = mkdtempSync(join(tmpdir(), 'cm-scoped-drift-'));
	try {
		mkdirSync(join(dir, 'cli-mono'), { recursive: true });
		copyFileSync(join(root, 'src/styles/components.css'), join(dir, 'cli-mono', 'components.css'));
		const entry = join(dir, 'entry.css');
		writeFileSync(entry, r.text.replace('--space-3: 0.75rem;', '--space-3: 0.9rem;'));
		let code = 0;
		let stderr = '';
		try {
			execFileSync('node', [GENERATOR, '--check', entry, '--components', 'cli-mono/components.css'], {
				cwd: root,
				stdio: 'pipe',
				encoding: 'utf8',
			});
		} catch (e) {
			code = e.status === undefined ? 1 : e.status;
			stderr = e.stderr || '';
		}
		assert(code !== 0,
			'--check passed a scoped entry whose --space-3 was hand-edited. The whole point of generating this file is that a rebrand reaches every consumer; a check that cannot see the difference makes the generation pointless');
		assert(/STALE/.test(stderr),
			`--check failed without saying STALE: ${JSON.stringify(stderr)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/* ---------- .cm-surface: the paint a scoped adoption cannot get ------

   A SCOPED adoption (make-scoped-entry.mjs) ships components.css plus
   tokens re-scoped to [data-cm-theme], and deliberately cannot ship
   base.css: that file is 52 bare-element rules, and unlayered CSS
   outranks every @layer in a Vite/PostCSS build, so importing it would
   let the library's `a`, `h1`, `button` defaults beat the consumer's
   own Tailwind utilities across the whole app.

   The cost was that nothing in the library PAINTED anything. Every
   other .cm-* class is padding and colour within a surface. So a
   scoped consumer had one option: `style={{ background: 'var(--bg)',
   color: 'var(--ink)' }}` written by hand at the root of its tree, and
   without it the app rendered BLACK TEXT ON A WHITE PAGE with every
   token resolving correctly. MEASURED on spacetime-memory at
   1280x900: html and body both computed rgba(0,0,0,0).

   These assert the CAUSE (the paint declarations exist and resolve), not
   the effect, for the reason this file exists: a presence check passes
   on `.cm-surface { }` with an empty body, which paints nothing. */

{
	// The rule that OWNS a property for a selector, not a
	// last-in-source-order read: `.cm-surface` and `.cm-surface--flat`
	// are siblings, and reading the wrong one passes the wrong test.
	const ruleBody = (cls) => {
		const esc = cls.replace(/[-]/g, '\\-');
		const re = new RegExp(
			'(^|[\\s,}])' + esc + '\\s*(,[^{]*)?\\{([^}]*)\\}', 'g');
		let last = null;
		for (const m of compSrc.matchAll(re)) {
			// A COMPOUND selector (`--x .cm-surface`) does not define it.
			const head = m[0].slice(0, m[0].indexOf('{'));
			if (!new RegExp('(^|[\\s,}])' + esc + '\\s*(,|$)')
				.test(head.trim())) continue;
			last = m[3];
		}
		return last || '';
	};

	check('.cm-surface paints a subtree root, which no other class does', () => {
		const body = ruleBody('.cm-surface');
		assert(body !== '', '.cm-surface has no rule in components.css');
		assert(/background-color:\s*var\(--bg\)/.test(body),
			'.cm-surface must set background-color: var(--bg) - without it ' +
			'the subtree paints transparent and the text lands on the page behind it');
		assert(/color:\s*var\(--ink\)/.test(body),
			'.cm-surface must set color: var(--ink), or a scoped adoption ' +
			'inherits the host app foreground');
		assert(/font-family:\s*var\(--font-body\)/.test(body),
			'.cm-surface must carry the body font; a scoped subtree that does ' +
			'not renders the host app font stack');
	});

	check('the surface paints from tokens the SCOPED entry actually emits', () => {
		// The generator copies the colour half VERBATIM out of
		// tokens.css's own [data-cm-theme] blocks, so the string `--bg`
		// need never appear in the script at all - reading the source for
		// token names reports a working generator as broken. ASK it
		// instead, through the repo's own generator fixture, and read the
		// declarations in the file it actually emits.
		const r = runGenerator(GENERATOR);
		assert(r.code === 0,
			'the scoped-entry generator did not run, so the emitted tokens ' +
			'cannot be read: ' + r.stderr.trim());
		const declared = new Set(
			[...r.text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
		assert(declared.size > 20,
			'the generated entry declares suspiciously few tokens (' +
			declared.size + '), so this check is reading the wrong file');
		for (const v of new Set(
			[...ruleBody('.cm-surface').matchAll(/var\((--[a-z0-9-]+)\)/g)]
				.map((m) => m[1]))) {
			assert(declared.has(v),
				'.cm-surface resolves ' + v + ', which the generated scoped ' +
				'entry does not declare - the scoped adoption this class ' +
				'exists for would render with an undefined value');
		}
	});

	check('.cm-surface--flat drops the vignette instead of restating the paint', () => {
		const body = ruleBody('.cm-surface--flat');
		assert(body !== '', '.cm-surface--flat has no rule in components.css');
		assert(/background-image:\s*none/.test(body),
			'--flat must set background-image: none - a consumer that paints ' +
			'its own chrome would get the library vignette composited over it');
		assert(!/background-color\s*:/.test(body),
			'--flat restates background-color; that belongs to .cm-surface alone');
		assert(!/color\s*:/.test(body),
			'--flat restates color; that belongs to .cm-surface alone');
	});

	check('the surface and the bare body rule agree on what a surface IS', () => {
		// The MUTEX. `.cm-surface` and base.css `body` are two
		// implementations of one job, and a scoped consumer gets exactly
		// one of them. If base.css changes its paint and this class does
		// not, the same product renders two different surfaces depending
		// on which file the consumer could afford to import - and every
		// check that reads only components.css reports green.
		const bodyRule = (() => {
			const m = /(?:^|\})\s*body\s*\{([^}]*)\}/.exec(
				read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, ''));
			return m ? m[1] : '';
		})();
		assert(bodyRule !== '', 'base.css has no body rule to compare against');
		for (const prop of ['background-color', 'color', 'font-family',
			'font-size', 'line-height', '-webkit-font-smoothing',
			'text-rendering', 'background-image', 'background-attachment']) {
			const decl = (src) => {
				const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)');
				const m = re.exec(src);
				return m ? m[1].trim() : null;
			};
			const inBody = decl(bodyRule);
			const inSurface = decl(ruleBody('.cm-surface'));
			assert(inBody !== null,
				'base.css body no longer declares ' + prop + ', so the ' +
				'comparison that keeps the two surfaces identical lost its subject');
			assert(inBody === inSurface,
				'base.css body and .cm-surface disagree on ' + prop + ': ' +
				"'" + inBody + "' against '" + inSurface + "'. A scoped adoption " +
				'and a full adoption would then paint the same product two ways.');
		}
	});

	check('the showcase demonstrates the surface on an island, not on its body', () => {
		// A fixture nested in the showcase inherits the showcase own body
		// paint, so a `.cm-surface` with NO declarations renders
		// identically to a correct one. The masked backing is what makes
		// this section a demonstration rather than a decoration, and
		// removing it leaves the section LOOKING fine while proving
		// nothing - which is the failure this whole file exists to stop.
		const page = read('src/pages/index.astro');
		const at = page.indexOf('<section id="surface-paint"');
		assert(at !== -1, 'the showcase has no surface-paint section');
		const body = page.slice(at, page.indexOf('</section>', at));
		assert(/class="cm-surface"/.test(body),
			'the surface section does not render .cm-surface');
		assert(/class="cm-surface cm-surface--flat"/.test(body),
			'the surface section does not demonstrate --flat');
		assert(/<div style="[^"]*background:[^"]*"/.test(body),
			'the specimen has no masked backing, so what is being demonstrated ' +
			'is the showcase body paint - delete .cm-surface and it still looks right');
		const islands = [...body.matchAll(/class="cm-surface[^"]*"[^>]*?data-cm-theme="(\w+)"/g)];
		assert(islands.length === 2,
			'expected both surface specimens to bind a theme, found ' + islands.length);
	});
}

/* ================= the verdict is printed at the very END of this file.
   It used to sit here, in the middle: every check declared after it -
   the rhythm block, then anything a later batch appended - still RAN but
   could neither be counted nor fail the run, which is the silent-dead-test
   mode this file exists to prevent. Appended checks are the normal way
   this file grows, so the report belongs after them, not before. */

/* ================= one rhythm, everywhere ================= */
{
	// Omar: "some items don't appear to be spaced correctly... many cases
	// where sections are mashed together and there's no padding or margins
	// or anything to divide them."
	//
	// Measured at 390px across all five consumers, EVERY one put content
	// flush against its page head at exactly 0.0px. One cause: .cm-head
	// set no bottom margin and no component owned the space between two
	// top-level blocks. The --space-N scale was already enforced and still
	// produced this, because a scale says which sizes EXIST - nothing said
	// which one goes WHERE, so each project invented its own number.
	//
	// tests/verify-vertical-rhythm.py proves it in a real browser; these
	// pin the source invariants that make it possible.
	const TOKENS = read("src/styles/tokens.css");
	const COMP = read("src/styles/components.css");

	check("the rhythm tokens exist, and every one is off the spacing scale", () => {
		// Four steps, each naming WHERE it goes rather than how big it is.
		// A literal here is the disease: one project's rem is another
		// project's bug report.
		for (const t of ["--stack-gap", "--stack-section", "--stack-head",
		                 "--stack-tight"]) {
			const re = new RegExp(t + ":\\s*var\\(--space-\\d\\)");
			if (!re.test(TOKENS))
				throw new Error(t + " is missing or is not off the spacing scale");
		}
	});

	check("the stack owns the gap between siblings", () => {
		const base = ruleBodies(COMP, ".cm-stack").join("");
		if (!/display:\s*flex/.test(base))
			throw new Error("the stack must be a flex container");
		if (!/flex-direction:\s*column/.test(base))
			throw new Error("a stack whose flex-direction is not column lays blocks out in a ROW");
		if (!/gap:\s*var\(--stack-gap\)/.test(base))
			throw new Error("the stack carries no gap from the rhythm tokens");
	});

	check("the stack zeroing rule sits at the END of the layer, where it wins", () => {
		// Same specificity as every component rule, so source order decides.
		// Measured with it up top next to the definition: `.cm-stack > *`
		// lost to `.cm-section` and `.cm-status`, sections rendered at
		// 48.8px (a 28.8px component margin + a 20px gap) against a 24px
		// rhythm, and --stack-section never applied at all.
		const zero = COMP.lastIndexOf(".cm-stack > * {");
		if (zero < 0)
			throw new Error("no .cm-stack > * reset exists, so a child's own margin adds to the gap");
		const head = COMP.indexOf(".cm-head {");
		const section = COMP.indexOf(".cm-section {");
		const status = COMP.indexOf(".cm-status");
		for (const [name, at] of [["cm-head", head], ["cm-section", section],
		                          ["cm-status", status]]) {
			if (at < 0) continue;
			if (zero < at)
				throw new Error("the .cm-stack reset is before ." + name +
					", so that component's own margin still wins");
		}
	});

	check("a head block separates itself from what it introduces", () => {
		const head = ruleBodies(COMP, ".cm-head").join("");
		if (!/margin-bottom:\s*var\(--stack-head\)/.test(head))
			throw new Error(".cm-head has no bottom margin from the rhythm, so " +
				"content sits flush against it (the 0px join in all five projects)");
	});

	check("no DIRECT child of the stack carries a hand-written margin", () => {
		// The page is the thing that drifted: 128 inline margin
		// declarations, 29 of them on the sections the stack already
		// spaces. Each one added to the gap rather than replacing it, which
		// is how the same page rendered 20px, 24px, 40px, 48.8px and 52px
		// between sections.
		//
		// Scoped to the stack's DIRECT children on purpose. A margin on
		// something nested four levels down is a specimen's internal
		// spacing, which is the author's business - and a test that
		// forbade those would be a test nobody could satisfy honestly, so
		// it would just get deleted. The rhythm is a page-level contract.
		const page = read("src/pages/index.astro");
		const mainAt = page.indexOf("<main");
		const main = page.slice(mainAt);
		// Derive the child indent from <main>'s own line rather than
		// hardcoding it. An earlier version of this test assumed two tabs
		// and the sections are at three, so the regex matched NOTHING and
		// the test passed while a hand-written `margin-bottom: 2rem` sat
		// on the `nav` section - a dead test, which is the one failure
		// mode this whole file exists to prevent.
		const mainIndent = page.slice(page.lastIndexOf("\n", mainAt) + 1, mainAt)
			.match(/^[	 ]*/)[0];
		const childIndent = mainIndent + "	";
		const offender = new RegExp(
			"^" + childIndent.replace(/	/g, "\	") +
			"<(?!\/)[a-zA-Z][^>]*\\sstyle=\"[^\"]*margin-(?:top|bottom)",
			"gm",
		);
		const offenders = [...main.matchAll(offender)].map((m) => m[0].trim().slice(0, 70));
		// Guard the guard: if the derived indent matches nothing at all on
		// a page that plainly has direct children, the regex is wrong again
		// and would pass vacuously forever.
		const directChildren = (main.match(new RegExp(
			"^" + childIndent.replace(/	/g, "\	") + "<(?!\\/)", "gm")) || []).length;
		if (directChildren === 0)
			throw new Error("the derived child indent matched no direct children of " +
				"<main>; this test would pass on anything");
		if (offenders.length)
			throw new Error(offenders.length + " direct child/children of <main> " +
				"carry a hand-written margin, e.g. " + offenders[0] +
				" - the stack owns this; a number here adds to the gap");
	});
}


// ---------- shadcn-parity: outline button + range slider ----------
check("the outline button variant exists and inverts on hover", () => {
	const css = read("src/styles/components.css");
	const page = read("src/pages/index.astro");
	assert(/\.cm-btn--outline:hover,[\s\S]{0,200}?background:\s*var\(--ink\)/.test(css),
		".cm-btn--outline must fill with --ink on hover");
	assert(/\.cm-btn--outline:hover[\s\S]{0,200}?color:\s*var\(--bg\)/.test(css),
		".cm-btn--outline must invert its text on hover");
	assert(page.includes('class="cm-btn cm-btn--outline"'),
		"the showcase must ship an outline button specimen");
});

check("the slider is a native range input wearing house chrome", () => {
	const css = read("src/styles/components.css");
	const page = read("src/pages/index.astro");
	assert(/<input[^>]*class="cm-slider"[^>]*type="range"/.test(page),
		"the slider must be a real input[type=range], not a div");
	assert(css.includes("input.cm-slider::-webkit-slider-runnable-track"),
		"the rail must be styled for WebKit (Omar reads on iPhone)");
	assert(/input\.cm-slider::-webkit-slider-thumb \{[\s\S]{0,200}?border-radius:\s*0/.test(css),
		"the thumb must be sharp");
	assert(/input\.cm-slider::-webkit-slider-runnable-track \{[\s\S]{0,300}?border:\s*1px solid/.test(css),
		"a bare --bg-3 rail measures ~1.04:1 against its panel, so the rail must be framed");
});

check("the runtime mirrors the slider value into the fill", () => {
	const js = read("src/js/cli-mono.js");
	assert(js.includes("function cmPaintSlider"), "cmPaintSlider must exist");
	assert(js.includes("addEventListener('input', onSliderInput)"),
		"the fill must follow the input event, delegated at the root");
	assert(js.includes("cmInitSliders(root)"), "init() must paint sliders already in the DOM");
});

/* ================= result =================
   Registered as an EXIT handler, not printed inline. Checks are appended
   to this file as it grows - the rhythm block and every later batch sit
   below wherever this text physically lands - and a verdict printed at a
   fixed line stops counting every check after it. Eight checks were dead
   that way. Reading the counters at exit means the report is always last
   and always complete, whatever order the file ends up in. */
process.on('exit', () => {
	console.log(`\n${passed} passed, ${failures.length} failed`);
	if (failures.length) {
		for (const [n, m] of failures) console.error(`  FAIL ${n}: ${m}`);
		process.exitCode = 1;
	}
});

// ---------- shadcn-parity: hover card + input group ----------
check("the hover card is visibility-gated, not merely faded", () => {
	const css = read("src/styles/components.css");
	const page = read("src/pages/index.astro");
	assert(/\.cm-hovercard__panel \{[\s\S]{0,300}?visibility: hidden/.test(css),
		"the panel must be visibility: hidden at rest - opacity alone still catches touches");
	assert(/\.cm-hovercard:focus-within \.cm-hovercard__panel/.test(css),
		"the keyboard needs focus-within, which a hover-only rule drops");
	assert(page.includes('cm-hovercard__panel'), "the showcase must ship a hover card specimen");
});

check("the input group collapses to one hairline", () => {
	const css = read("src/styles/components.css");
	const page = read("src/pages/index.astro");
	assert(/\.cm-input-group__addon \{[^}]*border-right-width: 0;/s.test(css),
		"the addon gives up its right border so the field's own border is the only seam");
	assert(!/\.cm-input-group[^{]*\{[^}]*margin-left: -/.test(css) &&
		!/\.cm-input-group > \* \+ \* \{[^}]*margin/s.test(css),
		"the seam must be a collapsed border, never a negative margin");
	assert(page.includes('class="cm-input-group'), "the showcase must ship an input group specimen");
	assert(!/\.cm-input-group[^{]*\{[^}]*margin-left: -/.test(css),
		"the seam must be a collapsed border, never a negative margin");
});


// ---------- shadcn-parity: OTP input + command palette ----------
{
	const page = read('src/pages/index.astro');
	const js = read('src/js/cli-mono.js');
	const css = read('src/styles/components.css');

	check('six OTP cells ship, and init() binds them', () => {
		const cells = page.match(/class="cm-otp__cell"/g) || [];
		assert(cells.length === 6, 'expected 6 cells, got ' + cells.length);
		assert(js.includes('cmInitOtp(root);'), 'init() must bind the OTP group');
		assert(js.includes("querySelectorAll('.cm-otp')"), 'the binder must scope to .cm-otp');
	});

	check('the OTP cell rule outranks the base input rule', () => {
		// base.css styles `input:not(...)` at (0,1,1). A lone
		// `.cm-otp__cell` at (0,1,0) loses every property they share,
		// and the cell keeps its full-width box.
		assert(/\.cm-otp \.cm-otp__cell \{/.test(css),
			'the cell rule must be a descendant pair to win the cascade');
	});

	check('a typed digit advances and Backspace clears before it retreats', () => {
		assert(/if \(el\.value\) focusAt\(index\(el\) \+ 1\)/.test(js),
			'the input handler must advance focus after a digit');
		assert(/if \(el\.value\) el\.value = '';/.test(js) &&
			/else if \(i > 0\)/.test(js),
			'backspace must clear a filled cell before retreating');
		// preventDefault() in the keydown branch means no input event
		// follows a typed digit, so the advance must live there too.
		assert(/el\.value = e\.key;\s*\n\s*focusAt\(i \+ 1\);/.test(js),
			'the keydown branch must advance focus itself');
		assert(/addEventListener\('paste'/.test(js), 'a pasted code must fill the group');
	});

	check('the command palette ships and init() binds it', () => {
		assert(page.includes('id="cmd-demo" class="cm-dialog cm-command"') ||
			page.includes('class="cm-dialog cm-command" id="cmd-demo"'),
			'the palette specimen must be a cm-dialog cm-command');
		assert(page.includes('data-cm-open="cmd-demo"'), 'there must be a trigger');
		assert(js.includes('cmInitCommand(root);'), 'init() must bind the palette');
		assert(js.includes("querySelectorAll('.cm-command')"), 'the binder must scope to .cm-command');
	});

	check('the palette filters, tracks a roving row, and resets on close', () => {
		assert(/it\.textContent\.toLowerCase\(\)\.indexOf\(q\) !== -1/.test(js),
			'matching must be a substring search, not a prefix one');
		assert(/'ArrowDown'/.test(js) && /'ArrowUp'/.test(js),
			'arrow keys must move the active row');
		assert(/aria-activedescendant/.test(js), 'the active row must reach the a11y tree');
		assert(/addEventListener\('close'/.test(js) && /input\.value = ''/.test(js),
			'reopening must start from a clean query');
	});

	check('a filtered row actually disappears', () => {
		// `.cm-command__item { display: flex }` is an author rule; the UA
		// ships `[hidden] { display: none }`. Author beats UA, so without
		// an explicit rule the row keeps its box with its text gone.
		assert(/\.cm-command__item\[hidden\][\s\S]{0,120}display: none;/.test(css),
			'the palette needs an explicit [hidden] rule');
		assert(page.includes('class="cm-command__empty" hidden'),
			'there must be an empty state to reveal');
	});
}

// ---------- shadcn-parity: carousel + stepper ----------
{
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	const page = read('src/pages/index.astro');

	check('the carousel is a scrollport with snap, not a transform slideshow', () => {
		const track = css.match(/\.cm-carousel__track\s*\{([^}]*)\}/);
		assert(track, '.cm-carousel__track is not defined');
		assert(/scroll-snap-type:\s*x mandatory/.test(track[1]),
			'the track must snap on x, or a swipe lands between slides');
		assert(/overflow-x:\s*auto/.test(track[1]),
			'the track must be the scroll container; without it the page scrolls sideways');
		const slide = css.match(/\.cm-carousel__slide\s*\{([^}]*)\}/);
		assert(slide, '.cm-carousel__slide is not defined');
		assert(/flex:\s*0 0 100%/.test(slide[1]), 'a slide must be one viewport of the track, not shrink to fit');
		assert(/scroll-snap-align:\s*start/.test(slide[1]), 'a slide must snap on start');
		assert(!/transform:|translateX\(/.test(slide[1] + (track[1] || '')),
			'the carousel must not transform slides: a transform desyncs from the real scroll offset');
	});

	check('the page marks are tap-sized and carry the current position', () => {
		// An 8px square is not a target. The button is the box; the square
		// is painted inside it, so the hit area is --tap and the mark is 8.
		assert(/\.cm-carousel__page\s*\{[^}]*width:\s*var\(--tap\)/s.test(css),
			'page buttons must be --tap wide, or a thumb cannot hit the position mark');
		assert(/\.cm-carousel__page\[aria-current='true'\]::before\s*\{[^}]*background:\s*var\(--ink\)/s.test(css),
			'the current page must fill, or position is carried by hue alone');
		assert(page.includes('cm-carousel__page'), 'the showcase must render page marks');
		assert((page.match(/cm-carousel__page/g) || []).length >= 4,
			'the showcase carousel needs at least three marks to prove the contract');
	});

	check('the carousel runtime reads the track and writes only its scroll', () => {
		assert(/function cmInitCarousels\(root\)/.test(js), 'cmInitCarousels is missing');
		assert(/cmInitCarousels\(root\);/.test(js), 'cmInitCarousels is never called from init');
		assert(/addEventListener\('scroll'/.test(js), 'the active mark must follow the track scroll');
		assert(/track\.addEventListener\('keydown'/.test(js),
			'the track must own its arrow keys: WebKit does not scroll a focused scroll container for you');
		// The landing coordinate must be measured in the TRACK's frame.
		// `slide.offsetLeft` is measured against the nearest positioned
		// ancestor - at 402px it is 40px larger than the scroll offset, and
		// scroll-snap quietly rescued every wrong landing, so nothing looked
		// broken until a test compared the two numbers directly.
		assert(/track\.scrollTo\(\{\s*left:\s*slideOffset\(i\)/.test(js),
			'buttons must scroll to the slide offset measured in track coordinates');
		assert(/return track\.scrollLeft \+ \(r\.left - t\.left\)/.test(js),
			'the slide offset must come from the rects (getBoundingClientRect), not from offsetLeft');
		assert(!/scrollTo\(\{\s*left:\s*s\.offsetLeft/.test(js),
			'offsetLeft is not a scroll coordinate: measured against a positioned ancestor, 40px off at 402px');
		assert(/aria-current', 'true'/.test(js) && /removeAttribute\('aria-current'\)/.test(js),
			'the active mark must be mirrored to aria-current, both ways');
		assert(/prev\.disabled = i <= 0/.test(js) && /next\.disabled = i >= slides\.length - 1/.test(js),
			'prev/next must disable at the ends, or an end button scrolls nowhere and looks broken');
	});

	check('the stepper marks one current step and moves aria with it', () => {
		assert(page.includes('data-cm-stepper'), 'the showcase must render an interactive stepper');
		assert(/function cmInitSteppers\(root\)/.test(js) && /cmInitSteppers\(root\);/.test(js),
			'cmInitSteppers must exist and be called from init');
		assert(/classList\.toggle\('is-current', n === i\)/.test(js),
			'exactly one step may be current; a stepper that can show two is a stepper that lies');
		assert(/classList\.toggle\('is-done', n < i\)/.test(js),
			'every step before the current one must read as done');
		assert(/setAttribute\('aria-current', 'step'\)/.test(js),
			'the current step must carry aria-current="step" and move with the class');
		const marker = css.match(/\.cm-step\.is-current \.cm-step__marker\s*\{([^}]*)\}/);
		assert(marker && /background:\s*var\(--ink\)/.test(marker[1]),
			'the current marker must invert, not take a hue this system does not have');
		assert(/\.cm-stepper\s*\{[^}]*list-style:\s*none/s.test(css),
			'the stepper is an <ol>: the list marker must be suppressed, not left to the UA');
		// The connector must hang off the <li>. Each .cm-step is the only
		// child of its own li, so `:not(:last-child)` on the button is
		// always false - the first version of this component had no
		// connector at any width and every check in the suite stayed green.
		assert(/\.cm-stepper > li:not\(:last-child\)::after\s*\{[^}]*content:\s*''/s.test(css),
			'the connector must target the <li>: .cm-step is always an only child, so :not(:last-child) on it never matches');
		assert(!/\.cm-step:not\(:last-child\)/.test(css),
			'a connector keyed to .cm-step:not(:last-child) can never match - target the li');
	});
}


// ---------- shadcn-parity: popover + combobox ----------
{
	const page = read('src/pages/index.astro');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');

	check('the popover is a native [popover] anchored by the runtime', () => {
		assert(/<div class="cm-popover" id="pop-demo"[^>]*\bpopover\b/s.test(page),
			'the showcase must ship a popover card on the platform element');
		assert(/popovertarget="pop-demo"/.test(page),
			'the trigger must open it through popovertarget, not through script');
		assert(/POP_SEL = '[^']*\.cm-popover\[popover\]/.test(js),
			'the card must join POP_SEL or it is never anchored, pinned or focused');
		assert(/classList\.contains\('cm-popover'\)/.test(js) && /var x = start \? t\.left : t\.right - w/.test(js),
			'a card aligns to the LEFT edge it opened from; only a menu right-aligns to its chevron');
		assert(/classList\.contains\('cm-menubar__menu'\)/.test(js),
			'the menubar panel must be in that left-align set too - it hangs under its WORD');
		const rule = css.match(/\.cm-popover \{([^}]*)\}/);
		assert(rule, '.cm-popover is not defined');
		assert(/border-radius:\s*var\(--radius-sm\)/.test(rule[1]), 'the card must take the sharp radius token');
		assert(/z-index:\s*var\(--z-popover\)/.test(rule[1]), 'the card must sit on the named popover layer');
	});

	check('the combobox wires an input to a listbox and filters it', () => {
		assert(/<div class="cm-combobox"/.test(page), 'the showcase must ship a combobox specimen');
		assert(/role="combobox"[^>]*\baria-expanded="false"/s.test(page),
			'the input must state its collapsed state to a reader');
		const opts = (page.match(/role="option"/g) || []).length;
		assert(opts >= 4, `a combobox needs options to filter, found ${opts}`);
		assert(/function cmInitComboboxes\(root\)/.test(js), 'cmInitComboboxes is missing');
		assert(/cmInitComboboxes\(root\);/.test(js), 'cmInitComboboxes is never called from init');
		assert(/addEventListener\('input', filter\)/.test(js), 'typing must filter the list');
		assert(/choose\(active\)/.test(js), 'Enter must commit the active option, not just close the list');
		assert(/wrap\.contains\(e\.target\)\) setOpen\(false\)/.test(js),
			'a click outside must close the list - the part every hand-rolled version forgets');
		// `display: block` on the list outranks the UA's [hidden], so a
		// filtered-empty list would stay laid out: the rule has to say it.
		assert(/\.cm-combobox__list\[hidden\][^{]*\{[^}]*display:\s*none/s.test(css),
			'the list needs an explicit [hidden] display: none - author display beats the UA rule');
		const list = css.match(/\.cm-combobox__list \{([^}]*)\}/);
		assert(list && /position:\s*absolute/.test(list[1]), 'the list must overlay, not push the form down');
		// The active row must be marked in PAINT, and that paint must WIN.
		// Asserting the rule exists passed on a file that declared it and
		// then repainted the same selector transparent three lines later.
		const paint = /\.cm-combobox__option\.is-active[^{}]*\{[^}]*background:\s*var\(--bg-3\)/s.exec(css);
		assert(paint, 'the active option must be painted, not only classed');
		const later = css.slice(paint.index + paint[0].length)
			.match(/\.cm-combobox__option\.is-active[^{}]*\{[^}]*background:\s*[^;}]+/s);
		assert(!later, `a later rule repaints the active option: ${later && later[0].replace(/\s+/g, ' ').slice(0, 90)}`);
	});
}

// ---------- shadcn-parity: context menu + menubar ----------
{
	const page = read('src/pages/index.astro');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');

	check('a context menu opens at the pointer, not at a trigger', () => {
		assert(/data-cm-ctx="ctx-demo"/.test(page), 'the showcase must ship a right-click specimen');
		assert(/id="ctx-demo" popover="manual" role="menu"/.test(page),
			'the panel must be a platform [popover] menu, not a positioned div');
		// MANUAL is a measured decision, not a preference: with light dismiss
		// on, the mouseup of the right-click that opened it closed the panel
		// 2ms after it appeared (open 2469ms, closed 2471ms). So the two
		// things light dismiss and Escape would have owned must be runtime.
		assert(/addEventListener\('pointerdown', onCtxOutside, true\)/.test(js),
			'an outside press must dismiss it - nothing else does in manual mode');
		assert(/addEventListener\('keydown', onCtxEscape, true\)/.test(js),
			'Escape must dismiss it - nothing else does in manual mode');
		assert(/menu\.__cmReturn/.test(js),
			'a manual popover gets no focus return; the runtime has to remember it');
		assert(/addEventListener\('contextmenu', onContextMenu, true\)/.test(js),
			'the contextmenu listener must be bound, in capture, at the root');
		assert(/closest\('\[data-cm-ctx\]'\)/.test(js), 'the handler must find its trigger through data-cm-ctx');
		assert(/var x = e\.clientX, y = e\.clientY;/.test(js),
			'the pointer is the anchor: without reading it there is no point to open at');
		assert(/if \(!x && !y && typeof trg\.getBoundingClientRect/.test(js),
			'the context-menu KEY carries no pointer: 0,0 must resolve to the element');
		assert(/menu\.__cmCtx = \{ x: x, y: y \}/.test(js),
			'the resolved point must ride on the menu until the anchor reads it');
		// preventDefault must be IN this handler - the browser's own menu
		// is the thing being replaced, and a panel under it is invisible.
		const body = js.slice(js.indexOf('function onContextMenu'), js.indexOf('/* ---------- menubar'));
		assert(/\s\s\te\.preventDefault\(\);/.test(body), 'the OS menu must be suppressed inside onContextMenu');
		// showPopover() on an open popover THROWS, so the close must come first.
		assert(body.indexOf('hidePopover') !== -1 && body.indexOf('hidePopover') < body.indexOf('menu.showPopover()'),
			'a second right-click must close before it reopens, or it throws');
		assert(/if \(!trigger && !at && !host\) return;/.test(js),
			'the anchor must accept a pointer-only menu; a bare return strands it at the origin');
		assert(/if \(at\) \{[\s\S]*?cx \+ w > window\.innerWidth - pad/.test(js),
			'the panel must be clamped inside the viewport at the point that was clicked');
		// A context menu belongs to a point: the page moving under it
		// invalidates the anchor, so it closes rather than drifts.
		assert(js.includes('popPins.push({ menu: menu, fn: closeOn })') &&
			js.includes("window.addEventListener('scroll', closeOn"),
			'a pointer menu must close when the page moves under it');
		const rule = css.match(/\.cm-ctx \{([^}]*)\}/);
		assert(rule, '.cm-ctx is not defined');
		assert(/position:\s*fixed/.test(rule[1]), 'it must start where a pointer click leaves it, not at a corner offset');
		assert(/max-width:\s*calc\(100vw - 16px\)/.test(rule[1]),
			'width cap must be the viewport minus the runtime\'s own 8px clamp per side');
	});

	check('a menubar is a row of words whose panels hang under them', () => {
		assert(/<div class="cm-menubar" data-cm-menubar role="menubar"/.test(page),
			'the showcase must ship a real menubar');
		const triggers = (page.match(/class="cm-menubar__trigger"/g) || []).length;
		assert(triggers >= 3, `a menubar needs words to walk, found ${triggers}`);
		const panels = (page.match(/cm-dropdown__menu cm-menubar__menu/g) || []).length;
		assert(panels >= 3, `each word needs its own panel, found ${panels}`);
		const bar = css.match(/\.cm-menubar \{([^}]*)\}/);
		assert(bar && /display:\s*flex/.test(bar[1]), 'the bar is a row, not a stack');
		const trg = css.match(/\.cm-menubar__trigger \{([^}]*)\}/);
		assert(trg, '.cm-menubar__trigger is not defined');
		assert(/border-radius:\s*var\(--radius-sm\)/.test(trg[1]), 'the cell takes the sharp radius token');
		assert(/border-right:\s*1px solid var\(--line\)/.test(trg[1]),
			'cells are divided by a hairline - a menu bar without rules reads as one blob');
		const panel = css.match(/\.cm-menubar__menu \{([^}]*)\}/);
		assert(panel && /position:\s*fixed/.test(panel[1]),
			'the panel must be out of flow, or opening one widens the bar');
		assert(/function menubarTriggers\(bar\)/.test(js) && /function onMenubarKey\(e\)/.test(js),
			'the menubar keyboard handler is missing');
		assert(/closest\('\[data-cm-menubar\]'\)/.test(js), 'the handler must be scoped to its own bar');
		assert(/e\.key === 'ArrowDown'/.test(js),
			'ArrowDown must open a focused word - Enter and Space are the platform\'s, ArrowDown is not');
		assert(/\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/.test(js),
			'walking the words and their menus is the whole point of the pattern');
		const kbody = js.slice(js.indexOf('function onMenubarKey'), js.indexOf('/* ---------- toggle group'));
		assert(kbody.indexOf('next.focus();') !== -1 &&
			kbody.indexOf('next.focus();') < kbody.indexOf('nm.showPopover()'),
			'focus the new word before opening: the toggle handler steals focus into the panel');
		assert(/var x = start \? t\.left : t\.right - w/.test(js),
			'the panel must align to the LEFT edge of its word');
		assert(/aria-expanded'.*?trig\.setAttribute/.test(js.replace(/\n/g, ' ')) ||
			/trig\.setAttribute\('aria-expanded'/.test(js),
			'the platform does not manage aria-expanded on [popover]; the toggle handler must');
		assert(/function popTrigger\(menu\)/.test(js),
			'the trigger must be found by comparing the attribute value, not by a selector that needs escaping');
	});
}

// ---------- shadcn-parity: tree + resizable ----------
{
	const page = read('src/pages/index.astro');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');

	check('a tree expands with the platform and walks with the arrows', () => {
		assert(/data-cm-tree/.test(page), 'the showcase must ship a tree');
		const branches = (page.match(/<details class="cm-disclosure"/g) || []).length;
		assert(branches >= 2, `a tree needs branches to expand, found ${branches}`);
		// Expansion is the PLATFORM's. The moment the runtime toggles
		// `open`, there are two owners of one piece of state.
		assert(!/\.open\s*=\s*(true|false)/.test(js),
			'the runtime must not open or close branches - <details> already does');
		assert(/function onTreeKey\(e\)/.test(js) && /function onTreeFocus\(e\)/.test(js),
			'the arrow walker and the roving-focus handler are the runtime\'s half');
		assert(/addEventListener\('keydown', onTreeKey\)/.test(js), 'the walker must be bound at the root');
		assert(/row\.click\(\)/.test(js),
			'Right opens and Left closes through the summary\'s OWN click path - the keys no platform maps, with the state still owned by the platform');
		const tree = css.match(/\.cm-tree \{([^}]*)\}/);
		assert(tree && /padding: 0 0 0 var\(--space-4\)/.test(tree[1]),
			'each level must pad its own children: a depth typed into a style is a lie');
		assert(/\.cm-tree--root \{ padding-left: 0; \}/.test(css), 'the root must not be indented twice');
		const leaves = (page.match(/<a class="cm-tree__row"/g) || []).length;
		assert(leaves >= 3, `leaves must be real links, found ${leaves}`);
		assert(/cm-disclosure__summary cm-tree__row/.test(page),
			'a branch summary and a leaf link must share one row treatment');
		assert(/\.cm-tree__row \{[^}]*border-radius:\s*var\(--radius-sm\)/s.test(css),
			'the row takes the sharp radius token like every other surface');
	});

	check('the resizable group reports the same percentage it paints', () => {
		assert(/data-cm-resize/.test(page), 'the showcase must ship a resizable group');
		assert(/role="separator"[^>]*tabindex="0"/.test(page.replace(/\s+/g, ' ')) ||
			/class="cm-resize__handle" role="separator" tabindex="0"/.test(page.replace(/\n/g, ' ')),
			'the boundary must be a focusable separator, not a bare div');
		assert(/aria-valuenow="58"/.test(page), 'the reported value must match the initial split');
		assert(/aria-valuemin="20"/.test(page) && /aria-valuemax="80"/.test(page),
			'the range the drag clamps to must be declared');
		assert(/function cmInitResize\(root\)/.test(js) && /cmInitResize\(root\);/.test(js),
			'cmInitResize must exist and be called from init');
		assert(/setPointerCapture/.test(js) && /hasPointerCapture/.test(js),
			'the drag must use pointer capture: one path for mouse, pen and touch');
		assert(/touch-action:\s*none/.test(css),
			'without touch-action: none the browser scrolls instead of dragging');
		assert(/flexDirection/.test(js),
			'the axis must come from the group, or the stacked phone layout needs a second implementation');
		assert(/\(16 \/ base\) \* 100/.test(js),
			'a keyboard step must be 16px, not a percentage - 10% is a nudge or a leap');
		assert(/g\.style\.setProperty\('--cm-resize', pct \+ '%'\)/.test(js) &&
			/handle\.setAttribute\('aria-valuenow', String\(Math\.round\(pct\)\)\)/.test(js),
			'the separator must report the split it just painted - the eye and the reader share one number');
		assert(/Math\.min\(max, Math\.max\(min, pct\)\)/.test(js),
			'the boundary must clamp to the declared range');
		assert(/@media \(max-width: 640px\)/s.test(css) && /flex-direction: column;/.test(css),
			'two panes on a phone are two unusable panes - they must stack');
		assert(/var\(--cm-resize, 50%\)/.test(css),
			'a consumer that never sets the knob must still lay out: an undeclared var() invalidates its declaration');
	});
}

// ---------- shadcn-parity: calendar ----------
{
	const page = read('src/pages/index.astro');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	const keyFn = js.slice(js.indexOf('function onCalKey'),
		js.indexOf('function calClearPreview'));

	check('a month is a grid of days, seven to a row', () => {
		assert(/data-cm-cal/.test(page), 'the showcase must ship a calendar');
		assert(/<table class="cm-cal__grid" role="grid"/.test(page),
			'the month is a table[role=grid], not a div pile');
		const tables = page.match(/<table class="cm-cal__grid"[\s\S]*?<\/table>/g) || [];
		assert(tables.length >= 1, 'the calendar table exists');
		for (const t of tables) {
			const heads = (t.match(/role="columnheader"/g) || []).length;
			assert(heads === 7, `seven weekday columns per month, found ${heads}`);
		}
		const rows = page.match(/<tr role="row">(<td role="gridcell">.*?<\/td>){7}<\/tr>/g) || [];
		assert(rows.length >= 5, `five whole weeks of seven cells, found ${rows.length}`);
		assert(/<button type="button" class="cm-cal__day"/.test(page),
			'a day is a button: the platform supplies focus and click');
	});

	check('the state a reader hears is the state the markup reads back', () => {
		assert(/data-cm-cal-selected="2026-10-15"/.test(page),
			'the specimen pins a single selection in data-*');
		assert(/data-cm-cal-start="2026-10-12"/.test(page) &&
			/data-cm-cal-end="2026-10-16"/.test(page),
			'the range is declared in data-* too');
		assert(/aria-selected="true"/.test(page), 'ARIA carries the same selection');
		assert(/aria-current="date"/.test(page), 'today is marked in the markup');
		assert(/data-cm-cal-disabled="2026-10-22"/.test(page) &&
			/aria-disabled="true"/.test(page),
			'a blocked date is aria-disabled, never [disabled]: it must stay reachable by arrow');
		assert(/data-in-range="true"/.test(page), 'the middle of a range is marked');
		assert(/setAttribute\('data-cm-cal-selected'/.test(js) &&
			/setAttribute\('data-cm-cal-start'/.test(js),
			'the runtime must report back what it painted');
	});

	check('the grid walks with the keys and the month with PageUp', () => {
		assert(/function cmInitCal\(root\)/.test(js) && /cmInitCal\(root\);/.test(js),
			'cmInitCal must exist and be called from init');
		for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
		                   'PageUp', 'PageDown', 'Home', 'End']) {
			assert(keyFn.includes(`'${key}'`), `${key} must move the cursor`);
		}
		assert(/Escape/.test(keyFn) && /removeAttribute\('data-cm-cal-selected'\)/.test(keyFn),
			'Escape clears the selection');
		assert(!/e\.key === 'Enter'/.test(keyFn),
			'Enter must stay the platform\'s - a button already clicks on it');
		// today comes from the clock at render time, not from the specimen
		assert(/function calToday\(\)/.test(js) && /calIso\(calToday\(\)\)/.test(js),
			'today is read from the clock');
		// the tbody is rebuilt wholesale, so every listener is delegated
		assert(/document\.addEventListener\('click', onCalClick\)/.test(js),
			'a per-day listener would die with the first render');
		// rows are seven cells sliced from an array - no regex over closing tags
		assert(/cells\.slice\(r, r \+ 7\)/.test(js),
			'a row is seven cells sliced from an array');
		// the disable list must be splittable: two dates are separated by a space
		assert(/\.split\(' '\)\.filter\(Boolean\)/.test(js),
			'the disabled list is space-separated (a regex here must not be able to eat a date)');
	});

	check('the calendar paints with tokens and stays sharp', () => {
		assert(/\.cm-cal__day \{/.test(css), 'the day rule exists');
		assert(/width: var\(--tap\);/.test(css),
			'the cell IS the touch target - a 24px day is a 24px target');
		assert(/\[aria-selected='true'\][^{]*\{[^}]*background: var\(--ink\)/s.test(css),
			'selection is inversion, not a tint');
		assert(/\[aria-current='date'\]/.test(css), 'today has a ring');
		assert(/border: 1px solid transparent;/.test(css),
			'the ring is reserved so today never pushes the day it marks');
		assert(/\.cm-cal__day\[data-outside\]/.test(css), 'outside days dim');
		assert(/overflow-x: auto;/.test(css),
			'below ~350px the grid scrolls inside the card, never the page');
	});
}

/* --- shadcn parity: dropdown depth --- */
check('shadcn-parity: dropdown depth carries the documented item kinds', () => {
	const html = read('dist/index.html');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	for (const c of ['cm-dropdown__shortcut', 'cm-dropdown__icon',
		'cm-dropdown__caret', 'cm-dropdown__group-label',
		'cm-dropdown__label-text']) {
		assert(html.includes(c), 'dropdown part unrendered: ' + c);
		assert(css.includes(c), 'dropdown part unstyled: ' + c);
	}
	// A submenu owner carries the two attributes that make it one, and the
	// nested panel is a real menu of its own.
	assert(/role="menuitem" aria-haspopup="menu" aria-controls="sub-depth-1"/.test(html),
		'a submenu item must announce AND own its panel by id');
	assert(/id="sub-depth-1" popover role="menu"/.test(html),
		'the submenu is a menu');
	// checkbox + radio rows exist in the SAME list as plain items
	assert(/role="menuitemcheckbox" aria-checked="true"/.test(html),
		'a checked checkbox item');
	assert(/role="menuitemradio" aria-checked="false"/.test(html),
		'an unchecked radio item');
	// the glyph slot is never empty, so toggling cannot shift the column
	assert(/cm-dropdown__icon" aria-hidden="true" data-checked="true"/.test(html),
		'the check glyph rides the slot, not the label');
	// ...and the CHECK itself is drawn on that slot. Moving it to the row
	// shifts the label column the moment an item toggles.
	assert(css.includes(".cm-dropdown__icon[data-checked='true']::before"),
		'the check glyph is drawn on the icon slot, not the row');
	// the slot is a fixed width so a toggle cannot resize the row
	assert(css.includes('.cm-dropdown__icon {\n\tflex: none;'),
		'the icon slot must be a fixed-width slot');
	// shortcuts are out of the accessible name
	// Both hinted rows, not "one of them": a twin-row mutant removes a
	// single aria-hidden and a single-occurrence regex sails past it.
	assert((html.match(/cm-dropdown__shortcut" aria-hidden="true"/g) || []).length === 2,
		'every shortcut hint must be hidden from the name');
	// the runtime: no per-menu init, one delegated handler.
	// A plain regex here was /" then a CHARACTER CLASS - it matched any one
	// of those letters and therefore killed nothing. Literal string only.
	assert(js.includes('[role^="menuitem"]'),
		'stepping must find checkbox/radio items too');
	assert(/function openSubmenu\(/.test(js) && /function closeSubmenu\(/.test(js),
		'submenu open/close must exist');
	assert(/function onMenuTypeahead\(/.test(js),
		'typeahead must exist');
	assert(/document\.addEventListener\('keydown', onMenuTypeahead\)/.test(js),
		'typeahead is delegated, one listener at the root');
	// Hover opens a submenu ONLY inside an already-open menu: without the
	// guard a pointer crossing the trigger flickers panels on the way.
	assert(js.includes("if (!item || !item.closest(POP_SEL)) return;"),
		'hover must only open a submenu inside an open menu');
	// The trigger must name what it controls (the platform does not set it
	// for you), and Left must work from popovertarget alone for consumers
	// whose button carries only that.
	assert(/popovertarget="menu-depth" aria-controls="menu-depth"/.test(html),
		'the trigger must announce the panel it controls');
	assert(js.includes('\'[popovertarget="\' + menu.id + \'"]\''),
		'stepping out must fall back to popovertarget');
	// The submenu opens BESIDE its panel through the ONE mechanism every
	// panel uses: anchorPopover's submenu branch - fixed, viewport
	// coordinates, clamped, pinned. A second placer is exactly how the
	// two surfaces drifted apart on scroll.
	assert(js.includes("menu.parentNode.closest('.cm-dropdown__menu')"),
		'anchorPopover must recognise a submenu by its host panel');
	assert(js.includes('anchorPopover(sub);'),
		'the submenu is anchored synchronously: the toggle task can paint first');
	assert(!js.includes('function placeSubmenu'),
		'one owner of placement: no second positioning path');
	assert(js.includes('popPins.push({ menu: menu, fn: fn })'),
		'pins are per-popover: a submenu must not evict its parent\'s');
	assert(js.includes('p.menu !== menu'),
		'unpin names its popover; closing one must not unpin the other');
	const nestedIdx = css.indexOf('.cm-dropdown__menu .cm-dropdown__menu {');
	assert(nestedIdx >= 0, 'a nested menu needs its own positioning rule');
	const nestedRule = css.slice(nestedIdx, nestedIdx + 240);
	assert(nestedRule.includes('min-width: 0'),
		'content-sized: the inherited 12rem cannot fit beside the parent');
	assert(nestedRule.includes('position: fixed'),
		'base state matches the fixed-placement mechanism');
	// One level per press: the DEEPEST open child closes before the menu
	// itself, so a parent row with a panel open steps back, not out.
	assert(js.includes("menu.querySelectorAll('[popover]:popover-open')"),
		'close must consider the open child first');
	assert(js.includes('opens[opens.length - 1]'),
		'the deepest open panel is the one that closes');
	// Right opens the submenu, Left closes it and returns focus
	assert(/if \(openSubmenu\(t\)\) e\.preventDefault\(\);/.test(js),
		'Right/Enter must open the submenu');
	assert(/if \(closeSubmenu\(t\.closest\(POP_SEL\)\)\) e\.preventDefault\(\);/.test(js),
		'Left must close the panel the reader is actually inside');
	assert(/if \(owner && typeof owner\.focus === 'function'\) owner\.focus\(\);/.test(js),
		'Left must return focus to the parent row');
	assert(/function setRadio\(/.test(js) && /setRadio\(next\)/.test(js),
		'arriving on a radio row must take the selection');
	// A submenu's rows belong to the submenu. If the parent's item list
	// included them, ArrowDown would walk into the panel and the parent's
	// own rows after it would be unreachable by keyboard.
	assert(/return owner === menu &&/.test(js),
		'menuItems must exclude rows owned by a nested panel');
	// ...and the typeahead/hover handlers must be DOM-guarded: the module is
	// evaluated in a sandbox with no document at all.
	assert(/if \(typeof document !== 'undefined'\) document\.addEventListener\('keydown', onMenuTypeahead\);/.test(js),
		'the typeahead binding must survive a documentless environment');
	assert(/if \(typeof document !== 'undefined'\) document\.addEventListener\('pointerover', onMenuHover\);/.test(js),
		'the hover binding must survive a documentless environment');

	// A DEFINED handler that nobody binds is dead code, and the symptom is
	// the worst kind: the menu opens, every row looks right, and the arrow
	// keys simply do nothing. This bit for real during batch 18 - pin it.
	assert(
		/document\.addEventListener\('keydown', onMenuKey\);/.test(js),
		'the menu key handler must be registered, not just defined',
	);
	// Derive the binding list from the file rather than naming events: any
	// handler the module DEFINES must be bound to something.
	const handlers = [...js.matchAll(/function (on[A-Za-z]+)\(e\) \{/g)].map(
		(m) => m[1],
	);
	assert(handlers.length > 0, 'the sweep found no handlers at all');
	const bound = [...js.matchAll(/addEventListener\(\s*'([a-z]+)'[^)]*,\s*(on[A-Za-z]+)/g)]
		.map((m) => m[2]);
	for (const h of handlers) {
		assert(bound.includes(h), `handler ${h} is defined but never bound`);
	}
});


/* --- generated scoped entries: the fleet check that can see them ------ */
/*
 * MAP and ALT name the files a CONSUMER copies. Nothing in the checker
 * named the file the LIBRARY generates FOR the consumer, so a scoped
 * adoption could carry a token set frozen at generation time and report
 * "in sync" forever.
 *
 * MEASURED 2026-10-08: all three scoped consumers on the fleet
 * (spacetime-kanban, spacetime-memory, hermes-articles) were generated
 * before the library gained its --z-* scale and were missing all nine
 * tokens. In WebKit at 390px the four selectors that CONSUME them
 * (.cm-toolbar, .cm-header, .cm-toast-region, .cm-js .cm-nav-scrim) then
 * computed `z-index: auto` - `z-index: var(--missing)` is invalid at
 * computed-value time and falls back silently, so the scrim drew under
 * the drawer and the toast under everything.
 */

const CHECKER = read('scripts/check-design-sync.sh');
const GENERATOR_PATH = 'scripts/make-scoped-entry.mjs';

check('the fleet checker looks at generated scoped entries', () => {
	assert(/make-scoped-entry\.mjs/.test(CHECKER),
		'check-design-sync.sh never mentions the scoped-entry generator, so a ' +
		'scoped consumer can freeze its token set and still report in sync');
});

check('the scoped-entry pass is keyed on CONTENT, not on a filename', () => {
	// hermes-articles calls its entry cm-prose.css, the other two
	// cm-scoped.css. A filename rule would grade two of three consumers
	// and miss the third silently - the same class of miss as the *.tsx
	// and *.py gaps this script already carries.
	assert(/grep -q 'make-scoped-entry\.mjs'/.test(CHECKER),
		'the pass must identify a generated entry by its own header, which is ' +
		'the only contract that covers every name the generator was pointed at');
});

check('the scoped-entry pass delegates to the generator, never reimplements it', () => {
	// A second implementation of "what the generator would emit" is a
	// second thing to drift - and this script already learned that from
	// the runtime, where a hand-copied vendored file sat 140 lines behind.
	// ONE line, not two independent greps: `--check ` also appears in this
	// script's own --check branch and in the install tests, so a two-part
	// assertion stays green when the generator call is replaced by an
	// inline reimplementation - which is the exact mutant that survived it.
	assert(/scoped_out="\$\(cd "\$t" && node "\$SRC\/scripts\/make-scoped-entry\.mjs" \\\n\t*\t--check /.test(CHECKER),
		'the checker must call the generator\'s own --check rather than ' +
		'comparing against a second copy of the token list');
});

check('a scoped entry is handed the components.css it actually IMPORTS', () => {
	// The generator resolves --components relative to the TARGET FILE's
	// directory. Handing it a project-root-relative path resolved
	// `../cli-mono/components.css` to web/src/web/cli-mono/... and made
	// a correct consumer print NOT FOUND.
	assert(/--components "\$imp"/.test(CHECKER),
		'the --components argument must be the import path as the entry ' +
		'spells it, read out of the file rather than guessed by directory layout');
});

check('a scoped entry importing a MISSING components.css fails loudly', () => {
	// PostCSS drops an unresolvable @import with no error, so the whole
	// design system can be absent while every other check reports success -
	// the Vite/tailwind trap install.sh documents.
	assert(/SCOPED/.test(CHECKER) && /does not exist/.test(CHECKER),
		'an unresolvable @import must be a finding, not a silent skip');
});

check('every z-index token components.css consumes is declared in the scoped scale', () => {
	const css = read('src/styles/components.css');
	const tokens = read('src/styles/tokens.css');
	// Read the CONSUMED names out of the component layer and require each
	// in :root. A generator that emits a partial scale reproduces exactly
	// the defect this pass exists to catch, one library token later.
	const used = new Set(
		[...css.matchAll(/z-index:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1])
	);
	// 13 declarations across 8 DISTINCT tokens: --z-root is declared for a
	// consumer to override the in-flow baseline and consumed by nothing yet,
	// which is a legal token, not a gap. Asserting a count would fail on a
	// library that legitimately added or dropped a level.
	assert(used.size >= 8,
		`expected the component layer to consume a real z scale, found ${used.size}`);
	const undeclared = [...used].filter((t) => !new RegExp(`\\${t}\\s*:`).test(tokens));
	assert(undeclared.length === 0,
		'these z tokens are consumed but never declared in tokens.css, so every ' +
		'scoped consumer computes them as invalid: ' + undeclared.join(', '));
});

check('the z scale is a single contiguous block in :root', () => {
	const tokens = read('src/styles/tokens.css');
	const names = [...tokens.matchAll(/^\t(--z-[a-z]+):\s*(-?\d+);/gm)].map((m) => m[1]);
	// The values are the INVARIANT, and they only mean anything in order:
	// a drawer above its scrim, a popover above the header, a toast above
	// everything. Assert the relationships, not the literal numbers, so a
	// retune does not have to edit this test to keep it true.
	const v = Object.fromEntries(
		[...tokens.matchAll(/^\t(--z-[a-z]+):\s*(-?\d+);/gm)].map((m) => [m[1], +m[2]])
	);
	for (const c of [
		['--z-scrim', '--z-drawer'], ['--z-drawer', '--z-header'],
		['--z-header', '--z-popover'], ['--z-popover', '--z-toast'],
		['--z-root', '--z-raised'],
	]) {
		assert(v[c[0]] !== undefined && v[c[1]] !== undefined,
			`z scale is missing ${c.join(' or ')}; found ${names.join(', ')}`);
		assert(v[c[0]] < v[c[1]],
			`${c[0]} (${v[c[0]]}) must sit below ${c[1]} (${v[c[1]]})`);
	}
});

check('the scoped-entry generator emits EVERY z token, not a sample', () => {
	// The generator is the thing that decides what a consumer's subtree
	// can resolve. A token it omits is a token that consumer can never
	// have, and --check would still pass, because it compares against the
	// generator's own (equally incomplete) output.
	// Run the generator rather than reading its source: it copies the bare
	// `:root` block verbatim, so grepping the .mjs for token names tests the
	// spelling of its own template, not what it writes. The first draft of
	// this check did exactly that and FAILED on a generator that emits all
	// nine correctly.
	const dir = mkdtempSync(join(tmpdir(), 'cm-zscale-'));
	const out = join(dir, 'cm-scoped.css');
	const { status, stdout, stderr } = spawnSync(process.execPath,
		[GENERATOR_PATH, '--out', out, '--components',
			join(root, 'src/styles/components.css')],
		{ encoding: 'utf8' });
	assert(status === 0, `generator failed: ${stdout}${stderr}`);
	const emitted = read(out);
	const tokens = read('src/styles/tokens.css');
	const declared = [...tokens.matchAll(/^\t(--z-[a-z]+):/gm)].map((m) => m[1]);
	assert(declared.length >= 9, `expected a real z scale, found ${declared.length}`);
	for (const t of declared) {
		assert(new RegExp(`\\${t}\\s*:`).test(emitted),
			`the generator does not emit ${t}, so every scoped consumer resolves ` +
			'it to nothing and each z-index silently computes to auto');
	}
	rmSync(dir, { recursive: true, force: true });
});


/* --- batch 19: data table depth -------------------------------------- */
/*
 * Filter, page, columns, selection. The bug this block exists for: the
 * refresh writes the page INDEX back as `data-cm-page` on the TABLE, so
 * a bare closest('[data-cm-page]') matched the table itself from every
 * click inside it - a stray refresh fired between a checkbox's native
 * toggle and its change event and unchecked the box again, and
 * "select all" silently did nothing while every other feature worked.
 * The selectors below are element-qualified for load-bearing reasons.
 */

check('the data table: delegation, one refresh, and the controls that must not match the table', () => {
	const js = read('src/js/cli-mono.js');

	// Scope: one opt-in ancestor; every handler resolves through it, so
	// a second table on the page can never be driven by this one's controls.
	assert(js.includes("el.closest('[data-cm-datatable]')"),
		'cmTableScope must resolve through the section opt-in');

	// Delegation: listeners live on DOCUMENT, so a tbody a framework
	// rewrites every few seconds keeps every control working. Pin the
	// event, not just the handler name - a `change` binding where the
	// feature fires on `input` still "binds" the handler.
	for (const binding of [
		"document.addEventListener('input', onTableFilter)",
		"document.addEventListener('click', onTableSort)",
		"document.addEventListener('click', onTablePageClick)",
		"document.addEventListener('click', onColvisClick)",
		"document.addEventListener('change', onTableSelectChange)",
		"document.addEventListener('change', onTableSizeChange)",
	]) {
		assert(js.includes(binding), `missing delegation binding: ${binding}`);
	}

	// ONE refresh per scope: every state change re-derives rows, page
	// slice and footer from the same pass. Four handlers each redrawing
	// their own half is how the halves start disagreeing.
	assert(js.includes('cmTableRefresh(cmTableScope(t));'),
		'filter must refresh through the shared pass');
	assert(js.includes("row.style.display = inPage.indexOf(row) >= 0 ? '' : 'none'"),
		'rows have exactly one visibility writer, in the shared pass');

	// THE regression: page controls are BUTTONS. The table stores the
	// page index under the same attribute name, so the qualified
	// selector is what keeps a click on any checkbox from re-entering
	// the page handler. Both sites, or neither works.
	assert(js.includes("t.closest('button[data-cm-page]')"),
		'onTablePageClick must match the page BUTTON, not the table that stores data-cm-page');
	assert(js.includes("querySelectorAll('button[data-cm-page]')"),
		'the disabled-state loop must not write .disabled onto the table');
	assert(js.includes("table.setAttribute('data-cm-page', String(page))"),
		'the page index lives on the table as state');

	// Selection: the header box covers the PAGE, the count line counts
	// the selected rows among the FILTERED - the two models shadcn prints.
	assert(js.includes('inPage.length > 0 && onPageSelected.length === inPage.length'),
		'select-all must cover the current page, not every row');
	assert(js.includes('allBox.indeterminate = onPageSelected.length > 0 && !all'),
		'a partially selected page reads indeterminate');
	assert(js.includes("count.textContent = selFiltered + ' of ' + matched.length"),
		'the count line is selected INTERSECT filtered');
	assert(js.includes("row.setAttribute('aria-selected', t.checked ? 'true' : 'false');"),
		'selection state must be written onto the row');
	assert(js.includes("return row.getAttribute('aria-selected') === 'true';"),
		'selection must be READ from the row, not from a shadow map');

	// Filter: substring, case-insensitive - filterFn_includesString's model.
	assert(js.includes('text.indexOf(q) >= 0'),
		'filter is a substring match over cell text');
	assert(js.includes("col: input.getAttribute('data-cm-filter') || ''"),
		'a bare data-cm-filter is the global search; a value scopes it');

	// Pagination: clamped to a REAL page (never the empty tail of the
	// old one), and both ends disable honestly.
	assert(js.includes('if (page > pages - 1) page = pages - 1;'),
		'a filter that shrinks results must land on a real page');
	assert(js.includes("btn.disabled = kind === 'first' || kind === 'prev'"),
		'page ends must disable from the same page math');

	// The no-results row renders where shadcn renders its empty TableRow.
	assert(js.includes("table.querySelector('[data-cm-empty]')") &&
		js.includes("empty.style.display = matched.length ? 'none' : '';"),
		'the empty row shows exactly when nothing matched');

	// Sort: numeric cells compare NUMERICALLY (a lexical sort would put
	// 1180 before 120), and only the clicked header carries direction.
	assert(js.includes('return sign * cmSortCompare(x.key, y.key);'),
		'sort compares through the comparator, per tbody');
	assert(js.includes('if (!/^[+-]?[\\d\\u00a0,\\s]+%?$/.test(v)) return null;'),
		'cmSortNumber must accept one whole quantity and nothing else');
	assert(js.includes("other.setAttribute('aria-sort', other === th ? dir : 'none');"),
		'aria-sort marks the clicked header and resets the rest');

	// Column visibility: cells matched by getAttribute (a column id with
	// a quote must not break the query), shown/hidden via aria-checked.
	assert(js.includes("cell.getAttribute('data-col') !== col") &&
		js.includes("cell.style.display = show ? '' : 'none';"),
		'colvis hides by attribute match, via style.display');
	assert(js.includes("var show = item.getAttribute('aria-checked') === 'true';"),
		'colvis reads its state from aria-checked');
});

check('the data table specimen: registered, opted in, every control present, far buttons hide', () => {
	const html = read('src/pages/index.astro');
	const css = read('src/styles/components.css');

	assert(html.includes("'data-table'"), 'SECTION_ORDER must list the specimen');
	assert(html.includes('id="data-table"') && html.includes('data-cm-datatable'),
		'the section exists and opts in');
	for (const attr of ['data-cm-selectall', 'data-cm-selcount', 'data-cm-pageinfo',
		'data-cm-empty', 'data-cm-pagesize', 'data-cm-filter', 'data-cm-sort',
		'aria-selected', 'data-cm-size']) {
		assert(html.includes(attr), `specimen is missing ${attr}`);
	}
	assert((html.match(/data-cm-col=/g) || []).length >= 4,
		'four toggleable columns must be declared');
	assert((html.match(/data-cm-page="/g) || []).length >= 4,
		'all four page buttons (first/prev/next/last) must be declared');

	// First/last are the first controls to go when width runs out - the
	// same call shadcn makes below lg, pinned as text.
	assert(/@media \(max-width: 760px\) \{\s*\n\t\.cm-table__far \{ display: none; \}/.test(css),
		'.cm-table__far must be hidden at phone width');
});

/* --- shadcn parity: navigation menu ---
   The nav that opens PANELS. Where the dropdown contract checks the item
   kinds, this one checks the three things a nav menu has and a dropdown
   does not: a persistent trigger with a drawn chevron, links with a
   description under each, and a bar-level indicator measured from the page
   rather than authored. */
check('shadcn-parity: the navigation menu carries its own anatomy', () => {
	const html = read('dist/index.html');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	for (const c of ['cm-navmenu', 'cm-navmenu__trigger', 'cm-navmenu__panel',
		'cm-navmenu__link', 'cm-navmenu__label', 'cm-navmenu__desc',
		'cm-navmenu__chev', 'cm-navmenu__col', 'cm-navmenu__item',
		'cm-navmenu__indicator']) {
		assert(html.includes(c), 'navmenu part unrendered: ' + c);
		assert(css.includes('.' + c), 'navmenu part unstyled: ' + c);
	}
	// The bar is a landmark, not a div: a nav without a role and a name is
	// a pile of links to a screen reader.
	assert(/class="cm-navmenu" data-cm-navmenu role="navigation" aria-label=/.test(html),
		'the bar must be a labelled navigation landmark');
	// ...and the data hook is the SAME HOOK init() binds to. Without it the
	// bar renders and does nothing, and a mutation that deletes it survived
	// a whole harness run: every navmenu check reads the bar by CLASS, so a
	// bar with no runtime is indistinguishable from a working one.
	assert(/cmInitNavmenu\(root\)/.test(js) &&
		js.includes("root.querySelectorAll('[data-cm-navmenu]')"),
		'init() must bind the hook the markup declares');
	// The panel is the dropdown element plus the panel class, so it inherits
	// light dismiss, Escape and focus return from the platform.
	// Count AND attributes. Counting alone passed a mutant that dropped
	// `popover` from a panel: the class list still matched, and a panel that
	// is not a popover has no light dismiss, no Escape and no focus return -
	// it is a div that happens to be positioned.
	const panels = html.match(/class="cm-dropdown__menu cm-navmenu__panel"[^>]*>/g) || [];
	assert(panels.length >= 2, 'every panel must be the shared popover element');
	for (const tag of panels) {
		assert(/ popover[\s>]/.test(tag), 'a navmenu panel must BE a popover: ' + tag);
	}
	// The mark is decorative: it duplicates a state already announced by
	// aria-current on the trigger, so a screen reader must not hear it
	// twice. A mutant that drops aria-hidden survived a whole suite because
	// nothing asserted the attribute.
	assert((html.match(/class="cm-navmenu__indicator" aria-hidden="true"/g) || []).length === 1,
		'the indicator duplicates aria-current and must stay out of the tree');
	// The chevron must be DRAWN, not a glyph: a rotated border pair in
	// currentColor cannot drift from the label's colour and needs no icon
	// font. A text arrow here would render at a different weight on every
	// platform.
	assert(/\.cm-navmenu__chev \{[\s\S]*?border-right: 1\.5px solid currentColor;/.test(css),
		'the chevron is drawn from the element ink, not a glyph');
	assert(/\.cm-navmenu__chev \{[\s\S]*?transform: rotate\(45deg\);/.test(css),
		'the chevron must start pointing down');
	// The rotation is driven by aria-expanded, which onPopoverToggle already
	// keeps honest for any trigger carrying aria-haspopup - the open state is
	// stated once, not twice.
	assert(/\.cm-navmenu__trigger\[aria-expanded='true'\] \.cm-navmenu__chev/.test(css),
		'the chevron must rotate off the state the platform keeps');
	// The panel opens from the trigger's LEFT edge, beside every other
	// left-anchored surface. Miss this and the panel hangs off its own
	// trigger's right edge, which is a 12rem panel shifted half a bar right.
	// Scoped to the START expression itself. A bare grep for the class name
	// is satisfied by a mutation that keeps the name and appends `|| false`
	// - the panel then aligns to its trigger's RIGHT edge again and the
	// assertion still passes. Pin the disjunction, not the string.
	const start = js.match(/var start = menu\.classList && \(([^;]*?)\);/);
	assert(start, 'anchorPopover must decide its start edge from one expression');
	assert(start[1].includes("menu.classList.contains('cm-navmenu__panel')"),
		'a navmenu panel must be in the left-align set anchorPopover owns');
	assert(!/\|\|\s*false/.test(start[1]),
		'the left-align set must not be short-circuited');
});

check('shadcn-parity: the navmenu indicator is measured, not authored', () => {
	const html = read('dist/index.html');
	const css = read('src/styles/components.css');
	const js = read('src/js/cli-mono.js');
	// One indicator per bar, and the bar we can reach from a link: a bar
	// with two marks has no single current section.
	assert((html.match(/class="cm-navmenu__indicator"/g) || []).length === 1,
		'a bar carries exactly one indicator');
	// The mark is a pseudo-element driven by two custom properties. Both are
	// component-scoped, so both are written with a fallback - an
	// unresolvable var() is a declaration that dies silently at
	// computed-value time, and the mark would then be a zero-width nothing
	// on every bar in every consumer.
	assert(/\.cm-navmenu__indicator::after \{[\s\S]*?width: var\(--cm-navmenu-w, 0\);/.test(css),
		'the mark width needs a fallback');
	assert(/\.cm-navmenu__indicator::after \{[\s\S]*?transform: translateX\(var\(--cm-navmenu-x, 0px\)\);/.test(css),
		'the mark offset needs a fallback');
	// The runtime writes BOTH, and the state attribute that says it ran.
	assert(js.includes("ind.setAttribute('data-active', 'true');"),
		'the mark must report that it was measured');
	assert(js.includes("ind.style.setProperty('--cm-navmenu-w'"),
		'the runtime must write the measured width');
	assert(js.includes("ind.style.setProperty('--cm-navmenu-x'"),
		'the runtime must write the measured offset');
	// A trigger with no href is never the current section: a panel opener
	// points at nothing, and marking it would tell a reader they are in a
	// section that does not exist.
	assert(/if \(!href \|\| href\.charAt\(0\) !== '#' \|\| href\.length < 2\) return null;/.test(js),
		'only a same-page fragment can be the current section');
	// The spy is bound to the element that actually scrolls, found rather
	// than assumed, and it is latched against re-entry: it runs on every
	// scroll event and measures a rect per link.
	assert(/function navScrollport\(el\)/.test(js),
		'the scrollport must be found, not assumed to be the page');
	assert(/if \(bar\.__cmNavBusy\) return null;/.test(js),
		'the spy needs a re-entrancy latch');
	assert(/cmInitNavmenu\(root\);/.test(js), 'init() never binds the navmenu');
	// The late-markup observer arms on this list. A SPA commits its tree
	// after this module evaluates, so a hook missing here is a navmenu that
	// never binds in a consumer - and the page still looks right.
	assert(js.includes("'[data-cm-navmenu], .cm-prose-table'"),
		'the navmenu hook must arm the late-markup observer');
	// One re-measure after load: the first pass runs before webfonts swap,
	// and the sections this bar points at sit below 20,000px of specimens.
	assert(/window\.addEventListener\('load', function \(\) \{\n\t\t\t\tnavSpies\.forEach/.test(js),
		'the bar must re-measure once the page has settled');
	// The chevron's rotation is a TRANSITION, so `animation: none` in the
	// reduced-motion block does not touch it - the same trap the burger and
	// the progress fill are already listed for.
	assert(/\.cm-navmenu__chev \{ transition: none; \}/.test(css),
		'the chevron transition must join the reduced-motion guard');
});

check('shadcn-parity: the navmenu bar walks and the panel swaps', () => {
	const js = read('src/js/cli-mono.js');
	// Left/Right walk the WORDS and the neighbouring panel opens in the same
	// press - the behaviour that makes this a bar and not four dropdowns in
	// a row. It is gated on a panel already being open, read from the one
	// place that knows.
	assert(/function onNavmenuKey\(e\)/.test(js), 'the bar walk must exist');
	assert(/document\.addEventListener\('keydown', onNavmenuKey\)/.test(js),
		'the walk is delegated: one listener at the root');
	assert(/var wasOpen = bar\.querySelector\('\.cm-navmenu__trigger\[aria-expanded="true"\]'\);/.test(js),
		'the walk must gate on a panel being open');
	// The gate is stated as the BEHAVIOUR, not as a code shape. An earlier
	// cut of this assertion pinned `if (wasOpen) {` - so rewriting the same
	// gate as an early return (which is what makes the idle bar leave focus
	// alone rather than walking and putting it back) failed a test that was
	// supposed to be about a panel being open at all.
	assert(/if \(!wasOpen\) return;/.test(js),
		'the walk must refuse to touch focus while no panel is open');
	// Scoped to THIS handler's body: `e.preventDefault()` appears a dozen
	// times in this runtime, so an unscoped indexOf compares positions in
	// other functions and the assertion cannot fail for its own reason.
	const walk = js.slice(js.indexOf('function onNavmenuKey'),
		js.indexOf("document.addEventListener('keydown', onNavmenuKey)"));
	assert(walk.length > 0, 'the walk handler body must be findable');
	assert(walk.indexOf('if (!wasOpen) return;') < walk.indexOf('e.preventDefault();'),
		'the gate is decided BEFORE the key is taken from the page');
	// Scoped to its OWN bar: a page with two navmenus must not have the
	// arrow keys jump between them.
	assert(/trigger\.closest\('\[data-cm-navmenu\]'\)/.test(js),
		'the walk must be scoped to its own bar');
	// The walk wraps at both ends, like every native menu bar.
	assert(/triggers\[\(i \+ 1\) % triggers\.length\]/.test(js) &&
		/triggers\[\(i - 1 \+ triggers\.length\) % triggers\.length\]/.test(js),
		'the walk must wrap');
});
/* --- batch 20: sidebar ---------------------------------------------- */
/*
 * The Sidebar carries shadcn's prop surface as ATTRIBUTES on one scope
 * (side / variant / collapsible / state / mobile twin), and the bug this
 * block exists for is a native one: the panel GROWS under the pointer
 * during a rail drag, so the cursor crosses a menu <a> mid-gesture,
 * WebKit starts a link-drag, and the pointer stream dies with no
 * pointerup and no pointercancel - the resize froze at whatever width
 * the last delivered move computed (measured: +40 of an intended +80).
 * The dragstart veto below is load-bearing, not defensive padding.
 */

check('the sidebar: state in attributes, one session per rail, the gesture it must not lose', () => {
	const js = read('src/js/cli-mono.js');

	// One fact per viewport: desktop reads data-state, the phone reads
	// data-mobile-open, and the trigger's aria says EFFECTIVE truth -
	// the property that made aria-expanded a liar for one viewport in
	// every two is pinned at both read sites and the write site.
	assert(js.includes("function sidebarIsPhone()"), 'the phone test is one function');
	assert(js.includes("matchMedia('(max-width: 767px)')"),
		'sidebarIsPhone must use the sheet boundary the CSS uses');
	assert(js.includes("? scope.getAttribute('data-mobile-open') === 'true'") &&
		js.includes(": scope.getAttribute('data-state') === 'expanded';"),
		'sidebarOpen must read the attribute the VIEWPORT owns');
	assert(js.includes("scope.setAttribute('data-mobile-open',") &&
		js.includes("scope.setAttribute('data-state',"),
		'the toggle must write the attribute the viewport owns');
	assert(js.includes("btn.setAttribute('aria-expanded', open ? 'true' : 'false');"),
		'triggers mirror effective state');

	// Disclosures: aria-expanded and hidden move as ONE fact. A handler
	// that flips the button and forgets hidden (or vice versa) leaves
	// assistive tech and pixels disagreeing.
	assert(js.includes("btn.setAttribute('aria-expanded', open ? 'false' : 'true');") &&
		js.includes("if (open) panel.setAttribute('hidden', '');"),
		'aria-expanded and hidden must flip together');

	// CMD-B / Ctrl+B is the documented toggle: editable targets are
	// skipped (the browser owns B inside editors), and the page's own
	// scrolling is told to stand down only after we act.
	assert(js.includes("if ((e.key === 'b' || e.key === 'B') &&") &&
		js.includes('(e.metaKey || e.ctrlKey)'),
		'the shortcut is CMD-B or Ctrl-B');
	assert(js.includes('if (sidebarEditable(e.target)) return;'),
		'editors keep their B');
	assert(js.includes('e.preventDefault();'),
		'the shortcut must not also bold/scroll');

	// The rail: ONE pointer session anchored at the press (startX +
	// startW), signed by data-side, clamped, written as the inline
	// --sidebar-width - and an unmoved press IS the click that toggles.
	assert(js.includes('startW: panel.getBoundingClientRect().width,'),
		'the drag must anchor at the press, not chase the transition');
	assert(js.includes("railDrag.scope.getAttribute('data-side') === 'right' ? -1 : 1"),
		'side=right drags the other way');
	assert(js.includes("railDrag.scope.style.setProperty('--sidebar-width', w + 'px');"),
		'the resize lives on the scope as an inline token');
	assert(js.includes('if (!drag.moved) sidebarToggle(drag.scope);'),
		'a press that never moved is a click');

	// THE fix: while the rail gesture is live, the native link-drag it
	// trips over is vetoed. Delete this line and the harness's drag
	// check freezes mid-gesture - proven by mutation.
	assert(js.includes('if (railDrag) e.preventDefault();'),
		'the gesture must veto the native drag it crosses into');

	// Delegation, so the sheet works wherever the trigger is rendered.
	for (const binding of [
		"document.addEventListener('click', onSidebarClick)",
		"document.addEventListener('keydown', onSidebarKeydown)",
		"document.addEventListener('pointerdown', onSidebarPointerDown)",
		"document.addEventListener('pointermove', onSidebarPointerMove)",
		"document.addEventListener('pointerup', onSidebarPointerUp)",
		"document.addEventListener('dragstart', onSidebarDragStart)",
	]) {
		assert(js.includes(binding), `missing delegation binding: ${binding}`);
	}
	assert(js.includes('cmInitSidebars(root);'),
		'sidebars must sync their triggers at init - the phone starts closed and the aria has to say so before any click');
});

check('the sidebar: the CSS derives from the attributes alone, and none keeps its promise', () => {
	const css = read('src/styles/components.css');

	assert(css.includes(".cm-sidebar[data-state='collapsed'] .cm-sidebar__panel {\n\twidth: var(--sidebar-icon-width);"),
		'collapsed width comes from the token');
	assert(css.includes(".cm-sidebar[data-collapsible='none'] .cm-sidebar__panel {\n\twidth: var(--sidebar-width);\n\ttransform: none;\n\tposition: sticky;"),
		'collapsible=none must keep width, position and transform however the state attr reads');
	assert(css.includes(".cm-sidebar[data-collapsible='none'] .cm-sidebar__rail { display: none; }"),
		'no rail to collapse with');
	// offcanvas leaves the FLOW (fixed), each side sliding off its own
	// edge; the right side must park at the right edge or it parks in
	// the middle of the screen mid-slide.
	assert(css.includes(".cm-sidebar[data-collapsible='offcanvas'][data-state='collapsed']\n\t.cm-sidebar__panel {\n\tposition: fixed;") &&
		css.includes('transform: translateX(-100%);'),
		'offcanvas parks off-screen, out of the flow');
	assert(css.includes(".cm-sidebar[data-side='right'][data-collapsible='offcanvas']\n\t[data-state='collapsed'] .cm-sidebar__panel {\n\tinset-inline-start: auto;\n\tinset-inline-end: 0;\n\ttransform: translateX(100%);"),
		'offcanvas on the right parks at the RIGHT edge');
	// icon mode: labels step aside; the aria-label keeps the name.
	assert(css.includes(".cm-sidebar[data-collapsible='icon'][data-state='collapsed'] .cm-sidebar__label,") &&
		css.includes(".cm-sidebar[data-collapsible='icon'][data-state='collapsed']\n\t.cm-sidebar__grouphead {\n\tjustify-content: center;"),
		'icon mode hides labels and centers what stays');
	// variants.
	assert(css.includes(".cm-sidebar[data-variant='floating'] .cm-sidebar__panel {\n\tmargin: var(--space-3);"),
		'floating frames the panel');
	assert(css.includes(".cm-sidebar[data-variant='inset'] .cm-sidebar__inset {\n\tmargin: var(--space-3);"),
		'inset cards the CONTENT');
	// the sheet: same boundary in CSS and JS (767px), full phone width,
	// parked off its own edge, scrimmed.
	assert(css.includes('@media (max-width: 767px) {'),
		'the sheet boundary matches sidebarIsPhone');
	assert(css.includes('width: var(--sidebar-width-mobile);'),
		'the sheet carries the phone width token');
	assert(css.includes('.cm-sidebar .cm-sidebar__panel { width: var(--sidebar-width-mobile); }'),
		'even an expanded state is a sheet at phone width');
	// the inset aligns to the panel - UA <main> margins measured at 20px
	// in WebKit are not our spacing.
	assert(css.includes('/* UA stylesheets give <main> a 20px margin in WebKit'),
		'the inset must zero the engine\'s <main> margin');
});

check('the sidebar specimen: registered, opted in, every affordance the JS routes on', () => {
	const html = read('src/pages/index.astro');

	assert(html.includes("'sidebar'"), 'SECTION_ORDER must list the specimen');
	assert(html.includes('id="sidebar"') && html.includes('data-cm-sidebar'),
		'the section exists and opts in');
	for (const attr of ['data-cm-sidebar-trigger', 'data-cm-sidebar-rail',
		'data-cm-sidebar-group', 'data-cm-sidebar-sub', 'data-cm-sidebar-scrim',
		'aria-controls', 'aria-expanded', 'aria-current']) {
		assert(html.includes(attr), `specimen is missing ${attr}`);
	}
	// The keyboard story is worthless if the reader cannot find it.
	assert(html.includes('&#8984;B') || html.includes('⌘B'),
		'the lede must name the shortcut it wires');

	// `includes` proves ONE row carries the attribute; a rename on one
	// group while its sibling still routes is exactly the mutation that
	// survived proof. Every label that LOOKS like a disclosure must be
	// ROUTED as one - counted, not sampled.
	const groups = (html.match(/class="cm-sidebar__grouplabel"/g) || []).length;
	const routed = (html.match(/data-cm-sidebar-group/g) || []).length;
	assert(groups >= 2 && routed === groups,
		`every group label must carry data-cm-sidebar-group (${routed}/${groups})`);
	const subs = (html.match(/data-cm-sidebar-sub/g) || []).length;
	assert(subs >= 1 && subs === (html.match(/aria-controls="sb-sub-/g) || []).length,
		'every submenu trigger must carry data-cm-sidebar-sub and own its list');
});
