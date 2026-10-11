#!/usr/bin/env node
/**
 * Mutation sweep for the scoped-prose contract.
 *
 * Every check added by the scoped-prose cycle is a GUESS until it has been
 * shown to FAIL. This applies one mutation at a time, runs the suite, and
 * requires the suite to go red - then restores the file from an in-process
 * copy and byte-verifies the restore.
 *
 * THE RECOVERY COPY LIVES IN THIS PROCESS, not on disk. A 153-mutant run in
 * this repo once died at #139 because its only snapshot was a cp into the
 * scratch directory, which the Hermes scratch pruner deleted mid-run: the
 * restore in `finally` then threw FileNotFoundError with the mutation still
 * applied. Bytes held in the process cannot be pruned by anything.
 *
 * PATTERNS ARE PRE-FLIGHTED. A mutation whose pattern matches nothing is not
 * a survivor and not a kill - it is a HOLE reported as proof (two mutants in
 * an earlier sweep returned `SKIPPED (pattern absent)` and shrank the run
 * while looking green). A miss here exits non-zero before anything mutates.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'src/styles/base.css';
const GEN = 'scripts/make-scoped-entry.mjs';

const MUTATIONS = [
	{
		name: 'the generator stops extracting base.css and retypes nothing',
		file: GEN,
		from: 'lines.push(scopedElementDefaults());',
		to: '/* the extraction is gone */',
		expect: 'scoped prose: the generator EXTRACTS the block',
	},
	{
		name: 'the prose block loses its banner (slice has no start)',
		file: BASE,
		from: '/* ============ prose typography',
		to: '/* ============ prose type',
		expect: 'scoped prose: base.css carries the block',
	},
	{
		name: 'the descendant pair wraps its ELEMENT in :where()',
		file: BASE,
		from: ':where([data-cm-theme]) pre > code {\n	all: unset;',
		to: ':where([data-cm-theme]) pre > :where(code) {\n	all: unset;',
		expect: 'scoped prose: :where() preserves the specificity',
	},
	{
		name: 'a bare :where([data-cm-theme]) rule is reintroduced (0,0,0)',
		file: BASE,
		from: ':where([data-cm-theme]) th {\n\tbackground: var(--bg-3);',
		to: ':where([data-cm-theme]) {\n\tfont-size: var(--text);\n}\n:where([data-cm-theme]) th {\n\tbackground: var(--bg-3);',
		expect: 'scoped prose: :where() preserves the specificity',
	},
	{
		name: 'the token mirror loses its ancestor (0,0,0, loses to the theme block)',
		file: GEN,
		from: "'\	:where([data-cm-theme]) [data-cm-theme],\\n' +\n		'\	:where([data-cm-theme])[data-cm-theme] {\\n' +",
		to: "'\	:where([data-cm-theme]) {\\n' +",
		expect: 'scoped prose: :where() preserves the specificity',
	},
	{
		name: 'the responsive step is emitted BEFORE the theme block that ties it',
		file: GEN,
		from: "\tlines.push('@import \"' + relComponents + '\";');\n\tlines.push('');\n\tlines.push('/* ---- the theme-INDEPENDENT scale, scoped ----');",
		to: "\tlines.push('@import \"' + relComponents + '\";');\n\tlines.push('');\n\tlines.push(scopedResponsiveTokens());\n\tlines.push('');\n\tlines.push('/* ---- the theme-INDEPENDENT scale, scoped ----');",
		expect: 'scoped prose: the responsive step is emitted AFTER',
	},
	{
		name: 'the prose link loses its same-element twin',
		file: BASE,
		from: ':where([data-cm-theme]) .cm-prose a,\n:where([data-cm-theme]).cm-prose a {',
		to: ':where([data-cm-theme]) .cm-prose a {',
		expect: 'scoped prose: the prose link twin matches BOTH',
	},
	{
		name: 'the prose link twin declares underline instead of matching base.css',
		file: BASE,
		from: ':where([data-cm-theme]).cm-prose a {\n	color: var(--ink-dim);\n	text-decoration: none;',
		to: ':where([data-cm-theme]).cm-prose a {\n	color: var(--ink-dim);\n	text-decoration: underline;',
		expect: 'scoped prose: the prose link twin matches BOTH',
	},
	{
		name: 'a mirrored rule loses its [data-cm-theme] gate',
		file: BASE,
		from: ':where([data-cm-theme]) blockquote {',
		to: 'blockquote {',
		expect: 'scoped prose: the mirror does not leak',
	},
	{
		name: 'the prose link reaches a bare element in the host app',
		file: BASE,
		from: ':where([data-cm-theme]) .cm-prose a,',
		to: ':where([data-cm-theme]) a,',
		expect: 'scoped prose: the mirror does not leak',
	},
];

// ---- pre-flight -------------------------------------------------------
// Validate every pattern BEFORE mutating anything. A miss is a hole in the
// sweep, not a passing test, and it has to be loud.
const originals = new Map();
let broken = 0;
for (const m of MUTATIONS) {
	if (!originals.has(m.file)) originals.set(m.file, readFileSync(join(ROOT, m.file), 'utf8'));
	const src = originals.get(m.file);
	const hits = src.split(m.from).length - 1;
	if (hits !== 1) {
		console.log(`  BROKEN MUTATION  ${m.name}`);
		console.log(`          the pattern matches ${hits} time(s) in ${m.file} (expected exactly 1)`);
		broken++;
	}
	if (m.to === m.from) {
		console.log(`  BROKEN MUTATION  ${m.name} - from === to, a no-op`);
		broken++;
	}
}
if (broken) {
	console.log(`\n${broken} broken mutant(s). Refusing to run: a mutant that matches nothing SHRINKS the sweep and reads as a pass.`);
	process.exit(2);
}

// The baseline MUST be green, or every "kill" below is meaningless.
{
	const r = spawnSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
	const pass = /(\d+) passed, (\d+) failed/.exec(r.stdout);
	if (!pass || pass[2] !== '0') {
		console.log(`the suite is not green at HEAD (${pass ? pass[0] : 'no summary'}). Fix that first - a mutant cannot be shown to break a suite that is already broken.`);
		process.exit(2);
	}
	console.log(`baseline: ${pass[0]}\n`);
}

let killed = 0;
const survivors = [];
for (const m of MUTATIONS) {
	const path = join(ROOT, m.file);
	const orig = originals.get(m.file);
	writeFileSync(path, orig.replace(m.from, m.to));
	const r = spawnSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
	const fails = (r.stdout.match(/^  FAIL .*$/gm) || []).map((s) => s.trim());
	// Which check caught it. The named check is the strongest evidence; a kill
	// by some OTHER check is reported honestly rather than counted as proof
	// that the intended check works.
	const named = fails.some((f) => f.includes(m.expect));
	// Byte-verified restore from the in-process copy.
	writeFileSync(path, orig);
	if (readFileSync(path, 'utf8') !== orig) {
		console.log(`  RESTORE FAILED  ${m.name} - the working tree is not byte-identical to the original`);
		process.exit(3);
	}
	if (r.status !== 0) {
		killed++;
		console.log(`  KILLED  ${m.name}`);
		console.log(`          ${named ? 'by' : 'NOT by the intended check - caught instead by'}: ${m.expect}`);
		if (!named) console.log(`          actual: ${fails.slice(0, 3).join(' | ') || '(build failure, not an assertion)'}`);
	} else {
		survivors.push(m.name);
		console.log(`  SURVIVED  ${m.name}  <-- ${m.expect} cannot see this`);
	}
}

console.log(`\n${killed}/${MUTATIONS.length} killed, ${survivors.length} survived`);
if (survivors.length) {
	for (const s of survivors) console.log(`  survivor: ${s}`);
	process.exit(1);
}
