#!/usr/bin/env node
/**
 * mutation: variants / reachability
 *
 * Three new contract checks shipped with the `variants` showcase section:
 *
 *   1. every class the library defines is rendered somewhere on the page
 *   2. a variant is only called demonstrated if it differs from its base
 *   3. .cm-tag survives a word too long for its column
 *
 * Each is a guess until it has been made to fail. This harness breaks the
 * exact thing each check guards, runs the suite, and reports which check
 * fired. A pattern that no longer matches the source is a NO-OP - a
 * failure of THIS file, never a pass.
 *
 * Note every mutation here is in a SOURCE file that the checks read from
 * the BUILT page, so each one rebuilds before running the suite. Skipping
 * the rebuild is how a caught mutation gets reported as MISSED.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);

const MUTATIONS = [
	{
		// The reachability check's whole point. Removing a rendered tag
		// specimen must name the class as dead.
		name: 'the long-tag specimen is removed from the showcase',
		file: 'src/pages/index.astro',
		from: /<span class="cm-tag">infrastructureascodeverylong<\/span>/,
		to: '<span class="cm-tag">linux</span>',
		expectFail: '.cm-tag survives a word too long for its column',
	},
	{
		// Proves the reachability test reads the BUILT page and not the
		// source. `cm-media` appears in both; deleting the markup from the
		// source and rebuilding must un-render it.
		name: 'the media specimen is removed from the showcase',
		file: 'src/pages/index.astro',
		from: /<figure class="cm-media"[\s\S]*?<\/figure>/,
		to: '',
		expectFail: 'every class the library defines is rendered somewhere on the page',
	},
	{
		// The header's extra link. oem-portfolio renders this class on a
		// live site; the showcase never did, so the rule was unreachable
		// here. Drop the prop and it goes dark again.
		name: 'the header loses its extra link (cm-header__icon-link)',
		file: 'src/pages/index.astro',
		from: /\t\textraLinks=\{\[\{ href: 'https:\/\/github\.com\/omiinaya\/oem-ui', label: 'github' \}\]\}\n/,
		to: '',
		expectFail: 'every class the library defines is rendered somewhere on the page',
	},
	{
		// A toast variant rendered only by the runtime never appears in
		// the served HTML, so a static specimen is the only way to see it.
		name: 'the static toast --warn specimen is removed',
		file: 'src/pages/index.astro',
		from: /<div class="cm-toast cm-toast--warn">[\s\S]*?<\/div>\n\t\t\t\t\t\t<\/span>/,
		to: '</span>',
		expectFail: 'every class the library defines is rendered somewhere on the page',
	},
	{
		// THE check this whole section exists for. Emptying the accent
		// tag's rule body leaves the class defined, rendered, and
		// identical to its base. Only a difference test can see it.
		name: 'the accent tag variant is emptied into its own base',
		file: 'src/styles/components.css',
		from: '.cm-tag--accent { border-color: var(--accent-dim); color: var(--ink); }',
		to: '.cm-tag--accent { }',
		expectFail: 'a variant is only called demonstrated if it differs from its base',
	},
	{
		// The --ok glyph is the ONLY thing separating an ok status from a
		// warn one. Remove the content and the variant renders blank.
		name: 'the ok status glyph is emptied',
		file: 'src/styles/components.css',
		from: ".cm-status--ok .cm-status__value::before { content: '\\25cf\\00a0'; color: var(--ink-dim); }",
		to: ".cm-status--ok .cm-status__value::before { }",
		expectFail: 'a variant is only called demonstrated if it differs from its base',
	},
	{
		// The measured defect. Without break-word a long word overflows
		// its column; the check must fire on the loss of any one of the
		// three declarations, so this drops just the wrap.
		name: 'the long-tag fix loses overflow-wrap',
		file: 'src/styles/components.css',
		from: '\toverflow-wrap: break-word;\n}',
		to: '}',
		expectFail: '.cm-tag survives a word too long for its column',
	},
	{
		name: 'the long-tag fix loses min-width: 0',
		file: 'src/styles/components.css',
		from: '\tmax-width: 100%;\n\tmin-width: 0;\n\toverflow-wrap: break-word;',
		to: '\tmax-width: 100%;\n\toverflow-wrap: break-word;',
		expectFail: '.cm-tag survives a word too long for its column',
	},
	{
		// The `anywhere` trap: it satisfies the overflow question by
		// breaking min-content sizing, which a sibling check bans.
		name: 'the tag is switched to overflow-wrap: anywhere',
		file: 'src/styles/components.css',
		from: '\toverflow-wrap: break-word;\n}',
		to: '\toverflow-wrap: anywhere;\n}',
		expectFail: 'wrapping never breaks an identifier in half',
	},
	{
		// The base title hook. `.cm-head h1, .cm-head .cm-head__title` is
		// a PAIR; deleting the second selector makes the class dead.
		name: 'the head__title selector is removed from the h1 pair',
		file: 'src/styles/components.css',
		from: '.cm-head h1,\n.cm-head .cm-head__title {',
		to: '.cm-head h1 {',
		expectFail: 'every class the library defines is rendered somewhere on the page',
	},
];

const runSuite = () =>
	spawnSync(process.execPath, [p('tests/run.mjs')], { encoding: 'utf8', cwd: root });

// The reachability test reads dist/index.html, so every mutation needs a
// rebuild. A boolean-only return made the caller short-circuit on a build
// failure and never run the suite, reporting a caught mutation as MISSED.
const rebuild = () => {
	const r = spawnSync('npx', ['astro', 'build'], { encoding: 'utf8', cwd: root, shell: true });
	return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

let caught = 0;
const noops = [];
const unexpected = [];

// --dry reports which patterns match the CURRENT source and exits. The only
// parser of the mutation list lives here; a second implementation in another
// file silently disagrees about what a pattern means.
const DRY = process.argv.includes('--dry');
if (DRY) {
	console.log(`mutation dry-run: variants / reachability (${MUTATIONS.length} mutations)\n`);
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

console.log(`mutation: variants / reachability (${MUTATIONS.length} mutations)\n`);

for (const m of MUTATIONS) {
	const file = p(m.file);
	const original = readFileSync(file, 'utf8');

	const re = m.from instanceof RegExp
		? m.from
		: new RegExp(m.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\n/g, '\\n'), 'g');
	const match = original.match(re);
	if (!match) {
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

	// The restore MUST run even if the build or the suite throws, or a
	// crash leaves the working tree holding a mutant and the next commit
	// ships it. This has happened in this repo before.
	let out = '';
	let built = { ok: false, out: '' };
	try {
		built = rebuild();
		out = runSuite().stdout || '';
		if (!built.ok && !/FAIL  /.test(out)) {
			out += '\nBUILD FAILED\n' + (built.out || '');
		}
	} finally {
		writeFileSync(file, original);
		rebuild();
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
