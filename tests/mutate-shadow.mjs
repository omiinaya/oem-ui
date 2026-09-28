#!/usr/bin/env node
/**
 * Mutation harness for the shadow-copy work.
 *
 * Every mutation here must make the suite go RED. A mutation that leaves it
 * green is a hole in a test, and a hole reported as a pass is worse than no
 * test at all - so a pattern that no longer matches is reported as a NO-OP
 * and counted as a FAILURE of this harness, not as a success.
 *
 * Run: node tests/mutate-shadow.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = join(root, 'scripts/check-design-sync.sh');
const INST = join(root, 'scripts/install.sh');
const README = join(root, 'README.md');

const results = [];

function runSuite() {
	const r = spawnSync('node', [join(root, 'tests/run.mjs')], {
		encoding: 'utf8', cwd: root,
	});
	const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
	return {
		passed: m ? +m[1] : 0,
		failed: m ? +m[2] : -1,
		out: r.stdout || '',
	};
}

/** Apply a mutation, run the suite, restore, report. */
function mutate(name, file, from, to, expectFail = true) {
	if (!existsSync(file)) {
		results.push([name, 'NO-OP', `target missing: ${file}`]);
		return;
	}
	const orig = readFileSync(file, 'utf8');
	if (!orig.includes(from)) {
		// A pattern that no longer matches is a broken mutation, NOT a pass.
		results.push([name, 'NO-OP', `pattern not found in ${file.split('/').pop()}: ${JSON.stringify(from.slice(0, 70))}`]);
		return;
	}
	const hits = orig.split(from).length - 1;
	writeFileSync(file, orig.split(from).join(to));
	const r = runSuite();
	writeFileSync(file, orig);

	const wentRed = r.failed > 0;
	const wrong = expectFail ? !wentRed : wentRed;
	results.push([
		name,
		wrong ? 'NOT-CAUGHT' : 'caught',
		wrong
			? `expected ${expectFail ? 'a failure' : 'green'}, got ${r.failed} failed (${hits} site(s) mutated)`
			: `${r.failed} failed / ${r.passed} passed`,
	]);
}

// Baseline first, so a pre-existing failure is never blamed on a mutation.
const base = runSuite();
console.log(`baseline: ${base.passed} passed, ${base.failed} failed\n`);
if (base.failed !== 0) {
	console.error('baseline is not green; every mutation verdict below would be noise');
	process.exit(1);
}

console.log('mutating scripts/check-design-sync.sh');

// 1. Remove the ALT comparison entirely. A consumer's public/ copy is then
//    invisible again - which is the original defect.
mutate(
	'drop the ALT public/ comparison',
	SYNC,
	'for pair in "${ALT[@]}"; do\n\t\ts="$SRC/${pair%%:*}"\n\t\td="$t/${pair##*:}"\n\t\t[ -f "$d" ] || continue\n\t\tif ! cmp -s "$s" "$d"; then',
	'for pair in "${ALT[@]}"; do\n\t\ts="$SRC/${pair%%:*}"\n\t\td="$t/${pair##*:}"\n\t\t[ -f "$d" ] || continue\n\t\tif false; then',
);

// 2. Report the ALT copy as fine even when it differs.
mutate(
	'the ALT copy is never reported as stale',
	SYNC,
	'out+="  STALE    ${pair##*:} ($n lines differ)"$\'\\n\'\n\t\t\tstale=1\n\t\tfi\n\tdone\n\n\t# ---- shadow copies',
	'out+="  STALE    ${pair##*:} ($n lines differ)"$\'\\n\'\n\t\tfi\n\tdone\n\n\t# ---- shadow copies',
);

// 3. Delete the shadow scan. A copy on a path MAP and ALT both miss becomes
//    completely invisible - the whitelist hole reopens.
mutate(
	'delete the shadow scan',
	SYNC,
	"for f in $(find \"$t\" -type f -name 'cli-mono*.js' \\",
	"for f in $(find /nonexistent -type f -name 'cli-mono*.js' \\",
);

// 4. The bug I actually wrote and then caught: skip by BASENAME instead of
//    by full path. Because MAP also holds a file called cli-mono.js, this
//    silently skips the public/ copy the section exists to find. If this
//    mutation is NOT caught, the ORPHAN/STALE half is decorative.
mutate(
	'skip shadow copies by basename (the real bug I wrote)',
	SYNC,
	'already=0\n\t\tfor pair in "${MAP[@]}" "${ALT[@]}"; do\n\t\t\t[ "$f" = "$t/${pair##*:}" ] && already=1 && break\n\t\tdone',
	'already=0\n\t\tfor pair in "${MAP[@]}" "${ALT[@]}"; do\n\t\t\t[ "$(basename "$f")" = "$(basename "${pair##*:}")" ] && already=1 && break\n\t\tdone',
);

// 5. A shadow copy that differs is reported but not fatal.
mutate(
	'a drifted shadow copy is a note, not a failure',
	SYNC,
	'out+="  SHADOW   $rel ($n lines differ from the library)"$\'\\n\'\n\t\t\tstale=1',
	'out+="  SHADOW   $rel ($n lines differ from the library)"$\'\\n\'',
);

// 6. An ORPHAN (identical, unchecked path) stops failing. This is the
//    precondition of the drift, and losing it is the subtler of the two.
mutate(
	'an orphaned copy is allowed to pass',
	SYNC,
	'out+="  ORPHAN   $rel is byte-identical but on no path this check compares"$\'\\n\'\n\t\t\tstale=1',
	'out+="  ORPHAN   $rel is byte-identical but on no path this check compares"$\'\\n\'',
);

console.log('mutating scripts/install.sh');

// 7. --public installs nothing.
mutate(
	'--public installs no files',
	INST,
	'\tinstall -m 0644 "$FROM/src/js/cli-mono.js"            "$TARGET/public/cli-mono.js"\n\tinstall -m 0644 "$FROM/src/js/cli-mono-theme-guard.js" "$TARGET/public/cli-mono-theme-guard.js"',
	'\t:',
);

// 8. --public silently stops printing the shape, so a consumer falls back to
//    hand-maintaining a copy - the exact failure the flag replaces.
mutate(
	'--public stops documenting the verbatim shape',
	INST,
	"printf '  const base = import.meta.env.BASE_URL;   // never a leading /\\n'",
	"printf '  // see the docs\\n'",
);

// 9. --public creates public/ unconditionally, which would hand every
//    consumer an ORPHAN to fail on.
mutate(
	'--public is not opt-in',
	INST,
	'if [ "$PUBLIC" -eq 1 ]; then\n\tmkdir -p "$TARGET/public"',
	'if [ "$PUBLIC" -eq 0 ]; then\n\tmkdir -p "$TARGET/public"',
);

// 10. The public copy is cut from a DIFFERENT source than src/js, so the two
//     copies a consumer serves and reads can disagree with each other.
mutate(
	'the public copy comes from a different origin',
	INST,
	'install -m 0644 "$FROM/src/js/cli-mono.js"            "$TARGET/public/cli-mono.js"',
	'printf \'/* edited in public */\\n\' > "$TARGET/public/cli-mono.js"',
);

console.log('mutating README.md');

// 11. The README's file count goes stale again. It already said "four"
//     after the guard landed as a fifth file, and nothing checked it - the
//     same class of defect as a check that names a superseded symbol.
mutate(
	'the README understates the file count again',
	README,
	'- copy five files, no package manager',
	'- copy four files, no package manager',
);

const after = runSuite();
if (after.failed !== 0) {
	results.push(['suite is green again after restore', 'NOT-CAUGHT',
		`${after.failed} still failing`]);
} else {
	results.push(['suite is green again after restore', 'caught', `${after.passed} passed`]);
}

console.log('');
let noops = 0;
let notCaught = 0;
for (const [name, verdict, detail] of results) {
	const bad = verdict === 'NO-OP' || verdict === 'NOT-CAUGHT';
	if (bad) (verdict === 'NO-OP' ? noops++ : notCaught++);
	console.log(`  ${bad ? 'BAD ' : 'ok  '} ${verdict.padEnd(10)} ${name}\n         ${detail}`);
}
console.log(`\n${results.length} mutations: ${results.length - noops - notCaught} caught, ` +
	`${notCaught} not caught, ${noops} NO-OP`);
console.log('A NO-OP is a failure of this harness. The count reported for the cycle must have zero of them.');
process.exit(noops + notCaught > 0 ? 1 : 0);
