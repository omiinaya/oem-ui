#!/usr/bin/env node
/**
 * Mutation check for the "cards" increment (.cm-cards, .cm-card,
 * .cm-meter, Card.astro, Meter.astro).
 *
 * A test you have not tried to break is a guess. Every mutation below
 * REVERTS a real decision, the suite must FAIL, and the source is
 * restored. Mirrors tests/mutate-records.mjs.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const MUTATIONS = [
	{
		name: 'the card grid goes back to a fixed column count',
		file: 'src/styles/components.css',
		from: /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(20rem, 100%\), 1fr\)\);/,
		to: 'grid-template-columns: repeat(2, 1fr);',
		expectFail: '.cm-cards does not use auto-fit',
	},
	{
		name: 'the card track minimum drops the min() overflow guard',
		file: 'src/styles/components.css',
		from: 'minmax(min(20rem, 100%), 1fr)',
		to: 'minmax(20rem, 1fr)',
		expectFail: ['does not use auto-fit', 'a long title forces overflow'],
	},
	{
		name: 'cards stretch to the tallest in the row',
		file: 'src/styles/components.css',
		from: /(\.cm-cards\s*\{[^}]*?)\n\talign-items:\s*start;/,
		to: '$1\n\talign-items: stretch;',
		expectFail: 'align-items: start',
	},
	{
		name: 'a short card stops matching the tall one beside it',
		file: 'src/styles/components.css',
		from: /(\.cm-card\s*\{[^}]*?)\n\theight:\s*100%;/,
		to: '$1',
		expectFail: '.cm-card has no height: 100%',
	},
	{
		name: 'the card body stops growing, so footers float up',
		file: 'src/styles/components.css',
		from: /(\.cm-card__body\s*\{[^}]*?)\n\tflex:\s*1 1 auto;/,
		to: '$1',
		expectFail: '.cm-card__body does not grow',
	},
	{
		name: 'the card stops clipping, so the accent escapes the radius',
		file: 'src/styles/components.css',
		from: /(\.cm-card\s*\{[^}]*?)\n\toverflow:\s*hidden;/,
		to: '$1',
		expectFail: ['does not clip', 'is not position: relative'],
	},
	{
		name: 'the card loses its containing block for the stretched link',
		file: 'src/styles/components.css',
		from: /(\.cm-card\s*\{[^}]*?)\n\t\/\* The stretched link below needs a containing block\. \*\/\n\tposition:\s*relative;/,
		to: '$1',
		expectFail: 'is not position: relative',
	},
	{
		name: 'the whole-card link stretch is removed',
		file: 'src/styles/components.css',
		from: /\.cm-card__link::after\s*\{[^}]*\}/,
		to: '.cm-card__link::after { content: none; }',
		expectFail: 'the stretch does not cover the whole card',
	},
	{
		name: 'the stretch is moved onto the card, where it covers the text',
		file: 'src/styles/components.css',
		from: '.cm-card__link::after {',
		to: '.cm-card::after {',
		expectFail: 'so a card link is only as big as its text',
	},
	{
		name: 'the card copy loses its mobile floor',
		file: 'src/styles/components.css',
		from: /(\.cm-card__text\s*\{[^}]*?)font-size:\s*max\(var\(--min-font\), 0\.85rem\);/,
		to: '$1font-size: 0.85rem;',
		expectFail: '.cm-card__text is not floored',
	},
	{
		name: 'the meter sub-line loses its mobile floor',
		file: 'src/styles/components.css',
		from: /(\.cm-meter__label\s*\{[^}]*?)font-size:\s*max\(var\(--min-font\), 0\.78rem\);/,
		to: '$1font-size: 0.78rem;',
		expectFail: '.cm-meter__label is not floored',
	},
	{
		name: 'the meter fill is hardcoded instead of driven by the printed value',
		file: 'src/styles/components.css',
		from: 'width: var(--cm-meter-fill, 0%);',
		to: 'width: 100%;',
		expectFail: 'the fill width is not driven by --cm-meter-fill',
	},
	{
		name: 'the meter fill default becomes full, so a missing value reads as 100%',
		file: 'src/styles/components.css',
		from: 'var(--cm-meter-fill, 0%)',
		to: 'var(--cm-meter-fill, 100%)',
		expectFail: 'the fill width is not driven by --cm-meter-fill',
	},
	{
		name: 'the meter track is announced, so the value is read twice',
		file: 'src/astro/Meter.astro',
		from: '<div class="cm-meter__track" aria-hidden="true">',
		to: '<div class="cm-meter__track">',
		expectFail: 'the track is not aria-hidden',
	},
	{
		name: 'the meter stops printing its value, leaving a picture of nothing',
		file: 'src/astro/Meter.astro',
		from: '<span class="cm-meter__val">{value}</span>',
		to: '',
		expectFail: 'does not render the value as text',
	},
	{
		name: 'the pct guard is removed, so a bad weighting ships a lying bar',
		file: 'src/astro/Meter.astro',
		from: /if \(!Number\.isFinite\(pct\) \|\| pct < 0 \|\| pct > 100\) \{\n\tthrow new Error\(`<Meter> pct must be 0-100, got \$\{pct\}[^`]*`\);\n\}/,
		to: 'if (false) { throw new Error("nope"); }',
		expectFail: 'the guard does not reject non-finite, negative',
	},
	{
		name: 'the pct guard excludes a legitimate full bar',
		file: 'src/astro/Meter.astro',
		from: 'pct > 100',
		to: 'pct >= 100',
		expectFail: 'the guard does not reject non-finite, negative',
	},
	{
		name: 'the guard stops rejecting a negative pct',
		file: 'src/astro/Meter.astro',
		from: '!Number.isFinite(pct) || pct < 0 ||',
		to: '!Number.isFinite(pct) ||',
		expectFail: 'does not reject non-finite, negative',
	},
	{
		name: 'the accent is hardcoded onto every card',
		file: 'src/astro/Card.astro',
		from: /const cls = \['cm-card', accent && 'cm-card--accent'\];/,
		to: "const cls = ['cm-card', 'cm-card--accent'];",
		expectFail: 'the --accent class is not bound to the accent prop',
	},
	{
		name: 'the card body slot is removed, so a consumer cannot put anything in it',
		file: 'src/astro/Card.astro',
		from: /<div class="cm-card__body">\s*\n\s*<slot \/>\s*\n\s*<\/div>/,
		to: '<div class="cm-card__body"></div>',
		expectFail: 'has no default slot inside .cm-card__body',
	},
	{
		name: 'the card foot wrapper is removed, so the footer CSS is dead',
		file: 'src/astro/Card.astro',
		from: /<div class="cm-card__foot">\s*\n\s*<slot name="foot" \/>\s*\n\s*<\/div>/,
		to: '<slot name="foot" />',
		expectFail: 'without a .cm-card__foot wrapper',
	},
	{
		name: 'the foot wrapper becomes unconditional, painting an empty bar',
		file: 'src/astro/Card.astro',
		from: "{Astro.slots.has('foot') && (",
		to: '{true && (',
		expectFail: 'the foot wrapper is unconditional',
	},
	{
		name: 'the card foot slot is removed entirely',
		file: 'src/astro/Card.astro',
		// Anchored to the one inside the wrapper, not a bare match: the
		// explanatory comment quotes the same tag, and an unanchored
		// regex would delete the mention and leave the real slot intact.
		from: /<div class="cm-card__foot">\s*\n\s*<slot name="foot" \/>/,
		to: '<div class="cm-card__foot">',
		expectFail: ['Card.astro has no foot slot', 'without a .cm-card__foot wrapper'],
	},
	{
		name: 'the card stops emitting its title, so a grid of them has no outline',
		file: 'src/astro/Card.astro',
		from: '<h3 class="cm-card__title">{title}</h3>',
		to: '{title}',
		expectFail: 'Card.astro does not emit .cm-card__title',
	},
	{
		name: 'Card.astro starts hardcoding a consumer identity',
		file: 'src/astro/Card.astro',
		from: 'interface Props {',
		to: '// omiinaya\ninterface Props {',
		expectFail: 'hardcodes a site identity',
	},
	{
		name: 'the README drops the meter class table',
		file: 'README.md',
		from: '| `.cm-meter__fill` | the filled part. Width is `var(--cm-meter-fill, 0%)` — the caller sets it from the same number it printed |\n',
		to: '',
		expectFail: 'the README does not document `.cm-meter__fill`',
	},
	{
		// Scoped to the fence that actually contains the card markup. A
		// bare /```html…```/ regex matches the FIRST fence in the whole
		// README, which lives in another section — so the cards section
		// kept its example and the suite stayed green.
		name: 'the README markup example loses the meter',
		file: 'README.md',
		from: /```html\n<ul class="cm-cards">[\s\S]*?```/,
		to: '```html\n<!-- no markup -->\n```',
		expectFail: 'shows no markup',
	},
	{
		name: 'the showcase drops the cards nav entry',
		file: 'src/pages/index.astro',
		from: "\t\t\t\t{ href: '#cards', label: 'cards' },\n",
		to: '',
		expectFail: 'the cards section is not in the showcase nav',
	},
	{
		name: 'the showcase stops importing Card, so the demo drifts from the component',
		file: 'src/pages/index.astro',
		from: 'import Card from',
		to: 'import Nope from',
		expectFail: 'the showcase does not import <Card>',
	},
	{
		name: 'the showcase stops importing Meter',
		file: 'src/pages/index.astro',
		from: 'import Meter from',
		to: 'import Nope from',
		expectFail: 'the showcase does not import <Meter>',
	},
	{
		name: 'the card block leaks a hardcoded hex',
		file: 'src/styles/components.css',
		from: '.cm-meter__track {',
		to: '.cm-meter__track {\n\tbackground: #14161a;',
		expectFail: 'contains a hex literal',
	},
	{
		name: 'the footer goes back to wrapping, so a long status overlaps the link',
		file: 'src/styles/components.css',
		from: /\.cm-card__foot\s*\{[\s\S]*?\}/,
		to: '.cm-card__foot {\n	flex-wrap: wrap;\n	align-items: center;\n	gap: var(--space-2);\n}',
		expectFail: 'the footer wraps instead of stacking',
	},
	{
		// Scoped to the card block ON PURPOSE. `border-top: … var(--line-soft)`
		// appears earlier in the file too, and a bare string replace only
		// hits the FIRST occurrence — which sits outside the block the
		// colour check scans, so the suite stayed green. The token has to
		// be a card-block one, or the mutation proves nothing.
		name: 'the card block uses a token the palette does not define',
		file: 'src/styles/components.css',
		from: '.cm-card__foot {',
		to: '.cm-card__foot { /* */\n	border-top-color: var(--line-muted);',
		expectFail: 'uses undefined token',
	},
	{
		name: 'Meter.astro is deleted outright',
		file: 'src/astro/Meter.astro',
		from: '',
		delete: true,
		expectFail: ['does not ship src/astro/Meter.astro', 'the README does not document'],
	},
	{
		name: 'Card.astro is deleted outright',
		file: 'src/astro/Card.astro',
		from: '',
		delete: true,
		expectFail: ['does not ship src/astro/Card.astro', 'the README does not document'],
	},
];

const run = () => spawnSync('node', [p('tests/run.mjs')], { encoding: 'utf8' });

let caught = 0, noop = 0, wrongTest = 0;
const problems = [];

for (const m of MUTATIONS) {
	const original = readFileSync(p(m.file), 'utf8');
	const apply = (s) => (m.all ? s.replaceAll(m.from, m.to) : s.replace(m.from, m.to));
	const mutated = m.from === '' ? original : apply(original);
	/* The mutation must actually CHANGE BYTES. `String.replace` reports a
	   non-matching pattern as success, so a no-op would be recorded as a
	   real attempt and then counted as a miss — a broken mutation script
	   wearing the costume of a weak test. Compare the bytes. */
	if (!m.delete && mutated === original) {
		console.log(`NO-OP  ${m.name}  (pattern did not match ${m.file})`);
		noop++;
		problems.push(`NO-OP: ${m.name}`);
		continue;
	}
	if (m.delete) rmSync(p(m.file));
	else writeFileSync(p(m.file), mutated);
	const r = run();
	// Restore unconditionally: a deleted file comes back with its original
	// bytes, so one line covers both the mutate and the delete case.
	writeFileSync(p(m.file), original);

	const out = `${r.stdout}${r.stderr}`;
	const failed = out.includes('FAIL');
	// `expectFail` is a substring or a list of them; any one matching means
	// the suite went red for a reason this mutation intended.
	const wants = Array.isArray(m.expectFail) ? m.expectFail : [m.expectFail];
	const hit = wants.some((w) => out.includes(w));
	if (failed && hit) {
		console.log(`caught ${m.name}`);
		caught++;
	} else if (failed) {
		console.log(`WRONG  ${m.name} — suite failed, but not by ${wants.map((w) => `"${w}"`).join(' / ')}`);
		wrongTest++;
		problems.push(`WRONG TEST: ${m.name}`);
	} else {
		console.log(`MISSED ${m.name} — the suite stayed green`);
		problems.push(`MISSED: ${m.name}`);
	}
}

const final = run();
const green = final.status === 0;
console.log(`\n${caught} caught, ${noop} no-op, ${wrongTest} wrong-test, ${MUTATIONS.length} total`);
console.log(green ? 'restored suite: GREEN' : 'restored suite: RED');
if (problems.length) {
	console.log('\nproblems:');
	for (const pr of problems) console.log(`  ${pr}`);
}
process.exit(green && !problems.length ? 0 : 1);
