#!/usr/bin/env node
/**
 * Mutation check for the reset-safe article-body element defaults
 * (`ul`/`ol` list-style-type and `th` font-weight in base.css) and the
 * specimen that demonstrates them.
 *
 * A test you have not tried to break is a guess. Each mutant reverts ONE
 * thing this change fixed, and a correct mutant makes the suite FAIL.
 *
 * Three traps this file is shaped around, all of which have produced a
 * green suite in this repo that meant nothing:
 *
 *   - A mutation whose pattern no longer matches is a NO-OP, and scoring a
 *     no-op as a pass is worse than having no test at all. Every pattern is
 *     asserted to match before its result is counted.
 *   - These rules are DOCUMENTED IN COMMENTS that sit directly above them,
 *     naming `list-style-type` and `font-weight` and the whole Tailwind
 *     measurement. So a substring test ("does base.css contain
 *     list-style-type") passes with the declaration deleted. Every mutant
 *     here DELETES or alters the declaration itself.
 *   - `ul, ol` is ONE rule with a selector list, and `ol` is a second rule
 *     for the decimal override. A mutation that only edits the first leaves
 *     the second, so the mutant must target the exact declaration.
 *
 * Run: node tests/mutate-article-defaults.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => writeFileSync(join(root, p), s);

/** [label, file, pattern-that-must-exist, replacement] */
const MUTANTS = [
	[
		"delete the list marker from the shared ul, ol rule (the word survives in the comment above it)",
		'src/styles/base.css',
		/^ul, ol \{[^\n]*list-style-type: disc;[^\n]*\}$/m,
		'ul, ol { padding-left: 1.4em; margin: 0 0 1.2em; }',
	],
	[
		'delete the ol decimal override, so a numbered list inherits disc from ul',
		'src/styles/base.css',
		/^ol \{ list-style-type: decimal; \}$/m,
		'',
	],
	[
		'delete the th weight, leaving the header cell the weight of the data beside it',
		'src/styles/base.css',
		/^th \{ background: var\(--bg-3\); color: var\(--ink\); font-weight: 700; \}$/m,
		'th { background: var(--bg-3); color: var(--ink); }',
	],
	[
		// The value-shaped survivor: `font-weight: bold` is a legal
		// font-weight and every /font-weight/ regex matches it, so a
		// test that checks presence rather than VALUE passes the broken
		// version. It is the same class of defect as `max-height: none`.
		'swap the th weight for a keyword, which every presence test accepts',
		'src/styles/base.css',
		/font-weight: 700; \}$/m,
		'font-weight: 500; }',
	],
	[
		'scope the list marker to a class, so a markdown renderer\'s bare <ul> goes back to inheriting it',
		'src/styles/base.css',
		/^ul, ol \{/m,
		'.cm-list ul, .cm-list ol {',
	],
	[
		'scope the th weight to a class, so a bare <th> from any renderer goes back to inheriting it',
		'src/styles/base.css',
		/^th \{ background: var\(--bg-3\)/m,
		'.cm-prose th { background: var(--bg-3)',
	],
	[
		// The inverse of the bug, and the reason the tests assert the
		// component side: pushing `disc` onto a component list turns
		// every row of every list component into a bulleted row.
		'drop list-style: none from .cm-rows, so the new default reaches the component',
		'src/styles/components.css',
		/^\.cm-rows \{ list-style: none;/m,
		'.cm-rows {',
	],
	[
		'remove the classless <ul> from the specimen, so nothing proves the element default',
		'src/pages/index.astro',
		/<ul>\s*\n\s*<li>A bullet\./,
		'<ul class="cm-rows">\n\t\t\t\t\t\t\t\t<li>A bullet.',
	],
	[
		'remove the classless <ol> from the specimen',
		'src/pages/index.astro',
		/<ol>\s*\n\s*<li>A numbered item\./,
		'<ol class="cm-rows">\n\t\t\t\t\t\t\t\t<li>A numbered item.',
	],
	[
		'remove the bare <th> from the specimen table',
		'src/pages/index.astro',
		/<th scope="col">Consumer<\/th>/,
		'<th scope="col" class="cm-label">Consumer</th>',
	],
	[
		'remove the whole #proselists section, so the defaults are unproven surface again',
		'src/pages/index.astro',
		/<section id="proselists"[\s\S]*?<\/section>/,
		'',
	],
	[
		'unregister the section from SECTION_ORDER, leaving it unreachable from the nav',
		'src/pages/index.astro',
		/'proselists', /,
		'',
	],

	/* ---- the load-order half, added when the reset race was fixed ----
	   Each of these reverts ONE link in the chain that makes the marker
	   survive a consumer's preflight. The naive scoped selector is the
	   important one: it is the fix a reasonable person writes, it PASSES
	   every value-shaped assertion in the file above, and it is wrong -
	   MEASURED, it gives a .cm-rows nested in prose a bullet. A harness
	   without it would score the shipped selector as equivalent to a
	   regression. */
	[
		'scope the marker to a flat .cm-prose ul - the obvious fix, which wins the reset and puts bullets on every .cm-rows',
		'src/styles/base.css',
		/^\.cm-prose ul:not\(\[class\]\),\n\.cm-prose ol:not\(\[class\]\) \{ list-style-type: disc; \}$/m,
		'.cm-prose ul, .cm-prose ol { list-style-type: disc; }',
	],
	[
		'drop :not([class]) from the ul selector only, so a classed list in prose gains a marker',
		'src/styles/base.css',
		/^\.cm-prose ul:not\(\[class\]\),$/m,
		'.cm-prose ul,',
	],
	[
		'drop :not([class]) from the ol selector only',
		'src/styles/base.css',
		/^\.cm-prose ol:not\(\[class\]\) \{ list-style-type: decimal; \}$/m,
		'.cm-prose ol { list-style-type: decimal; }',
	],
	[
		// The inert-value mutant for a SELECTOR-shaped guarantee: the rule
		// keeps its name and its `list-style-type: disc`, and the load-order
		// bug comes straight back. Every /list-style-type/ presence test
		// still passes, which is the whole reason the tests assert the
		// selector rather than the value.
		'replace the whole scoped pair with the bare reset-order rule the fix replaced',
		'src/styles/base.css',
		/^\.cm-prose ul:not\(\[class\]\),\n\.cm-prose ol:not\(\[class\]\) \{ list-style-type: disc; \}$/m,
		'ul, ol { list-style-type: disc; }',
	],
	[
		'delete the prose decimal rule, so a numbered list inside prose computes disc',
		'src/styles/base.css',
		/^\.cm-prose ol:not\(\[class\]\) \{ list-style-type: decimal; \}$/m,
		'',
	],
	[
		// Anchored in base.css, which is where the marker rule lives. The
		// first version of this mutant anchored on `.cm-prose { color: ...`,
		// a rule that only exists in components.css - so it reported NO-OP
		// and would have scored a pattern that can never match as a pass.
		// The point of the mutant is that an unscoped `.cm-prose ul` ANYWHERE
		// reaches classed lists, which is why the guard in run.mjs scans the
		// whole file rather than the two rules it wrote.
		'add a flat .cm-prose ul rule elsewhere, which reaches classed lists the scoped one cannot',
		'src/styles/base.css',
		/^\.cm-prose ul:not\(\[class\]\),$/m,
		'.cm-prose ul { margin-bottom: 1em; }\n.cm-prose ul:not([class]),',
	],
	[
		'remove the classless <ul> from the load-order specimen',
		'src/pages/index.astro',
		/<ul>\s*\n\s*<li><code>ul<\/code>/,
		'<ul class="cm-rows">\n														<li><code>ul</code>',
	],
	[
		'remove the classless <ol> from the load-order specimen',
		'src/pages/index.astro',
		/<ol>\s*\n\s*<li><code>ol<\/code>/,
		'<ol class="cm-rows">\n														<li><code>ol</code>',
	],
	[
		// The counter-example mutant. Removing it leaves a specimen that
		// still shows two classless lists, so it still "demonstrates the
		// rule" - and would pass a suite that only checks that. The rule
		// under test is EXCLUSIVE, and only the counter-example shows it.
		'remove the classed .cm-rows counter-example, so the specimen proves only that markers can be added',
		'src/pages/index.astro',
		/<ul class="cm-rows">\s*\n\s*<li class="cm-row">\s*\n\s*<span class="cm-row__idx">&mdash;<\/span>\s*\n\s*<span class="cm-row__body">\s*\n\s*<span class="cm-row__title">\.cm-rows<\/span>/,
		'<ul>\n															<li class="cm-row">\n															<span class="cm-row__idx">&mdash;</span>\n															<span class="cm-row__body">\n																<span class="cm-row__title">.cm-rows</span>',
	],
	[
		'remove the whole #proselists-order section, so the load-order guarantee is unproven surface',
		'src/pages/index.astro',
		/<section id="proselists-order"[\s\S]*?<\/section>/,
		'',
	],
	[
		'unregister the load-order section from SECTION_ORDER',
		'src/pages/index.astro',
		/'proselists-order', /,
		'',
	],
];

let noop = 0;
let caught = 0;
const restored = [];

function suiteFails() {
	const r = spawnSync(process.execPath, [join(root, 'tests', 'run.mjs')], {
		encoding: 'utf8',
	});
	return r.status !== 0;
}

// Byte-exact snapshot of every file a mutant touches, taken BEFORE the
// first mutation, so the restore check compares against real prior content
// rather than a re-read of a file the harness may already have written.
const pristine = new Map(
	[...new Set(MUTANTS.map(([, file]) => file))].map((f) => [f, read(f)]),
);

if (suiteFails()) {
	console.error('PRECONDITION FAILED: the suite is already red, so no mutation proves anything.');
	process.exit(1);
}
console.log('precondition: suite green\n');

for (const [label, file, pattern, replacement] of MUTANTS) {
	const original = read(file);
	if (!pattern.test(original)) {
		noop++;
		console.error(`NO-OP  ${label}\n        pattern did not match ${file} -- BROKEN mutation, not a pass`);
		continue;
	}
	write(file, original.replace(pattern, replacement));
	let failed = false;
	try {
		failed = suiteFails();
	} finally {
		write(file, original);
		restored.push(file);
	}
	if (failed) {
		caught++;
		console.log(`caught  ${label}`);
	} else {
		noop++;
		console.error(`MISSED  ${label}\n        the suite stayed green with the fix reverted`);
	}
}

// The restore is asserted, not assumed: a harness that leaves the tree
// mutated is worse than one that does not run. And a `git checkout` is
// deliberately NOT used to clean up - this repo is edited by concurrent
// cycles, and a checkout of a shared file reverts their work too.
//
// This compares the BYTES against what was on disk before the run, rather
// than grepping for the strings the mutants removed. The first version of
// this check grepped for `list-style-type: disc` and `font-weight: 700` in
// every restored file and reported 2 phantom failures, because those two
// declarations live in base.css and two of the three mutated files do not
// contain them at all - the check was failing on a correct restore. A
// restore assertion that is wrong in the passing direction is as bad as no
// restore assertion, because it trains you to ignore it.
for (const f of new Set(restored)) {
	const after = read(f);
	if (after !== pristine.get(f)) {
		console.error(`RESTORE FAILED  ${f} is not byte-identical to its pre-run content`);
		noop++;
	}
}
if (suiteFails()) {
	console.error('RESTORE FAILED  the suite is red after restore');
	noop++;
}

console.log(`\n${caught} caught, ${noop} missed/no-op`);
process.exit(noop ? 1 : 0);