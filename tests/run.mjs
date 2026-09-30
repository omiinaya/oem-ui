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
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, appendFileSync, statSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
const compSrc = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
// Element defaults live in base.css by design - a bare `input` is
// on-brand there, and `.cm-sr-only` is a bare element utility. A
// reachability test that only reads components.css therefore reports
// every base-layer class as unstyled, which is the same false negative
// as a check that reads only the showcase source.
const baseSrc = read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '');
const allCss = compSrc + '\n' + baseSrc;
const showcase = read('src/pages/index.astro');

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

/* ================= astro components ================= */
console.log('\nastro components');
const astroFiles = ['Head.astro', 'Header.astro', 'HeaderLink.astro', 'Footer.astro', 'PageHead.astro', 'PostHead.astro', 'PostRow.astro', 'StatusStrip.astro', 'Card.astro', 'Meter.astro', 'Stat.astro', 'TimelineItem.astro', 'config.ts'];
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
		assert(/<legend>/.test(fs[2]),
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

check('every bordered block uses the same corner radius', () => {
	// .cm-status hardcoded border-radius:0 while .cm-section used the
	// token, so two same-width boxes of the same role had different corners.
	const comp = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const m of comp.matchAll(/\.cm-(status|section|panel|card)[^{]*\{([^}]*)\}/g)) {
		const decl = m[2];
		if (!/\bborder\s*:/.test(decl)) continue;
		assert(!/border-radius:\s*0(?![\d.])/.test(decl),
			`.${m[1]} has a hardcoded square corner; use var(--radius-sm)`);
	}
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
			.map(m => m[2] + ' {' + m[3] + '}'));
	assert(blocks.length > 0, 'no state rules found — is the parse stale?');
	const block = blocks.join('\n');
	const hex = block.match(/#[0-9a-f]{3,8}\b/gi) || [];
	const named = block.match(/:\s*(red|green|blue|yellow|orange|purple|pink|teal)\b/gi) || [];
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
		// Build the pattern by concatenation: nesting a backtick escape
		// inside a template literal is unreadable and easy to break.
		const want = '.cm-alert--' + v + ' .cm-alert__mark::before';
		const re = new RegExp(
			want.replace('.', '\\.').replace(' ', ' ') + '\\s*\\{[^}]*content:\\s*\'([^\']*)\'');
		const m = compSrc.match(re);
		assert(m, `.cm-alert--${v} must carry a ::before glyph, not a colour alone`);
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
	assert(alertMarks.length === 3, `expected 3 alert marks, found ${alertMarks.length}`);
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
	assert(/class="cm-table-wrap"[^>]*tabindex="0"/.test(show),
		'a scrollable region needs tabindex="0" to be keyboard reachable');
	assert(/class="cm-table-wrap"[^>]*aria-label=/.test(show),
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

check('the rail link rules are scoped to direct children of the list', () => {
	// The showcase demonstrates the link style with bare .cm-header__link
	// elements. A descendant selector restyled those specimens as rail rows.
	assert(/\.cm-header--rail \.cm-header__links > \.cm-header__link\s*\{/.test(RAIL),
		'the rail link rule is not scoped to `>` children, so demo links are rail rows');
	assert(!/\.cm-header--rail \.cm-header__link\s*\{/.test(RAIL),
		'a descendant .cm-header__link rule will style the showcase specimens');
});

check('a rail link keeps the tap floor', () => {
	const m = RAIL.match(/\.cm-header--rail \.cm-header__links > \.cm-header__link\s*\{([^}]*)\}/);
	assert(m, 'the rail link rule is missing');
	// Declaration-anchored: the rail block explains the 44px floor in a
	// comment, so a bare `min-height: var(--tap)` search was satisfied by
	// the prose describing it.
	assert(/^[ \t]*min-height:\s*var\(--tap\);/m.test(m[1]),
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
	assert(/<main class="cm-shell cm-shell--rail">/.test(page),
		'the showcase does not offset its own content');
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
	assert(/flex:\s*0 0 var\(--measure-title\)/.test(inline[0]),
		`the inline title must be flex: 0 0 var(--measure-title), got: ${inline[0]}`);
	assert(/max-width:\s*var\(--measure-title\)/.test(inline[0]),
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
			const swept = spawnSync('bash', [join(root, 'scripts/check-design-sync.sh')], {
				encoding: 'utf8', env: { ...process.env, OEM_UI_SRC: root, CONSUMER_ROOT: tree },
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
		const plainInstall = spawnSync('bash', [join(root, 'scripts/install.sh'), dir], {
			encoding: 'utf8',
		});
		assert(plainInstall.status === 0, `plain install exited ${plainInstall.status}`);
		const clean = plainInstall.stdout.replace(/\u001b\[[0-9;]*m/g, '');
		const landed = (clean.match(/^ok\s+\S+\s+->/gm) || []).length;
		assert(landed === 5,
			`a plain install should report 5 files, it reported ${landed}; update the README count too`);
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
	const h = read('src/astro/Header.astro');
	assert(/active\?:\s*boolean/.test(h), 'Link needs an `active` prop');
	assert(/aria-current=\{l\.active\s*\?\s*'page'\s*:\s*undefined\}/.test(h),
		'Header must render aria-current="page" for an active link');
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
	// The TS annotations are stripped because `new Function` compiles plain
	// JS. If the extraction ever fails to find the function, that is a FAIL,
	// never a silent skip.
	const src = read('src/astro/HeaderLink.astro');
	const stripSrc = /const strip = \(p(?::\s*string)?\) => \{[\s\S]*?^\};/m.exec(src);
	assert(stripSrc, 'could not find the strip() normaliser in HeaderLink.astro');
	const js = stripSrc[0]
		.replace(/\(p(?::\s*string)?\)/, '(p)')
		.replace(/^const strip = /, 'return ');
	// One normaliser, two builds: the site root, and a site served under a
	// `base` prefix. The prefix case is the one that silently disables the
	// whole component, so it gets its own instance.
	const atRoot = new Function('base', `${js}\nreturn strip;`)('/');
	const prefixed = new Function('base', `${js}\nreturn strip;`)('/dev-blog');
	const strip = atRoot;
	assert(strip('/blog/') === '/blog', `trailing slash: /blog/ -> ${strip('/blog/')}`);
	assert(strip('/blog/?q=1') === '/blog', `query string: /blog/?q=1 -> ${strip('/blog/?q=1')}`);
	assert(strip('/blog/#x') === '/blog', `hash: /blog/#x -> ${strip('/blog/#x')}`);
	assert(strip('/') === '/', `root: / -> ${strip('/')}`);
	// Under a base prefix, BOTH sides carry it, so both must lose it.
	assert(prefixed('/dev-blog/about/') === '/about',
		`base prefix: -> ${prefixed('/dev-blog/about/')}`);
	assert(prefixed('/about/') === '/about',
		`base prefix, already-stripped href: -> ${prefixed('/about/')}`);
	// an external link is not this page, whatever its path looks like
	assert(strip('https://example.com/blog/') === null, 'an external href was treated as a local path');
	assert(strip('//example.com/blog/') === null, 'a protocol-relative href was treated as a local path');
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
	assert(!/role="dialog"/.test(showcase), 'a role="dialog" is a hand-rolled modal; use <dialog>');
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
			const m = new RegExp(
				`\\.${prefix}--${v} \\.${prefix}__mark::before\\s*\\{[^}]*content:\\s*'([^']*)'`,
			).exec(compSrc);
			assert(m, `.${prefix}--${v} carries no ::before glyph`);
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
	const h2 = /(?:^|\n)h2\s*\{[^}]*font-size:\s*([0-9.]+)rem/.exec(base);
	assert(h2, 'no bare h2 element default found in base.css');
	const val = /^\.cm-stat__val\s*\{([^}]*)\}/m.exec(compSrc);
	assert(val, '.cm-stat__val is not defined');
	const v = /font-size:\s*([0-9.]+)rem/.exec(val[1]);
	assert(v, '.cm-stat__val declares no rem font-size');
	assert(parseFloat(v[1]) <= parseFloat(h2[1]),
		`.cm-stat__val (${v[1]}rem) must not exceed the section h2 (${h2[1]}rem)`);
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
	const block = raw.slice(from);
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
const INTERACTIVE = ['cm-btn', 'cm-tabs__tab', 'cm-nav-toggle', 'cm-chip--action', 'cm-icon-btn--bare'];
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
	const PINS_BOTH_DIMENSIONS = new Set(['cm-icon-btn--bare']);
	const all = declsOf(sel);
	// The value, not the substring. `[role='tab']` shares ONE declaration
	// block with `a, button, label, input, textarea, select` and
	// `[role='button']`, so a check that asks "does this block contain
	// var(--tap) anywhere" is satisfied by `a`'s floor and would have
	// passed with `[role='tab'] { min-height: 20px }` - a check that reports
	// a green suite while the tab sits at 20px. (Proven: that exact
	// mutation is in tests/mutate-chip.mjs.) So the element has to be NAMED
	// in the prelude, and then its own declaration read.
	const coarseBlock = (read('src/styles/base.css').replace(/\/\*[\s\S]*?\*\//g, '')
		.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] || '');
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
	// It steps below the floor on purpose, but only if it resets the
	// min-height it would otherwise inherit from .cm-btn.
	assert(/min-height:\s*0/.test(sm[1]),
		'.cm-btn--sm inherits the 44px floor, so the small variant is not small');
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

/* A drawer over the left edge that does not lock the page behind it lets a
   tap land on the content the drawer is covering. */
check('the drawer locks page scroll while it is open', () => {
	// The LOCK and the UNLOCK, both, or the page is stuck scrolled-free
	// forever after one accidental open. `/body[^]*overflow/` matched the
	// unlock line alone and passed while the lock was gone.
	if (!/body\.style\.overflow\s*=\s*'hidden'/.test(MC_NAV_JS))
		throw new Error('opening the drawer does not lock page scroll');
	if (!/body\.style\.overflow\s*=\s*''/.test(MC_NAV_JS))
		throw new Error('closing the drawer never restores page scroll');
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
	const rule = /^\.cm-chip \{([^}]*)\}/m.exec(compSrc);
	assert(rule, 'no .cm-chip base rule found');
	assert(/font-size:\s*max\(var\(--min-font\),\s*0\.7rem\)/.test(rule[1]),
		'.cm-chip must floor its font-size at var(--min-font) via max(); 0.7rem alone is 11.2px');
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
	const base = baseNoComment.match(/input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)\s*,\s*textarea\s*,\s*select\s*\{([^}]*)\}/);
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
	assert(/z-index:\s*[1-9]/.test(bar),
		'a sticky bar needs a NUMERIC z-index above the rows; z-index: auto leaves it painted under the list it is meant to float over');
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
	const inp = (compSrc.match(/\.cm-inline__input\s*\{([^}]*)\}/) || [, ''])[1];
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
		assert(!/\bcm-header\b/.test(outText),
			`an EXISTING library class must not be reported as rogue, got: ${outText.trim()}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
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
	assert(/gap:\s*var\(--space-\d\)/.test(body),
		`the gap must come off the spacing scale, got: ${body.trim()}`);
	assert(!/[\d.]+(rem|em)/.test(body),
		`the stack carries a hardcoded rem value; use --space-*: ${body.trim()}`);
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
	const rule = [...comp.matchAll(/([^{}\n]*\.cm-head__badge[^{}\n]*)\{([^}]*)\}/g)][0];
	assert(rule, '.cm-head__badge must have its own rule body');
	// Read the BODY. A whole-file /gradient/ search matches the two comments
	// that explain why the library has none, which is the opposite failure.
	assert(!/gradient/.test(rule[2]),
		'the badge paints a gradient; the library marks state with an inset rule, not a hue');
	assert(/box-shadow:\s*inset/.test(rule[2]),
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

/* ================= result ================= */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const [n, m] of failures) console.error(`  FAIL ${n}: ${m}`);
	process.exit(1);
}
