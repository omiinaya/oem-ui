#!/usr/bin/env node
/**
 * Differentiate "the suite is too weak to see this" from "no test COULD ever
 * see this".
 *
 * Two mutations in the current.ts sweep survived. Both mutate a defensive
 * clause - the `there !== '/'` guard and the `here === null` guard - so the
 * question is whether the suite is blind or the mutation is genuinely
 * behaviour-preserving. Reporting both as SURVIVED is the honest-looking
 * lie: it says "the suite cannot see this", when the truth may be "nothing
 * can see this, because the guard is unreachable given normalise()'s
 * contract".
 *
 * So this runs the module itself, before and after the mutation, over an
 * EXHAUSTIVE corpus of (href, pathname, matchSegment) triples and compares.
 * Identical output means the mutation cannot affect behaviour at all and no
 * test exists that could kill it - that is a statement about the CODE, and
 * it gets filed as DEAD, not as a gap in the suite. Differing output with a
 * green suite is a real survivor and stays one.
 *
 *     node tests/probe-current-diff.mjs <file.ts> <file.ts.mutated>
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The corpus: every path shape normalise() can produce, crossed with the
// href shapes a nav actually renders, plus the external/null cases.
const PATHS = [
	'/',
	'',
	'/a',
	'/a/',
	'/a/b',
	'/a/b/c',
	'/v2',
	'/v2/api',
	'/blog',
	'/blog/',
	'/blog/a-post',
	'/about',
	'/dev-blog',
	'/dev-blog/',
	'/dev-blog/about',
	'/dev-blog/about/',
	'/about/',
	// Paths with a doubled slash. These are NOT exotic: `normalise` strips a
	// base prefix and REJOINS the remainder with a single leading slash, so a
	// URL whose path legitimately contains `//` after the prefix comes back
	// as `//x`. The first version of this corpus omitted them and reported
	// two mutations as behaviour-identical when one of them is reachable
	// exactly here - the corpus's silence is not the code's silence.
	'/dev-blog//x',
	'/dev-blog//x/y',
	'/dev-blog///a//b',
	'//x',
];
const HREFS = [
	...PATHS,
	...PATHS.map((p) => `${p}#section`),
	...PATHS.map((p) => `${p}?q=1`),
	...PATHS.map((p) => `${p}/`),
	'#',
	'#nav',
	'#section',
	'https://example.com/blog/',
	'https://example.com/',
	'//example.com/blog/',
	'mailto:a@b.co',
	'   #spaced',
	'   /spaced',
];

const scriptFor = (file) => `
import { isCurrentPage } from ${JSON.stringify(file)};
const PATHS = ${JSON.stringify(PATHS)};
const HREFS = ${JSON.stringify(HREFS)};
// base is a DIMENSION, not a constant. Pinning it to '/' makes every
// base-prefixed path unreachable, and an unreachable branch looks exactly
// like an absent one - which is how this probe reported a reachable mutation
// as behaviour-identical on its first run.
const BASES = ['/', '/dev-blog', ''];
const out = [];
for (const base of BASES) for (const href of HREFS) for (const p of PATHS) for (const ms of [false, true]) {
	let r;
	try { r = isCurrentPage(href, p, base, ms); } catch (e) { r = 'THREW: ' + e.message; }
	out.push([base, href, p, ms, r]);
}
console.log(JSON.stringify(out));
`;

export function fingerprint(file) {
	const dir = mkdtempSync(join(tmpdir(), 'cm-current-'));
	// The module under test, plus a shim that exports whatever the real
	// module exports, so MODPATH resolution works for either name.
	const probe = join(dir, 'probe.mjs');
	writeFileSync(probe, scriptFor(file));
	try {
		return execSync(`node --experimental-strip-types ${probe}`, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} finally {
		execSync(`rm -rf ${dir}`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [, , a, b] = process.argv;
	if (!a || !b) {
		console.error('usage: probe-current-diff.mjs <original.ts> <mutated.ts>');
		process.exit(2);
	}
	const fa = fingerprint(a);
	const fb = fingerprint(b);
	if (fa === fb) {
		console.log('DEAD: behaviour-identical over ' + PATHS.length * HREFS.length * 2 + ' cases');
		process.exit(1);
	}
	console.log('DIFFERS: the mutation is observable');
	process.exit(0);
}