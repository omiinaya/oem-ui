#!/usr/bin/env node
/**
 * mutation: the state chip + the tap-floor fix
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
const BASE = 'src/styles/base.css';

const MUTATIONS = [
	{
		name: 'the --ok glyph is removed (state becomes colour-only)',
		file: COMP,
		from: /\.cm-chip--ok::before \{[^}]*\}/,
		to: '.cm-chip--ok { }',
		expectFail: 'a state chip carries a non-hue cue, not just a colour step',
	},
	{
		// The whole point of the check, sharpened: --warn borrows --ok's
		// glyph, so two states look identical. Distinctness, not presence.
		name: '--warn borrows the --ok glyph',
		file: COMP,
		from: /\.cm-chip--warn::before \{ content: '\\25b2/,
		to: ".cm-chip--warn::before { content: '\\25cf",
		expectFail: 'a state chip carries a non-hue cue, not just a colour step',
	},
	{
		name: 'the 12px floor is dropped from .cm-chip',
		file: COMP,
		from: /font-size: max\(var\(--min-font\), 0\.7rem\);(\s+line-height: 1\.4;)/,
		to: 'font-size: 0.7rem;$1',
		expectFail: 'a state chip cannot fall below the 12px text floor',
	},
	{
		// The measured no-no, as a mutation: the floor belongs on
		// --action only, because on the base it inflates a status row from
		// 39.6px to 60.5px. An "add the floor everywhere for consistency"
		// pass must fail the suite.
		name: 'the chip is given the --tap floor on its base (the measured no-no)',
		file: COMP,
		from: /(	white-space: nowrap;\n	max-width: 100%;\n\})/,
		to: '	white-space: nowrap;\n	max-width: 100%;\n	min-height: var(--tap);\n}',
		expectFail: 'a chip is a mark by default and a control only when it is the target',
	},
	{
		// The other direction: remove the escape hatch and a consumer with a
		// tappable chip has to hand-write the floor. "No floor anywhere" is
		// its own wrong answer, so it gets its own mutation.
		name: 'the --action variant no longer reaches --tap',
		file: COMP,
		from: /\.cm-chip--action \{[^}]*min-height: var\(--tap\);/,
		to: '.cm-chip--action {',
		expectFail: 'a chip is a mark by default and a control only when it is the target',
	},
	{
		name: '--action hardcodes 44px instead of the token',
		file: COMP,
		from: /\.cm-chip--action \{ min-height: var\(--tap\);/,
		to: '.cm-chip--action { min-height: 44px;',
		expectFail: 'a chip is a mark by default and a control only when it is the target',
	},
	{
		name: 'the --set variant loses its dashed border (renders like the base)',
		file: COMP,
		from: /\.cm-chip--set \{ border-style: dashed;/,
		to: '.cm-chip--set {',
		expectFail: 'a chip modifier that renders like its base is not a modifier',
	},
	{
		name: 'the chip loses max-width:100%',
		file: COMP,
		from: /(\.cm-chip \{(?:[^\n]*\n)*?\t)white-space: nowrap;\n\tmax-width: 100%;/,
		to: '$1white-space: nowrap;',
		expectFail: 'a chip in a table cell cannot widen the table past the viewport',
	},
	{
		// The nav toggle regression: its floor used to be an accident of
		// the stretched flex parent. Deleting the declaration must fail,
		// or the check is reading a coincidence.
		name: 'the nav toggle loses its explicit tap floor',
		file: COMP,
		from: /(\.cm-nav-toggle \{[^}]*?)\n\tmin-width: var\(--tap\);\n\tmin-height: var\(--tap\);/,
		to: '$1',
		expectFail: '.cm-nav-toggle meets the tap floor',
	},
	{
		// The element-layer case. base.css's coarse-pointer block is the
		// ONLY thing putting .cm-tabs__tab at 44px, so deleting it must
		// fail - and fail on a check that named the ELEMENT, not the class.
		name: 'base.css loses the coarse-pointer element floor',
		file: BASE,
		from: /(\t\[role='tab'\] \{\n\t\tmin-height: var\(--tap\);)/,
		to: "\t[role='tab'] {\n\t\tmin-height: 20px;",
		expectFail: '.cm-tabs__tab meets the tap floor',
	},
	{
		name: 'the --action specimen is removed from the showcase',
		file: SHOW,
		from: /\s*<div class="cm-spec__row">\s*<span class="cm-spec__label"><code>--action<\/code>[\s\S]*?<\/div>\n/,
		to: '\n',
		expectFail: 'every chip variant is demonstrated against its own base',
		skipBuild: true,
	},
	{
		// The presence trap: the chip renders but a variant is swapped for a
		// plain one, so the element is on the page and the case is unproven.
		name: 'the --warn specimen is rendered as a plain chip',
		file: SHOW,
		from: /class="cm-chip cm-chip--warn"/,
		to: 'class="cm-chip"',
		expectFail: 'every chip variant is demonstrated against its own base',
		skipBuild: true,
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
				// A build failure is a legitimate way for a check to fail
				// only if the suite still runs; report it honestly.
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
