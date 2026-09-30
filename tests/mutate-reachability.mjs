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
			'out+="  UNREACHABLE  $v is vendored but nothing imports it"$\'\\n\'\n						stale=1',
		],
		[
			'drop only the stale=1 (reports the file but never fails)',
			'out+="  UNREACHABLE  $v is vendored but nothing imports it"$\'\\n\'\n						stale=1',
			'keep-report',
		],
	[
		'revert to matching the full vendored PATH (misses @import consumers)',
		'for v in "tokens.css" "base.css" "components.css"; do',
		'for v in "styles/cli-mono/tokens.css" "styles/cli-mono/base.css" "styles/cli-mono/components.css"; do',
	],
	[
		'require an import in any file, ignoring extension filters entirely',
		'sources=$(find "$t" \\\n			\\( -type d \\( -name node_modules',
		'sources=$(find "$t" -type f 2>/dev/null)',
	],
	[
		'scan the vendored dir too (a file "imports" itself)',
		"! -path \"$t/$CD/*\" \\\n			! -name 'cli-mono.js' \\\n			! -name 'cli-mono-theme-guard.js' -print \\)",
		"-print \\)",
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
	[
		// THE FIVE THIS CYCLE ADDED. The first two hid in the --flat
		// layout, the one install.sh documents for a project with no src/
		// tree at all, and both reported "in sync" on a consumer that had
		// vendored the entire library and loaded none of it.
		//
		// js_dir_for used `${d#"$t"/}`, which returns its input UNCHANGED
		// when there is nothing to strip. The vendored JS directory IS the
		// project root in a flat install, so every lookup became
		// "/a/b//a/b/cli-mono.js" and both JS files reported MISSING.
		'revert js_dir_for to the strip that no-ops at the project root',
		'	if [ "$1" = "$t" ]; then printf \'.\'; return 0; fi\n	printf \'%s\' "${1#"$t"/}"\n}',
		'	printf \'%s\' "${1#"$t"/}"\n}',
	],
	[
		// Scanning $t/src meant a static consumer - pages are plain .html at
		// the root, no src/ tree - produced an EMPTY source set, so the
		// entire reachability pass was skipped. Restoring $t/src puts the
		// dev-blog bug back for the --flat layout specifically.
		'rescan $t/src only, so a static consumer has no sources to check',
		'sources=$(find "$t" \\',
		'sources=$(find "$t/src" \\',
	],
	[
		// .html is the only source language a --flat consumer has. Without
		// it in the filter the scan is empty for every static site, which
		// is the same silent pass as scanning the wrong root.
		'drop .html from the scanned extensions',
		" -o -name '*.html' \\)",
		" \\)",
	],
	[
		// A page that NAMES the guard in a comment has not loaded it. This
		// mutant is the one that would have shipped a checker satisfied by
		// the word "cli-mono-theme-guard.js" appearing in a sentence.
		'count a comment as a reference to the guard',
		"blob=$(printf '%s' \"$blob\" | perl -0pe 's/<!--.*?-->//gs')",
		'# comment stripping removed',
	],
	[
		// spacetime-rpm pastes the whole guard file into a <script>, so no
		// filename appears on its page. Matching only the name called a
		// shipped, wired guard UNREACHABLE - a false positive, which is
		// the failure mode this whole script is written against.
		'stop recognising the guard by its body (inline-verbatim consumers)',
		'			*"$(guard_sig)"*) ;;',
		'',
	],
	[
		// A signature generated from the guard source cannot rot; one
		// hand-copied here would stop matching its own guard the moment
		// the guard changed, and the check would go quietly inert.
		'hardcode a guard signature that no longer matches the guard',
		"sed -n '/^(function () {/,/^})();/p' \\\n					\"$SRC/src/js/cli-mono-theme-guard.js\" |\n					grep -o \"s === 'light' || s === 'dark'\" | head -1",
		"printf '%s' \"s === 'light' || s === 'dark' || s === 'NEVER'\"",
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
