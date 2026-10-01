#!/usr/bin/env node
/**
 * mutation: the breadcrumb trail
 *
 * Every assertion in the breadcrumb block of tests/run.mjs is a guess until
 * it has been made to fail. This harness breaks the exact thing each check
 * guards, runs the suite, and reports which check fired.
 *
 * Two of these are the mutations that a value-shaped test passes by
 * construction, and they are the reason this file exists rather than a
 * single `sed`:
 *
 *   - `min-height: 44px` is DECLARED, so a check that asks /min-height/
 *     still matches it. The check asserts var(--tap) precisely so that this
 *     mutant is caught; if the check ever regresses to a bare property
 *     match, this one goes MISSED and that is the signal.
 *   - `max-width: none` / a nowrap trail is the same class of thing for the
 *     wrap: the property can be present and the behaviour gone.
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

const MUTATIONS = [
	{
		name: 'the trail stops wrapping and scrolls sideways instead',
		file: COMP,
		from: /\.cm-crumbs \{[^}]*flex-wrap: wrap;/,
		to: '.cm-crumbs { flex-wrap: nowrap;',
		expectFail: 'the trail wraps rather than scrolling',
	},
	{
		name: 'the trail becomes nowrap, so a deep trail overflows',
		file: COMP,
		from: /\.cm-crumbs \{([^}]*)\}/,
		to: (m) => m.replace(/\{/, '{ white-space: nowrap;'),
		expectFail: 'the trail wraps rather than scrolling',
	},
	{
		// The inert-value mutant. 44px is the right number and the wrong
		// SOURCE: it passes /min-height/ and detaches the floor from the
		// token every other control in the library reads.
		name: 'the tap floor becomes a literal 44px instead of var(--tap)',
		file: COMP,
		from: /(\.cm-crumbs__link \{[^}]*?)min-height: var\(--tap\);/,
		to: '$1min-height: 44px;',
		expectFail: 'every crumb link reaches the tap floor from the token',
	},
	{
		name: 'the crumb link loses the tap floor entirely',
		file: COMP,
		from: /(\.cm-crumbs__link \{[^}]*?)min-height: var\(--tap\);\s*/,
		to: '$1',
		expectFail: 'every crumb link reaches the tap floor from the token',
	},
	{
		name: 'the current crumb loses the tap floor',
		file: COMP,
		from: /(\.cm-crumbs__here \{[^}]*?)min-height: var\(--tap\);\s*/,
		to: '$1',
		expectFail: 'the current crumb reaches the floor too',
	},
	{
		// The separator moved from a ::after to a real aria-hidden element
		// after tests/measure-crumb-separator-ax.py measured that a ::after
		// IS read aloud (accessible name "store›", ignored=false). So these
		// mutations attack the ATTRIBUTE, which is the thing that actually
		// silences it, plus one that reintroduces the ::after to prove the
		// "no ::after" guard is live rather than vacuously satisfied.
		name: 'the separator loses aria-hidden, so a screen reader speaks it',
		file: SHOW,
		from: /<span class="cm-crumbs__sep" aria-hidden="true">/,
		to: '<span class="cm-crumbs__sep">',
		expectFail: 'the separator is aria-hidden in the MARKUP',
	},
	{
		// The one the vision model found by LOOKING at the phone screenshot:
		// with the separator as a sibling flex item, a 5-level trail at 393px
		// put a lone chevron at the start of row 2 and another at the end, and
		// the wrapped row started at left 56px instead of 40px. This mutation
		// puts it back and the shape check must fire.
		name: 'the separator moves back OUT of its link, so one can wrap alone',
		file: SHOW,
		from: /(<a class="cm-crumbs__link"[^>]*>[^<]*)<span class="cm-crumbs__sep" aria-hidden="true">&rsaquo;<\/span>(<\/a>)/,
		to: '$1</a><span class="cm-crumbs__sep" aria-hidden="true">&rsaquo;</span>',
		expectFail: 'the separator lives INSIDE its link',
	},
	{
		name: 'the separator goes back onto a ::after, the shape that is spoken',
		file: COMP,
		from: /\.cm-crumbs__sep \{/,
		to: ".cm-crumbs__link::after { content: '\\203a'; }\n.cm-crumbs__sep {",
		expectFail: 'the separator is a real element, because ::after would be spoken',
	},
	{
		name: 'the demonstrated trail loses its aria-current crumb',
		file: SHOW,
		from: /<span class="cm-crumbs__here" aria-current="page">/,
		to: '<span class="cm-crumbs__here">',
		expectFail: 'the breadcrumb uses aria-current',
	},
	{
		name: 'the current crumb is demonstrated as a link that goes nowhere',
		file: SHOW,
		from: /<span class="cm-crumbs__here" aria-current="page">/,
		to: '<a class="cm-crumbs__here" href="#lists" aria-current="page">',
		expectFail: 'the demonstration proves the current crumb is NOT a link',
	},
	{
		// A fixture that cannot wrap proves nothing about the wrap. This is
		// the "3 rows under a 30rem cap" defect from the sticky-header
		// cycle, applied to the showcase specimen.
		name: 'the deep trail is cut down to a short one',
		file: SHOW,
		from: /<a class="cm-crumbs__link" href="#lists">terminal multiplexer[\s\S]*?<\/a>\s*/,
		to: '',
		expectFail: 'the showcase demonstrates a deep trail',
	},
];

const runSuite = () => {
	const r = spawnSync('node', [join(root, 'tests/run.mjs')], { encoding: 'utf8' });
	return r.stdout || '';
};
const runBuild = () => spawnSync('npx', ['astro', 'build'], { cwd: root, encoding: 'utf8' });

let caught = 0,
	missed = 0,
	noop = 0;
for (const mut of MUTATIONS) {
	const file = p(mut.file);
	const orig = readFileSync(file, 'utf8');
	const mutated = typeof mut.to === 'function' ? orig.replace(mut.from, mut.to) : orig.replace(mut.from, mut.to);
	if (mutated === orig) {
		noop++;
		console.log(`NO-OP  ${mut.name}\n       pattern did not match ${mut.file} - FIX THE HARNESS`);
		continue;
	}
	writeFileSync(file, mutated);
	try {
		// Every mutation here is in a file the BUILT page is generated from,
		// and one check ("every class the library defines is rendered
		// somewhere on the page") reads dist/. So the build has to run for
		// the suite to see the mutation at all - a stale dist would make a
		// real regression invisible.
		const b = runBuild();
		if (b.status !== 0) {
			// A compile failure is the STRONGEST kill available, not a
			// no-op: the page cannot ship. File it as caught.
			console.log(`BUILD  ${mut.name}\n       the build itself failed - strongest kill`);
			caught++;
			continue;
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
