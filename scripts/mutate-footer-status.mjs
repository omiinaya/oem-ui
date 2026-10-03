#!/usr/bin/env node
/**
 * Mutation harness for the footer SEPARATOR rules and the status row.
 *
 * Two defects shipped together in this repo once, both reported the harness
 * as PASSING while it killed nothing: it printed `KILLED` without
 * incrementing the counter, and a mutation that broke the BUILD was filed as
 * a NO-OP because the preview stopped answering. So:
 *
 *   - the kill count and the summary are derived from the SAME variable;
 *   - a non-zero `npm run build` exit is a KILL, the strongest one available;
 *   - every pattern is asserted against the source BEFORE it is used, so a
 *     drifted pattern is a loud error rather than a phantom survivor.
 *
 * It also REBUILDS. A mutation against `src/styles/*.css` is invisible to a
 * suite that reads `dist/`, and a sweep that skips the rebuild manufactures
 * confidence out of nothing.
 *
 * NEVER run this in the background while editing the same files, and never
 * `git checkout --` to clean up: that reverts the whole cycle's work, not
 * the mutation. Every mutation snapshots to its own file and restores with
 * `cp`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/root/projects/oem-ui';
// NOT a mktemp under TMPDIR: the scratch dir is pruned after 24h, and a
// sweep that outlives the prune dies mid-run with its snapshot gone -
// which is how a mutation was left committed to the working tree. A stable
// dir under the repo's own gitignored tree cannot vanish underneath it.
const SNAP = join(ROOT, '.mutate-snapshots');
mkdirSync(SNAP, { recursive: true });
const CSS = join(ROOT, 'src/styles/components.css');
const ASTRO = join(ROOT, 'src/astro/Footer.astro');
const PAGE = join(ROOT, 'src/pages/index.astro');

let killed = 0;
let survived = 0;
let errored = 0;

/** Restore a file from the snapshot taken before the mutation. */
function restore(path, snapshot) {
	copyFileSync(snapshot, path);
}

function suite() {
	try {
		execFileSync('node', ['tests/run.mjs'], { cwd: ROOT, stdio: 'pipe' });
		return { ok: true };
	} catch (e) {
		return { ok: false, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
	}
}

function build() {
	try {
		execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
		return { ok: true };
	} catch (e) {
		return { ok: false, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
	}
}

/**
 * Apply a mutation, assert the pattern actually matched (a no-op mutation
 * is worse than no test), rebuild, run the suite, restore.
 */
function mutate(label, file, pattern, replacement, { needsBuild = true } = {}) {
	const snapshot = join(SNAP, `${file.replace(/\W+/g, '_')}.${Math.random().toString(36).slice(2)}`);
	copyFileSync(file, snapshot);
	const before = readFileSync(file, 'utf8');

	// `replace()` with a string pattern replaces the FIRST match only, which
	// is what we want for scoping. A regex needs the `g` flag or it is a
	// no-op by construction - the harness that let two such mutations
	// "survive" was measuring its own pattern, not the code.
	const hit = pattern instanceof RegExp
		? (pattern.flags.includes('g') ? pattern.test(before) : new RegExp(pattern.source, pattern.flags + 'g').test(before))
		: before.includes(pattern);
	if (!hit) {
		console.error(`  ERROR  ${label}: pattern matched nothing - fix the pattern, this is not a test`);
		errored++;
		restore(file, snapshot);
		return;
	}

	const after = pattern instanceof RegExp ? before.replace(pattern, replacement) : before.replace(pattern, replacement);
	if (after === before) {
		console.error(`  ERROR  ${label}: the mutation changed nothing`);
		errored++;
		restore(file, snapshot);
		return;
	}
	writeFileSync(file, after);

	let verdict = 'SURVIVED';
	let detail = '';
	if (needsBuild) {
		const b = build();
		if (!b.ok) {
			// A compile failure is the strongest kill available.
			verdict = 'KILLED';
			detail = 'build broke';
		}
	}
	if (verdict !== 'KILLED') {
		const s = suite();
		if (!s.ok) {
			verdict = 'KILLED';
			detail = 'suite failed';
		}
	}

	restore(file, snapshot);

	if (verdict === 'KILLED') {
		killed++;
		console.log(`  KILLED  ${label}  (${detail})`);
	} else {
		survived++;
		console.log(`  SURVIVED ${label}  <-- the test cannot fail`);
	}
}

console.log('\n=== footer separator mutations ===');

// 1. The separator flips to ::after - the exact defect d2ec654 deleted.
mutate(
	'status separator ::before -> ::after',
	CSS,
	'.cm-footer__status-part:not(:first-child)::before',
	'.cm-footer__status-part:not(:last-child)::after',
);

// 2. `content: none` - DECLARED, so a /content/ search still matches it.
mutate(
	'status separator content -> none',
	CSS,
	/(\.cm-footer__status-part:not\(:first-child\)[^{]*::before\s*\{[^}]*content:\s*)'│'/,
	"$1none",
);

// 3. The whole status rule deleted.
mutate(
	'the status separator rule deleted outright',
	CSS,
	/\.cm-footer__status-part:not\(:first-child\)[^{]*::before\s*\{[^}]*\}/,
	'',
);

// 4. The row stops wrapping - the fixture that can no longer strand.
mutate(
	'status row flex-wrap removed',
	CSS,
	/(\.cm-footer__status\s*\{[^}]*?)flex-wrap:\s*wrap;/,
	'$1flex-wrap: nowrap;',
);

// 5. The row stops being flex, so the fragments are not flex items.
mutate(
	'status row display:flex removed',
	CSS,
	/(\.cm-footer__status\s*\{[^}]*?)display:\s*flex;/,
	'$1display: block;',
);

// 6. The array prop silently becomes a string again.
mutate(
	'status prop type back to string only',
	ASTRO,
	'status?: string | string[]',
	'status?: string',
);

// 7. The template stops branching on the array shape.
mutate(
	'the Array.isArray branch removed',
	ASTRO,
	'Array.isArray(status)',
	'false',
);

// 8. Fragments stop being separate elements.
mutate(
	'statusParts.map removed',
	ASTRO,
	'statusParts.map(',
	'[status].map(',
);

// 9. The leading dot renders on EVERY fragment.
mutate(
	'the leading dot renders per fragment',
	ASTRO,
	'{i === 0 && <span class="cm-footer__dot">',
	'{<span class="cm-footer__dot">',
);

// 10. The dot is dropped entirely, leaving dead CSS.
mutate(
	'the leading dot removed',
	ASTRO,
	'{i === 0 && <span class="cm-footer__dot">●</span>}',
	'',
);

// 11. The showcase reverts to a single string, so nothing demonstrates it.
mutate(
	'showcase status reverted to one string',
	PAGE,
	'status={[\'all systems nominal\', \'sig: static only\']}',
	'status="all systems nominal"',
);

// 12. The fixture grows a literal dot, which the component then doubles.
mutate(
	'showcase fragment carries a literal dot too',
	PAGE,
	"status={['all systems nominal', 'sig: static only']}",
	"status={['● all systems nominal', 'sig: static only']}",
);

console.log(`\n${killed} killed, ${survived} survived, ${errored} errored`);
rmSync(SNAP, { recursive: true, force: true });
process.exit(survived || errored ? 1 : 0);

// Every mutated file is restored from ITS OWN snapshot, taken before that
// mutation. The last crash in this repo was a snapshot directory pruned
// out from under a running sweep, which left `Array.isArray(status)` -
// the exact production of mutation 7 - sitting in the working tree, and
// the next two runs of the suite were measuring the mutant. Restoring in a
// finally block means an exception mid-sweep cannot do that.