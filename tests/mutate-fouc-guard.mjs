#!/usr/bin/env node
/**
 * mutation: the FOUC guard
 *
 * Two checks shipped with the guard rewrite:
 *
 *   1. the FOUC guard finds a theme saved under a LEGACY key
 *   2. the FOUC guard prefers the project key over the legacy ones
 *
 * Both are behavioural: they evaluate the emitted snippet in a throwaway
 * <head>-shaped context and assert what it writes to documentElement. The
 * first mutation below is the ORIGINAL BUG, reverted verbatim -- the guard
 * baking its key list in at build time, so a legacy-only theme is missed.
 * A test that has only been broken in a small way has not been tested.
 *
 * Note the suite reads src/js/cli-mono.js directly, so no rebuild is
 * needed; the restore MUST run even if the suite throws, or a crash
 * leaves the working tree holding a mutant and the next commit ships it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const RUNTIME = 'src/js/cli-mono.js';

const CONSUMERS = {
	'dev-blog': { dir: '/root/projects/dev-blog', guard: 'src/components/Header.astro' },
	'oem-portfolio': { dir: '/root/projects/oem-portfolio', guard: 'src/components/Head.astro' },
};

// The guard as it was before this cycle: one hardcoded key, no loop.
const OLD_GUARD = `<script is:inline>
	(function () {
		try {
			var s = localStorage.getItem('cm-theme');
			if (s === 'light') document.documentElement.setAttribute('data-theme', 'light');
		} catch (e) {}
	})();
</script>`;

const MUTATIONS = [
	{
		// THE REGRESSION. Restore the old implementation exactly: build the
		// key list at build time from module state. The guard is evaluated
		// in <head> before the bundle runs, so LEGACY_KEYS is [] and a
		// legacy-only theme is invisible -> a black flash.
		name: 'the guard bakes its key list in at build time again',
		file: RUNTIME,
		from: /\.concat\(\(g\("data-cm-theme-legacy"\)\|\|""\)\.split\(","\)\);/,
		to: '.concat("");',
		expectFail: 'the FOUC guard finds a theme saved under a LEGACY key',
	},
	{
		// The order guarantee. Appending the CURRENT key last instead of
		// first lets a stale legacy 'light' override a live 'dark'.
		// The replacement spans the source's string-concatenation seams --
		// a single-line edit would re-append the project key rather than
		// move it, which is an EQUIVALENT mutant and proves nothing.
		name: 'the guard checks the legacy keys before the project key',
		file: RUNTIME,
		from: /'var k=\(g\("data-cm-theme-key"\)\|\|' \+\s*JSON\.stringify\(storageKey \|\| 'cm-theme'\) \+\s*'\)\.split\(","\)\.concat\(\(g\("data-cm-theme-legacy"\)\|\|""\)\.split\(","\)\);'/,
		to: '\'var k=(g("data-cm-theme-legacy")||"").split(",").concat((g("data-cm-theme-key")||"cm-theme").split(","));\'',
		expectFail: 'the FOUC guard prefers the project key over the legacy ones',
	},
	{
		// A guard that ignores the key <html> declares is the drift this
		// rewrite exists to remove: it finds the theme under a different
		// key than the runtime later uses. Caught by the ORDER check,
		// because the stale legacy 'light' then wins.
		name: 'the guard ignores the key declared on <html>',
		file: RUNTIME,
		from: /var k=\(g\("data-cm-theme-key"\)\|\|/,
		to: 'var k=("x"||',
		expectFail: 'the FOUC guard prefers the project key over the legacy ones',
	},
	{
		// The library's own Head.astro, reverted to the hand-typed guard.
		name: 'the library <Head> guard is hand-typed with one hardcoded key',
		file: 'src/astro/Head.astro',
		replaceScript: OLD_GUARD,
		expectFail: 'the library <Head> guard reads the same keys the runtime does',
	},
	{
		// A CONSUMER's guard dropping a key its own <html> declares. This
		// is the live drift the consistency check exists for, so it must be
		// proven to fire against a real project file.
		name: "dev-blog's guard stops searching its own oem-log-theme key",
		consumer: 'dev-blog',
		from: /var keys = \['oem-log-theme', 'cm-theme'\];/,
		to: "var keys = ['cm-theme'];",
		expectFail: 'every shipped FOUC guard covers the keys its own <html> declares',
	},
];

// Resolve a mutation to an absolute path. A `consumer` mutation edits a
// real project file outside this repo, which is why the restore below is
// not optional: a crash would leave a consumer holding a mutant.
const target = (m) =>
	m.consumer
		? join(CONSUMERS[m.consumer].dir, CONSUMERS[m.consumer].guard)
		: p(m.file);

const apply = (original, m) => {
	if (m.replaceScript) {
		const start = original.indexOf('<script is:inline');
		const end = original.indexOf('</script>', start) + '</script>'.length;
		if (start === -1 || end < start) return null;
		return original.slice(0, start) + m.replaceScript + original.slice(end);
	}
	if (!original.match(m.from)) return null;
	return original.replace(m.from, m.to);
};

const runSuite = () =>
	spawnSync(process.execPath, [p('tests/run.mjs')], { encoding: 'utf8', cwd: root });

let caught = 0;
const noops = [];
const unexpected = [];

const DRY = process.argv.includes('--dry');
if (DRY) {
	console.log(`mutation dry-run: FOUC guard (${MUTATIONS.length} mutations)\n`);
	for (const m of MUTATIONS) {
		const original = readFileSync(target(m), 'utf8');
		const hit = apply(original, m);
		console.log(hit && hit !== original ? `  match  ${m.name}` : `  NO-OP  ${m.name}`);
		if (!hit || hit === original) noops.push(m.name);
	}
	console.log(`\n${MUTATIONS.length - noops.length} match, ${noops.length} no-op`);
	process.exit(noops.length ? 1 : 0);
}

console.log(`mutation: FOUC guard (${MUTATIONS.length} mutations)\n`);

for (const m of MUTATIONS) {
	const file = target(m);
	const original = readFileSync(file, 'utf8');
	const mutated = apply(original, m);
	if (!mutated || mutated === original) {
		console.log(`  NO-OP  ${m.name}`);
		noops.push(m.name);
		continue;
	}
	writeFileSync(file, mutated);

	let out = '';
	try {
		out = runSuite().stdout || '';
	} finally {
		writeFileSync(file, original);
	}

	// Match the CHECK NAME, not a message substring: a reworded message
	// silently turns a caught mutation into a MISSED.
	const failed = out.includes('FAIL  ' + m.expectFail) || out.includes('FAIL  ' + m.expectFail + ':');
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
process.exit(noops.length || unexpected.length ? 1 : 0);
