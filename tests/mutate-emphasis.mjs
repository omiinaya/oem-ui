#!/usr/bin/env node
/**
 * Mutation check for the emphasis element default (`strong, b` in base.css)
 * and the specimen that demonstrates it.
 *
 * A test you have not tried to break is a guess. Each mutant reverts ONE
 * thing the work fixed, and a correct mutant makes the suite FAIL.
 *
 * The two traps this file is shaped around, both of which have already cost
 * this repo a green suite that meant nothing:
 *
 *   - A mutation whose pattern no longer matches is a NO-OP. Counting it as
 *     a pass is worse than having no test, so a miss is a hard failure here
 *     and every pattern is asserted to match before the run is trusted.
 *   - The rule is DOCUMENTED IN A COMMENT that sits directly above it, and
 *     it is named in the showcase copy. So a substring check ("does the file
 *     contain `strong`") passes with the whole rule deleted, because the
 *     word is still in the prose. Every mutant below therefore DELETES the
 *     declaration, and the tests use a real selector parser.
 *
 * Run: node tests/mutate-emphasis.mjs
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
		'delete the whole strong/b rule (the word survives in the comment above it)',
		'src/styles/base.css',
		/^strong, b \{ color: var\(--ink\); font-weight: 700; \}$/m,
		'',
	],
	[
		'drop the weight cue, leaving colour-only emphasis',
		'src/styles/base.css',
		/strong, b \{ color: var\(--ink\); font-weight: 700; \}/,
		'strong, b { color: var(--ink); }',
	],
	[
		'drop the colour cue, leaving weight-only emphasis',
		'src/styles/base.css',
		/strong, b \{ color: var\(--ink\); font-weight: 700; \}/,
		'strong, b { font-weight: 700; }',
	],
	[
		'hardcode the emphasis colour instead of using the token (a rebrand bug)',
		'src/styles/base.css',
		/color: var\(--ink\); font-weight: 700; \}/,
		'color: #e8e8e8; font-weight: 700; }',
	],
	[
		'scope it to a class instead of the bare element (a bare <strong> stops working)',
		'src/styles/base.css',
		/^strong, b \{/m,
		'.cm-em {',
	],
	[
		'keep the element but orphan the weight, so it is a colour-only nudge again',
		'src/styles/base.css',
		/font-weight: 700; \}$/m,
		'}',
	],
	[
		// The global-flag trap, hit while writing this file. A non-global
		// replace only rewrites the FIRST <strong> in the file, and the
		// first one is in the states section, not the prose section the
		// test reads - so the mutant "ran", the suite stayed green, and it
		// was scored MISSED for the wrong reason. Anchored on the prose
		// specimen's own copy so it can only hit the one under test.
		'remove the <strong> specimen from the prose section',
		'src/pages/index.astro',
		/Emphasis is an element default, not a class, so this <strong>[\s\S]*?<\/strong>/,
		'Emphasis is an element default, not a class, so this <em>bold word</em>',
	],
	[
		'put a class on the specimen, so it no longer proves the bare element works',
		'src/pages/index.astro',
		/<strong>/,
		'<strong class="cm-em">',
	],
	[
		'flatten --ink onto --ink-dim, so emphasis is indistinguishable',
		'src/styles/tokens.css',
		/--ink: #e8e8e8;/,
		'--ink: #9c9c9c;',
	],
	[
		// components.css has no top-level :root, so the anchor is its
		// first real rule. A pattern that matches nothing is a NO-OP and
		// is scored as a failure, not as a pass.
		'put the emphasis rule in a second layer (a silent cascade race)',
		'src/styles/components.css',
		/^\.cm-kicker \{/m,
		'strong, b { color: var(--ink); font-weight: 700; }\n.cm-kicker {',
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
// mutated is worse than one that does not run.
for (const f of new Set(restored)) {
	const after = read(f);
	if (/:root \{\}|#e8e8e8; font-weight|cm-em \{|\.cm-em\b/.test(after) && !after.includes('strong, b {')) {
		console.error(`RESTORE FAILED  ${f} still carries a mutant`);
		noop++;
	}
}
if (suiteFails()) {
	console.error('RESTORE FAILED  the suite is red after restore');
	noop++;
}

console.log(`\n${caught} caught, ${noop} missed/no-op`);
process.exit(noop ? 1 : 0);
