#!/usr/bin/env node
/**
 * mutation: the auth surface
 *
 * Every assertion added in this cycle is a guess until it has been made
 * to fail. This harness breaks the exact thing each check guards, runs
 * the suite, and reports which check fired.
 *
 * A pattern that no longer matches the source is a NO-OP - a failure of
 * THIS file, never a pass. The count reported in the cycle note must
 * have zero in it, or the harness is broken and the number is
 * worthless.
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
	// ---- the parallel vocabulary comes back -------------------------
	{
		// The bug this cycle fixed. A first draft shipped a private
		// vocabulary beside the system's own; this is that draft.
		// Note the name is cm-login__FIELD: the original check matched
		// /\.cm-login[\s{,]/, which cannot match a double-underscore
		// part because `_` is a word character. So this mutation used
		// to sail straight through a green suite.
		name: 'the parallel login vocabulary is reintroduced',
		file: COMP,
		from: /\.cm-card--auth \{ padding: var\(--space-5\);/,
		to: '.cm-login__field { display: flex; }\n.cm-card--auth { padding: var(--space-5);',
		expectFail: 'private vocabulary instead of composing',
	},
	{
		// Same trap, a DIFFERENT name. A check listing only the names
		// the first draft happened to use passes this forever, so the
		// check has to be structural: a NEW block family in the auth
		// block is a private vocabulary whatever it is called.
		name: 'a differently-named private field class is introduced',
		file: COMP,
		from: /\.cm-card--auth \{ padding: var\(--space-5\);/,
		to: '.cm-auth__field { display: flex; }\n.cm-card--auth { padding: var(--space-5);',
		expectFail: 'private vocabulary instead of composing',
	},
	{
		// The showcase side: a class the layer does not define. This
		// is the oem-links failure - markup renamed, rule left behind,
		// build green and the element unstyled.
		name: 'the private submit class is reintroduced in the showcase',
		file: SHOW,
		from: /class="cm-btn cm-btn--primary cm-btn--block">sign in<\/button>/,
		to: 'class="cm-submit">sign in</button>',
		expectFail: 'components.css does not define',
		skipBuild: true,
	},
	// ---- the dead restatements come back ----------------------------
	{
		// This is the one that measured DEAD in WebKit: 10 declarations
		// that lose to the base input rule's (0,3,1) specificity. A
		// presence-only test passes it; the "states only what differs"
		// check is what has to fire.
		name: 'the code field restates the base input default again',
		file: COMP,
		from: /\.cm-code-input \{\n\tmin-height: var\(--tap\);/,
		to: '.cm-code-input {\n\tfont-family: var(--font-mono);\n\tmin-height: var(--tap);',
		expectFail: 'cannot win the cascade',
	},
	{
		name: 'the code field declares its own font-size again',
		file: COMP,
		from: /\.cm-code-input \{\n\tmin-height: var\(--tap\);/,
		to: '.cm-code-input {\n\tfont-size: 0.9rem;\n\tmin-height: var(--tap);',
		expectFail: 'loses to the base (0,3,1) input rule',
	},
	{
		// The subtler one: it also drops the 16px floor from the base
		// rule, which is where the field actually gets its size. A
		// test that only watched the class would report green.
		name: 'the base input rule loses the 16px form-text floor',
		file: 'src/styles/base.css',
		from: /font-size: max\(var\(--min-font\), 1rem\);/,
		to: 'font-size: max(var(--min-font), 0.9rem);',
		expectFail: 'no longer carries the 16px form-text floor',
	},
	// ---- the frame stops centring ----------------------------------
	{
		name: 'the auth frame stops centring its own card',
		file: COMP,
		from: /\.cm-auth \{\n\tmin-height: 100dvh;\n\tdisplay: grid;\n\tplace-items: center;/,
		to: '.cm-auth {\n\tmin-height: 100dvh;\n\tdisplay: block;',
		expectFail: 'must center its own card',
	},
	{
		// 100vh is cut off by a mobile URL bar: the card's bottom
		// button lands under it. 100dvh is the fix.
		name: 'the frame uses 100vh instead of 100dvh',
		file: COMP,
		from: /\.cm-auth \{\n\tmin-height: 100dvh;/,
		to: '.cm-auth {\n\tmin-height: 100vh;',
		expectFail: '100vh is cut off by a mobile URL bar',
	},
	{
		// The measure moves onto the frame, where it fights the
		// padding: width:100% + padding + max-width overflows by
		// exactly the difference.
		name: 'the measure moves onto the frame, fighting its padding',
		file: COMP,
		from: /\.cm-auth \{\n\tmin-height: 100dvh;/,
		to: '.cm-auth {\n\tmax-width: 26rem;\n\tmin-height: 100dvh;',
		expectFail: 'the measure belongs on its child',
	},
	{
		// The variant is demonstrated but the CSS is gone - the shape
		// the audit calls "green, built, and invisible".
		name: 'the wide variant rule is deleted entirely',
		file: COMP,
		from: /\.cm-auth--wide > \* \{ max-width: 34rem; \}/,
		to: '.cm-auth--wide > * { }',
		expectFail: 'widen the CHILD',
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
