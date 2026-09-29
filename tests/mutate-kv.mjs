#!/usr/bin/env node
/**
 * mutation: the kv pair wrapper
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

const MUTATIONS = [
	{
		// The bug itself, in the library. Deleting the rule must fail.
		name: 'the pair wrapper is left as a grid item again',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv > div,\n.cm-kv > span { }',
		expectFail: 'a wrapped pair is taken out of the kv grid layout',
	},
	{
		// The subtler version of the same bug: a rule that still exists and
		// still says something, just not the right thing. A presence-only
		// check would pass this forever.
		name: 'the wrapper is neutralised with display:block instead',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv > div,\n.cm-kv > span { display: block; }',
		expectFail: 'display:block leaves the wrapper a grid item',
	},
	{
		// display:none is the wrong fix in a way that looks right: the
		// layout stops collapsing AND the rows vanish from the a11y tree.
		name: 'the wrapper is removed with display:none',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv > div,\n.cm-kv > span { display: none; }',
		expectFail: 'display:none hides the row from assistive tech too',
	},
	{
		// The combinator. A descendant selector fixes the reported case and
		// silently breaks a <div> nested inside a <dd> - a value containing
		// a rich block - which is a far worse regression. `contents` and no
		// `>` is the mutant a substring check cannot see.
		//
		// The message it fires on is the DESCENDANT assertion, not the
		// child-combinator one: the descendant scan runs first, so it is
		// the claim this mutant actually breaks. Naming the wrong message
		// here reads as a MISSED mutation when the check did its job.
		name: 'the child combinator becomes a descendant one',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv div,\n.cm-kv span { display: contents; }',
		expectFail: 'only a direct pair wrapper',
	},
	{
		// The dead-declaration trap: a margin on a box that no longer
		// exists. It reads like a spacing decision and paints nothing.
		// This one caught a real bug in the test itself - the assertion
		// anchored to a LINE start and the body is a single line.
		name: 'a margin is added to the boxless wrapper',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv > div,\n.cm-kv > span { display: contents; margin-top: var(--space-1); }',
		expectFail: 'generates no box',
	},
	{
		// The spec is stripped out of the comment-free source only, so this
		// cannot be satisfied by prose elsewhere in the file.
		name: 'the child selector is deleted entirely',
		file: COMP,
		from: /\.cm-kv > div,\n\.cm-kv > span \{ display: contents; \}/,
		to: '.cm-kv__pair { display: contents; }',
		expectFail: '> child selector',
	},
	{
		// The presence trap. The WRAPPED specimen - the only one carrying a
		// div - is flattened into a direct list: the section still builds,
		// the classes still exist, and the fix is no longer shown anywhere.
		// The first version of this mutation rewrote the DIRECT list
		// instead, so it deleted a <dt> and the suite failed for a reason
		// that had nothing to do with the claim: the harness was editing
		// the wrong specimen. Anchor on the wrapper itself.
		name: 'the wrapped kv specimen is flattened into a direct one',
		file: SHOW,
		from: /	*<dl class="cm-kv">\n	*<div><dt>role<\/dt><dd>engineer<\/dd><\/div>\n	*<div><dt>since<\/dt><dd>2014<\/dd><\/div>\n	*<div><dt>based<\/dt><dd>remote<\/dd><\/div>\n	*<\/dl>/,
		to: '						<dl class="cm-kv">\n							<dt>role</dt><dd>engineer</dd>\n							<dt>since</dt><dd>2014</dd>\n							<dt>based</dt><dd>remote</dd>\n						</dl>',
		expectFail: 'never demonstrates a wrapped dt/dd pair',
		skipBuild: true,
	},
	{
		// The invisible-specimen trap, and the one that matters most: both
		// lists are removed, so the block still builds and the heading is
		// still there. Only a check that asserts the specimens exist can
		// see it.
		name: 'both kv specimens are removed from the section',
		file: SHOW,
		from: /\t\t\t\t<div class="cm-split">\n\t\t\t\t\t<div>\n\t\t\t\t\t\t<h4 class="cm-kicker cm-kicker--plain">direct<\/h4>[\s\S]*?\n\t\t\t\t<\/div>\n/,
		to: '\n',
		expectFail: 'kv list',
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
