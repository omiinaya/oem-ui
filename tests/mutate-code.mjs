#!/usr/bin/env node
/**
 * Mutation check for the "code / copy" increment
 * (.cm-copy, .cm-copy__state, .cm-codebar*, CodeBlock.astro, the
 * initCopy bind guard and the label slot).
 *
 * A test you have not tried to break is a guess. Every mutation below
 * REVERTS a real decision, the suite must FAIL, and the source is
 * restored. A pattern that no longer matches is reported as NO-OP and
 * counts as a FAILURE of this harness, never as a pass.
 *
 * Mirrors tests/mutate-cards.mjs.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const MUTATIONS = [
	{
		name: 'the copy button stops composing the house button',
		file: 'src/astro/CodeBlock.astro',
		from: /class="cm-btn cm-btn--sm cm-copy"/,
		to: 'class="cm-copy"',
		expectFail: 'the copy button is a house button, not a new visual language',
	},
	{
		name: 'the copy control re-declares the button border',
		file: 'src/styles/components.css',
		from: /(\.cm-copy\s*\{[^}]*?)\n(\tcolor: var\(--ink-faint\);)/,
		to: '$1\n\tborder: 1px solid var(--line);\n$2',
		expectFail: 'the copy button is a house button, not a new visual language',
	},
	{
		name: 'the tap floor is dropped from the coarse-pointer block',
		file: 'src/styles/components.css',
		from: '@media (pointer: coarse) {\n\t.cm-copy { min-height: var(--tap); }\n}',
		to: '@media (pointer: coarse) {\n\t.cm-copy { min-height: 0; }\n}',
		expectFail: 'a copy control is never below the tap floor on touch',
	},
	{
		name: 'the tap floor moves to a hardcoded 44px',
		file: 'src/styles/components.css',
		from: '@media (pointer: coarse) {\n\t.cm-copy { min-height: var(--tap); }\n}',
		to: '@media (pointer: coarse) {\n\t.cm-copy { min-height: 44px; }\n}',
		expectFail: 'a copy control is never below the tap floor on touch',
	},
	{
		name: 'the copied state loses its rule',
		file: 'src/styles/components.css',
		from: /\.cm-copy\.is-copied\s*\{[^}]*\}/,
		to: '.cm-copy.is-nope { color: var(--ink); }',
		expectFail: 'the copied state has a rule, so a successful copy is visible',
	},
	{
		name: 'the glyph slot stops reserving its width',
		file: 'src/styles/components.css',
		from: /(\tmin-width:\s*1\.4em;)/,
		to: '',
		expectFail: 'the glyph slot reserves its width, so the label never shifts',
	},
	{
		name: 'the initCopy bind guard is removed',
		file: 'src/js/cli-mono.js',
		from: "\t\t\t\tif (btn.dataset.cmCopyBound) return;\n\t\t\t\tbtn.dataset.cmCopyBound = '1';\n",
		to: '',
		expectFail: 'the copy button is bound once, however often init runs again',
	},
	{
		name: 'the label goes back into textContent, destroying the slot',
		file: 'src/js/cli-mono.js',
		from: "setCopyLabel(btn, 'copied');",
		to: "btn.textContent = 'copied';",
		expectFail: 'the copy button keeps its glyph slot when the label changes',
	},
	{
		name: 'setCopyLabel stops honouring the label slot',
		file: 'src/js/cli-mono.js',
		from: "var slot = btn.querySelector('[data-cm-copy-label]');\n\t\tif (slot) slot.textContent = text;\n\t\telse btn.textContent = text;",
		to: 'btn.textContent = text;',
		expectFail: 'the copy button keeps its glyph slot when the label changes',
	},
	{
		name: 'the language label stops shrinking',
		file: 'src/styles/components.css',
		from: '.cm-codebar__lang { min-width: 0; }',
		to: '.cm-codebar__lang { }',
		expectFail: 'a long language label cannot push the copy button off the row',
	},
	{
		name: 'the code bar stops flattening the pre default it wraps',
		file: 'src/styles/components.css',
		from: '\tborder-left: 0;\n\tborder-radius: 0;',
		to: '\tborder-left: 0;\n\tborder-radius: var(--radius-sm);',
		expectFail: 'the code bar flattens the pre default it wraps',
	},
	{
		name: 'the code bar goes back to asymmetric insets',
		file: 'src/styles/components.css',
		from: '	padding: 0 var(--space-2);',
		to: '	padding: 0 var(--space-2) 0 var(--space-4);',
		expectFail: 'the code bar is symmetric, so the copy button is not hugging the edge',
	},
	{
		name: 'the code bar draws a hardcoded radius',
		file: 'src/styles/components.css',
		from: /(\.cm-codebar\s*\{[^}]*?)\n\tborder-radius:\s*var\(--radius-sm\);/,
		to: '$1\n\tborder-radius: 4px;',
		expectFail: 'the code bar corners come from the radius token',
	},
	{
		name: 'the copy control stops being a real button',
		file: 'src/astro/CodeBlock.astro',
		from: /<button([\s\S]*?)type="button"/,
		to: '<span role="button" tabindex="0" data-was-button',
		expectFail: 'the copy button is a real button a keyboard can reach',
	},
	{
		name: 'CodeBlock stops refusing to build without an id',
		file: 'src/astro/CodeBlock.astro',
		from: /if \(!id\)[\s\S]*?\}\n/,
		to: '',
		expectFail: 'a code block without an id fails the build instead of shipping a dead button',
	},
	{
		name: 'the showcase ships only one copy button',
		file: 'src/pages/index.astro',
		from: /\t\t\t\t<CodeBlock\n\t\t\t\t\tid="demo-config"[\s\S]*?`\}\n\t\t\t\t\/>/,
		to: '',
		expectFail: 'the showcase demonstrates copy with more than one block',
	},
	{
		name: 'the copy button loses its rendered label slot',
		file: 'src/astro/CodeBlock.astro',
		from: 'data-cm-copy-label',
		to: 'data-cm-nope',
		expectFail: 'the copy button keeps its glyph slot when the label changes',
	},
	{
		name: 'the copy control drops out of the mobile type floor',
		file: 'src/styles/components.css',
		from: '\t.cm-codebar__bar,\n\t.cm-copy {',
		to: '\t.cm-codebar__bar {',
		expectFail: 'every text-bearing component is floored on mobile',
	},
];

const runSuite = () =>
	spawnSync(process.execPath, [p('tests/run.mjs')], { encoding: 'utf8', cwd: root });

// The copy tests read dist/index.html, so a mutation to a SOURCE file is
// invisible until the page is rebuilt. Rebuild, then test. Astro is a local
// devDependency, so this is offline and takes about a second.
const rebuild = () => {
	const r = spawnSync('npx', ['astro', 'build'], { encoding: 'utf8', cwd: root, shell: true });
	// Return the outcome AND the output. A boolean made the caller
	// short-circuit on a build failure and never run the suite, which is
	// how a caught mutation was reported as MISSED.
	return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

let caught = 0;
const noops = [];
const unexpected = [];

// --dry reports which patterns match the CURRENT source and exits. A
// pattern that does not match is a NO-OP, and running the slow path to
// discover that costs two full rebuilds per dead pattern. This is the
// only parser of the mutation list: a second implementation in another
// language silently disagrees with this one about what a pattern means.
const DRY = process.argv.includes('--dry');
if (DRY) {
	console.log(`mutation dry-run: code / copy (${MUTATIONS.length} mutations)\n`);
	for (const m of MUTATIONS) {
		const original = readFileSync(p(m.file), 'utf8');
		const re = m.from instanceof RegExp
			? m.from
			: new RegExp(m.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\n/g, '\\n'), 'g');
		const hit = original.match(re);
		const changes = hit ? original.replace(re, m.to) !== original : false;
		if (!hit || !changes) {
			console.log(`  NO-OP  ${m.name}`);
			noops.push(m.name);
		} else {
			console.log(`  match  ${m.name}`);
		}
	}
	console.log(`\n${MUTATIONS.length - noops.length} match, ${noops.length} no-op`);
	process.exit(noops.length ? 1 : 0);
}

console.log(`mutation: code / copy (${MUTATIONS.length} mutations)\n`);

for (const m of MUTATIONS) {
	const file = p(m.file);
	const original = readFileSync(file, 'utf8');

	// `from` may be a string or a RegExp. A string has no .test, so
	// normalise before matching - the harness has to survive a pattern
	// edit without crashing halfway and leaving the tree mutated.
	const re = m.from instanceof RegExp
		? m.from
		: new RegExp(m.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\n/g, '\\n'), 'g');
	const match = original.match(re);
	if (!match) {
		// A pattern that no longer matches is a failure of THIS harness,
		// never a pass. Counting it as a pass is how two mutants in
		// mutate-layout.mjs reported MISSED for a whole cycle.
		console.log(`  NO-OP  ${m.name}`);
		noops.push(m.name);
		continue;
	}
	const mutated = original.replace(re, m.to);
	if (mutated === original) {
		console.log(`  NO-OP  ${m.name} (replace changed nothing)`);
		noops.push(m.name);
		continue;
	}
	writeFileSync(file, mutated);

	// The restore MUST run even if the suite or the build throws, or a
	// crash leaves the working tree holding a mutant and the next commit
	// ships it. This is not hypothetical: a ReferenceError in this file
	// skipped the restore, another thread committed the mutated
	// CodeBlock.astro, and the suite was red on origin until it was
	// noticed. try/finally, no exceptions.
	let out = '';
	let built = { ok: false, out: '' };
	try {
		// Run the suite whether or not the build succeeded, and KEEP the
		// build output. A mutation that breaks the Astro build (a <span>
		// where the component had a <button> closes the tag differently)
		// used to short-circuit here: `rebuild()` returned false, `out`
		// was set to a BUILD FAILED string and the suite never ran, so
		// the check could not be seen.
		built = rebuild();
		out = runSuite().stdout || '';
		if (!built.ok && !/FAIL  /.test(out)) {
			out += '\nBUILD FAILED\n' + (built.out || '');
		}
	} finally {
		writeFileSync(file, original);
		rebuild();
	}

	// Match the CHECK NAME, not a message substring: the suite prints
	// "FAIL  <name>" and a message can be reworded without the test
	// changing at all, which silently turns a caught mutation into a
	// MISSED. This is the accounting bug that made mutation 1 report a
	// miss when the suite had in fact failed.
	const failed = out.includes('FAIL  ' + m.expectFail) || out.includes('FAIL  ' + m.expectFail + ':');
	// Already restored in the `finally` above.

	if (failed) {
		caught++;
		console.log(`  caught  ${m.name}`);
	} else {
		unexpected.push(m.name);
		console.log(`  MISSED  ${m.name} (expected: ${m.expectFail})`);
	}
}

console.log(`\n${caught} caught, ${noops.length} no-op, ${unexpected.length} missed`);
if (noops.length) {
	console.log('\nno-op (a broken pattern is a broken harness, not a pass):');
	for (const n of noops) console.log(`  ${n}`);
}
if (unexpected.length) {
	console.log('\nmissed (a test that cannot fail is decoration):');
	for (const n of unexpected) console.log(`  ${n}`);
}
// A clean run is caught === MUTATIONS.length with zero no-ops.
process.exit(noops.length || unexpected.length ? 1 : 0);
