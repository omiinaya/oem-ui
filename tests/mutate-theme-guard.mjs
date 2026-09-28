#!/usr/bin/env node
/**
 * mutation: the shared FOUC guard
 *
 * Three checks shipped with this cycle:
 *
 *   1. the shared guard carries no sequence that can close its own script tag
 *   2. the BUILT page ships a working guard, not a truncated comment
 *   3. the guard file is the one the installer and the drift checker ship
 *
 * The first two guard a bug that was actually SHIPPED. The guard file
 * documented its own usage by writing the closing tag literally in a
 * header comment; the HTML parser ended the <script> there, the build
 * stayed green, the source tests stayed green, and every visitor got a
 * page with NO GUARD AT ALL. A file that is all comment satisfies a
 * "no bad sequence" test on its own, so mutation 1 re-creates the exact
 * shape that shipped and mutation 2 deletes the body entirely.
 *
 * A pattern that no longer matches the source is reported as a NO-OP,
 * never as a pass. A mutation that cannot fire is a broken harness, and
 * the count reported must contain zero of them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const GUARD = 'src/js/cli-mono-theme-guard.js';
const INSTALL = 'scripts/install.sh';
const SYNC = 'scripts/check-design-sync.sh';

const original = new Map();
const snapshot = (f) => {
	if (!original.has(f)) original.set(f, readFileSync(p(f), 'utf8'));
};
const restore = () => {
	for (const [f, s] of original) writeFileSync(p(f), s);
	original.clear();
};

const run = () => {
	// The built-output check reads dist/, so a mutation has to rebuild to
	// be a fair trial: a test that read a stale dist would be testing
	// nothing. Build failures are a PASS for the mutation, because the
	// thing we broke is supposed to stop the build or the suite.
	const b = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
	if (b.status !== 0) return { caught: true, why: 'build failed' };
	const r = spawnSync('node', ['tests/run.mjs'], { cwd: root, encoding: 'utf8' });
	if (r.status === 0) return { caught: false, why: 'suite stayed GREEN' };
	const lines = (r.stdout + r.stderr).split('\n').filter((l) => l.startsWith('FAIL'));
	return {
		caught: true,
		why: lines.length ? `suite failed: ${lines.map((l) => l.slice(5).trim()).join(' | ')}` : 'suite exited non-zero',
	};
};

const MUTATIONS = [
	{
		name: 'the guard documents its usage by spelling the closing tag (the shipped bug)',
		files: [GUARD],
		apply: (s) =>
			s.replace(
				'Astro: import the file with a ?raw suffix',
				'Use it as: <script is:inline set:html={g} /> </script> Astro: import the file with a ?raw suffix',
			),
	},
	{
		name: 'the guard body is deleted, leaving only the comment',
		files: [GUARD],
		apply: (s) => s.slice(0, s.indexOf('(function')),
	},
	{
		name: 'the guard stops reading the legacy keys (the original black-flash bug)',
		files: [GUARD],
		apply: (s) =>
			s.replace(
				".concat((g('data-cm-theme-legacy') || '').split(','));",
				".split(',');",
			),
	},
	{
		name: 'the guard writes to storage, racing the runtime migration',
		files: [GUARD],
		apply: (s) =>
			s.replace(
				"if (s === 'light') d.setAttribute('data-theme', 'light');",
				"if (s === 'light') { d.setAttribute('data-theme', 'light'); localStorage.setItem(k[0], s); }",
			),
	},
	{
		name: 'the guard is dropped from the installer',
		files: [INSTALL],
		apply: (s) =>
			s
				.replace(/install -m 0644 "\$FROM\/src\/js\/cli-mono-theme-guard\.js" "\$GUARD_DEST"\n/, '')
				.replace(/say "guard          -> \$GUARD_DEST"\n/, ''),
	},
	{
		name: 'the guard is dropped from the drift checker',
		files: [SYNC],
		apply: (s) => s.replace(/\t"src\/js\/cli-mono-theme-guard\.js:src\/js\/cli-mono-theme-guard\.js"\n/, ''),
	},
];

let missed = 0;
let noop = 0;
const rows = [];

try {
	for (const m of MUTATIONS) {
		for (const f of m.files) snapshot(f);
		const before = m.files.map((f) => readFileSync(p(f), 'utf8'));
		const after = m.files.map((f, i) => m.apply(before[i]));
		if (after.every((s, i) => s === before[i])) {
			// The pattern did not match. Counting this as a pass is exactly
			// the harness failure the mutation suite exists to prevent.
			console.log(`NO-OP  ${m.name}`);
			console.log('        the pattern matched nothing, so this proves nothing');
			noop++;
			restore();
			continue;
		}
		m.files.forEach((f, i) => writeFileSync(p(f), after[i]));
		const res = run();
		restore();
		if (res.caught) {
			console.log(`caught  ${m.name}\n          ${res.why}`);
			rows.push(['caught', m.name]);
		} else {
			console.log(`MISSED  ${m.name}\n          ${res.why}`);
			rows.push(['MISSED', m.name]);
			missed++;
		}
	}
} finally {
	restore();
}

console.log(
	`\n${rows.length} mutations: ${rows.filter((r) => r[0] === 'caught').length} caught, ` +
		`${missed} missed, ${noop} no-op`,
);
process.exit(missed || noop ? 1 : 0);
