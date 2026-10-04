#!/usr/bin/env node
/**
 * Mutation catalog for src/astro/current.ts - the shared current-page matcher.
 *
 * The lesson this harness encodes, from a sibling sweep in this repo:
 *
 *   - SNAPSHOT each file immediately BEFORE mutating it and restore with
 *     `cp`. NEVER `git checkout -- <file>`: current.ts is a file another
 *     cycle of this same job may be editing, and `git checkout` reverts the
 *     whole cycle's work, not just the mutation. Measured here before this
 *     file existed: a cleanup step that used `git checkout` wiped a
 *     components.css fix that had nothing to do with the sweep.
 *   - A pattern that does not occur in the source is a NO-OP, and a no-op
 *     that is filed as a survivor is worse than no test at all. Every
 *     mutation below ASSERTS its own pattern matched before it is counted.
 *   - A pattern that occurs MORE times than expected is also an error, for
 *     the same reason with the opposite sign: `.replace(x, 1)` against a
 *     selector that appears twice edits the wrong one and reports a kill
 *     against code that was never exercised.
 *   - REBUILD before the suite when the mutation touches page markup: the
 *     reachability checks read dist/index.html, so an un-rebuilt mutation
 *     is invisible and the sweep manufactures confidence.
 *   - Kill count and the summary line come from the same variable.
 *
 *     node tests/mutate-current.mjs [--verbose]
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const TARGET = 'src/astro/current.ts';
const SUMMARY = /^\d+ passed, \d+ failed$/m;

/* Each mutation: [description, file, [[old, new]], needsRebuild] */
const MUTATIONS = [
	[
		'current.ts: the fragment-only guard is deleted',
		TARGET,
		[["\tif (href.trimStart().startsWith('#')) return false;\n", '']],
		false,
	],
	[
		'current.ts: the fragment guard only tests href[0], so a leading space slips past it',
		TARGET,
		[["href.trimStart().startsWith('#')", "href.startsWith('#')"]],
		false,
	],
	[
		'current.ts: the fragment guard is moved AFTER normalise, which strips the fragment it tests',
		TARGET,
		[
			[
				"\tif (href.trimStart().startsWith('#')) return false;\n\n\tconst there = normalise(href, base);",
				"\tconst there = normalise(href, base);\n\n\tif (href.trimStart().startsWith('#')) return false;",
			],
		],
		false,
	],
	[
		'current.ts: normalise stops dropping the query string',
		TARGET,
		[[".split('#')[0].split('?')[0]", ".split('#')[0]"]],
		false,
	],
	[
		'current.ts: normalise stops dropping the fragment',
		TARGET,
		[[".split('#')[0].split('?')[0]", ".split('?')[0]"]],
		false,
	],
	[
		'current.ts: normalise stops rejecting an external href',
		TARGET,
		[["|| out.startsWith('//')", '']],
		false,
	],
	[
		'current.ts: normalise stops stripping the base prefix, so no link is current under a prefix',
		TARGET,
		[["if (base && out.startsWith(base)) out = out.slice(base.length);", '']],
		false,
	],
	[
		'current.ts: normalise stops trimming the trailing slash',
		TARGET,
		[["out = out.replace(/\\/+$/, '');", '']],
		false,
	],
	[
		'current.ts: normalise loses the leading-slash repair, so a stripped base never equals its path',
		TARGET,
		[["return out.startsWith('/') ? out : `/${out}`;", 'return out;']],
		false,
	],
	[
		'current.ts: matchSegment ignores its opt-in and every link lights on every child',
		TARGET,
		[
			[
				"there === here || (matchSegment && there !== '/' && here.startsWith(`${there}/`))",
				'there === here || (there !== \'/\' && here.startsWith(`${there}/`))',
			],
		],
		false,
	],
	[
		'current.ts: matchSegment drops its "/" guard, so the root link lights on EVERY path',
		TARGET,
		[
			[
				"(matchSegment && there !== '/' && here.startsWith(`${there}/`))",
				"(matchSegment && here.startsWith(`${there}/`))",
			],
		],
		false,
	],
	[
		'current.ts: a null (external) href is treated as a local path',
		TARGET,
		[['if (there === null || here === null) return false;', '']],
		false,
	],
	[
		'Header.astro stops routing the nav through the shared matcher',
		'src/astro/Header.astro',
		[["import { isCurrentPage } from './current';\n", '']],
		false,
	],
	[
		'HeaderLink.astro stops importing the shared matcher',
		'src/astro/HeaderLink.astro',
		[["import { isCurrentPage } from './current';\n", '']],
		false,
	],
	[
		'Header.astro emits aria-current from the raw `active` boolean again',
		'src/astro/Header.astro',
		[
			[
				"l.active !== undefined\n									? l.active\n									: isCurrentPage(l.href, currentPath, base, l.matchSegment)",
				'l.active === true',
			],
		],
		false,
	],
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

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
			return [
				false,
				`pattern occurs ${n}x, expected 1x: ${JSON.stringify(old.slice(0, 50))}`,
			];
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
		const [passed, failed] = m[0].match(/^(\d+) passed, (\d+) failed$/).slice(1).map(Number);
		return [failed, r];
	} catch (e) {
		// A non-zero exit still carries the summary in stdout.
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

console.log('mutation sweep: current.ts (the shared current-page matcher)');
try {
	for (const [desc, file, pairs, rebuild] of MUTATIONS) {
		const full = join(ROOT, file);
		const snap = `${full}.mutate-snap`;
		// snapshot IMMEDIATELY before mutating, per mutation - see the header
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
			console.log(out.trim().split('\n').slice(-6).map((l) => '           ' + l).join('\n'));
			errors += 1;
			copyFileSync(snap, full);
			continue;
		}
		if (failed > 0) {
			console.log(`  KILLED    ${desc}`);
			killed += 1;
			if (VERBOSE) {
				for (const line of out.split('\n')) {
					if (line.trim().startsWith('FAIL')) console.log('           ' + line.trim());
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
	// leave dist matching the restored source
	try {
		execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
	} catch {}
}

console.log();
console.log(`${killed} killed, ${survived} survived, ${errors} harness errors`);
process.exit(survived || errors ? 1 : 0);