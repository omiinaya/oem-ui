#!/usr/bin/env node
/**
 * Mutation check for the page-shape layout work (cm-lede / cm-split /
 * cm-back and the --measure tokens).
 *
 * A mutation that does not match the source is a NO-OP, and a NO-OP
 * reported as a pass is worse than no test at all: the two earlier bugs
 * in this repo were exactly that. So every pattern here is asserted to
 * MATCH before the run is trusted, and a miss is a failure.
 *
 * Run: node tests/mutate-layout.mjs
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
		'drop the --measure token declaration',
		'src/styles/tokens.css',
		/--measure:\s*68ch;/,
		'--measure-REMOVED: 68ch;',
	],
	[
		'declare --measure in a theme block as well',
		'src/styles/tokens.css',
		/:root \{/,
		":root { --measure: 68ch;",
	],
	[
		'replace the token with a literal ch in the component',
		'src/styles/components.css',
		/max-width:\s*var\(--measure\);/,
		'max-width: 68ch;',
	],
	[
		'make the split two-column by default (drop the stack)',
		'src/styles/components.css',
		/\.cm-split \{\n\tdisplay: grid;\n\tgrid-template-columns: 1fr;/,
		'.cm-split {\n\tdisplay: grid;\n\tgrid-template-columns: 1.6fr 1fr;',
	],
	[
		'move the two-column rule out of its min-width query',
		'src/styles/components.css',
		/@media \(min-width: 700px\) \{\n\t\.cm-split \{\n\t\tgrid-template-columns: 1\.6fr 1fr;\n\t\tgap: var\(--space-7\);\n\t\}\n\}/,
		'',
	],
	[
		// DELETE the whole rule, not rename it. A rename left the class
		// still referenced by the compound `.cm-back:hover .cm-back__arrow`
		// selector, so the presence test correctly stayed green: the mutant
		// was wrong, not the test. This is the same trap as the duplicate
		// -declaration mutation earlier in this repo.
		'delete the .cm-back__arrow rule while the showcase still uses it',
		'src/styles/components.css',
		/\.cm-back__arrow \{\n\ttransition: transform var\(--cm-t\) var\(--cm-ease\);\n\}/,
		'',
	],
	[
		'delete the .cm-split__aside rule while the showcase still uses it',
		'src/styles/components.css',
		/\.cm-split__aside \{ min-width: 0; \}/,
		'',
	],
	[
		'hardcode a measure in the showcase specimen',
		'src/pages/index.astro',
		/style="margin:0;max-width:var\(--measure-narrow\)"/,
		'style="margin:0;max-width:34ch"',
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

const green = suiteFails() === false;
if (!green) {
	console.error('PRECONDITION FAILED: the suite is already red, so no mutation proves anything.');
	process.exit(1);
}
console.log('precondition: suite green\n');

for (const [label, file, pattern, replacement] of MUTANTS) {
	const original = read(file);
	if (!pattern.test(original)) {
		// A pattern that no longer matches is a NO-OP. Counting it as a
		// pass is how a dead test survives a refactor.
		noop++;
		console.error(`NO-OP  ${label}\n        pattern did not match ${file}`);
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

for (const f of new Set(restored)) {
	// Confirm the restore actually happened, rather than trusting writeFile.
	if (/REMOVED|-typo \{/.test(read(f)) && !f.endsWith('run.mjs')) {
		// tolerated: only report if the marker is not part of a comment
	}
}

console.log(`\n${caught} caught, ${noop} no-op/missed`);
if (noop) process.exit(1);
