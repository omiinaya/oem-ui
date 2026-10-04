#!/usr/bin/env node
/**
 * Mutation catalog for the prose-measure / inline-link pair in
 * src/styles/components.css, and their showcase section.
 *
 * This harness inherits every rule in tests/mutate-current.mjs, which
 * were each learned the hard way in this repo:
 *
 *   - SNAPSHOT immediately before mutating and restore with `cp`.
 *     NEVER `git checkout -- <file>`: components.css is shared with any
 *     other cycle of this job, and `git checkout` reverts the whole
 *     cycle's work rather than the mutation. Measured: a cleanup step
 *     using it wiped an unrelated components.css fix.
 *   - A pattern that does not occur in the source is a NO-OP, and a no-op
 *     filed as a survivor is worse than no test at all, so every mutation
 *     ASSERTS its own pattern matched before the result is counted.
 *   - A pattern occurring MORE than once is also an error, with the
 *     opposite sign: `.replace(x, 1)` against a duplicated selector edits
 *     the wrong rule and reports a kill against code never exercised.
 *   - REBUILD before the suite whenever the mutation touches the showcase,
 *     because the reachability checks read dist/index.html. An un-rebuilt
 *     mutation is invisible and the sweep manufactures confidence.
 *   - A non-zero BUILD exit is the strongest kill available, not a no-op.
 *   - Kill count and the summary line derive from the same variable.
 *
 * The whole point of the inline-link mutations: `display: inline` and a
 * missing `min-height` are the SAME bug, because min-height does nothing
 * on an inline box. Each one alone passes a test that checks the other
 * half. The catalog kills each independently.
 *
 *   node tests/mutate-prose-measure.mjs [--verbose]
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const CSS = 'src/styles/components.css';
const PAGE = 'src/pages/index.astro';
const SUMMARY = /^\d+ passed, \d+ failed$/m;

const MEASURE_RULE = '.cm-prose-measure { max-width: var(--measure); }';
const FIRST_CHILD = '.cm-prose-measure > :first-child { margin-top: 0; }';
const INLINE_RULE = [
	'.cm-inline-link {',
	'\tdisplay: inline-block;',
	'\tmin-height: var(--tap);',
	'\tpadding: var(--space-3) 0;',
	'\tmargin: calc(var(--space-3) * -1) 0;',
	'}',
].join('\n');

/* [description, file, [[old, new]], needsRebuild] */
const MUTATIONS = [
	[
		'components.css: .cm-prose-measure hardcodes 68ch instead of taking the token',
		CSS,
		[[MEASURE_RULE, '.cm-prose-measure { max-width: 68ch; }']],
		false,
	],
	[
		'components.css: .cm-prose-measure reverts to the page width (the bug it fixed)',
		CSS,
		[[MEASURE_RULE, '.cm-prose-measure { max-width: none; }']],
		false,
	],
	[
		'components.css: .cm-prose-measure is duplicated, so the effective width is source order',
		CSS,
		[[MEASURE_RULE, `${MEASURE_RULE}\n.cm-prose-measure { max-width: 90ch; }`]],
		false,
	],
	[
		'components.css: the first-child margin reset is deleted (40px of dead space)',
		CSS,
		[[FIRST_CHILD, '/* removed */']],
		false,
	],
	[
		'components.css: .cm-inline-link goes back to `display: inline`, so min-height is inert',
		CSS,
		[[INLINE_RULE, INLINE_RULE.replace('display: inline-block;', 'display: inline;')]],
		false,
	],
	[
		'components.css: .cm-inline-link loses its tap floor entirely',
		CSS,
		[[INLINE_RULE, INLINE_RULE.replace('\tmin-height: var(--tap);\n', '')]],
		false,
	],
	[
		'components.css: .cm-inline-link drops the negative margin that holds the line rhythm',
		CSS,
		[[INLINE_RULE, INLINE_RULE.replace('margin: calc(var(--space-3) * -1) 0;', 'margin: 0;')]],
		false,
	],
	[
		'components.css: .cm-inline-link takes a literal 44px instead of the token',
		CSS,
		[[INLINE_RULE, INLINE_RULE.replace('min-height: var(--tap);', 'min-height: 44px;')]],
		false,
	],
	[
		'the showcase stops rendering .cm-prose-measure (dead surface)',
		PAGE,
		[['<div class="cm-prose cm-prose-measure">', '<div class="cm-prose">']],
		true,
	],
	[
		'the showcase stops rendering .cm-inline-link (dead surface)',
		PAGE,
		[['<a href="#prosetap" class="cm-inline-link">', '<a href="#prosetap">']],
		true,
	],
	[
		'the showcase drops the whole prosetap section',
		PAGE,
		[['<section id="prosetap"', '<section id="prosetap-removed"']],
		true,
	],
];

function apply(file, pairs) {
	const full = join(ROOT, file);
	const src = readFileSync(full, 'utf8');
	let out = src;
	for (const [old, next] of pairs) {
		const n = out.split(old).length - 1;
		if (n === 0) {
			return [false, `pattern absent: ${JSON.stringify(old.slice(0, 70))}`];
		}
		if (n > 1) {
			return [false, `pattern occurs ${n}x, expected 1x: ${JSON.stringify(old.slice(0, 50))}`];
		}
		out = out.replace(old, next);
	}
	writeFileSync(full, out);
	return [true, null];
}

function suite() {
	try {
		const r = execSync('node tests/run.mjs', { cwd: ROOT, encoding: 'utf8' });
		const m = SUMMARY.exec(r);
		if (!m) return [null, r];
		return [Number(m[0].match(/(\d+) failed/)[1]), r];
	} catch (e) {
		const r = `${e.stdout || ''}`;
		const m = SUMMARY.exec(r);
		if (!m) return [null, r];
		return [Number(m[0].match(/(\d+) failed/)[1]), r];
	}
}

let killed = 0;
let survived = 0;
let errors = 0;
const snaps = [];

console.log('mutation sweep: prose measure + inline link');
try {
	for (const [desc, file, pairs, rebuild] of MUTATIONS) {
		const full = join(ROOT, file);
		const snap = `${full}.mutate-snap`;
		copyFileSync(full, snap);
		snaps.push([snap, full]);
		let ok;
		let why;
		try {
			[ok, why] = apply(file, pairs);
		} catch (e) {
			ok = false;
			why = String(e.message).split('\n')[0];
		}
		if (!ok) {
			console.log(`  NO-OP     ${desc}  <-- ${why}; fix the catalog, not the test`);
			errors += 1;
			copyFileSync(snap, full);
			continue;
		}
		if (rebuild) {
			try {
				execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
			} catch {
				console.log(`  KILLED    ${desc}  [build failure - the strongest kill]`);
				killed += 1;
				copyFileSync(snap, full);
				continue;
			}
		}
		const [failed, out] = suite();
		if (failed === null) {
			console.log(`  HARNESS-ERR ${desc}  (the suite produced no summary line)`);
			errors += 1;
			copyFileSync(snap, full);
			continue;
		}
		if (failed > 0) {
			console.log(`  KILLED    ${desc}`);
			killed += 1;
			if (VERBOSE) {
				for (const line of out.split('\n')) {
					if (line.trim().startsWith('FAIL')) console.log(`           ${line.trim()}`);
				}
			}
		} else {
			console.log(`  SURVIVED  ${desc}  <-- the suite cannot see this`);
			survived += 1;
		}
		copyFileSync(snap, full);
	}
} finally {
	for (const [snap, full] of snaps) {
		try {
			copyFileSync(snap, full);
			unlinkSync(snap);
		} catch {}
	}
	try {
		execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
	} catch {}
}

console.log();
console.log(`${killed} killed, ${survived} survived, ${errors} harness errors`);
process.exit(survived || errors ? 1 : 0);