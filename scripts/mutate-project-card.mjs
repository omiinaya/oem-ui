/* Mutation harness for the project card, promoted out of oem-portfolio.
 *
 * A test that has never been broken is a guess. Each entry below is a REAL
 * defect - the source as it was before the promotion, or a plausible
 * regression someone could reintroduce - and each names the check that must
 * fail.
 *
 * Every `from` is anchored on text unique to the project rules. `.cm-project`
 * is a PREFIX of `.cm-projects`, `.cm-project__stack`, `.cm-project--pending`
 * and `.cm-project-tags`, so an unscoped single-token replace lands on a
 * sibling and the harness reports a kill about a rule it never touched -
 * which is the same prefix trap that made `declForSelector('.cm-project')`
 * return the `.cm-projects` body on its first run.
 *
 * Two mutations here are no-ops BY CONSTRUCTION unless anchored on the
 * declaration rather than the class, and the harness asserts its own pattern
 * matched exactly once before counting the result: `display: flex` on the
 * `li` appears in a dozen rules, and `height: 100%` is declared by
 * `.cm-card` as well. A drifted pattern must be a loud error, never a
 * phantom survivor.
 *
 * The originals are restored in `finally` from bytes read BEFORE the edit, so
 * an interrupted run cannot leave a partial mutation behind. Do NOT run this
 * while editing the same files: a kill between the edit and the restore
 * leaves the mutation in the tree.
 *
 *   usage: node scripts/mutate-project-card.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS = join(ROOT, 'src/styles/components.css');
const PAGE = join(ROOT, 'src/pages/index.astro');

const MUTATIONS = [
	{
		name: 'the grid goes back to a hardcoded pair of columns',
		file: CSS,
		// The consumer it replaced used `auto-fit`, so this is not a
		// hypothetical: it is the shape most "just two columns" patches take,
		// and it strands a card on an odd total.
		from: '\tgrid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));\n\tgap: var(--space-4);\n}',
		to: '\tgrid-template-columns: repeat(2, minmax(0, 1fr));\n\tgap: var(--space-4);\n}',
		expect: 'the project grid counts its columns rather than fixing a pair',
	},
	{
		name: 'the min() cap is dropped from the column floor',
		file: CSS,
		// 17rem is 272px; on a 320px phone with the gutter in, the floor is
		// wider than the container and the grid overflows the page.
		from: 'repeat(auto-fit, minmax(min(17rem, 100%), 1fr))',
		to: 'repeat(auto-fit, minmax(17rem, 1fr))',
		expect: 'the project grid counts its columns rather than fixing a pair',
	},
	{
		name: 'the <li> stops being flex, so the card cannot fill its cell',
		file: CSS,
		// The first half of the pairing. With this gone, `height: 100%` on
		// the card resolves against an auto-height parent and the tag stack
		// floats up under the blurb: the row reads as four separate cards
		// instead of one index, with no rule visibly wrong.
		from: '.cm-projects > li { margin: 0; min-width: 0; display: flex; }',
		to: '.cm-projects > li { margin: 0; min-width: 0; }',
		expect: 'the project card fills its cell',
	},
	{
		name: 'the card loses height: 100%, so the stack has nothing to pin to',
		file: CSS,
		// The second half. `.cm-card` declares `height: 100%` too, so this
		// anchor has to include the flex-direction line to be unique.
		from: '\tflex-direction: column;\n\tgap: var(--space-2);\n\theight: 100%;\n\tpadding: var(--space-5);',
		to: '\tflex-direction: column;\n\tgap: var(--space-2);\n\tpadding: var(--space-5);',
		expect: 'the project card fills its cell',
	},
	{
		name: 'the stack loses its bottom pin',
		file: CSS,
		// `margin-top: auto` IS the component. Without it the tags sit
		// directly under the blurb and the cards in a row end at four
		// different heights.
		from: '.cm-project__stack {\n\tmargin: auto 0 0;',
		to: '.cm-project__stack {\n\tmargin: 0;',
		expect: 'the project card fills its cell',
	},
	{
		name: 'the em dash becomes ::after - it rides the name above it',
		file: CSS,
		// The subtle wrong answer. It still renders exactly one dash and the
		// element-based probe cannot see the difference; what changes is
		// WHICH element owns it, which is what makes the glyph survive a
		// caller rendering one themselves.
		from: '.cm-project__blurb::before {',
		to: '.cm-project__blurb::after {',
		expect: 'the project blurb owns its em dash',
	},
	{
		name: 'the em dash glyph is emptied - declared, invisible',
		file: CSS,
		// A value-shaped /content/ match passes this. Only the glyph does.
		from: "\tcontent: '\\2014\\00a0';\n\tcolor: var(--ink-faint);",
		to: "\tcontent: '';\n\tcolor: var(--ink-faint);",
		expect: 'the project blurb owns its em dash',
	},
	{
		name: 'the reserved slot goes solid, so it reads as a broken card',
		file: CSS,
		from: '.cm-project--pending {\n\tborder-style: dashed;',
		to: '.cm-project--pending {\n\tborder-style: solid;',
		expect: 'the reserved project slot is not a link',
	},
	{
		name: 'the reserved slot becomes an <a> - a tab stop that goes nowhere',
		file: PAGE,
		from: '<div class="cm-project cm-project--pending" aria-hidden="true">',
		to: '<a class="cm-project cm-project--pending" href="#projects">',
		expect: 'the reserved project slot is not a link',
	},
	{
		name: 'the aside tag list inherits the card stack\'s inert bottom pin',
		file: CSS,
		// The consolidation this repo has shipped before. The list still
		// renders at the top of the aside; the CSS now claims it is pinned.
		from: '.cm-project-tags {\n\tdisplay: flex;',
		to: '.cm-project-tags {\n\tmargin: auto 0 0;\n\tdisplay: flex;',
		expect: 'the project card and the aside tag list are NOT one rule',
	},
	{
		name: 'the showcase stops rendering the aside tag list',
		file: PAGE,
		// Dead CSS. The class-vs-selector reachability test only proves the
		// CLASS is somewhere on the page; this proves the shape.
		from: '<ul class="cm-project-tags">',
		to: '<ul class="cm-tag">',
		expect: 'the project card and the aside tag list are NOT one rule',
	},
	{
		name: 'the coarse back-link floor is reverted to 0 - DECLARED, inert',
		file: CSS,
		// The exact defect that shipped: the comment claimed a coarse
		// floor, the sheet had none, and `.cm-back` measured 27.19px. This
		// mutation is the more plausible regression - the rule exists and
		// declares min-height, just not the tap one - and a test asserting
		// the bare PROPERTY would pass it.
		from: '@media (pointer: coarse) {\n\t.cm-back { min-height: var(--tap); }\n}',
		to: '@media (pointer: coarse) {\n\t.cm-back { min-height: 0; }\n}',
		expect: 'the back link takes the tap floor it claims to take',
	},
	{
		name: 'the coarse back-link floor is deleted outright',
		file: CSS,
		from: '@media (pointer: coarse) {\n\t.cm-back { min-height: var(--tap); }\n}',
		to: '/* the back link never had a tap floor */',
		expect: 'the back link takes the tap floor it claims to take',
	},
	{
		name: '.cm-back goes inline, which makes any floor dead',
		file: CSS,
		// An inline box IGNORES min-height. The floor can stay declared and
		// measure 0, which is why the display is part of the invariant and
		// not a cosmetic detail.
		from: '.cm-back {\n\tdisplay: inline-flex;',
		to: '.cm-back {\n\tdisplay: inline;',
		expect: 'the back link takes the tap floor it claims to take',
	},
];

// Bytes read BEFORE any edit, so the restore cannot depend on a mutation
// having been undone cleanly.
const ORIGINALS = new Map(MUTATIONS.map((m) => [m.file, readFileSync(m.file, 'utf8')]));

const run = () => spawnSync('node', [join(ROOT, 'tests/run.mjs')], {
	cwd: ROOT, encoding: 'utf8',
});
// The suite's own verdict. A non-zero exit is a kill, NOT a no-op: a
// mutation that breaks the build is the strongest kill available.
const suiteFailed = (r) => r.status !== 0;
const failingNames = (r) => [...`${r.stdout}\n${r.stderr}`.matchAll(/FAIL\s+(.+?):/g)].map((m) => m[1]);

let killed = 0;
const survivors = [];

try {
	// A mutation whose `from` does not occur exactly once is a NO-OP, and a
	// no-op that reports as a pass is worse than no mutation at all.
	for (const m of MUTATIONS) {
		const before = ORIGINALS.get(m.file);
		const occurrences = before.split(m.from).length - 1;
		if (occurrences !== 1) {
			survivors.push(`${m.name} -- PATTERN MATCHES ${occurrences} TIMES, NOT 1 (fix the anchor before trusting this run)`);
			continue;
		}
		writeFileSync(m.file, before.replace(m.from, m.to));

		const r = run();
		// Restore immediately, so a kill never leaves the tree mutated.
		writeFileSync(m.file, before);

		if (!suiteFailed(r)) {
			survivors.push(`${m.name} -- suite stayed GREEN`);
			continue;
		}
		// Assert the EXPECTED check fired. A suite that fails for an
		// unrelated reason would otherwise count as a kill and prove
		// nothing about the mutation.
		const names = failingNames(r);
		if (!names.some((n) => n.includes(m.expect))) {
			survivors.push(`${m.name} -- suite went red on the WRONG check (${names.join(', ') || 'unknown'}); expected one containing "${m.expect}"`);
			continue;
		}
		killed++;
		console.log(`  KILLED  ${m.name}`);
	}
} finally {
	for (const [file, body] of ORIGINALS) writeFileSync(file, body);
}

// The summary is derived from the SAME variable the loop increments.
console.log(`\n${killed}/${MUTATIONS.length} killed`);
if (survivors.length) {
	console.log('\nSURVIVORS:');
	for (const s of survivors) console.log(`  ${s}`);
	process.exit(1);
}
if (killed !== MUTATIONS.length) {
	console.log('\nkill count does not match the mutation count - the summary is lying');
	process.exit(1);
}
console.log('every mutation was killed by the check that owns it');
