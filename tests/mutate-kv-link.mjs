#!/usr/bin/env node
/**
 * mutation: the whole-row kv link
 *
 * Every assertion added for .cm-kv--link is a guess until it has been
 * made to fail. This harness breaks the exact thing each check guards,
 * runs the suite, and reports which check fired.
 *
 * A pattern that no longer matches the source is a NO-OP - a failure of
 * THIS file, never a pass. The count reported in the cycle note must
 * have zero in it, or the harness itself is broken.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A mutation may target a CONSUMER outside the repo, so this cannot
// blindly join: `join(root, '/root/projects/...')` produces
// `<root>/root/projects/...` and the harness dies with ENOENT instead of
// reporting anything. The first version did exactly that.
const p = (f) => (isAbsolute(f) ? f : join(root, f));
const COMP = 'src/styles/components.css';
const SHOW = 'src/pages/index.astro';
const PORT = '/root/projects/oem-portfolio/src/styles/global.css';

const MUTATIONS = [
	{
		// The bug this component exists to prevent, reintroduced in the
		// library's own rule: a literal floor instead of the token. It
		// measures identically today and is a rebrand bug the moment a
		// consumer retunes --tap.
		name: 'the tap floor becomes a literal instead of the token',
		file: COMP,
		from: /\tmin-height: var\(--tap\);\n\talign-items: center;\n\tpadding: var\(--space-2\);/,
		to: '\tmin-height: 44px;\n\talign-items: center;\n\tpadding: var(--space-2);',
		expectFail: 'not a literal',
		skipBuild: true,
	},
	{
		// The floor deleted outright. The row drops to its text height and
		// is a 20px target on a phone.
		//
		// The pattern is anchored to the `.cm-kv--link a` rule ON PURPOSE.
		// The first version was a bare /min-height: var\(--tap\);/, and
		// `String.replace` with a non-global regex hits the FIRST match in
		// the file - which belongs to some other component entirely. The
		// library has many components at the tap floor, so this mutation
		// was silently editing one of them and the kv row was never
		// touched. It reported MISSED, which read as a weak test and was
		// actually a harness pointing at the wrong line.
		name: 'the tap floor is removed from the row link',
		file: COMP,
		from: /(\.cm-kv--link a \{[^}]*?)	min-height: var\(--tap\);\n/,
		to: '$1',
		expectFail: 'reach the tap floor from var(--tap)',
		skipBuild: true,
	},
	{
		// A block link is the obvious "simplification" and it silently
		// collapses the two-column grid: the term and the value stack and
		// the component is no longer a key-value list at all.
		name: 'the row link stops being a grid',
		file: COMP,
		from: 'a {\n\tdisplay: grid;',
		to: 'a {\n\tdisplay: block;',
		expectFail: 'the link owns the two columns itself',
		skipBuild: true,
	},
	{
		// Half the cancellation. The padding alone pushes the text away
		// from the term above it by the amount of the padding - the rows
		// get visibly further apart and nothing else changes.
		name: 'the padding is no longer cancelled by a negative margin',
		file: COMP,
		from: '\tmargin: calc(var(--space-2) * -1);\n',
		to: '',
		expectFail: 'cancelled by an equal negative margin',
		skipBuild: true,
	},
	{
		// The inverse: the margin with no padding. The hit area grows into
		// the row above it, so two adjacent rows share a band of target
		// and the tap goes to whichever was painted last.
		name: 'the negative margin is left with no padding to cancel',
		file: COMP,
		from: '\tpadding: var(--space-2);\n\tmargin: calc(var(--space-2) * -1);\n',
		to: '\tmargin: calc(var(--space-2) * -1);\n',
		expectFail: 'the row needs padding',
		skipBuild: true,
	},
	{
		// The front-door version of the pair-wrapper bug: the variant
		// forgets to neutralise the base grid, so the pair wrapper
		// becomes a grid item again and the two columns are gone. This is
		// the exact defect the .cm-kv > div rule was written for,
		// reintroduced through a different door.
		name: 'the variant stops neutralising the base kv grid',
		file: COMP,
		from: '.cm-kv--link { display: block; }',
		to: '.cm-kv--link { }',
		expectFail: 'take the base kv grid out of the layout',
		skipBuild: true,
	},
	{
		// The combinator, same shape as the existing .cm-kv check. A
		// descendant also matches a div nested inside a <dd> - a value
		// containing a rich block - and gives it a margin it never asked
		// for.
		name: 'the pair spacing becomes a descendant selector',
		file: COMP,
		from: '.cm-kv--link > div { margin-top: var(--space-2); }',
		to: '.cm-kv--link div { margin-top: var(--space-2); }',
		expectFail: 'child selector',
		skipBuild: true,
	},
	{
		// The whole reason the two columns can still be told apart. Remove
		// the term colour and the row reads as one sentence with a gap in
		// it - the tap target got fixed and the component stopped doing
		// its job.
		name: 'the term loses its own colour in a whole-row kv',
		file: COMP,
		from: '.cm-kv--link dt { color: var(--ink-faint); }',
		to: '.cm-kv--link dt { }',
		expectFail: 'the term in a whole-row kv keeps its own colour',
		skipBuild: true,
	},
	{
		// Half the hover: the value lifts and the term does not, so
		// hovering a row lights up the right half of it.
		name: 'hovering the row no longer lifts the term',
		file: COMP,
		from: '.cm-kv--link a:hover dt,\n.cm-kv--link a:focus-visible dt { color: var(--ink-dim); }',
		to: '.cm-kv--link a:hover dd,\n.cm-kv--link a:focus-visible dd { color: var(--ink-dim); }',
		expectFail: 'lift the term out of its faint colour',
		skipBuild: true,
	},
	{
		// The a11y half of the same state: the row is focusable, so it
		// needs a visible focus ring. Remove it and a keyboard user
		// cannot tell which row they are on.
		name: 'the row link loses its focus ring',
		file: COMP,
		from: '.cm-kv--link a:focus-visible {\n\toutline: 1px solid var(--ink-dim);\n\toutline-offset: -1px;\n}',
		to: '.cm-kv--link a:focus-visible {\n}',
		expectFail: 'the focused whole-row kv row must paint a visible outline',
		skipBuild: true,
	},
	{
		// The anchor is moved INSIDE the <dd>. Everything still builds,
		// the classes are all still present, the section still reads as a
		// key-value list - and the tap target is a 14px value with a
		// 44px row around it that does nothing. This is the bug the
		// component exists to fix, shipping as its own specimen.
		name: 'the specimen moves the anchor inside the dd',
		file: SHOW,
		from: `<a href="#forms">
							<dt>role</dt>
							<dd>engineer</dd>
						</a>`,
		to: `<dt>role</dt>
							<dd><a href="#forms">engineer</a></dd>`,
		expectFail: 'the link must wrap the dt',
		skipBuild: true,
	},
	{
		// The invisible-specimen trap: the whole block goes, the section
		// still builds and the heading is still there.
		//
		// It fires on the VARIANT-CLASS assertion, which comes first:
		// the heading text survives the removal, so `indexOf` still
		// finds the block, and the empty block no longer carries
		// `cm-kv--link` on its <dl>. Naming the anchor-count message here
		// reports MISSED on a mutant the suite caught - the ordering trap
		// this repo has now hit four times. Name the message the
		// mutation actually trips, and put the scan that catches it
		// first.
		name: 'the whole-row kv specimen is removed from the section',
		file: SHOW,
		from: /	*<dl class="cm-kv cm-kv--link">[\s\S]*?<\/dl>\n/,
		to: '',
		expectFail: 'the specimen does not carry the variant class alongside the base',
		skipBuild: true,
	},
	{
		// The migration half. Re-introduce the consumer's private copy
		// wearing the library's reserved prefix, which is what the audit
		// actually found on disk.
		//
		// The pattern is anchored to `.project__stack {` - a rule this
		// cycle has no reason to touch. Two earlier anchors failed: the
		// first was `.cm-kv dt {`, one of the rules this cycle deleted,
		// and the second was `.lede {`, whose surrounding COMMENT this
		// cycle reworded. A mutation anchored to the code under test is
		// a NO-OP the moment that code changes, which is exactly when you
		// least want the harness silently reporting a broken test.
		name: 'the consumer re-declares .cm-kv__* under the reserved prefix',
		file: PORT,
		from: /^\.project__stack \{/m,
		to: '.cm-kv__pair { display: block; }\n.cm-kv__term { color: var(--ink-faint); }\n.project__stack {',
		expectFail: 'the .cm- prefix is reserved',
		skipBuild: true,
	},
	{
		// The other half of the migration claim: the consumer re-ships
		// the whole pattern under its own name instead of adopting the
		// library class.
		name: 'the consumer re-ships its own copy of the whole-row kv link',
		file: PORT,
		from: /^\.project__stack \{/m,
		to: '.kv-links .cm-kv--link { display: block; }\n.project__stack {',
		expectFail: 'it must use the library class',
		skipBuild: true,
	},
	{
		// The markup half. The classes are gone from the consumer
		// stylesheet, so a class left behind in the page would now style
		// NOTHING - the same silent failure as a renamed selector, one
		// repository over. This is a consumer-scoped check the library
		// suite cannot do on its own, so the mutation edits the consumer.
		name: 'a retired .cm-kv__* class is left in the consumer markup',
		file: '/root/projects/oem-portfolio/src/pages/certs.astro',
		from: /<div>\s*<dt>\{c\.name\}<\/dt>/,
		to: '<div class="cm-kv__pair">\n						<dt>{c.name}</dt>',
		expectFail: 'the rules for those were removed, so the classes style nothing',
		skipBuild: true,
	},
];

const runSuite = () => {
	// BOTH streams. The summary block that pairs each failed check with
	// its assertion MESSAGE is written to stderr (`console.error`), while
	// the per-check `FAIL <name>` line goes to stdout. A harness that
	// reads only stdout can only ever match a check NAME - which is why
	// this one had five mutations collapsed onto two names, and why a
	// genuinely caught mutant reads as MISSED. The first version of this
	// harness hit exactly that: three mutants were caught, and reported
	// as missed, because the message it was grepping for had never left
	// stderr.
	const r = spawnSync('node', [join(root, 'tests/run.mjs')], { encoding: 'utf8' });
	return (r.stdout || '') + (r.stderr || '');
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
		// The suite prints the check NAME on a failure line and the
		// assertion MESSAGE only in verbose mode, so a harness that
		// greps for the message reports MISSED on a mutant the suite
		// caught. Three mutations did exactly that this cycle and each
		// one looked like a weak test rather than a wrong expectation.
		// Match the NAME, which is what is actually on the wire.
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
