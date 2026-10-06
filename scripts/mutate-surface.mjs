#!/usr/bin/env node
/*
 * Mutation sweep for the `.cm-surface` contract.
 *
 * Written in node rather than bash because a bash harness spent three
 * rounds reporting SURVIVED for mutations it never applied: `shift` plus a
 * heredoc `python3 - "$@"` lost the positional arguments, the python
 * exited on IndexError, and the `if [ $? -eq 9 ]` guard never fired - so a
 * run that mutated NOTHING printed the same green as a real survivor. A
 * harness that cannot prove it mutated something is not measuring, and a
 * no-op that looks like a pass is worse than no test at all.
 *
 * So every mutation is applied in-process, the harness ASSERTS the file
 * changed, and it ASSERTS the mutation text is present before it reads a
 * test result. A mutation whose pattern does not match is a loud error,
 * never a silent survivor.
 *
 * Snapshot discipline per this repo's own rule: restore is a `cp` from a
 * file taken BEFORE the mutation, never `git checkout -- <file>`, which
 * reverts the whole cycle's work rather than the mutation.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/root/projects/oem-ui';
const CSS = join(ROOT, 'src/styles/components.css');
const ASTRO = join(ROOT, 'src/pages/index.astro');
const SNAP = join(tmpdir(), 'cm-surface-snap.css');
const SNAP_A = join(tmpdir(), 'cm-surface-snap.astro');

copyFileSync(CSS, SNAP);
copyFileSync(ASTRO, SNAP_A);

const restore = () => { copyFileSync(SNAP, CSS); copyFileSync(SNAP_A, ASTRO); };

function runSuite() {
	try {
		return execFileSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
	} catch (e) {
		// A build/test crash is a KILL, not a no-op: the strongest available
		// signal that the change broke something.
		return (e.stdout || '') + '\n' + (e.stderr || '');
	}
}

function report(out) {
	const fails = out.split('\n').filter((l) => /^  FAIL/.test(l));
	const score = (out.match(/\d+ passed, \d+ failed/) || ['?'])[0];
	return { killed: fails.length > 0, fails, score };
}

const MUTATIONS = [
	{
		name: 'delete background-color: var(--bg)',
		file: CSS,
		old: '\tbackground-color: var(--bg);',
		new: '',
	},
	{
		name: 'background-color: var(--bg) -> var(--bg-2)',
		file: CSS,
		old: '\tbackground-color: var(--bg);',
		new: '\tbackground-color: var(--bg-2);',
	},
	{
		name: '--flat restates background-color instead of only dropping the vignette',
		file: CSS,
		old: '.cm-surface--flat {\n\tbackground-image: none;',
		new: '.cm-surface--flat {\n\tbackground-color: var(--bg-2);\n\tbackground-image: none;',
	},
	{
		name: 'drop the body font from the paint',
		file: CSS,
		old: '\tfont-family: var(--font-body);\n\tfont-size: var(--text);\n\tline-height: 1.7;',
		new: '',
	},
	{
		name: 'remove data-cm-theme from ONE specimen (the island proves nothing)',
		file: ASTRO,
		old: '<div class="cm-surface" data-cm-theme="dark"',
		new: '<div class="cm-surface"',
	},
	{
		name: "remove the specimen's masked backing (it still LOOKS fine)",
		file: ASTRO,
		old: 'background:#f2f0ec;',
		new: '',
	},
];

console.log('mutation sweep: .cm-surface\n');

let killed = 0;
let survived = 0;
let errored = 0;

for (const m of MUTATIONS) {
	restore();
	const before = readFileSync(m.file, 'utf8');
	if (!before.includes(m.old)) {
		console.log(`  ERROR  ${m.name}`);
		console.log('         the pattern does not match the source - this mutation is a');
		console.log('         NO-OP by construction, so any result below would be fiction.');
		errored++;
		continue;
	}
	const after = before.replace(m.old, m.new);
	if (after === before) {
		console.log(`  ERROR  ${m.name} :: replace() was a no-op`);
		errored++;
		continue;
	}
	writeFileSync(m.file, after);

	// PROVE the mutation is live in the file the tests read.
	const onDisk = readFileSync(m.file, 'utf8');
	if (m.new && !onDisk.includes(m.new)) {
		console.log(`  ERROR  ${m.name} :: the mutation is not in the file on disk`);
		errored++;
		continue;
	}
	if (!m.new && onDisk.includes(m.old)) {
		console.log(`  ERROR  ${m.name} :: the deletion did not land`);
		errored++;
		continue;
	}

	const r = report(runSuite());
	if (r.killed) {
		killed++;
		console.log(`  KILLED   ${m.name}`);
		r.fails.slice(0, 2).forEach((f) => console.log(`          ${f.trim()}`));
	} else {
		survived++;
		console.log(`  SURVIVED ${m.name}`);
		console.log(`          ${r.score}  <-- the suite did not catch this`);
	}
}

restore();
const final = report(runSuite());

console.log('');
console.log(`killed ${killed}, survived ${survived}, errored ${errored}`);
console.log(`suite after restore: ${final.score}`);
if (final.killed) {
	console.log('');
	console.log('the suite is NOT green after restore - the harness did not clean up.');
	process.exit(1);
}
process.exit(survived || errored ? 1 : 0);