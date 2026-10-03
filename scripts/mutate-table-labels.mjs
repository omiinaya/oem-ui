/* Mutation harness for the generated-table-label runtime.
 *
 * The same contract the prose-table harness keeps, applied to the piece
 * that DERIVES what that harness's CSS consumes:
 *
 *   - the counter is incremented in the branch that prints KILLED, and the
 *     summary is derived from that counter alone. A harness that prints a
 *     kill without counting it reported six real kills as "0 killed" once
 *     in this repo.
 *   - a pattern that matches the wrong number of places is a NO-OP and is
 *     reported loudly. `String.replace` rewrites only the FIRST match, so
 *     an unscoped pattern lands on someone else's code and the suite goes
 *     red (or green) about a function the mutation never touched.
 *   - each mutation names the check that must fire. A suite that fails for
 *     an unrelated reason would otherwise count as a kill and prove nothing.
 *   - the pristine bytes are read BEFORE the edit and restored in `finally`,
 *     so an interrupted run cannot leave a partial mutation in the tree.
 *
 * NEVER run this in the background while editing the same files: killing it
 * mid-sweep leaves a half-mutation behind and the next build fails on
 * something unrelated to the work in progress.
 *
 *   usage: node scripts/mutate-table-labels.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const JS = join(ROOT, 'src/js/cli-mono.js');
const PAGE = join(ROOT, 'src/pages/index.astro');

const MUTATIONS = [
	{
		name: 'the derivation never runs - the stacked rows lose every column name',
		file: JS,
		from: "				cells[i].setAttribute('data-label', names[i]);",
		to: "				cells[i].setAttribute('data-label', '');",
		expect: 'column names from the header row',
	},
	{
		name: 'the header row is not the source of truth - labels come from nowhere',
		file: JS,
		from: "\t\tvar head = table.querySelector('thead tr');",
		to: "\t\tvar head = null;",
		expect: 'column names from the header row',
	},
	{
		name: 'the empty middle cells filtered out before labelling, shifting every later label',
		// A short row does NOT expose this: the gap is at the END, so
		// nothing after it shifts. Only a gap in the MIDDLE of a row
		// moves a real value under the wrong column heading, which is why
		// the fixture carries a row shaped `| a |  | c |`.
		file: JS,
		from: 'var cells = row.children;',
		to: 'var cells = Array.prototype.slice.call(row.children).filter(function (c) {\n				return (c.textContent || \'\').trim().length > 0;\n			});',
		expect: 'INDEX',
	},
	{
		name: "an author's own data-label is overwritten by the derived one",
		file: JS,
		from: "if (cells[i].hasAttribute('data-label')) continue;",
		to: '',
		expect: 'never overwritten',
	},
	{
		name: 'the opt-in attribute is dropped, so it runs on tables a person wrote',
		file: JS,
		from: ".querySelectorAll('[data-cm-table-labels] .cm-prose-table')",
		to: ".querySelectorAll('.cm-prose-table')",
		expect: 'opt-in',
	},
	{
		name: 'the showcase fixture given hand-written data-labels, so it proves nothing',
		// `all`: the generated-labels fixture has EIGHT body cells and the
		// mutation has to label EVERY one. A single replace would label
		// one and the check - which asks that NONE are labelled - would
		// still pass, so a one-shot mutation is a no-op dressed as a kill.
		file: PAGE,
		from: 'class="cm-prose-table"',
		to: 'class="cm-prose-table" data-x="1"',
		all: true,
		expect: 'opt-in',
	},
	{
		name: 'the showcase lost the opt-in attribute, so the section demos nothing',
		file: PAGE,
		from: 'style="margin-bottom:var(--space-7)" data-cm-table-labels>',
		to: 'style="margin-bottom:var(--space-7)">',
		expect: 'opt-in',
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
		// for the next mutation, and for the next cycle.
		writeFileSync(m.file, before);
	}
}

// The summary is derived from the same variable that was incremented.
console.log(`\n${killed} killed, ${noop} no-op, ${survived.length} survived, ` +
	`${wrongCheck.length} killed by the wrong check`);
if (survived.length) { console.error('SURVIVED:'); for (const n of survived) console.error(`  ${n}`); }
if (wrongCheck.length) { console.error('WRONG CHECK:'); for (const n of wrongCheck) console.error(`  ${n}`); }
process.exit(killed === MUTATIONS.length && noop === 0 ? 0 : 1);