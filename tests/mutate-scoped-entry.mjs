#!/usr/bin/env node
/* Mutations for the SCOPED-ADOPTION contract tests.

   Every mutation here reproduced a real defect during the hermes-articles
   migration, and every one of them shipped a GREEN BUILD:
     - a components.css path that did not resolve
     - an @import emitted after a declaration block
     - tokens.css imported instead of generated
     - the generated colour tokens silently differing from tokens.css
     - the :not([class]) marker guarantee dropped from the scoped twin

   A sweep that reports survivors is worse than no sweep, so this file:
     - ASSERTS its own pattern matched before counting a result,
     - restores every file it touches with cp, never `git checkout --`
       (which reverts the whole cycle's work on a shared repo),
     - derives the summary from the same counter it increments,
     - treats a broken BUILD as the strongest possible kill.

   Snapshot to a file BEFORE mutating: that snapshot is the only cheap undo.
*/
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GEN = path.join(ROOT, 'scripts/make-scoped-entry.mjs');
const TARGET = process.argv[2] || '/root/projects/hermes-articles/web/src/cm-prose.css';
const REL_COMPONENTS = process.argv[3] || '../cli-mono/components.css';

const GEN_BAK = GEN + '.mutbak';
const TARGET_BAK = TARGET + '.mutbak';
copyFileSync(GEN, GEN_BAK);
if (existsSync(TARGET)) copyFileSync(TARGET, TARGET_BAK);

let killed = 0;
let noop = 0;
const survivors = [];

function restore() {
	copyFileSync(GEN_BAK, GEN);
	if (existsSync(TARGET_BAK)) copyFileSync(TARGET_BAK, TARGET);
}
process.on('exit', restore);

/** Run the suite; non-zero is a KILL (the assertion fired). */
function suiteFails() {
	try {
		execFileSync('node', ['tests/run.mjs'], { cwd: ROOT, stdio: 'pipe' });
		return false;
	} catch {
		return true;
	}
}

/** Run the generator; a non-zero exit is a KILL too. */
function generatorFails(args) {
	try {
		execFileSync('node', ['scripts/make-scoped-entry.mjs', ...args], {
			cwd: ROOT,
			stdio: 'pipe',
		});
		return false;
	} catch {
		return true;
	}
}

function mutate(label, file, from, to, probe) {
	const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
	const src = readFileSync(p, 'utf8');
	if (!src.includes(from)) {
		// A mutation that never matched is a NO-OP, and a no-op counted as
		// a survivor manufactures a false defect report. Loud, instead.
		noop++;
		console.error(`  NO-OP  ${label} (pattern not found in ${path.basename(p)})`);
		restore();
		return;
	}
	writeFileSync(p, src.replace(from, to), 'utf8');
	const dead = probe();
	restore();
	if (dead) {
		killed++;
		console.log(`  KILLED ${label}`);
	} else {
		survivors.push(label);
		console.log(`  SURVIVED ${label}`);
	}
}

console.log('scoped-adoption mutations');

// 1. The hardcoded path that broke the real migration.
mutate(
	'the @import path is hardcoded again',
	GEN,
	"lines.push('@import \"' + relComponents + '\";');",
	'lines.push(\'@import "./cli-mono/components.css";\');',
	() => suiteFails(),
);

// 2. The @import moved below a declaration block, which PostCSS drops.
// 2. The @import moves AFTER the first declaration block. The first cut of
//    this mutation only swapped the import with the blank line that FOLLOWS
//    it, which changes nothing a reader would notice and, correctly, proved
//    nothing. It has to move past an actual rule to be the defect: that is
//    what PostCSS drops.
mutate(
	'the @import is emitted after the token block',
	GEN,
	"lines.push('@import \"' + relComponents + '\";');\n	lines.push('');",
	"lines.push('');\n	lines.push(\"[data-cm-theme='dark'],\");\n	lines.push(\"[data-cm-theme='light'] {\");\n	for (const [n, v] of decls(scale)) lines.push('\	' + n + ': ' + v + ';');\n	lines.push('}');\n	lines.push('');\n	lines.push('@import \"' + relComponents + '\";');",
	() => suiteFails(),
);

// 3. tokens.css imported instead of the colour blocks generated.
mutate(
	'the colour tokens are imported instead of generated',
	GEN,
	"lines.push(\"[data-cm-theme='\" + theme + \"'] {\");",
	"lines.push('@import \"../cli-mono/tokens.css\";');\n\t\tlines.push(\"[data-cm-theme='\" + theme + \"'] {\");",
	() => suiteFails(),
);

// 4. The generator stops verifying that components.css resolves - the guard
//    whose absence let a green build ship nothing.
//
//    PROBED WITH A PATH THAT DOES NOT EXIST. The first cut ran --check with
//    the real REL_COMPONENTS, which resolves; removing the guard changes
//    nothing observable and the mutation correctly survived. A guard is
//    proven by REMOVING its trigger, not by exercising the happy path.
mutate(
	'the generator stops checking that the import resolves',
	GEN,
	'if (!existsSync(resolvedComp)) {',
	'if (false) {',
	() => generatorFails(['--check', '/root/.hermes/cache/scratch/absent-components.css', '--components', 'definitely/not/here.css']),
);

// 5. The :not([class]) guarantee dropped from the scoped twin: bullets come
//    back to being erased by preflight.
mutate(
	'the scoped twin loses the :not([class]) specificity',
	GEN,
	'[data-cm-theme] :is(ul, ol):not([class]) {',
	'[data-cm-theme] :is(ul, ol) {',
	() => suiteFails(),
);

// 6. `ol` loses its own decimal rule.
mutate(
	'the scoped twin drops ol\'s decimal rule',
	GEN,
	'[data-cm-theme] ol:not([class]) {\n\tlist-style-type: decimal;\n}',
	'[data-cm-theme] ol:not([class]) {\n\tlist-style-type: disc;\n}',
	() => suiteFails(),
);

// 7. The generated scale drifts from tokens.css: --check must notice. This
//    is the anti-rot guarantee, so it is tested by EDITING the output.
if (existsSync(TARGET)) {
	mutate(
		'the generated file drifts from tokens.css',
		TARGET,
		'--space-3: 0.75rem;',
		'--space-3: 0.9rem;',
		() => generatorFails(['--check', TARGET, '--components', REL_COMPONENTS]),
	);
	// 8. A hand-edited colour value is the drift that matters most: a
	//    rebrand that never reaches the consumer.
	mutate(
		'a generated colour token is edited by hand',
		TARGET,
		'--ink: #e8e8e8;',
		'--ink: #ff00ff;',
		() => generatorFails(['--check', TARGET, '--components', REL_COMPONENTS]),
	);
}

restore();

console.log(`\n${killed} killed, ${survivors.length} survived, ${noop} no-ops`);
if (survivors.length) {
	for (const s of survivors) console.error(`  SURVIVOR ${s}`);
	process.exit(1);
}
