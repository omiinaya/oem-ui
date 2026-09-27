#!/usr/bin/env node
/* Mutation harness for the reachability half of check-design-sync.sh.
 *
 * A test you have not tried to break is a guess. Each mutant removes or
 * neutralises ONE behaviour in the drift checker. A correct mutant makes
 * the suite FAIL. A mutant that leaves the suite green is reported as a
 * NO-OP, never as a pass - a pattern that stopped matching is a broken
 * mutation, not a successful one.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const script = join(root, 'scripts/check-design-sync.sh');
const orig = readFileSync(script, 'utf8');

/* Each mutant: [name, the exact substring to remove from the script] */
const MUTANTS = [
	[
		'drop the UNREACHABLE report (bytes-only drift, the original bug)',
		'out+="  UNREACHABLE  $v is vendored but nothing imports it"$\'\\n\'\n\t\t\t\t\t\tstale=1',
	],
	[
		'drop only the stale=1 (reports the file but never fails)',
		'out+="  UNREACHABLE  $v is vendored but nothing imports it"$\'\\n\'\n\t\t\t\t\t\tstale=1',
		'keep-report',
	],
	[
		'revert to matching the full vendored PATH (misses @import consumers)',
		'for v in "tokens.css" "base.css" "components.css"; do',
		'for v in "styles/cli-mono/tokens.css" "styles/cli-mono/base.css" "styles/cli-mono/components.css"; do',
	],
	[
		'require an import in any file, ignoring extension filters entirely',
		"sources=$(find \"$t/src\" -type f \\\n\t\t\t\\( -name '*.astro' -o -name '*.ts' -o -name '*.js' -o -name '*.css' -o -name '*.mjs' \\) \\\n\t\t\t! -path \"*/styles/cli-mono/*\" ! -name 'cli-mono.js' 2>/dev/null)",
		'sources=$(find "$t/src" -type f 2>/dev/null)',
	],
	[
		'scan the vendored dir too (a file "imports" itself)',
		"! -path \"*/styles/cli-mono/*\" ! -name 'cli-mono.js' 2>/dev/null)",
		"2>/dev/null)",
	],
	[
		'gate on src/ existing, so a bare install reads as in sync',
		'if [ -n "$sources" ]; then',
		'if [ -n "$sources" ] && [ -d "$t/src/components" ]; then',
	],
	[
		'make the runtime advisory disappear (should stay a note, not a fail)',
		'echo "  note: $t vendors cli-mono.js but references no script tag for it"',
		'echo "  NOTE-DISABLED: $t vendors cli-mono.js"',
	],
];

const run = () => spawnSync('node', [join(root, 'tests/run.mjs')], { encoding: 'utf8' });
const baseline = run();
if (baseline.status !== 0) {
	console.error('baseline suite is not green; fix that before mutating');
	process.exit(1);
}
console.log(`baseline: ${(baseline.stdout.match(/(\d+) passed/) || [])[0]}\n`);

let killed = 0, missed = 0, noop = 0;
for (const [name, needle, mode] of MUTANTS) {
	let mutated;
	if (mode === 'keep-report') {
		// keep the echo, drop only the failure flag
		mutated = orig.replace(needle, 'out+="  UNREACHABLE  $v is vendored but nothing imports it"$\'\\n\'');
	} else {
		mutated = orig.replace(needle, '');
	}
	if (mutated === orig) {
		console.log(`  NO-OP   ${name}\n            !! pattern did not match the source; this is a BROKEN mutation, not a pass`);
		noop++;
		continue;
	}
	writeFileSync(script, mutated);
	const r = run();
	if (r.status !== 0) {
		const line = (r.stdout.match(/FAIL[^\n]*/g) || []).slice(0, 2).join(' | ');
		console.log(`  KILLED  ${name}\n            -> ${line}`);
		killed++;
	} else {
		console.log(`  MISSED  ${name}\n            !! the suite stayed green; the test does not actually guard this`);
		missed++;
	}
	writeFileSync(script, orig);
}

const after = run();
console.log(`\n${killed} killed, ${missed} missed, ${noop} no-op`);
console.log(`suite after restore: ${after.status === 0 ? 'green' : 'RED'}`);
process.exit(missed || noop || after.status !== 0 ? 1 : 0);
