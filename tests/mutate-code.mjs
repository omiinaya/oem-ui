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
		expectFail: 'not composed from .cm-btn',
	},
	{
		name: 'the copy control re-declares the button border',
		file: 'src/styles/components.css',
		from: /(\.cm-copy\s*\{[^}]*?)\n(\tcolor: var\(--ink-faint\);)/,
		to: '$1\n\tborder: 1px solid var(--line);\n$2',
		expectFail: 'second button implementation',
	},
	{
		name: 'the tap floor is dropped from the coarse-pointer block',
		file: 'src/styles/components.css',
		from: '@media (pointer: coarse) {\n\t.cm-copy { min-height: var(--tap); }\n}',
		to: '@media (pointer: coarse) {\n\t.cm-copy { min-height: 0; }\n}',
		expectFail: 'below the tap floor on touch',
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
		expectFail: 'successful copy is visible',
	},
	{
		name: 'the glyph slot stops reserving its width',
		file: 'src/styles/components.css',
		from: /(\.cm-copy__state\s*\{[^}]*?)\n\tmin-width:\s*1\.4em;/,
		to: '$1',
		expectFail: 'the copied state has a rule, so a successful copy is visible',
	},
	{
		name: 'the initCopy bind guard is removed',
		file: 'src/js/cli-mono.js',
		from: "\t\t\t\tif (btn.dataset.cmCopyBound) return;\n\t\t\t\tbtn.dataset.cmCopyBound = '1';\n",
		to: '',
		expectFail: 'double-binds every copy button',
	},
	{
		name: 'the label goes back into textContent, destroying the slot',
		file: 'src/js/cli-mono.js',
		from: "setCopyLabel(btn, 'copied');",
		to: "btn.textContent = 'copied';",
		expectFail: 'destroys the glyph slot',
	},
	{
		name: 'setCopyLabel stops honouring the label slot',
		file: 'src/js/cli-mono.js',
		from: "var slot = btn.querySelector('[data-cm-copy-label]');\n\t\tif (slot) slot.textContent = text;\n\t\telse btn.textContent = text;",
		to: 'btn.textContent = text;',
		expectFail: 'no label slot to write into',
	},
	{
		name: 'the language label stops truncating',
		file: 'src/styles/components.css',
		from: /(\.cm-codebar__lang > span\s*\{[^}]*?)\n\tmin-width:\s*0;/,
		to: '$1',
		expectFail: 'min-width: 0',
	},
	{
		name: 'the code bar stops flattening the pre default it wraps',
		file: 'src/styles/components.css',
		from: /\.cm-codebar > pre\s*\{[^}]*?\n\tborder-radius:\s*0;/,
		to: '.cm-codebar > pre { border-radius: var(--radius-sm); }',
		expectFail: 'the code bar flattens the pre default it wraps',
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
		from: /<button type="button"/,
		to: '<span role="button" tabindex="0"',
		expectFail: 'not a <button type="button">',
	},
	{
		name: 'CodeBlock stops refusing to build without an id',
		file: 'src/astro/CodeBlock.astro',
		from: /if \(!id\)[\s\S]*?\}\n/,
		to: '',
		expectFail: 'fails the build',
	},
	{
		name: 'the showcase ships only one copy button',
		file: 'src/pages/index.astro',
		from: /\t\t\t\t<CodeBlock\n\t\t\t\t\tid="demo-config"[\s\S]*?`\}\n\t\t\t\t\/>/,
		to: '',
		expectFail: 'two are needed to exercise per-block resolution',
	},
	{
		name: 'the copy button loses its rendered label slot',
		file: 'src/astro/CodeBlock.astro',
		from: 'data-cm-copy-label',
		to: 'data-cm-nope',
		expectFail: 'no [data-cm-copy-label] slot',
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
	return r.status === 0;
};

let caught = 0;
const noops = [];
const unexpected = [];

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

	let out = '';
	if (rebuild()) out = runSuite().stdout || '';
	else out = 'BUILD FAILED\n' + (out || '');

	// Match the CHECK NAME, not a message substring: the suite prints
	// "FAIL  <name>" and a message can be reworded without the test
	// changing at all, which silently turns a caught mutation into a
	// MISSED. This is the accounting bug that made mutation 1 report a
	// miss when the suite had in fact failed.
	const failed = out.includes('FAIL  ' + m.expectFail) || out.includes('FAIL  ' + m.expectFail + ':');
	// restore BEFORE reporting, so a throw cannot leave the tree mutated
	writeFileSync(file, original);
	rebuild();

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
