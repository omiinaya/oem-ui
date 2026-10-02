#!/usr/bin/env node
/**
 * Mutations for the --astro install path.
 *
 * Each one breaks the feature in a way a plausible "fix" would, and each
 * must make the suite FAIL. A mutation that does not match the source is a
 * NO-OP, and a no-op that prints like a pass is worse than no test at all
 * - so the counter is derived from the SAME variable that decides a kill,
 * and a build/parse failure counts as the STRONGEST kill available rather
 * than being filed as a no-op.
 *
 * Run from the repo root: node scripts/mutate-install-astro.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = join(root, 'scripts/install.sh');
const RUN = join(root, 'tests/run.mjs');
const backup = mkdtempSync(join(tmpdir(), 'oemui-mut-'));
const installBak = join(backup, 'install.sh');
const runBak = join(backup, 'run.mjs');
copyFileSync(INSTALL, installBak);
copyFileSync(RUN, runBak);
// The astro directory listing, so a mutation that CREATES a component
// cannot leave it behind and still report a clean restore.
const astroBak = readdirSync(join(root, 'src/astro')).sort();

const MUTATIONS = [
	{
		name: 'the flag parses but installs nothing',
		why: 'a --astro that reports success and writes no component is the exact failure mode of a flag nobody exercises',
		// Setting ASTRO=0, not appending a `#`. An earlier version of this
		// mutation appended `#` after `;;` and SURVIVED - correctly, because
		// `;;` already terminates the case arm and the trailing comment
		// changes nothing at all. A mutation that does not actually break
		// the feature proves nothing about the suite, and in the output it
		// is indistinguishable from a real survivor.
		apply: (s) => s.replace('ASTRO=1; shift ;;', 'ASTRO=0; shift ;;'),
		file: 'install.sh',
	},
	{
		name: 'no component is copied at all',
		why: 'the directory is created, so it LOOKS installed',
		apply: (s) => s.replace('install -m 0644 "$FROM/src/astro/$f" "$ASTRO_DEST/$f"', ': #'),
		file: 'install.sh',
	},
	{
		name: 'config.ts is overwritten like any other component',
		why: 'the asymmetry that protects a real site identity, removed',
		apply: (s) => s.replace(/if \[ "\$f" = "config\.ts" \] && \[ -f "\$ASTRO_DEST\/\$f" \]; then\n(\s*)say "config\.ts     -> \$ASTRO_DEST\/config\.ts \(KEPT - the consumer owns its site identity\)"\n\s*continue\n\s*fi/, ''),
		file: 'install.sh',
	},
	{
		name: 'config.ts is kept but SILENTLY',
		why: 'the operator cannot see that a file was spared, so the flag still destroys nothing but starts lying about what it did',
		apply: (s) => s.replace(/say "config\.ts     -> \$ASTRO_DEST\/config\.ts \(KEPT - the consumer owns its site identity\)"/, 'say "config.ts     -> $ASTRO_DEST/config.ts"'),
		file: 'install.sh',
	},
	{
		name: 'an existing component is NOT re-synced',
		why: 'a vendored copy that is never overwritten is a fork - the exact failure a re-syncable install exists to prevent',
		apply: (s) => s.replace('install -m 0644 "$FROM/src/astro/$f" "$ASTRO_DEST/$f"', '[ -f "$ASTRO_DEST/$f" ] || install -m 0644 "$FROM/src/astro/$f" "$ASTRO_DEST/$f"'),
		file: 'install.sh',
	},
	{
		name: 'the shipped-files list drops CodeBlock.astro',
		why: 'the component ships to every consumer but no test claims it - the hole this cycle found',
		apply: (s) => s.replace("'Card.astro', 'CodeBlock.astro',", "'Card.astro',"),
		file: 'run.mjs',
	},
	{
		name: 'an unclaimed component appears on disk',
				why: 'the check exists for this: a component the installer ships but no test claims',
				// Neighbouring the mutation above is the important lesson here.
				// Replacing the directory walk with an empty loop leaves the suite
				// GREEN - correctly, because there is no drift in the tree right now,
				// so the check has nothing to catch. Deleting a guard cannot be
				// observed on a healthy tree.
				//
				// So this mutation CREATES the condition the guard exists to
				// detect: a new .astro file on disk that the shipped list does not
				// name. That is the state the check must fail on, and it is the
				// only way to measure it honestly. Mutating the guard to a no-op
				// measures a tree that is already correct.
				createsFile: 'Orphan.astro',
				apply: (s) => s,
				file: 'run.mjs',
	},
	{
		name: 'the install test accepts an EMPTY installed component',
		why: 'a file-shaped assertion that an empty file satisfies - the inert-value mutant',
		apply: (s) => s.replace(/readFileSync\(p, 'utf8'\)\.trim\(\)\.length > 0,\n\s*`--astro installed an empty src\/astro\/\$\{f\}`,\n\s*\);/, 'false,'),
		file: 'run.mjs',
	},
	{
		name: 'the install test stops requiring the flag at all',
				why: 'a test that passes whether or not --astro works',
				// This one SURVIVES, and it is supposed to.
				//
				// Deleting the source assertion and the installed-file assertions
				// from ONE check leaves the OTHER test -- '--astro never overwrites
				// the consumer's own site identity' -- still exercising the real
				// installer end to end. It installs, edits config.ts and a
				// component, re-installs, and asserts the component came back to
				// library bytes while config.ts did not. So the install path stays
				// covered even with this check gutted: the coverage is layered on
				// purpose, and a mutation that removes one layer is not a hole.
				//
				// Asserting the outcome honestly matters more than a 9/9 line, so
				// this is recorded as EXPECTED-SURVIVOR rather than quietly deleted
				// from the list to make the number look better.
				expectSurvive: true,
				apply: (s) =>
					s
						.replace("assert(/--astro\\)/.test(inst), 'install.sh has no --astro flag');", '// removed')
						.replace(
							/		for \(const f of \['Header\.astro', 'Footer\.astro', 'HeaderLink\.astro', 'config\.ts'\]\) \{[\s\S]*?\n		\}\n/,
							'',
						),
				file: 'run.mjs',
	},
];

let killed = 0;
let survived = 0;
const rows = [];

for (const m of MUTATIONS) {
	const target = m.file === 'install.sh' ? INSTALL : RUN;
	const original = readFileSync(target, 'utf8');
	const mutated = m.apply(original);
	const created = m.createsFile ? join(root, 'src/astro', m.createsFile) : null;

	// A mutation that only CREATES the condition a guard detects (rather
	// than breaking the guard) is legitimate even though the source text is
	// unchanged - the drift is in the tree, not in this file. Every other
	// mutation must actually change something, or it measures nothing.
	if (mutated === original && !created) {
		// A mutation that does not match the source measures NOTHING. Filed
		// as such, loudly - never as a pass.
		rows.push({ name: m.name, result: 'NO-OP', detail: 'pattern did not match' });
		survived++;
		continue;
	}
	if (created) writeFileSync(created, '---\n<div class="cm-shell">orphan</div>\n');
	writeFileSync(target, mutated);
	const r = spawnSync('node', [RUN], { encoding: 'utf8', cwd: root, timeout: 300000 });
	writeFileSync(target, original); // restore BEFORE the next mutation
	if (created) rmSync(created, { force: true });

	const out = (r.stdout || '') + (r.stderr || '');
	if (r.status !== 0) {
		// A non-zero exit IS a kill: the mutation broke the suite outright.
		killed++;
		rows.push({ name: m.name, result: 'KILLED', detail: `suite exited ${r.status}` });
	} else if (/\bFAIL\b/.test(out)) {
		killed++;
		const line = (out.split('\n').find((l) => l.startsWith('FAIL')) || '').trim();
		rows.push({ name: m.name, result: 'KILLED', detail: line.slice(0, 90) });
	} else {
		// An expected survivor is a documented property of the suite, not
		// an unexplained hole - but it still has to be the mutation that was
		// EXPECTED to survive, or the harness is lying in the other
		// direction and the whole count is meaningless.
		if (m.expectSurvive) {
			rows.push({ name: m.name, result: 'SURVIVED (expected)', detail: 'coverage is layered; the other install test still covers this path' });
		} else {
			survived++;
			rows.push({ name: m.name, result: 'SURVIVED', detail: 'suite still green - UNEXPECTED' });
		}
	}
}

// The counter and the summary come from the SAME variable, which is the
// whole point: a harness that prints KILLED without incrementing its own
// count reports six kills as "0 killed".
console.log(`\nmutations: ${killed} killed, ${survived} survived, ${MUTATIONS.length} total\n`);
for (const r of rows) {
	console.log(`  ${r.result.padEnd(9)} ${r.name}`);
	if (r.detail) console.log(`            ${r.detail}`);
}

// Verify the tree is EXACTLY as we found it BEFORE deleting the backup.
// The first version of this harness did the two in the other order and
// then died reading a backup it had already removed - taking the whole
// report down with it and, worse, leaving nothing to restore from if a
// mutation had genuinely failed to restore. The backup is deleted last,
// and only once the comparison has passed.
const cleanRestore =
	readFileSync(INSTALL, 'utf8') === readFileSync(installBak, 'utf8') &&
	readFileSync(RUN, 'utf8') === readFileSync(runBak, 'utf8') &&
	// A mutation that created a file must have removed it too, or the tree
	// is not what we found even though the two edited files match. Compare
	// the astro directory itself, not just the files the harness rewrote.
	readdirSync(join(root, 'src/astro')).sort().join() === astroBak.join();
if (!cleanRestore) {
	console.error('\nRESTORE FAILED - a file was left mutated. Do not trust this report.');
	console.error(`backup kept at ${backup}`);
	process.exit(2);
}
rmSync(backup, { recursive: true, force: true });
console.log('\ntree restored byte-for-byte; backup removed');
process.exit(survived === 0 ? 0 : 1);