/**
 * Mutation proof for the SectionHead contract tests.
 *
 * The defect this component fixes is INVISIBLE to a class-presence test:
 * `.cm-section__title` was defined, correct in isolation, shipped to rpm,
 * and rendered nowhere - while rpm hand-wrote the same block 18 times. So a
 * test that only asks "is the class there" passes on a library whose
 * component nobody uses. Each mutation below removes exactly one of the
 * things that makes the component real, and each MUST fail the suite.
 *
 * A mutation that does not change the file is a BROKEN MUTATION and is
 * reported as such, never as a pass - a no-op that looks like a kill is
 * worse than no test at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = '/root/projects/oem-ui';
const p = (f) => `${ROOT}/${f}`;

/* These tests read the BUILT page, and three of the six mutations change
   component source. Without a rebuild between mutate and assert, the
   harness would report a green suite against a `dist/` built from the
   UNMUTATED file - a mutation that cannot fail reported as surviving, or
   worse, a kill attributed to the wrong cause. The build is part of the
   mutation, not an optimisation. */
function rebuild() {
	const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
	// A compile failure is the STRONGEST kill available, not a no-op: the
	// mutation broke the build, so the thing under test is definitively
	// not the thing that shipped.
	return b.status === 0;
}

const MUTATIONS = [
	['the component stops rendering a section title at all',
		'src/astro/SectionHead.astro',
		(s) => s.replace('class="cm-section__title"', 'class="cm-nope"')],
	['the title wears the PAGE title size, which is the bug it replaced',
		'src/styles/components.css',
		(s) => s.replace('font-size: var(--head-h2);', 'font-size: var(--head-h1);')],
	['the heading scale step goes back to a raw literal',
		'src/styles/components.css',
		(s) => s.replace('font-size: var(--head-h2);', 'font-size: 1.15rem;')],
	['the sub reverts to the page-head class it replaced',
		'src/astro/SectionHead.astro',
		(s) => s.replace('class="cm-section__sub"', 'class="cm-head__sub"')],
	['the action slot stops rendering the action wrapper',
		'src/astro/SectionHead.astro',
		(s) => s.replace('class="cm-head-row__action"', 'class="cm-nope"')],
	['the slot escapes the caller markup (string prop instead of a slot)',
		'src/astro/SectionHead.astro',
		(s) => s.replace('<slot />', '{sub}')],
];

let killed = 0;
let broken = 0;
const survivors = [];

for (const [name, file, mutate] of MUTATIONS) {
	const path = p(file);
	const orig = readFileSync(path, 'utf8');
	const mutated = mutate(orig);
	if (mutated === orig) {
		console.log(`  BROKEN MUTATION  ${name} - the pattern matched nothing in ${file}`);
		broken++;
		continue;
	}
	writeFileSync(path, mutated);
	const built = rebuild();
	let killedNow = false;
	let why = '';
	if (!built) {
		killedNow = true;
		why = 'the build itself failed - the strongest kill available';
	} else {
		const r = spawnSync('node', ['tests/run.mjs'], { cwd: ROOT, encoding: 'utf8' });
		killedNow = r.status !== 0;
		why = (r.stdout.match(/^FAIL .*$/m) || ['(no FAIL line)'])[0].trim();
	}
	writeFileSync(path, orig);
	if (killedNow) {
		killed++;
		console.log(`  KILLED  ${name}`);
		console.log(`          ${why}`);
	} else {
		survivors.push(name);
		console.log(`  SURVIVED  ${name}  <-- the test cannot see this`);
	}
}

console.log(`\n${killed}/${MUTATIONS.length} killed, ${broken} broken, ${survivors.length} survived`);
process.exit(survivors.length || broken ? 1 : 0);
