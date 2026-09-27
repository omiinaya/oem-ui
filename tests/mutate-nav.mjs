#!/usr/bin/env node
/**
 * Mutation check for the "nav state" increment.
 *
 * A test you have not tried to break is a guess. Every mutation below
 * REVERTS a real fix, the suite must FAIL, and the source is restored.
 *
 * A pattern that no longer matches the source is reported as NO-OP and
 * counted as neither pass nor fail, because a no-op that looks like a pass
 * is worse than no test at all.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const MUTATIONS = [
	{
		name: 'Header drops the active prop',
		file: 'src/astro/Header.astro',
		from: /active\?:\s*boolean/,
		to: 'activeDisabled?: boolean',
		expectFail: 'Header can express the current page',
	},
	{
		name: 'Header stops rendering aria-current',
		file: 'src/astro/Header.astro',
		from: /aria-current=\{l\.active \? 'page' : undefined\}/,
		to: 'data-mutated={l.active}',
		expectFail: 'Header can express the current page',
	},
	{
		name: 'Header stops emitting data-cm-nav',
		file: 'src/astro/Header.astro',
		from: /data-cm-nav=\{anySpy \? true : undefined\}/,
		to: 'data-mutated',
		expectFail: 'Header hands its links to the runtime scroll-spy',
	},
	{
		name: 'Header stops emitting data-cm-spy',
		file: 'src/astro/Header.astro',
		from: /data-cm-spy=\{l\.spyId\}/,
		to: 'data-mutated={l.spyId}',
		expectFail: 'Header hands its links to the runtime scroll-spy',
	},
	{
		name: 'Header stops inferring the spy id from the href',
		file: 'src/astro/Header.astro',
		from: /l\.href\.startsWith\('#'\)/,
		to: "l.href.startsWith('@')",
		expectFail: 'Header hands its links to the runtime scroll-spy',
	},
	{
		name: 'Header hardcodes the spy class (conflating the two states)',
		file: 'src/astro/Header.astro',
		from: /aria-current=\{l\.active \? 'page' : undefined\}/,
		to: "class:list={['cm-header__link', l.active && 'is-active']}",
		expectFail: 'the spy and the current page are DIFFERENT attributes',
	},
	{
		name: 'the scroll-spy goes back to offsetTop',
		file: 'src/js/cli-mono.js',
		// Match the WHOLE measured expression, including the `top` binding, so
		// reverting it restores the original `s.el.offsetTop <= probe` compare
		// and the test that forbids it has something to catch.
		from: /var top = s\.el\.getBoundingClientRect\s*\n\s*\?\s*s\.el\.getBoundingClientRect\(\)\.top \+ window\.scrollY\s*\n\s*:\s*s\.el\.offsetTop;/,
		to: 'if (s.el.offsetTop <= probe) current = s;',
		expectFail: 'the scroll-spy measures from the document, not the nearest positioned parent',
	},
	{
		name: 'HeaderLink stops normalising the trailing slash',
		file: 'src/astro/HeaderLink.astro',
		// Written as a string, not a regex literal: the source is
		// `out.replace(/\/+$/, '')`, whose backslashes and `+` are metacharacters
		// in a regex and were silently failing to match.
		from: "out = out.replace(/\\/+$/, '');",
		to: '// mutated: no trailing-slash normalisation',
		expectFail: 'HeaderLink normalises before it compares',
	},
	{
		name: 'HeaderLink treats an external href as the current page',
		file: 'src/astro/HeaderLink.astro',
		from: "if (/^[a-z][a-z0-9+.-]*:/i.test(out) || out.startsWith('//')) return null;",
		to: '// mutated: no external check',
		expectFail: 'HeaderLink normalises before it compares',
	},
	{
		name: 'HeaderLink grows its own <style> block',
		file: 'src/astro/HeaderLink.astro',
		from: /<a\n/,
		to: '<style>[aria-current="page"]{color:red}</style>\n<a\n',
		expectFail: 'HeaderLink decides only the attribute; the library owns the look',
	},
	{
		name: 'HeaderLink loses its default nav class',
		file: 'src/astro/HeaderLink.astro',
		from: /class:\s*className = 'cm-header__link'/,
		to: "class: className = 'x'",
		expectFail: 'HeaderLink ships the default nav class so it cannot be unstyled',
	},
	{
		name: 'the showcase drops the current-page demo',
		file: 'src/pages/index.astro',
		// replaceAll: `aria-current="page"` appears three times, and a
		// single replace would only kill the first, leaving the test green.
		all: true,
		from: 'aria-current="page"',
		to: 'data-mutated',
		expectFail: 'the showcase demonstrates both nav states',
	},
	{
		name: 'the showcase drops the spy demo',
		file: 'src/pages/index.astro',
		all: true,
		from: 'class="cm-header__link is-active"',
		to: 'class="cm-header__link"',
		expectFail: 'the showcase demonstrates both nav states',
	},
	{
		name: 'the showcase stops using HeaderLink',
		file: 'src/pages/index.astro',
		all: true,
		from: '<HeaderLink',
		to: '<span',
		expectFail: 'the showcase demonstrates both nav states',
	},
	{
		name: 'the showcase stops importing HeaderLink',
		file: 'src/pages/index.astro',
		from: "import HeaderLink from '../astro/HeaderLink.astro';",
		to: '// mutated: not imported',
		expectFail: 'the showcase demonstrates both nav states',
	},
	{
		name: 'HeaderLink.astro is deleted while still listed as shipped',
		file: 'src/astro/HeaderLink.astro',
		delete: true,
		all: true,
		from: '',
		to: '',
		expectFail: 'ships src/astro/HeaderLink.astro',
	},
];

const run = () => spawnSync('node', [p('tests/run.mjs')], { encoding: 'utf8' });

let caught = 0, noop = 0, wrongTest = 0, miss = 0;
const problems = [];

for (const m of MUTATIONS) {
	const original = readFileSync(p(m.file), 'utf8');
	const apply = (s) => (m.all ? s.replaceAll(m.from, m.to) : s.replace(m.from, m.to));
	const mutated = apply(original);
	/* The mutation must actually CHANGE BYTES. A pattern that does not match
	   leaves the file identical, and `String.replace` reports that as success,
	   so a no-op mutation would otherwise be recorded as a real attempt and
	   then counted as a miss - a failure of the mutation script wearing the
	   costume of a weak test. Compare the bytes, not the regex. */
	if (!m.delete && mutated === original) {
		console.log(`NO-OP  ${m.name}  (pattern did not match ${m.file})`);
		noop++;
		problems.push(`NO-OP: ${m.name}`);
		continue;
	}
	if (m.delete) rmSync(p(m.file));
	else writeFileSync(p(m.file), mutated);
	const r = run();
	writeFileSync(p(m.file), original);

	const out = `${r.stdout}${r.stderr}`;
	const failed = out.includes('FAIL');
	const hit = out.includes(m.expectFail);
	if (failed && hit) {
		console.log(`caught ${m.name}`);
		caught++;
	} else if (failed) {
		console.log(`WRONG  ${m.name} — suite failed, but not by "${m.expectFail}"`);
		wrongTest++;
		problems.push(`WRONG TEST: ${m.name}`);
	} else {
		console.log(`MISSED ${m.name} — the suite stayed green`);
		miss++;
		problems.push(`MISSED: ${m.name}`);
	}
}

// The suite must be green again with everything restored.
const final = run();
const green = final.status === 0;
console.log(`\n${caught} caught, ${noop} no-op, ${wrongTest} wrong-test, ${MUTATIONS.length} total`);
console.log(green ? 'restored suite: GREEN' : 'restored suite: RED');
if (problems.length) {
	console.log('\nproblems:');
	for (const p of problems) console.log(`  ${p}`);
}
process.exit(green && !problems.length ? 0 : 1);
