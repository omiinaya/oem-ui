#!/usr/bin/env node
/**
 * Mutation check for the two new contract tests:
 *   1. every class a shipped component emits is defined in the CSS
 *   2. every shipped Astro component is rendered by the showcase
 *
 * usage: node mut-new-tests.mjs <path-to-oem-ui>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const SHOWCASE = join(root, 'src/pages/index.astro');
const ASTRO = join(root, 'src/astro');
const run = () => spawnSync('node', [join(root, 'tests/run.mjs')], { cwd: root, encoding: 'utf8' });

const backups = new Map();
// The test file itself is a mutation target, so it MUST be backed up. The
// first run of this script omitted it, and two mutations survived the
// restore and left the suite red — the exact failure mode a mutation
// harness that does not verify its own cleanup is guaranteed to hide.
for (const p of [SHOWCASE, join(root, 'tests/run.mjs'), join(root, 'src/styles/components.css'), ...readdirSync(ASTRO).map((f) => join(ASTRO, f))]) {
	backups.set(p, readFileSync(p, 'utf8'));
}
const restore = () => { for (const [p, s] of backups) writeFileSync(p, s); };

const CLS = 'every class a shipped component emits is defined in the CSS';
const RENDER = 'every shipped Astro component is rendered by the showcase';

const MUTATIONS = [
	{ name: 'drop the <PostHead> import from the showcase', target: RENDER, path: SHOWCASE,
		from: /import PostHead from '\.\.\/astro\/PostHead\.astro';\n/, to: '' },
	{ name: 'import <PostHead> but never render it', target: RENDER, path: SHOWCASE,
		from: /<PostHead[\s\S]*?\/>/, to: '<!-- removed -->' },
	{ name: 'exempt every component from the render check', target: RENDER, path: join(root, 'tests/run.mjs'),
		from: /if \(NOT_RENDERABLE_BY_A_SHOWCASE_PAGE\[f\]\) continue;/,
		to: 'for (const k of Object.keys(NOT_RENDERABLE_BY_A_SHOWCASE_PAGE)) {}' },
	{ name: 'make a component emit a class with no rule again', target: CLS, path: join(ASTRO, 'Footer.astro'),
		from: /class="cm-footer"/, to: 'class="cm-footer cm-footerish"' },
	{ name: 'revert the parser to accept a descendant-only mention', target: CLS, path: join(root, 'tests/run.mjs'),
		from: "const subject = sel.trim().split(/\\s+|>|\\+|~/).pop() || '';",
		to: 'const subject = sel.trim();',
		// Not a missed defect: a loose parser is only a weakness when a
		// class has NO rule at all, and .cm-post-head legitimately has
		// descendant rules. Alone this is an equivalent mutant. The
		// compound mutation below is the one that proves the check fires
		// on the state the library was actually found in.
		equivalent: true },
	{ name: 'stop scanning the markup for classes at all', target: CLS, path: join(root, 'tests/run.mjs'),
		from: 'for (const m of src.matchAll(/class(:list)?[=\\s]*[\\[{\'\"]([^\\]}\'"]+)[\\]}\'"]/g)) {',
		to: 'for (const m of [].map(() => [0, 0, ""])) {' },
];

let caught = 0, bad = 0, equivalent = 0;
for (const m of MUTATIONS) {
	const src = readFileSync(m.path, 'utf8');
	const matched = m.from instanceof RegExp ? m.from.test(src) : src.includes(m.from);
	if (!matched) {
		bad++;
		console.log(`NO-OP   ${m.name} — pattern did not match ${m.path}`);
		restore();
		continue;
	}
	try {
		writeFileSync(m.path, src.replace(m.from, m.to));
		const r = run();
		const ok = r.status !== 0 && r.stdout.includes(`FAIL  ${m.target}`);
		if (ok) { caught++; console.log(`caught  ${m.name}`); }
		else if (m.equivalent) { equivalent++; console.log(`equiv   ${m.name} (no behaviour change while the class has descendant rules)`); }
		else { bad++; console.log(`MISSED  ${m.name} (exit ${r.status})`); }
	} finally { restore(); }
}

// Loosening the parser on its own does NOT break the suite, and that is
// correct: it is only a weakness in combination with an actual missing
// rule. So the mutation that matters is the compound one - delete the
// rule AND revert the parser - which is precisely the state the library
// was found in. A single-step mutation here would report a false pass.
{
	const name = 'delete .cm-post-head AND revert the parser to a loose match';
	const css = join(root, 'src/styles/components.css');
	const cssOrig = backups.get(css) ?? readFileSync(css, 'utf8');
	const testOrig = backups.get(join(root, 'tests/run.mjs'));
	try {
		writeFileSync(css, cssOrig.replace(/\.cm-post-head[^{]*\{[^}]*\}/g, ''));
		writeFileSync(
			join(root, 'tests/run.mjs'),
			testOrig.replace("const subject = sel.trim().split(/\\s+|>|\\+|~/).pop() || '';", 'const subject = sel.trim();'),
		);
		const r = run();
		const ok = r.status !== 0 && r.stdout.includes(`FAIL  ${CLS}`);
		if (ok) { caught++; console.log(`caught  ${name}`); }
		else { bad++; console.log(`MISSED  ${name} (exit ${r.status})`); }
	} finally {
		restore();
		backups.set(css, cssOrig);
	}
}

const after = run();
const green = after.status === 0;
console.log(`\n${caught} caught, ${equivalent} equivalent, ${bad} missed/no-op, suite after restore: ${green ? 'green' : 'RED'}`);
process.exit(caught === MUTATIONS.length && green ? 0 : 1);
