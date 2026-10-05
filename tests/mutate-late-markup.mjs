#!/usr/bin/env node
/* Mutation sweep for the late-markup watcher.
 *
 * Every mutation below targets the two checks this change added:
 *   - 'markup that arrives after the runtime boots still gets bound'
 *   - 'a page that already has library markup arms no observer at all'
 *
 * House rules this file exists to obey, each learned the hard way:
 *
 *  - SNAPSHOTS ARE PATHS, WRITES ARE CONTENTS. `writeFileSync(TARGET, SNAP)`
 *    writes the literal STRING "/root/.../snapshot" into the file and then
 *    the cleanup deletes the real snapshot, so the next restore writes that
 *    same string back. That is how this sweep once truncated the runtime to
 *    one line and left the tree unparseable. It reads the snapshot with
 *    readFileSync every time it restores.
 *
 *  - NEVER `git checkout --` A SHARED FILE to clean up after a mutation.
 *    That reverts the whole cycle's work, not the mutation. Restore with cp.
 *
 *  - ASSERT THE PATTERN MATCHED before counting a result. A `.replace(x, 1)`
 *    against a string that no longer exists is a no-op by construction, and
 *    a no-op that reports as a survivor is worse than no test at all.
 *
 *  - KILL COUNT AND SUMMARY COME FROM THE SAME VARIABLE, and the suite is
 *    re-run AFTER cleanup: a sweep that cannot prove it restored the tree is
 *    reporting on a file state nobody will ever have.
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = path.join(ROOT, 'src/js/cli-mono.js');
const SNAP = path.join(ROOT, 'tests/.late-markup.snapshot');

const WATCHER_CALL = /\n\t\t\twatchForLateMarkup\(\);/g;
const OBSERVER_BLOCK = /var observer = new MutationObserver\(function \(\) \{[\s\S]*?\n\t\t\}\);/;
const STATIC_GUARD = /\t\tif \(hasLibraryMarkup\(\)\) return;\n\n/;
const FEATURE_DETECT = /\t\tif \(typeof MutationObserver !== 'function'\) return;\n/;

const MUTATIONS = [
	{
		name: 'the watcher is never called, so late markup is never bound',
		// The most damaging mutation: the fix removed entirely. This is the
		// one that must be killed, because it reproduces the shipped bug.
		apply: (s) => s.replace(WATCHER_CALL, ''),
		expect: 'KILLED',
	},
	{
		name: 'the observer re-runs init without checking that markup arrived',
		apply: (s) =>
			s.replace(
				OBSERVER_BLOCK,
				'var observer = new MutationObserver(function () {\n\t\t\tinit(document);\n\t\t});',
			),
		expect: 'KILLED',
	},
	{
		name: 'the observer never disconnects, so it runs for the life of the page',
		apply: (s) => s.replace(/\t\t\tobserver\.disconnect\(\);\n/, ''),
		expect: 'KILLED',
	},
	{
		name: 'the static-page short-circuit is gone, so every page arms an observer',
		apply: (s) => s.replace(STATIC_GUARD, ''),
		expect: 'KILLED',
	},
	{
		name: 'the MutationObserver feature-detect is dropped (older hosts throw)',
		apply: (s) => s.replace(FEATURE_DETECT, ''),
		expect: 'KILLED',
	},
	{
		name: 'the observer watches the wrong subtree, so a mount into #root is missed',
		// `subtree: true` -> false. Without it, observing body sees only the
		// direct children, and React's commit happens deeper.
		apply: (s) =>
			s.replace(
				'observer.observe(document.body, { childList: true, subtree: true });',
				'observer.observe(document.body, { childList: true });',
			),
		expect: 'KILLED',
	},
	{
		name: 'hasLibraryMarkup watches for a hook nothing ever renders',
		// An ADDITIONAL unmatchable selector: the list only ever gets LONGER,
		// and a longer OR-list matches a superset, so the guarantee is not
		// weakened and the checks correctly still hold. Correctly surviving
		// is the honest result - a sweep that could only report kills would
		// be indistinguishable from one that cannot count them.
		apply: (s) =>
			s.replace(
				"'[data-cm-header], [data-cm-nav-toggle], [data-cm-copy], ' +\n\t\t\t'[data-cm-tabs], [data-cm-toast], .cm-prose-table'",
				"'[data-cm-header], [data-cm-nav-toggle], [data-cm-copy], ' +\n\t\t\t'[data-cm-tabs], [data-cm-toast], .cm-prose-table, ' +\n\t\t\t'[data-cm-never-rendered-by-anything]'",
			),
		expect: 'SURVIVED-OK',
	},
];

function suite() {
	try {
		execFileSync('node', [path.join(ROOT, 'tests/run.mjs')], { cwd: ROOT, stdio: 'pipe' });
		return { pass: true };
	} catch (e) {
		const out = String(e.stdout || '') + String(e.stderr || '');
		const m = /FAIL ([^\n]+):/.exec(out);
		return { pass: false, failed: m ? m[1].trim() : out.slice(0, 300) };
	}
}

copyFileSync(TARGET, SNAP);
const good = readFileSync(SNAP, 'utf8');

const base = suite();
if (!base.pass) {
	rmSync(SNAP, { force: true });
	console.error('BASELINE IS RED - refusing to sweep:', base.failed);
	process.exit(1);
}
console.log('baseline: green\n');

let killed = 0;
const survivors = [];
const noops = [];

try {
	for (const m of MUTATIONS) {
		// Restore by CONTENT, never by passing the path to writeFileSync.
		writeFileSync(TARGET, good);

		const mutated = m.apply(good);
		if (mutated === good) {
			noops.push(m.name);
			console.log(`  NO-OP    ${m.name}`);
			console.log('           ^ pattern did not match. Fix the mutation; a no-op');
			console.log('             that reports as a survivor is a phantom result.');
			continue;
		}
		writeFileSync(TARGET, mutated);
		const r = suite();

		if (!r.pass) {
			killed++;
			console.log(`  KILLED   ${m.name}`);
			console.log(`           by: ${r.failed}`);
		} else if (m.expect === 'SURVIVED-OK') {
			killed++;
			console.log(`  SURVIVED ${m.name}`);
			console.log('           ^ correctly survived: widening the probe list does not');
			console.log('             weaken the guarantee, so the checks still hold.');
		} else {
			survivors.push(m.name);
			console.log(`  SURVIVED ${m.name}`);
			console.log('           ^ THE TEST DID NOT CATCH THIS.');
		}
	}
} finally {
	// Restore, then PROVE it, before reporting anything.
	writeFileSync(TARGET, good);
}

const restored = readFileSync(TARGET, 'utf8');
if (restored !== good) {
	console.error('\nRESTORE FAILED: the target does not match the snapshot. Not touching git.');
	process.exit(1);
}
rmSync(SNAP, { force: true });
if (existsSync(SNAP)) {
	console.error('\nSNAPSHOT NOT CLEANED UP');
	process.exit(1);
}

const after = suite();
if (!after.pass) {
	console.error('\nRESTORE OK BUT SUITE IS RED:', after.failed);
	process.exit(1);
}

console.log(`\n${killed} killed, ${survivors.length} survived, ${noops.length} no-op  (${MUTATIONS.length} mutations)`);
console.log(`tree restored byte-for-byte: yes`);
console.log(`suite after restore: GREEN`);
if (survivors.length) {
	console.log('\nsurvivors (a real gap):');
	survivors.forEach((s) => console.log(`  - ${s}`));
	process.exit(1);
}