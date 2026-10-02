/* Mutation harness for the footer separator.
 *
 * A test that has never been broken is a guess. Each entry below is a
 * REAL defect - the source as it was before the fix, or a plausible
 * regression someone could reintroduce - and each names the check that
 * must fail.
 *
 * The three defects this repo shipped in one harness, all of which
 * reported PASS, are the reason for the shape here:
 *   - it printed KILLED without incrementing the counter, so real kills
 *     summarised as "0 killed";
 *   - a mutation that broke the BUILD was filed as NO-OP because the
 *     preview stopped answering, when a compile failure is the
 *     strongest kill available;
 *   - `content: none` is DECLARED, so a bare /content/ match passes it.
 *     The separator has to be asserted by its GLYPH.
 * So: the counter is incremented in the same branch that prints, the
 * summary is derived from the counter and nothing else, a non-zero exit
 * from the suite counts as a kill, and every `from` is scoped to a
 * declaration only this component has.
 *
 * Every `from` is anchored on text unique to the footer rules.
 * `flex-wrap: wrap` and `content:` appear in dozens of rules across
 * components.css, and String.replace rewrites only the FIRST - so an
 * unscoped mutation lands on another component, the guard never runs,
 * and the harness reports a kill about code it never touched.
 *
 * The originals are restored in `finally` from bytes read BEFORE the
 * edit, so an interrupted run cannot leave a partial mutation behind.
 * Do NOT run this while editing the same files: a kill between the edit
 * and the restore leaves the mutation in the tree.
 *
 *   usage: node scripts/mutate-footer-sep.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS = join(ROOT, 'src/styles/components.css');
const FOOTER = join(ROOT, 'src/astro/Footer.astro');

const MUTATIONS = [
	{
		name: 'the separator goes back to being its own flex item',
		file: FOOTER,
		// The original defect. Each `·` is a flex item in a wrapping row,
		// so any of them can be the last thing on a line with nothing
		// after it. Measured stranded at 320/360/390/402/430.
		from: '{items.map((it) => <span>{it}</span>)}',
		to: '{items.map((it) => (<><span class="cm-footer__bar" aria-hidden="true">·</span><span>{it}</span></>))}',
		expect: 'the footer separator is generated',
	},
	{
		name: '::before becomes ::after - the dot rides the PRECEDING item',
		file: CSS,
		// The subtle wrong answer. ::after on :not(:last-child) also stops
		// the separator being its own flex item, but it keeps the dot
		// attached to what comes BEFORE it, so when that item ends a
		// wrapped line the dot is still the last thing on it. The same
		// bug in a different position - and a probe that only looked for
		// a separator ELEMENT would call this version clean.
		from: '.cm-footer__meta > *:not(:first-child)::before {',
		to: '.cm-footer__meta > *:not(:first-child)::after {',
		expect: 'the footer separator hangs off the item it PRECEDES',
	},
	{
		name: ':not(:first-child) is dropped - the row LEADS with a dot',
		file: CSS,
		from: '.cm-footer__meta > *:not(:first-child)::before {',
		to: '.cm-footer__meta > *::before {',
		expect: 'the footer separator hangs off the item it PRECEDES',
	},
	{
		name: 'content: none - the separator is DECLARED but renders nothing',
		file: CSS,
		// A value-shaped /content/ match passes this. Only the glyph does.
		from: "\tcontent: '·';\n\tcolor: var(--ink-faint);\n\topacity: 0.6;",
		to: "\tcontent: none;\n\tcolor: var(--ink-faint);\n\topacity: 0.6;",
		expect: 'the footer separator hangs off the item it PRECEDES',
	},
	{
		name: 'the separator glyph is swapped for a space - declared, invisible',
		file: CSS,
		from: "\tcontent: '·';",
		to: "\tcontent: ' ';",
		expect: 'the footer separator hangs off the item it PRECEDES',
	},
	{
		name: '.cm-footer__bar is reinstated as a back-compat shim',
		file: CSS,
		// A rule for markup nobody ships is dead CSS, and the reachability
		// check exists precisely to refuse it. This also proves that check
		// still bites after the class was deleted.
		from: "\tcontent: '·';\n\tcolor: var(--ink-faint);\n\topacity: 0.6;\n\tmargin-left: calc(-1 * var(--space-2));\n\tmargin-right: var(--space-2);\n}\n",
		to: "\tcontent: '·';\n\tcolor: var(--ink-faint);\n\topacity: 0.6;\n\tmargin-left: calc(-1 * var(--space-2));\n\tmargin-right: var(--space-2);\n}\n.cm-footer__bar { color: var(--ink-faint); margin-right: 1.2em; }\n",
		expect: 'every class the library defines is rendered somewhere on the page',
	},
	{
		name: 'a consumer goes back to emitting the deleted separator element',
		file: FOOTER,
		// The migration half. Deleting the class while a consumer still
		// ships the markup strands that consumer's separator, so the CSS
		// being clean is not the claim - the EMITTERS being gone is.
		from: '<span>© <span data-cm-year>{new Date().getFullYear()}</span> {SITE.author}</span>',
		to: '<span>© <span data-cm-year>{new Date().getFullYear()}</span> {SITE.author}</span><span class="cm-footer__bar" aria-hidden="true">/</span>',
		expect: 'the footer separator is gone from the library surface entirely',
	},
];

// Bytes read BEFORE any edit, so the restore cannot depend on a mutation
// having been undone cleanly.
const ORIGINALS = new Map(MUTATIONS.map((m) => [m.file, readFileSync(m.file, 'utf8')]));

const run = () => spawnSync('node', [join(ROOT, 'tests/run.mjs')], {
	cwd: ROOT, encoding: 'utf8',
});
// The suite's own verdict. A non-zero exit is a kill, NOT a no-op: a
// mutation that breaks the build is the strongest kill available.
const suiteFailed = (r) => r.status !== 0;
const failingNames = (r) => [...`${r.stdout}\n${r.stderr}`.matchAll(/FAIL\s+(.+?):/g)].map((m) => m[1]);

let killed = 0;
const survivors = [];

try {
	// A mutation whose `from` does not occur exactly once is a NO-OP, and a
	// no-op that reports as a pass is worse than no mutation at all.
	for (const m of MUTATIONS) {
		const before = ORIGINALS.get(m.file);
		const occurrences = before.split(m.from).length - 1;
		if (occurrences !== 1) {
			survivors.push(`${m.name} -- PATTERN MATCHES ${occurrences} TIMES, NOT 1 (fix the anchor before trusting this run)`);
			continue;
		}
		writeFileSync(m.file, before.replace(m.from, m.to));

		const r = run();
		// Restore immediately, so a kill never leaves the tree mutated.
		writeFileSync(m.file, before);

		if (!suiteFailed(r)) {
			survivors.push(`${m.name} -- suite stayed GREEN`);
			continue;
		}
		// Assert the EXPECTED check fired. A suite that fails for an
		// unrelated reason would otherwise count as a kill and prove
		// nothing about the mutation.
		const names = failingNames(r);
		if (!names.some((n) => n.includes(m.expect))) {
			survivors.push(`${m.name} -- suite went red on the WRONG check (${names.join(', ') || 'unknown'}); expected one containing "${m.expect}"`);
			continue;
		}
		killed++;
		console.log(`  KILLED  ${m.name}`);
	}
} finally {
	for (const [file, body] of ORIGINALS) writeFileSync(file, body);
}

// The summary is derived from the SAME variable the loop increments.
console.log(`\n${killed}/${MUTATIONS.length} killed`);
if (survivors.length) {
	console.log('\nSURVIVORS:');
	for (const s of survivors) console.log(`  ${s}`);
	process.exit(1);
}
if (killed !== MUTATIONS.length) {
	console.log('\nkill count does not match the mutation count - the summary is lying');
	process.exit(1);
}
console.log('every mutation was killed by the check that owns it');