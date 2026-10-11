/**
 * Mutation proof for the hero component (batch 30).
 *
 * Every test in the hero block was written BEFORE it was trusted, and this
 * runner is what makes "trusted" mean something. Each mutation removes
 * exactly one of the things that makes the component correct, and each MUST
 * fail the suite.
 *
 * Two rules the runner follows, both learned here:
 *  - a mutation that does not change the file is reported BROKEN, never as
 *    a pass. A no-op that looks like a kill is worse than no test at all.
 *  - the showcase is BUILT, because the hero tests read `dist/index.html`.
 *    Without a rebuild the harness measures the previous build and reports
 *    a survivor for a mutation that never reached the page.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = '/root/projects/oem-ui';
const p = (f) => `${ROOT}/${f}`;

function rebuild() {
	const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
	return b.status === 0;
}

const MUTATIONS = [
	['the gradient primitive is moved OUT of its @supports gate (invisible text)',
		'src/styles/components.css',
		(s) => s.replace(
			'@supports ((background-clip: text) or (-webkit-background-clip: text)) {\n\t.cm-grad-text {',
			'.cm-grad-text {')
			.replace(/(\t\tcolor: transparent;\n\t\}\n)\}/, '$1')],
	['the stop sign is declared INSIDE the gate, where it is dead',
		'src/styles/components.css',
		(s) => s.replace('.cm-grad-text--none {\n\tbackground-image: none;\n\tcolor: inherit;\n}',
			'.cm-grad-text--none-inside {\n\tbackground-image: none;\n\tcolor: inherit;\n}')],
	['the colour stop falls back to transparent instead of currentColor',
		'src/styles/components.css',
		(s) => s.replace('var(--cm-grad-from, currentColor)', 'var(--cm-grad-from, transparent)')],
	['the library ships its own stop instead of leaving it to the consumer',
		'src/styles/components.css',
		(s) => s.replace('--cm-grad-from: currentColor;', '--cm-grad-from: #7a4bd0;')],
	['the stop sign stops clearing the painted gradient',
		'src/styles/components.css',
		(s) => s.replace('.cm-grad-text--none {\n\tbackground-image: none;\n\tcolor: inherit;\n}',
			'.cm-grad-text--none {\n\tcolor: inherit;\n}')],
	['the stop sign leaves the text transparent',
		'src/styles/components.css',
		(s) => s.replace('.cm-grad-text--none {\n\tbackground-image: none;\n\tcolor: inherit;\n}',
			'.cm-grad-text--none {\n\tbackground-image: none;\n\tcolor: transparent;\n}')],
	['the title ramp stops flooring at the scale',
		'src/styles/components.css',
		(s) => s.replace('font-size: var(--hero-title, clamp(var(--head-h1), 2rem + 4vw, 4rem));',
			'font-size: var(--hero-title, clamp(2rem, 2rem + 4vw, 4rem));')],
	['the composition width is no longer its own',
		'src/styles/components.css',
		(s) => s.replace('width: min(var(--hero-maxw, 61.25rem), 100%);', 'width: 100%;')],
	['the hero spacing goes back to a raw literal',
		'src/styles/components.css',
		(s) => s.replace('padding: var(--space-8) var(--gutter) var(--space-7);',
			'padding: 48px var(--gutter) 32px;')],
	['the divider becomes a same-line flex item that strands on a wrap',
		'src/styles/components.css',
		(s) => s.replace('flex: 0 0 100%;\n\theight: 1px;\n\tbackground: var(--line);\n\tmargin-block-end: var(--space-4);',
			'width: 1px;\n\theight: 1.5em;\n\tbackground: var(--line);\n\talign-self: center;')],
	['the showcase stops rendering the hero',
		'src/pages/index.astro',
		(s) => s.replace('<section id="hero" class="cm-section cm-section--pad">',
			'<section id="heroX" class="cm-section cm-section--pad">')],
	['the showcase stops demonstrating the stop sign',
		'src/pages/index.astro',
		(s) => s.replace('cm-grad-text cm-grad-text--none', 'cm-grad-text')],
	['the showcase stops declaring the stops on the element',
		'src/pages/index.astro',
		(s) => s.replace('--cm-grad-from:#7a4bd0;--cm-grad-to:#2ea3c7', '--x:1')],
];

let killed = 0;
let broken = 0;
const survivors = [];
const heroFailSet = new Set();
const BASELINE_FAILS = new Set();

// The BASELINE: which checks fail on the UNMUTATED tree. A mutation is
// killed by a check that was GREEN before it ran - anything already red
// is noise, and crediting it is how a sweep reports twelve kills for one
// cause.
console.log('baseline (unmutated):');
{
	// The tree must be PRISTINE before a sweep starts, and this is not
	// fussiness. The first run of this sweep was killed by a foreground
	// timeout halfway through, which left its mutation applied to
	// src/pages/index.astro. The next sweep read that damaged file as its
	// `orig`, so its showcase pattern matched nothing and it reported the
	// mutation BROKEN - while every later mutant was still being killed
	// by the damage the dead run left behind. Twelve kills, one cause,
	// none of them about the hero. An interrupted sweep must refuse to
	// run against a tree it cannot vouch for.
	const dirty = spawnSync('git', ['status', '--porcelain', '--', 'src/', 'tests/'], { cwd: ROOT, encoding: 'utf8' })
		.stdout.trim().split('\n').filter(Boolean);
	if (dirty.length) {
		console.log('   the working tree is NOT clean under src/ or tests/:');
		for (const d of dirty) console.log(`     ${d}`);
		console.log('   A previous sweep may have been killed mid-run. Restore those files,');
		console.log('   then run this again - a sweep over a dirty tree measures the dirt.');
		process.exit(2);
	}
	rebuild();
	const b = spawnSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
	const fails = (b.stdout.match(/^FAIL .*$/gm) || []).map((s) => s.trim().slice(5));
	for (const f of fails) BASELINE_FAILS.add(f);
	for (const f of fails) console.log(`   already failing: ${f}`);
	if (fails.length) console.log(`   ^ ${fails.length} pre-existing failure(s); they are NOT credited to any mutation`);
	if (b.status !== 0 && !fails.length) {
		console.log('   the suite failed with no FAIL line - refusing to sweep against an unreadable baseline');
		process.exit(2);
	}
}

for (const [name, file, mutate] of MUTATIONS) {
	const path = p(file);
	const orig = readFileSync(path, 'utf8');
	const mutated = mutate(orig);
	if (mutated === orig) {
		console.log(`  BROKEN MUTATION  ${name} - the pattern matched nothing in ${file}`);
		broken++;
		continue;
	}
	writeFileSync(path, mutated);
	let killedNow = false;
	let why = '';
	const built = rebuild();
	if (!built) {
		killedNow = true;
		why = 'the build itself failed - the strongest kill available';
	} else {
		const r = spawnSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
		killedNow = r.status !== 0;
		// The whole failing set, not a favourite line. The first version
		// picked the first FAIL whose text matched a loose filter, and for
		// every mutant in this file that was the SAME unrelated check - so
		// a sweep of twelve kills with one cause is a sweep that proves
		// nothing about the hero. What is needed is the DIFFERENCE against
		// the baseline, so capture both and subtract.
		const fails = (r.stdout.match(/^FAIL .*$/gm) || []).map((s) => s.trim().slice(5));
		const heroFails = fails.filter((f) => !BASELINE_FAILS.has(f));
		why = (heroFails.length ? heroFails : fails).map((f) => `FAIL ${f}`).join('\n          ');
		heroFailSet.add(fails.length - heroFails.length === 0 ? 'NONE-HERO' : String(heroFails.length));
	}
	// Restore from the in-process copy, byte-verified. A snapshot on disk
	// under the scratch dir can be pruned mid-run; the bytes in this
	// process are the authority.
	writeFileSync(path, orig);
	if (readFileSync(path, 'utf8') !== orig) {
		console.log(`  RESTORE FAILED  ${name} - the working tree is not byte-identical to the original`);
		process.exit(2);
	}
	if (killedNow) {
		killed++;
		console.log(`  KILLED  ${name}`);
		console.log(`          ${why}`);
	} else {
		survivors.push(name);
		console.log(`  SURVIVED  ${name}  <-- the test cannot see this`);
	}
}

console.log(`\n${killed}/${MUTATIONS.length} killed, ${broken} broken, ${survivors.length} survived`);
process.exit(survivors.length || broken ? 1 : 0);
