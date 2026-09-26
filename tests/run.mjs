#!/usr/bin/env node
/**
 * cli-mono contract tests.
 *
 * These are real assertions, not a smoke test: each one FAILS if the
 * library is broken. Run with `npm test`.
 *
 * The CSS checks are structural (tokens declared, components defined,
 * contrast computed from the real hex values in tokens.css). The runtime
 * checks execute the actual cli-mono.js against a minimal fake DOM so a
 * regression in the theme logic fails the build.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let passed = 0;
const failures = [];

function check(name, fn) {
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
	const links = comp.match(/\.cm-header__links\s*\{[^}]*\}/)[0];
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
	const snippet = /return\s*\(\s*'\(function\(\)\{try\{var s=localStorage\.getItem\("'/.test(runtimeSrc);
	assert(snippet, 'themeInitScript missing or malformed');
	assert(/s==="light"/.test(runtimeSrc), 'FOUC guard must only apply a saved light theme');
});

/* ================= astro components ================= */
console.log('\nastro components');
const astroFiles = ['Head.astro', 'Header.astro', 'Footer.astro', 'PageHead.astro', 'PostHead.astro', 'PostRow.astro', 'StatusStrip.astro', 'config.ts'];
for (const f of astroFiles) {
	check(`ships src/astro/${f}`, () => {
		const s = read(`src/astro/${f}`);
		assert(s.trim().length > 0, 'file is empty');
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
	const guard = markup.indexOf('cm-theme');
	const sheet = markup.indexOf('rel="stylesheet"');
	assert(guard !== -1, 'Head.astro missing theme guard');
	assert(guard < sheet, `FOUC guard must precede the stylesheet link (guard@${guard}, sheet@${sheet})`);
	assert(/stylesHref\s*&&\s*<link/.test(markup), 'stylesheet must be prop-driven, not hardcoded');
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

/* ================= result ================= */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const [n, m] of failures) console.error(`  FAIL ${n}: ${m}`);
	process.exit(1);
}
