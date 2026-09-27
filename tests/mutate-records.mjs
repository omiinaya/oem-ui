#!/usr/bin/env node
/**
 * Mutation check for the "records" increment (.cm-stats, .cm-stat,
 * .cm-timeline, Stat.astro, TimelineItem.astro).
 *
 * A test you have not tried to break is a guess. Every mutation below
 * REVERTS a real decision, the suite must FAIL, and the source is
 * restored. Mirrors tests/mutate-nav.mjs.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const MUTATIONS = [
	{
		name: 'the stat grid goes back to a fixed column count',
		file: 'src/styles/components.css',
		from: /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(9rem, 100%\), 1fr\)\);/,
		to: 'grid-template-columns: repeat(3, 1fr);',
		expectFail: 'the tile count is data',
	},
	{
		name: 'the track minimum drops the min() overflow guard',
		file: 'src/styles/components.css',
		from: 'minmax(min(9rem, 100%), 1fr)',
		to: 'minmax(9rem, 1fr)',
		expectFail: 'the track minimum must be min(…, 100%)',
	},
	{
		name: 'the stat value out-shouts the section heading',
		file: 'src/styles/components.css',
		from: /^\.cm-stat__val\s*\{([\s\S]*?)font-size:\s*1\.35rem;/m,
		to: '.cm-stat__val {$1font-size: 1.9rem;',
		expectFail: 'must not exceed the section h2',
	},
	{
		name: 'the stat value stops wrapping inside its tile',
		file: 'src/styles/components.css',
		all: true,
		from: 'overflow-wrap: break-word;',
		to: 'overflow-wrap: normal;',
		expectFail: 'must wrap inside its tile, not widen the grid',
	},
	{
		name: 'the stat label loses its mobile floor',
		file: 'src/styles/components.css',
		from: /^\.cm-stat__label\s*\{\n([\s\S]*?)font-size:\s*max\(var\(--min-font\), 0\.72rem\);/m,
		to: '.cm-stat__label {\n$1font-size: 0.72rem;',
		expectFail: 'declares a font-size with no --min-font floor',
	},
	{
		name: 'the rail moves onto the list, where it cannot know the last record',
		file: 'src/styles/components.css',
		from: /\.cm-timeline__item::before\s*\{/,
		to: '.cm-timeline::before {',
		expectFail: 'the rail must not be drawn on .cm-timeline itself',
	},
	{
		name: 'the rail runs past the last record',
		file: 'src/styles/components.css',
		all: true,
		from: '.cm-timeline__item:last-child::before { content: none; }',
		to: '/* mutated: rail never terminates */',
		expectFail: 'so the rail runs past the final record',
	},
	{
		name: 'the dot is no longer centred on the rail',
		file: 'src/styles/components.css',
		from: /^\.cm-timeline__item::after\s*\{([\s\S]*?)left:\s*-0\.25rem;/m,
		to: '.cm-timeline__item::after {$1left: 0;',
		expectFail: 'must be exactly -half its width',
	},
	{
		name: '"now" is marked with a hue instead of a fill',
		file: 'src/styles/components.css',
		from: /\.cm-timeline__item--now::after\s*\{\n\s*background:\s*var\(--ink\);/,
		to: '.cm-timeline__item--now::after {\n\tbackground: #22c55e;',
	// A single assertion rarely carries a whole check: one defect often
	// trips several guards inside the same `check(...)`, and the mutation
	// script has no way to know which one fired first. So `expectFail`
	// accepts a LIST of acceptable messages and the mutation counts as
	// caught if the suite went red for any of them. What it still refuses
	// to accept is a red suite for an UNRELATED reason — a mutation that
	// breaks the build instead of the contract it was meant to probe.
	expectFail: [
		'must not introduce a literal colour',
		'must fill the dot with --ink',
		'must use tokens, found literal colours',
	],
	},
	{
		name: 'the record components grow a colour of their own',
		file: 'src/styles/components.css',
		from: '.cm-stat__label {\n\tfont-size: max(var(--min-font), 0.72rem);\n\tline-height: 1.5;\n\tcolor: var(--ink-dim);',
		to: '.cm-stat__label {\n\tfont-size: max(var(--min-font), 0.72rem);\n\tline-height: 1.5;\n\tcolor: #3a3a3a;',
		expectFail: 'the record components must use tokens',
	},
	{
		name: 'the inner timeline list inherits a bullet that snaps under the rail',
		file: 'src/styles/components.css',
		all: true,
		from: '.cm-timeline__body li::before { content: none; }',
		to: '/* mutated: marker re-inherited */',
		expectFail: 'must cancel the inherited ::before marker',
	},
	{
		name: 'TimelineItem stops emitting the rail class',
		file: 'src/astro/TimelineItem.astro',
		from: 'class="cm-timeline__item"',
		to: 'class="cm-timeline-record"',
		expectFail: 'so it draws no rail',
	},
	{
		name: 'TimelineItem loses the --now variant',
		file: 'src/astro/TimelineItem.astro',
		from: 'cm-timeline__item--now',
		to: 'cm-timeline__item--current',
		expectFail: 'cannot express the current record',
	},
	{
		name: 'TimelineItem hardcodes --now into every record',
		file: 'src/astro/TimelineItem.astro',
		// The mutation a substring check cannot see: `cm-timeline__item--now`
		// is still present in the file, and class:list is still used, so the
		// earlier shape-only assertions both pass while every record on the
		// page is marked as the current one.
		from: "class:list={{ 'cm-timeline__item--now': now }}",
		to: 'class="cm-timeline__item cm-timeline__item--now"',
		expectFail: [
			'hardcodes --now into every item',
			'must be bound to the now prop through class:list',
			// Reached first: the shape-only guard asserts class:list is
			// present at all before the stricter binding guard can run.
			'does not use class:list',
		],
	},
	{
		name: 'Stat.astro hardcodes a site identity',
		file: 'src/astro/Stat.astro',
		from: '<span class="cm-stat__label">{label}</span>',
		to: '<span class="cm-stat__label">Omar Minaya</span>',
		expectFail: 'hardcodes a site identity',
	},
	{
		name: 'Stat.astro is deleted while still shipped',
		file: 'src/astro/Stat.astro',
		delete: true,
		from: '',
		to: '',
		expectFail: 'does not ship src/astro/Stat.astro',
	},
	{
		name: 'the records showcase section is unlinked from the nav',
		file: 'src/pages/index.astro',
		from: "{ href: '#records', label: 'records' },",
		to: "{ href: '#nothing', label: 'records' },",
		expectFail: 'the records section is not in the nav',
	},
	{
		name: 'the README stops documenting the tile note',
		file: 'README.md',
		// all: the class appears in BOTH the markup example and the class
		// table. A single replace would only hit the first, and the
		// documented-substring check would still pass off the second.
		all: true,
		from: '`.cm-stat__note`',
		to: '`.cm-stat-extra`',
		expectFail: 'the README does not document',
	},
	{
		name: 'the README drops the timeline markup example',
		file: 'README.md',
		from: '```html\n<ul class="cm-timeline">',
		to: '```text\n<ul class="cm-timeline">',
		expectFail: [
			'shows no markup for it',
			// Removing the ```html fence also removes the only ```html block
			// the section-scan looks for, so the same defect surfaces here.
			'no markup',
		],
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
	for (const p of problems) console.log(`  ${p}`);
}
process.exit(green && !problems.length ? 0 : 1);
