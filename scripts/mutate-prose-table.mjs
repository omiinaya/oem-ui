/* Mutation harness for `.cm-prose-table`.
 *
 * A test that has never been broken is a guess. Each entry below is a
 * REAL defect - the source as it was before a fix, or a plausible
 * regression someone could reintroduce - and each names the check that
 * must fail.
 *
 * Two defects in a harness like this shipped together in this repo once
 * and both reported PASS:
 *   - it printed KILLED without incrementing the counter, so six real
 *     kills summarised as "0 killed";
 *   - a mutation that broke the BUILD was filed as NO-OP because the
 *     preview stopped answering - but a compile failure is the
 *     strongest kill available.
 * So: the counter is incremented in the same branch that prints, the
 * summary is derived from the counter and nothing else, and a non-zero
 * exit from the suite counts as a kill.
 *
 * A third defect is specific to this file and is why every `from` is
 * SCOPED to this component rather than written as a bare property:
 * `overflow-wrap: break-word` appears in five rules across the file, and
 * String.replace rewrites only the FIRST. An unscoped mutation lands on
 * another component, the guard it was meant to exercise never runs, and
 * the harness reports a kill (or a survival) about code it never
 * touched. Anchor every pattern on a declaration only this component
 * has.
 *
 * Each mutation asserts the EXPECTED check fired, not merely that the
 * suite went red - a suite that fails for an unrelated reason would
 * otherwise count as a kill and prove nothing.
 *
 * The originals are restored in `finally` from bytes read BEFORE the
 * edit, so an interrupted run cannot leave a partial mutation behind.
 *
 *   usage: node scripts/mutate-prose-table.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS = join(ROOT, 'src/styles/components.css');
const PAGE = join(ROOT, 'src/pages/index.astro');

const MUTATIONS = [
	{
		name: 'table-layout: auto - width:100% goes back to being advisory',
		file: CSS,
		from: '\ttable-layout: fixed;',
		to: '\ttable-layout: auto;',
		expect: 'table-layout: fixed',
	},
	{
		name: 'the cells go nowrap, inheriting the data grid behaviour',
		file: CSS,
		from: '\toverflow-wrap: break-word;\n}\n.cm-prose-table th {',
		to: '\twhite-space: nowrap;\n}\n.cm-prose-table th {',
		expect: 'nowrap',
	},
	{
		name: 'word-break: break-word added alongside - the eager breaker that shreds prose',
		file: CSS,
		from: '\toverflow-wrap: break-word;\n}\n.cm-prose-table th {',
		to: '\toverflow-wrap: break-word;\n\tword-break: break-word;\n}\n.cm-prose-table th {',
		expect: 'shreds prose',
	},
	{
		name: 'the --min-font floor removed, so it renders at ~11.7px on a phone',
		file: CSS,
		from: '\tfont-size: max(var(--min-font), 0.94em);',
		to: '\tfont-size: 0.94em;',
		expect: 'min-font',
	},
	{
		name: 'the stacked cells stop rendering their data-label',
		file: CSS,
		from: '\t\tcontent: attr(data-label);',
		to: '\t\tcontent: none;',
		expect: 'data-label',
	},
	{
		name: 'the clipped thead switched to display:none, dropping it from the a11y tree',
		file: CSS,
		from: '\t\tposition: absolute;\n\t\twidth: 1px;',
		to: '\t\tdisplay: none;\n\t\twidth: 1px;',
		expect: 'accessibility tree',
	},
	{
		name: 'a max-height copied in from .cm-table-wrap',
		file: CSS,
		from: '\tmargin: 0 0 var(--space-5);\n\t/*',
		to: '\tmargin: 0 0 var(--space-5);\n\tmax-height: var(--table-max-h, 30rem);\n\t/*',
		expect: 'max-height',
	},
	{
		name: 'the data-labels stripped from the fixture, so a stacked row has no column names',
		// `replaceAll`: the label appears once per ROW (4 rows), and a
		// single-replace mutation would strip one and leave three - which
		// still passes, because the check asks that NONE are missing. A
		// mutation that cannot fail is a no-op dressed as a test.
		file: PAGE,
		from: ' data-label="Engine"',
		to: '',
		all: true,
		expect: 'carry no data-label',
	},
	{
		name: 'the table replaced by a div pile, losing table semantics',
		file: PAGE,
		from: '<table class="cm-prose-table">',
		to: '<div class="cm-prose-table">',
		expect: 'rendered as a <table>',
	},
];

let killed = 0;
let noop = 0;
const survived = [];
const wrongCheck = [];

for (const m of MUTATIONS) {
	// Read the pristine bytes fresh each time, so a previous mutation's
	// leftovers can never become this mutation's input.
	const before = readFileSync(m.file, 'utf8');
	const hits = before.split(m.from).length - 1;
	// Scoped patterns must match exactly once, or String.replace would
	// silently rewrite the wrong rule - the defect this file was born
	// from. An explicit `all` mutation is exempt: it says so.
	if (!m.all && hits !== 1) {
		noop++;
		console.error(`  NO-OP  ${m.name} - pattern matches ${hits} places, must be exactly 1`);
		continue;
	}
	if (m.all && hits < 2) {
		noop++;
		console.error(`  NO-OP  ${m.name} - pattern matches ${hits} places, expected several`);
		continue;
	}
	try {
		writeFileSync(m.file, m.all
			? before.split(m.from).join(m.to)
			: before.replace(m.from, m.to));
		const r = spawnSync(process.execPath, [join(ROOT, 'tests/run.mjs')],
			{ cwd: ROOT, encoding: 'utf8' });
		const out = `${r.stdout || ''}${r.stderr || ''}`;
		if (r.status === 0) {
			survived.push(m.name);
			console.log(`  SURVIVED ${m.name}  <-- the suite does not catch this`);
		} else {
			killed++;                       // incremented in the branch that prints
			if (out.includes(m.expect)) {
				console.log(`  KILLED  ${m.name}`);
			} else {
				wrongCheck.push(m.name);
				console.log(`  KILLED  ${m.name}  (but NOT by the expected check)`);
			}
		}
	} finally {
		// Restore the bytes read before the edit, never by inverting the
		// edit: an inverse that no longer matches leaves the tree broken
		// for the next mutation, and the next cycle.
		writeFileSync(m.file, before);
	}
}

// The summary is derived from the same variable that was incremented.
console.log(`\n${killed} killed, ${noop} no-op, ${survived.length} survived, ` +
	`${wrongCheck.length} killed by the wrong check`);
if (survived.length) { console.error('SURVIVED:'); for (const n of survived) console.error(`  ${n}`); }
if (wrongCheck.length) { console.error('WRONG CHECK:'); for (const n of wrongCheck) console.error(`  ${n}`); }
process.exit(killed === MUTATIONS.length && noop === 0 ? 0 : 1);