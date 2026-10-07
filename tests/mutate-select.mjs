#!/usr/bin/env node
/**
 * mutation: the select class, the arrow it draws, and the pair that keeps
 * the element default and the class painting the same widget.
 *
 * A test you have not tried to break is a guess. Each mutant reverts ONE
 * thing this change fixed, and a correct mutant makes the suite FAIL.
 *
 * Traps this file is shaped around, all learned in this repo:
 *
 *   - A mutation whose pattern no longer matches is a NO-OP, and scoring a
 *     no-op as a pass is worse than having no test at all. Every pattern is
 *     ASSERTED to match before its result is counted.
 *   - `background: var(--bg-2)` SURVIVES in the comments this change added
 *     (the doc block names the old declaration to explain the bug), and
 *     `background-image: linear-gradient(...)` survives too. So a
 *     substring test passes with the declaration reverted. Every mutant
 *     here edits the DECLARATION, scoped to its rule body.
 *   - The reachability test reads **dist/index.html**, so an un-rebuilt
 *     mutation is INVISIBLE to it. The harness runs `npm run build` before
 *     every sweep run. Without that it manufactures confidence.
 *   - A mutation that breaks the BUILD is the strongest kill available,
 *     not a no-op.
 *
 * Run: node tests/mutate-select.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => writeFileSync(join(root, p), s);

const BASE = 'src/styles/base.css';
const COMP = 'src/styles/components.css';
const PAGE = 'src/pages/index.astro';

/* [label, relpath, pattern-that-must-exist (string, replaced verbatim), replacement] */
const MUTANTS = [
	[
		'RESTORE THE BUG: the field block fills with the `background` SHORTHAND, which resets background-image and eats the arrow',
		BASE,
		'\tbackground-color: var(--bg-2);',
		'\tbackground: var(--bg-2);',
	],
	[
		'the field block drops its fill entirely, so the arrow survives but there is no surface under it',
		BASE,
		'\tbackground-color: var(--bg-2);',
		'',
	],
	[
		'BASE.LAYER ARROW: delete the pair of wedges, leaving the native arrow suppressed and nothing painted',
		BASE,
		'\tbackground-image: linear-gradient(45deg, transparent 50%, currentColor 50%),\n\t\tlinear-gradient(135deg, currentColor 50%, transparent 50%);',
		'',
	],
	[
		'CLASS ARROW: same deletion on the class, so a SCOPED adoption has no arrow at all',
		COMP,
		'\tbackground-image: linear-gradient(45deg, transparent 50%, currentColor 50%),\n\t\tlinear-gradient(135deg, currentColor 50%, transparent 50%);',
		'',
	],
	[
		'HALF A CHEVRON: drop the second wedge only',
		COMP,
		'\t\tlinear-gradient(135deg, currentColor 50%, transparent 50%);',
		'',
	],
	[
		'UNTHEMED ARROW: a literal hex instead of currentColor, so the arrow cannot follow the theme',
		COMP,
		'\tbackground-image: linear-gradient(45deg, transparent 50%, currentColor 50%),',
		'\tbackground-image: linear-gradient(45deg, transparent 50%, #888888 50%),',
	],
	[
		'AN IMAGE: the arrow becomes a url(), the second asset per theme this avoids',
		COMP,
		'\tbackground-image: linear-gradient(45deg, transparent 50%, currentColor 50%),',
		'\tbackground-image: url(arrow.svg),',
	],
	[
		'CLEARANCE DROPPED: the value runs under the wedges',
		COMP,
		'\tpadding-right: var(--space-7);',
		'',
	],
	[
		'PAIR BROKEN: the class and the element default disagree on the arrow size',
		COMP,
		'\tbackground-size: 0.35rem 0.35rem, 0.35rem 0.35rem;',
		'\tbackground-size: 0.5rem 0.5rem, 0.5rem 0.5rem;',
	],
	[
		'PAIR BROKEN: the class and the element default disagree on the arrow position',
		COMP,
		'\tbackground-position: calc(100% - 1.1rem) 52%, calc(100% - 0.75rem) 52%;',
		'\tbackground-position: calc(100% - 2rem) 52%, calc(100% - 1.5rem) 52%;',
	],
	[
		'LIST BOX WEARS A CHEVRON: the modifier no longer clears the arrow it cannot use',
		COMP,
		'.cm-select--multi {\n\tbackground-image: none;',
		'.cm-select--multi {',
	],
	[
		'LIST BOX CANNOT SCROLL: the extra options become unreachable',
		COMP,
		'\toverflow-y: auto;\n}',
		'}',
	],
	[
		'NOT DEMONSTRATED: the plain picker specimen loses its class, so the arrow ships unproven',
		PAGE,
		'<select id="f-kind" class="cm-select">',
		'<select id="f-kind">',
	],
	[
		'NOT DEMONSTRATED: the list-box specimen is no longer a multiple select',
		PAGE,
		'class="cm-select cm-select--multi" multiple size="4"',
		'class="cm-select cm-select--multi" size="4"',
	],
];

/** Run the suite; return {ok, failed:[names]}. */
function suite() {
	const r = spawnSync('node', ['tests/run.mjs'], {
		cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
	});
	const out = (r.stdout || '') + (r.stderr || '');
	const failed = [...out.matchAll(/^\s*FAIL\s+(.+?)(?::|$)/gm)].map((m) => m[1].trim());
	return { ok: r.status === 0, status: r.status, failed, out };
}

/** A build failure counts as a KILL, not a no-op. */
function build() {
	const r = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
	return r.status === 0;
}

const snap = new Map();
for (const f of new Set(MUTANTS.map((m) => m[1]))) snap.set(f, read(f));

const restore = () => {
	for (const [f, s] of snap) write(f, s);
};

console.log('select surface mutation check\n');

// A green baseline is not optional: a red one makes every kill meaningless.
if (!build()) {
	console.error('BASELINE BUILD FAILED — fix the tree before mutating.');
	process.exit(2);
}
const before = suite();
if (!before.ok) {
	console.error('BASELINE SUITE IS RED — every result below would be meaningless.');
	console.error('  failed: ' + before.failed.join(', '));
	process.exit(2);
}
console.log(`baseline: suite green, build green\n`);

let killed = 0;
let survived = 0;
let noop = 0;

for (const [label, file, from, to] of MUTANTS) {
	const src = read(file);
	// A drifted pattern is a LOUD error, never a phantom survivor.
	if (!src.includes(from)) {
		console.log(`  NO-OP  ${label}`);
		console.log(`         pattern not found in ${file}: ${JSON.stringify(from.slice(0, 60))}`);
		noop++;
		continue;
	}
	write(file, src.replace(from, to));

	const built = build();
	let verdict;
	if (!built) {
		verdict = 'KILLED (build)';
		killed++;
	} else {
		const r = suite();
		if (r.ok) {
			verdict = 'SURVIVED';
			survived++;
		} else {
			verdict = `KILLED (${r.failed.slice(0, 2).join(' | ') || 'suite red'})`;
			killed++;
		}
	}
	console.log(`  ${verdict.padEnd(64)} ${label}`);
	restore();
}

// Leave the tree exactly as it was found, then prove it.
restore();
const after = build() && suite().ok;
console.log(`\n${killed} killed, ${survived} survived, ${noop} no-op (of ${MUTANTS.length})`);
console.log(`tree restored and green: ${after ? 'yes' : 'NO — INVESTIGATE'}`);
process.exit(survived === 0 && noop === 0 && after ? 0 : 1);
