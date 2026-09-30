#!/usr/bin/env node
/**
 * Mutation harness for the .cm-rows--inline increment.
 *
 * The doctrine: a test you have not tried to break is a guess. Every
 * mutation below must turn the suite RED. A pattern that no longer
 * matches the source is a NO-OP and is reported as a FAILURE of the
 * harness -- a no-op that looks like a pass is worse than no test.
 *
 * Two traps this file exists to honour, both hit while writing it:
 *
 *  - tests/run.mjs prints `FAIL <name>` to STDOUT and the
 *    `FAIL <name>: <message>` summary to STDERR. Capturing stdout only
 *    collapses every mutation onto check NAMES, so each is matched on
 *    the MESSAGE it actually trips. Hence stdout + stderr.
 *  - expectFail is named after the message on the wire. When an
 *    assertion is reworded the expectation goes stale and the mutation
 *    reads as a weak test rather than a wrong string.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CSS = 'src/styles/components.css';
const TOK = 'src/styles/tokens.css';
const JS = 'src/js/cli-mono.js';
const SHOW = 'src/pages/index.astro';
const original = {
	css: readFileSync(CSS, 'utf8'),
	tok: readFileSync(TOK, 'utf8'),
	js: readFileSync(JS, 'utf8'),
	show: readFileSync(SHOW, 'utf8'),
};

function restore() {
	writeFileSync(CSS, original.css);
	writeFileSync(TOK, original.tok);
	writeFileSync(JS, original.js);
	writeFileSync(SHOW, original.show);
}

function runSuite() {
	const r = spawnSync('node', ['tests/run.mjs'], { encoding: 'utf8' });
	// BOTH streams: the assertion messages live on stderr.
	return (r.stdout || '') + (r.stderr || '');
}

/**
 * @param {string} name        what the mutation is
 * @param {string} file        which file to patch
 * @param {RegExp|string} find anchored on a line that SURVIVES
 * @param {string} replace     the replacement
 * @param {string} expectFail  the message the mutant must trip
 */
function mutate({ name, file = CSS, find, replace, expectFail }) {
	restore();
	const src = readFileSync(file, 'utf8');
	// A STRING pattern is a literal, not a regex. The first version built
	// `new RegExp(pat, 'm')` from it, so every anchor containing CSS
	// metacharacters -- `var(--measure-title)` is full of parens -- failed
	// to match and reported NO-OP on text that is plainly in the file.
	// Six of eleven mutations were no-ops for that reason alone, and a
	// no-op that looks like a pass is worse than no test.
	const isLiteral = typeof find === 'string';
	const pat = isLiteral ? find : find.source;
	const rx = isLiteral
		? new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gm')
		// `m` is added only if the author did not already carry it, or a
		// pattern written with /m throws on the doubled flag.
		: new RegExp(pat, (find.flags.replace('g', '') + 'm').replace('mm', 'm'));
	if (!rx.test(src)) {
		return { name, verdict: 'NO-OP', detail: `pattern not found: ${pat}` };
	}
	const mutated = src.replace(rx, replace);
	if (mutated === src) {
		return { name, verdict: 'NO-OP', detail: 'replacement was a no-op' };
	}
	writeFileSync(file, mutated);

	const out = runSuite();
	const failed = /FAIL/.test(out);
	const tripped = out.includes(expectFail);

	restore();
	if (!failed) {
		return { name, verdict: 'MISSED', detail: 'suite stayed GREEN' };
	}
	if (!tripped) {
		// The suite went red, but on some OTHER assertion. That is still
		// a caught mutant, but the harness is asserting the wrong thing
		// and the next reword would hide it.
		return {
			name,
			verdict: 'WRONG-MESSAGE',
			detail: `expected ${JSON.stringify(expectFail)}; got: ` +
				(out.match(/FAIL [^\n]*/g) || []).slice(0, 3).join(' | '),
		};
	}
	return { name, verdict: 'CAUGHT', detail: '' };
}

const MUTATIONS = [
	// --- the showcase specimen ---
	{
		name: 'the specimen types the value instead of using the token',
		file: SHOW,
		find: 'style="margin:0;max-width:var(--measure-title)"',
		replace: 'style="margin:0;max-width:42ch"',
		expectFail: 'the specimen must paint with var(--measure-title)',
	},
	{
		name: 'the specimen is deleted from the showcase',
		file: SHOW,
		find: /<div class="cm-spec__row" data-spec="measure-title">[\s\S]*?<\/div>\s*<\/div>\n/,
		replace: '',
		expectFail: 'no [data-spec="measure-title"] specimen in the showcase',
	},
	// --- the runtime readout ---
	{
		name: 'the readout is never called from init()',
		file: JS,
		find: '		initYears();\n		initMeasureReadout();',
		replace: '		initYears();',
		expectFail: 'initMeasureReadout is never called from init()',
	},
	{
		name: 'the readout restates the band with matchMedia',
		file: JS,
		find: "var live = getComputedStyle(desc).display !== 'none';",
		replace:
			"var live = !window.matchMedia('(max-width: 844px)').matches;",
		expectFail: 'the readout must not use matchMedia',
	},
	{
		name: 'the readout reads the wrong element for its state',
		file: JS,
		find: "var live = getComputedStyle(desc).display !== 'none';",
		replace: "var live = true;",
		expectFail: 'the readout must read the real computed display of the excerpt',
	},
	{
		name: 'cm-spec__state is left defined but no longer created (dead CSS)',
		file: JS,
		find: "out.className = 'cm-spec__state';",
		replace: "out.className = 'cm-spec__nope';",
		expectFail: 'is allowlisted as runtime-built',
	},
	{
		name: 'the inline title hardcodes a ch literal instead of the token',
		find: 'max-width: var(--measure-title);',
		replace: 'max-width: 42ch;',
		expectFail: 'a page-shape width comes from a measure token',
	},
	{
		name: 'inline title basis stops naming the token',
		find: 'flex: 0 0 var(--measure-title);',
		replace: 'flex: 0 0 42ch;',
		expectFail: 'a page-shape width comes from a measure token',
	},
	{
		name: 'inline title is allowed to shrink (clips the primary label)',
		find: 'flex: 0 0 var(--measure-title);',
		replace: 'flex: 0 1 var(--measure-title);',
		expectFail: 'the inline title must not shrink',
	},
	{
		name: 'the inline title rule is deleted entirely',
		find: /^\.cm-rows--inline \.cm-row__title \{[^}]*\}\n/m,
		replace: '',
		expectFail: 'no .cm-rows--inline .cm-row__title rule found',
	},
	{
		name: 'the lower starve band is removed (excerpt squeezes to 5px)',
		find: /@media \(max-width: 844px\) \{\n	\.cm-rows--inline \.cm-row__desc \{ display: none; \}\n\}\n/,
		replace: '',
		// With one query left the COUNT assertion fires before the
		// per-band one, so this is the message actually on the wire.
		// Naming the second one would report a caught mutant as MISSED.
		expectFail: 'expected both starve bands guarded, found 1',
	},
	{
		name: 'the rail starve band loses its upper edge (hides a 205px column at 1440)',
		find: '@media (min-width: 1000px) and (max-width: 1055px) {',
		replace: '@media (min-width: 1000px) {',
		expectFail: 'the rail band needs BOTH edges',
	},
	{
		name: 'the rail band loses its lower edge',
		find: '@media (min-width: 1000px) and (max-width: 1055px) {',
		replace: '@media (max-width: 1055px) {',
		expectFail: 'the rail band needs BOTH edges',
	},
	{
		name: 'both bands collapse into one guessed query',
		find: /@media \(max-width: 844px\) \{\n	\.cm-rows--inline \.cm-row__desc \{ display: none; \}\n\}\n@media \(min-width: 1000px\) and \(max-width: 1055px\) \{\n	\.cm-rows--inline \.cm-row__desc \{ display: none; \}\n\}\n/,
		replace:
			'@media (max-width: 1055px) {\n	.cm-rows--inline .cm-row__desc { display: none; }\n}\n',
		expectFail: 'expected both starve bands guarded',
	},
	{
		name: 'the excerpt stops naming its measure token',
		find: 'max-width: var(--measure-narrow);\n	white-space: nowrap;',
		replace: 'max-width: 34ch;\n	white-space: nowrap;',
		expectFail: 'a page-shape width comes from a measure token',
	},
	{
		name: '--measure-title is declared twice (two owners for one measure)',
		file: TOK,
		find: '--measure-title: 42ch;',
		replace: '--measure-title: 42ch;\n	--measure-title: 50ch;',
		expectFail: '--measure-title is declared 2 times',
	},
	{
		name: '--measure-title is moved into a theme block',
		file: TOK,
		find: /	--measure-title: 42ch;\n/,
		replace: '',
		expectFail: 'the measure tokens are declared once',
	},
];

console.log('mutation harness: .cm-rows--inline\n');
const results = MUTATIONS.map(mutate);
let noops = 0;
for (const r of results) {
	if (r.verdict === 'NO-OP') noops++;
	const mark = r.verdict === 'CAUGHT' ? 'ok  ' : 'BAD ';
	console.log(`${mark} ${r.verdict.padEnd(14)} ${r.name}`);
	if (r.detail) console.log(`                ${r.detail}`);
}

restore();
const bad = results.filter((r) => r.verdict !== 'CAUGHT');
console.log(
	`\n${results.length - bad.length}/${results.length} caught, ` +
	`${noops} NO-OP`,
);
if (noops) console.log('FIX THE HARNESS -- a NO-OP is not a pass.');
process.exit(bad.length ? 1 : 0);
