#!/usr/bin/env node
/**
 * mutation: the bare icon button + the trailing-slash drift fix
 *
 * Every assertion added in this cycle is a guess until it has been made to
 * fail. This harness breaks the exact thing each check guards, runs the
 * suite, and reports which check fired.
 *
 * A pattern that no longer matches the source is a NO-OP - a failure of THIS
 * file, never a pass. The count reported in the cycle note must have zero in
 * it, or the harness itself is broken and the number is worthless.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);
const COMP = 'src/styles/components.css';
const SHOW = 'src/pages/index.astro';
const TESTS = 'tests/run.mjs';
const SYNC = 'scripts/check-design-sync.sh';

const MUTATIONS = [
	/* ---------- .cm-icon-btn--bare ---------- */
	{
		// The defect that only WebKit could see. `width: var(--tap)` was
		// present, correct and applied - and the page still rendered
		// 37.89x44, because a flex row shrank the box below its own declared
		// width. Every check that reads the coarse-pointer block passes on
		// this mutant, which is precisely why the browser measurement has
		// to be in the loop and not just in the report.
		// Anchor on the SELECTOR, not the declaration pair. `flex: 0 0 auto;
		// border: 1px solid var(--line);` occurs three times in this file -
		// on .cm-swatch__chip, .cm-spec__chip and .cm-icon-btn - so an
		// unanchored replace mutated the first one and left the class under
		// test untouched, which reads as MISSED. The same "a duplicate
		// satisfies the wrong assertion" trap as everywhere else here.
		name: 'the icon button may shrink below its own target again',
		file: COMP,
		from: /(\.cm-icon-btn \{[^}]*?)\n	flex: 0 0 auto;/,
		to: '$1',
		expectFail: 'cannot be shrunk below its own target',
	},
	{
		// The variant's entire reason for existing. Delete the border reset
		// and the control is the boxed one with a different class name -
		// a modifier that renders like its base.
		name: '--bare stops dropping the border (renders like its base)',
		file: COMP,
		from: /\.cm-icon-btn--bare \{\n\tborder: 0;\n\tborder-radius: 0;\n\}/,
		to: '.cm-icon-btn--bare {\n\tcolor: var(--ink-dim);\n}',
		expectFail: 'renders DIFFERENTLY from its base',
	},
	{
		// The measured no-no as a mutation. The whole defect on the two live
		// sites was 32x44: the floor supplied one axis and the glyph box
		// supplied the other. Pinning only the height is that bug, and it
		// has to be a build failure rather than a silent half-fix.
		name: '--bare pins only the height on a coarse pointer (the 44x32 pill)',
		file: COMP,
		from: '\t.cm-icon-btn--bare { width: var(--tap); height: var(--tap); }',
		to: '\t.cm-icon-btn--bare { min-height: var(--tap); }',
		expectFail: 'pins BOTH dimensions on a coarse pointer',
	},
	{
		// A hardcoded 44 measures right and is still wrong: a consumer that
		// retunes --tap is stuck at the old size.
		name: '--bare hardcodes 44px instead of the token',
		file: COMP,
		from: '\t.cm-icon-btn--bare { width: var(--tap); height: var(--tap); }',
		to: '\t.cm-icon-btn--bare { width: 44px; height: 44px; }',
		expectFail: 'pins BOTH dimensions on a coarse pointer',
	},
	{
		// The whole coarse-pointer override goes. A consumer keeping a
		// hardcoded 32px width gets the 32x44 pill back - the exact state
		// measured on links.oem.ngo and log.oem.ngo.
		name: '--bare loses its coarse-pointer override entirely',
		file: COMP,
		from: /@media \(pointer: coarse\) \{\n\t\.cm-icon-btn--bare \{[^}]*\}\n\}/,
		to: '',
		expectFail: 'pins BOTH dimensions on a coarse pointer',
	},
	{
		// The generic sweep is what keeps a new interactive class from
		// shipping without a tap claim. Dropping it from INTERACTIVE has
		// to fail, or the sweep silently stops covering the component.
		name: 'the tap sweep stops covering --bare',
		file: TESTS,
		from: "'cm-chip--action', 'cm-icon-btn--bare']",
		to: "'cm-chip--action']",
		expectFail: 'reaches the tap floor like every other control',
	},
	{
		// Dead surface: a class nothing renders is code the next person
		// cannot trust. Remove the specimen, rebuild, and the built-page
		// assertion must fire.
		name: 'the bare specimen is removed from the showcase',
		file: SHOW,
		from: /\s*<div class="cm-spec__row">\s*<span class="cm-spec__label"><code>bare<\/code>[\s\S]*?<\/div>\n/,
		to: '\n',
		expectFail: 'is a defined, demonstrated variant',
	},
	{
		// The presence trap: the class is still on the page somewhere, but
		// the SPECIMEN that demonstrates the variant is rendered without
		// it, so the case is unproven.
		name: 'the bare specimen is rendered without the variant class',
		file: SHOW,
		from: 'class="cm-icon-btn cm-icon-btn--bare"',
		to: 'class="cm-icon-btn"',
		expectFail: 'is a defined, demonstrated variant',
	},

	/* ---------- the trailing-slash drift fix ---------- */
	{
		// THE BUG. Restoring the un-normalised target handling made the
		// script report ORPHAN on files MAP already owns, for a consumer
		// that was byte-identical and fully wired.
		name: 'the drift checker stops normalising a trailing slash',
		file: SYNC,
		from: 'for t0 in "$@"; do targets+=("$(strip_slash "$t0")"); done',
		to: 'for t0 in "$@"; do targets+=("$t0"); done',
		expectFail: 'a trailing slash on the target does not invent drift',
	},
	{
		// The no-argument sweep normalises separately, so fixing only the
		// explicit-argument path would leave the sweep broken. The harness
		// must catch the half-fix, not just the whole one.
		name: 'the no-argument sweep stops normalising a trailing slash',
		file: SYNC,
		from: 'targets+=("$(strip_slash "$d")")',
		to: 'targets+=("$d")',
		expectFail: 'a trailing slash on the target does not invent drift',
	},
];

const runSuite = () => {
	const r = spawnSync('node', [join(root, 'tests/run.mjs')], { encoding: 'utf8' });
	return r.stdout || '';
};
const runBuild = () => spawnSync('npx', ['astro', 'build'], { cwd: root, encoding: 'utf8' });

let caught = 0, missed = 0, noop = 0;
for (const mut of MUTATIONS) {
	const file = p(mut.file);
	const orig = readFileSync(file, 'utf8');
	const mutated = orig.replace(mut.from, mut.to);
	if (mutated === orig) {
		noop++;
		console.log(`NO-OP  ${mut.name}\n       pattern did not match ${mut.file} - FIX THE HARNESS`);
		continue;
	}
	writeFileSync(file, mutated);
	try {
		if (!mut.skipBuild) {
			const b = runBuild();
			if (b.status !== 0) {
				console.log(`BUILD  ${mut.name}\n       the build itself failed: ${(b.stderr || '').split('\n').slice(0, 2).join(' ')}`);
			}
		}
		const out = runSuite();
		if (out.includes(mut.expectFail) && /FAIL/.test(out)) {
			caught++;
			console.log(`caught ${mut.name}\n       -> ${mut.expectFail}`);
		} else {
			missed++;
			console.log(`MISSED ${mut.name}\n       expected: ${mut.expectFail}`);
		}
	} finally {
		writeFileSync(file, orig);
	}
}
console.log(`\n${MUTATIONS.length} mutations: ${caught} caught, ${missed} missed, ${noop} no-op`);
if (noop) process.exit(2);
process.exit(missed ? 1 : 0);
