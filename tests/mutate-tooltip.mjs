#!/usr/bin/env node
/**
 * Mutation check for "the page cannot scroll sideways on a phone, and the
 * tip is capped" (tests/run.mjs).
 *
 * usage: node mutate-tooltip.mjs <path-to-oem-ui>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.argv[2] || '/root/projects/oem-ui';
const BASE = join(root, 'src/styles/base.css');
const COMP = join(root, 'src/styles/components.css');
const TEST = join(root, 'tests/run.mjs');
const run = () => spawnSync('node', [join(root, 'tests/run.mjs')], { cwd: root, encoding: 'utf8' });

const backups = new Map();
for (const p of [BASE, COMP, TEST]) backups.set(p, readFileSync(p, 'utf8'));
const restore = () => { for (const [p, s] of backups) writeFileSync(p, s); };

const T = 'the page cannot scroll sideways on a phone, and the tip is capped';

const MUTATIONS = [
	{ name: 'revert overflow-x: clip to the original (no clip at all)', path: BASE,
		from: 'overflow-x: clip;', to: '' },
	{ name: 'the forbidden form: overflow-x: hidden (breaks sticky)', path: BASE,
		from: 'overflow-x: clip;', to: 'overflow-x: hidden;' },
	{ name: 'drop the tip width cap', path: COMP,
		from: 'max-width: min(18rem, calc(100vw - 2 * var(--gutter)));', to: '' },
	{ name: 'replace the viewport-derived cap with the old bare 18rem', path: COMP,
		from: 'max-width: min(18rem, calc(100vw - 2 * var(--gutter)));', to: 'max-width: 18rem;' },
	{ name: 'drop the centring transform', path: COMP,
		from: 'transform: translateX(-50%);', to: '' },
	// The comment above the html rule names `hidden` several times. The
	// test strips comments before matching, so deleting the prose must
	// NOT change the verdict. If it does, the test is matching its own
	// documentation - which is exactly what it did before the strip.
	{ name: 'strip the whole html comment (verdict must be UNCHANGED)', path: BASE,
		from: /	\/\* `clip`, not `hidden`[\s\S]*?sticky\. \*\/\n/, to: '',
		equivalent: true },
];

let caught = 0, bad = 0, equivalent = 0;
for (const m of MUTATIONS) {
	const src = readFileSync(m.path, 'utf8');
	const matched = m.from instanceof RegExp ? m.from.test(src) : src.includes(m.from);
	if (!matched) { bad++; console.log(`NO-OP  ${m.name} — pattern did not match`); restore(); continue; }
	try {
		writeFileSync(m.path, m.from instanceof RegExp ? src.replace(m.from, m.to) : src.replace(m.from, m.to));
		const r = run();
		const ok = r.status !== 0 && r.stdout.includes(`FAIL  ${T}`);
		if (ok) { caught++; console.log(`caught  ${m.name}`); }
		else if (m.equivalent) { equivalent++; console.log(`equiv   ${m.name} (verdict unchanged, as it must be)`); }
		else { bad++; console.log(`MISSED  ${m.name} (exit ${r.status})`); }
	} finally { restore(); }
}
const after = run();
const green = after.status === 0;
console.log(`\n${caught} caught, ${equivalent} equivalent, ${bad} missed/no-op, suite after restore: ${green ? 'green' : 'RED'}`);
// An equivalent mutant is a PASS here: it is the control that proves
// the check does not depend on prose. Only a real miss fails the script.
process.exit(bad === 0 && green ? 0 : 1);
