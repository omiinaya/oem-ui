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
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
check('declares the full --space-* scale', () => {
	const t = read('src/styles/tokens.css');
	const steps = ['05', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
	for (const s of steps) {
		assert(new RegExp(`--space-${s}:\\s*[\\d.]+rem;`).test(t),
			`--space-${s} is not declared in tokens.css`);
	}
});

check('the scale is monotonic and distinct', () => {
	const t = read('src/styles/tokens.css');
	const vals = [...t.matchAll(/--space-(?:05|1|2|3|4|5|6|7|8|9|10):\s*([\d.]+)rem/g)]
		.map(m => parseFloat(m[1]));
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
			assert.fail(`${f}: ${m[1]}${m[2]}: ${m[3]}${m[4]} is a raw spacing value; use var(--space-*)`);
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
	assert([...t.matchAll(/--space-(?:05|1|2|3|4|5|6|7|8|9|10):/g)].length === 11,
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

/* ================= drift guard ================= */
console.log('\ndrift guard');
check('ships an executable drift checker', () => {
	assert(exists('scripts/check-design-sync.sh'), 'scripts/check-design-sync.sh missing');
	const st = statSync(join(root, 'scripts/check-design-sync.sh'));
	assert(st.mode & 0o111, 'check-design-sync.sh is not executable');
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
