#!/usr/bin/env node
/* Emit a SCOPED oem-ui entry point for a consumer that cannot import the
 * library globally.
 *
 * WHY THIS EXISTS
 * ---------------
 * The documented install order is tokens -> base -> components, and
 * `base.css` is 52 BARE-ELEMENT rules. Unlayered CSS beats every `@layer`
 * in a Vite/PostCSS build, so importing base.css into a Tailwind app
 * overrides that app's own utilities across the whole page - not just the
 * subtree the consumer wanted.
 *
 * `tokens.css` is a second problem: it declares `--accent` and `--radius`
 * on `:root`, and those two names are already taken by shadcn-style apps
 * with DIFFERENT values. Measured collision: the library's `--accent` is a
 * neutral grey (#e8e8e8 dark / #111111 light) where hermes-articles' is
 * oklch(0.62 0.19 262.881); the library's `--radius` is 10px where the
 * app's is 0.5rem.
 *
 * WHAT IT EMITS
 * -------------
 * One stylesheet that:
 *   - re-declares the theme-INDEPENDENT scale scoped to
 *     `[data-cm-theme]`, verbatim from tokens.css (generated, never typed
 *     by hand - a hand-copied scale was measured wrong in 17 of 44 values),
 *   - relies on tokens.css's own `[data-cm-theme='dark'|'light']` blocks
 *     for the colour set, which already exist for exactly this purpose,
 *   - re-declares the two element defaults a scoped import cannot bring
 *     from base.css, as scoped twins,
 *   - imports components.css, which is `.cm-*`-scoped on the measurement
 *     (see tests/run.mjs: `components.css has no unscoped surface`).
 *
 * USAGE
 *   node scripts/make-scoped-entry.mjs --out <file>
 *   node scripts/make-scoped-entry.mjs --check <file>   # exit 1 if stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOKENS = path.join(ROOT, 'src/styles/tokens.css');
const BASE = path.join(ROOT, 'src/styles/base.css');

/* The scoped prose-typography block, EXTRACTED from base.css rather than
 * retyped here.
 *
 * It is the single source for those rules: base.css must carry them for a
 * full install, so a second hand-written copy in this generator would drift
 * the moment either side is edited - the same parallel-definition defect
 * `--space-*` and the token scale exist to prevent. The banner comments are
 * the block's boundaries, and a missing marker is a hard error rather than a
 * silently empty emit.
 *
 * WHY IT IS NEEDED AT ALL: `.cm-prose` in components.css declares only
 * `color` and `font-size`. Every actual typographic declaration for prose -
 * the heading ramp, `p` rhythm, `code`/`pre` fill and `display`, the
 * blockquote, the table's `border-collapse` and cell padding - lives in
 * base.css as a bare-element rule. A scoped adoption gets components.css and
 * nothing else, so without this block `.cm-prose` renders a design system
 * that is not ours: MEASURED, 786 deltas across 38 properties against a full
 * install, including `pre > code` losing `display: block` (six lines of code
 * collapsed into one paragraph) and 74 of 76 elements rendering the platform
 * default font instead of the mono stack. */
const SCOPED_HEAD = "/* ============ prose typography, in the component layer's reach ============";
const SCOPED_TAIL = '/* ============ form controls ============';
function scopedElementDefaults() {
	const css = readFileSync(BASE, 'utf8');
	const at = css.indexOf(SCOPED_HEAD);
	if (at === -1) {
		throw new Error('base.css has no scoped prose-typography block (' + SCOPED_HEAD + ')');
	}
	const end = css.indexOf(SCOPED_TAIL, at);
	if (end === -1) {
		throw new Error('base.css: the scoped prose block has no terminator (' + SCOPED_TAIL + ')');
	}
	const body = stripComments(css.slice(at, end)).trim();
	if (!body.includes(':where([data-cm-theme])')) {
		throw new Error('the scoped prose block declares no :where([data-cm-theme]) rule');
	}
	return body;
}

/* The responsive `:root` step, re-derived from base.css's own media query.
 *
 * `:root { --head-h1: 1.95rem }` and `--head-top: 2rem` exist in ONE place,
 * inside base.css's `@media (max-width: 680px)`. A scoped adoption does not
 * get that file, so without this it matches a full install at 1280px and not
 * at 390px - MEASURED: h1 32px against 31.2px.
 *
 * THE SELECTOR SHAPE IS THE WHOLE PROBLEM. The obvious mirror,
 * `:where([data-cm-theme])`, does NOT work: `:where()` zeroes its ENTIRE
 * argument, not just what it wraps, so that selector is specificity (0,0,0)
 * and loses to this generator's own theme block `[data-cm-theme='dark']` at
 * (0,1,0). MEASURED: with that spelling at 390px `--head-h1` still computed
 * `2rem`. The spelling below keeps an explicit ancestor (`[data-cm-theme]`)
 * OUTSIDE the `:where()`, which makes it (0,1,0) - a TIE with the theme
 * block - and this rule is emitted BEFORE that block so source order hands
 * it the win. Same property on an ancestor, so it inherits down the subtree. */
function scopedResponsiveTokens() {
	const css = readFileSync(BASE, 'utf8');
	const m = css.match(/@media\s*\(max-width:\s*680px\)\s*\{[\s\S]*?:root\s*\{([^}]*)\}/);
	if (!m) throw new Error('base.css has no responsive :root step to mirror');
	const decls = m[1].split(';').map((s) => s.trim()).filter(Boolean);
	if (!decls.length) throw new Error('the responsive :root step declares nothing');
	if (!decls.some((d) => d.startsWith('--head-'))) {
		throw new Error('the responsive :root step has no --head-* token');
	}
	return (
		'/* Mirrored from base.css\'s own responsive block. See the generator for\n' +
		'   why the ancestor sits OUTSIDE the :where(). */\n' +
		'@media (max-width: 680px) {\n' +
		"	:where([data-cm-theme]) [data-cm-theme],\n" +
		"	:where([data-cm-theme])[data-cm-theme] {\n" +
		decls.map((d) => '		' + d + ';').join('\n') + '\n	}\n}'
	);
}

const HEADER = `/* GENERATED by scripts/make-scoped-entry.mjs - DO NOT EDIT BY HAND.
 *
 * Regenerate:  node scripts/make-scoped-entry.mjs --out <this file>
 * Verify:      node scripts/make-scoped-entry.mjs --check <this file>
 *
 * A scoped oem-ui entry, for a consumer whose build inlines Tailwind into
 * \`@layer\`s and cannot import base.css globally (see the header of
 * install.sh for why that is not optional).
 */`;

/** Strip CSS comments. A literal close-delimiter in this line's own text
 * would terminate the block comment, which is the one way this function can
 * fail silently, so the pattern is spelled as a regexp instead. */
function stripComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every rule in `css` as {selector, body}, comment-free, nested-aware. */
function rules(css) {
	const out = [];
	let buf = '';
	for (let i = 0; i < css.length; i++) {
		const ch = css[i];
		if (ch === '{') {
			const selector = buf.replace(/\s+/g, ' ').trim();
			buf = '';
			let depth = 1;
			let j = i + 1;
			while (depth && j < css.length) {
				if (css[j] === '{') depth++;
				else if (css[j] === '}') depth--;
				j++;
			}
			out.push({ selector, body: css.slice(i + 1, j - 1) });
			i = j - 1;
		} else if (ch === '}') {
			buf = '';
		} else {
			buf += ch;
		}
	}
	return out;
}

/** Declarations of a rule body as an ordered [name, value] list. */
function decls(body) {
	const out = [];
	// split on `;` but keep `var(...)` and `calc(...)` intact - neither
	// contains a `;`, so a plain split is correct here and a paren-aware
	// splitter would be a bug waiting for a future value.
	for (const part of stripComments(body).split(';')) {
		const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
		if (m) out.push([m[1], m[2].replace(/\s+/g, ' ')]);
	}
	return out;
}

function build(relComponents) {
	const css = stripComments(readFileSync(TOKENS, 'utf8'));
	const all = rules(css);

	const root = all.find((r) => r.selector === ':root');
	if (!root) throw new Error('tokens.css has no bare :root block');

	// The colour tokens are THEME-DEPENDENT, so they are deliberately NOT
	// copied here: tokens.css already ships `[data-cm-theme='dark'|'light']`
	// for a scoped subtree, and duplicating a theme pair in a second file is
	// exactly the drift this generator exists to prevent. The bare `:root`
	// block holds the theme-independent scale, which is what a scoped
	// consumer has to own.
	const scale = decls(root.body);
	if (!scale.length) throw new Error('the :root block declares nothing');

	const lines = [];
	lines.push(HEADER);
	lines.push('');
	/* The @import goes FIRST, before any declaration block.
	   PostCSS requires it: `@import must precede all other statements`, and
	   when it does not, the file is DROPPED with only a warning - so the
	   consumer's build stays green and ships none of the library. MEASURED
	   here: with the import emitted last, the built CSS contained 0
	   occurrences of `cm-prose-table` while the page rendered fine on the
	   consumer's own styles. The comment above it is fine (comments are not
	   statements); a `:root`/`[data-cm-theme]` block above it is not.

	   components.css ONLY, and deliberately not tokens.css. The colour
	   tokens `.cm-prose` needs are already in tokens.css's
	   `[data-cm-theme='dark'|'light']` blocks, which is the library's own
	   scoped-theme mechanism; importing the whole file additionally applies
	   its BARE `:root` block to the document, and that block declares
	   `--accent` (a neutral grey, where the consuming app's is blue) and
	   `--radius` (10px against the app's 0.5rem). MEASURED with tokens.css
	   imported: `getComputedStyle(document.documentElement).getPropertyValue
	   ('--accent')` returned the app's blue but the library's `--ink`
	   resolved on the ROOT too - i.e. the app's own subtree was reading
	   library colours for any property it happened to name. Dropping the
	   tokens.css import removes the leak and the page still gets every
	   colour it needs from `[data-cm-theme]`.

	   A library that ships its rules without its tokens resolves every
	   `var(--ink)` to nothing; that is why the generator emits the
	   theme-independent scale itself, below. */
	lines.push('@import "' + relComponents + '";');
	lines.push('');
	lines.push('/* ---- the theme-INDEPENDENT scale, scoped ----');
	lines.push('   Verbatim from src/styles/tokens.css :root. These are the tokens');
	lines.push('   `[data-cm-theme]` does NOT carry, which is why a scoped consumer');
	lines.push('   has to declare them here rather than inherit them:');
	lines.push('   custom properties inherit, so without this a scoped subtree');
	lines.push('   resolves its spacing and type scale from whatever the document');
	lines.push('   root happens to say - a Tailwind app, a second design system, or');
	lines.push('   nothing at all.');
	lines.push('*/');
	lines.push("[data-cm-theme='dark'],");
	lines.push("[data-cm-theme='light'] {");
	for (const [n, v] of scale) {
		lines.push('	' + n + ': ' + v + ';');
	}
	lines.push('}');
	lines.push('');

	/* The COLOUR half, copied VERBATIM from tokens.css's own
	   `[data-cm-theme]` blocks. Copying is the right call here precisely
	   because the alternative - importing tokens.css - leaks: its bare
	   `:root` block then applies to the document and overrides the
	   consuming app's `--accent` and `--radius`. MEASURED both ways:
	   importing gave the prose subtree its colours AND put the library's
	   tokens on the document root; generating gives the prose subtree the
	   same colours with the root untouched. And because this file is
	   GENERATED from tokens.css, the copy cannot drift - `--check`
	   re-derives it and fails on any difference. */
	/* The selector is a comma PAIR (`[data-cm-theme='dark'],
	   [data-cm-theme='dark']`), so match the first part rather than the
	   whole string - an exact match reports "no block" on a file that has
	   one, which is the kind of confident wrong answer that costs an
	   hour. */
	for (const theme of ['dark', 'light']) {
		const sel = "[data-cm-theme='" + theme + "']";
		const blk = all.find(
			(r) => r.selector.split(',').some((p) => p.trim() === sel)
		);
		if (!blk) throw new Error('tokens.css has no ' + sel + ' block');
		const tdecls = decls(blk.body);
		if (!tdecls.length) throw new Error('the ' + theme + ' scoped block declares nothing');
		lines.push("/* ---- " + theme + ": the theme's colour set, from tokens.css ---- */");
		lines.push("[data-cm-theme='" + theme + "'] {");
		for (const [n, v] of tdecls) {
			lines.push('	' + n + ': ' + v + ';');
		}
		lines.push('}');
		lines.push('');
	}

	lines.push(TAIL);
	lines.push('');
	lines.push(scopedElementDefaults());
	lines.push('');
	/* Emitted LAST of the token blocks, and the position is the mechanism:
	   this rule and the theme block above are BOTH (0,1,0) and both match the
	   scoped subtree element, so source order decides - and the theme block
	   carries `--head-h1: 2rem`. Emitted before it, the responsive step
	   silently loses and a scoped adoption renders a 32px h1 where a full
	   install renders 31.2px. */
	lines.push('/* Mirror of base.css\'s responsive :root step. It must come AFTER the');
	lines.push('   theme block above: the two tie on specificity and this one has to win. */');
	lines.push(scopedResponsiveTokens());
	lines.push('');
	return lines.join('\n');
}

const TAIL = `/* ============================================================
   Scoped twins of the base.css element defaults a scoped import
   cannot bring.

   \`.cm-prose ul:not([class])\` is (0,2,1) in base.css, which beats
   Tailwind v3 preflight's \`ol,ul,menu{list-style:none}\` - also
   (0,0,1) - in BOTH load orders, and \`:not([class])\` is what stops
   it reaching a classed list. Reproduced here at the same
   specificity so a scoped adoption keeps the guarantee.

   MEASURED in WebKit at 390/375/1024 on the real corpus: prose ul
   computes \`disc\`, ol computes \`decimal\`, and a classed list inside
   the same subtree stays \`none\`.

   \`li { margin-bottom }\` and \`li::marker\` are NOT here: they are not
   in a reset's way, so they ride in the prose block below with the
   rest of the element defaults. Keeping a second copy here would be
   the parallel-definition defect this generator exists to avoid. */
[data-cm-theme] :is(ul, ol):not([class]) {
	list-style-type: disc;
}
[data-cm-theme] ol:not([class]) {
	list-style-type: decimal;
}

/* ============================================================
   components.css - safe to import here ON THE MEASUREMENT, not on
   the promise: every one of its classes is \`.cm-*\`, and the six
   that are not (\`is-active\`, \`is-copied\`, \`is-error\`,
   \`is-scrolled\`, \`num\`, \`right\`) appear only as a compound under
   a \`.cm-\` parent. tests/run.mjs asserts that, so a future bare
   selector here fails the suite instead of leaking into a consumer.

   base.css is NOT imported: it is the bare-element layer, and it is
   the reason this file exists. */`;

const args = process.argv.slice(2);
const mode = args[0];
const target = args[1];

if ((mode !== '--out' && mode !== '--check') || !target) {
	console.error(
		'usage: make-scoped-entry.mjs (--out|--check) <file> --components <rel-path>'
	);
	process.exit(2);
}

const compIdx = args.indexOf('--components');
if (compIdx === -1 || !args[compIdx + 1]) {
	console.error('  --components <path> is required');
	process.exit(2);
}
const relComponents = args[compIdx + 1];

const targetDir = path.dirname(path.resolve(target));
const resolvedComp = path.resolve(targetDir, relComponents);
if (!existsSync(resolvedComp)) {
	console.error('  components.css NOT FOUND at ' + resolvedComp);
	console.error('  the generated @import would be dropped silently by PostCSS.');
	process.exit(1);
}

const want = build(relComponents);

if (mode === '--out') {
	writeFileSync(target, want, 'utf8');
	console.log('  wrote ' + target);
} else {
	if (!existsSync(target)) {
		console.error('  MISSING ' + target + ' (run --out)');
		process.exit(1);
	}
	const have = readFileSync(target, 'utf8');
	if (have === want) {
		console.log('  in sync  ' + target);
	} else {
		const h = have.split('\n');
		const w = want.split('\n');
		let first = -1;
		for (let i = 0; i < Math.max(h.length, w.length); i++) {
			if (h[i] !== w[i]) { first = i; break; }
		}
		console.error('  STALE    ' + target);
		console.error('    first difference at line ' + (first + 1));
		console.error('    have: ' + (h[first] ?? '<eof>'));
		console.error('    want: ' + (w[first] ?? '<eof>'));
		console.error('  regenerate: node scripts/make-scoped-entry.mjs --out ' + target);
		process.exit(1);
	}
}
