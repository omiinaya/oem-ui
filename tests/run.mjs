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
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, readdirSync } from 'node:fs';
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

// Sources the component tests read, stripped of comments once so a note in
// the CSS can never be mistaken for a rule.
const tokenSrc = read('src/styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const compSrc = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
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
	const guard = markup.indexOf('cm-theme');
	const sheet = markup.indexOf('rel="stylesheet"');
	assert(guard !== -1, 'Head.astro missing theme guard');
	assert(guard < sheet, `FOUC guard must precede the stylesheet link (guard@${guard}, sheet@${sheet})`);
	assert(/stylesHref\s*&&\s*<link/.test(markup), 'stylesheet must be prop-driven, not hardcoded');
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

check('the FOUC guard searches the legacy keys too', () => {
	const h = themeHarness();
	h.api.setLegacyKeys(['oem-log-theme']);
	const src = h.api.themeInitScript('oem-links-theme');
	assert(src.includes('oem-links-theme'), 'guard must check the project key');
	assert(src.includes('oem-log-theme'), 'guard must also check the legacy key');
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
		const guardAt = s.search(/<script is:inline>\s*\(function/);
		const charsetAt = s.indexOf('<meta charset');
		assert(guardAt !== -1, `${name}: no inline FOUC guard found`);
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
	const all = read('src/styles/components.css').replace(/\/\*[\s\S]*?\*\//g, '');
	for (const c of demoed) {
		if (c === 'cm-sr-only') continue; // utility, lives in base.css
		assert(new RegExp(`\\.${c}(?![a-z0-9_-])`).test(all),
			`the showcase demos .${c} but components.css never defines it`);
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
	assert(/data-cm-nav/.test(h), 'Header never emits data-cm-nav, so the spy never runs');
	assert(/data-cm-spy/.test(h), 'Header never emits data-cm-spy');
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
	assert(/href:\s*['"]#overlays['"]/.test(showcase), 'the overlays section is not in the nav');
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
	assert(/href:\s*['"]#records['"]/.test(showcase), 'the records section is not in the nav');
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
	assert(
		/100vw/.test(tip),
		'the tip cap must be derived from the viewport, not a bare px value, or it is wrong at every width but the one it was written for',
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
	assert(/href:\s*['"]#cards['"]/.test(showcase), 'the cards section is not in the showcase nav');
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
