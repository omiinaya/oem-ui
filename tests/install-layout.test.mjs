// Contract tests for the installer layouts the drift checker can name but
// install.sh could not previously produce.
//
// The defect these cover: check-design-sync.sh prints
//     fix: scripts/install.sh <consumer>
// on every STALE result, and for oem-cdn that command was a NO-OP. oem-cdn
// vendors at web/oem-ui/ with the two JS files RENAMED (runtime.js,
// theme-guard.js) because they are include_str!'d into the Rust binary and
// served from routes named for the rename. No documented invocation of
// install.sh could write that path, so the reported remedy could not be
// performed and the drift was permanent by construction.
//
// These are SOURCE-level tests on the script, in the same spirit as the
// rest of the suite: they read install.sh as text, so they must be written
// to survive the script being rewritten into a different but equivalent
// shape. They deliberately assert the INVARIANT (an embed path is honoured
// verbatim and the bytes come from the library) rather than one spelling.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { statSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const INSTALL = join(REPO, 'scripts', 'install.sh')
const install = readFileSync(INSTALL, 'utf8')

let pass = 0
let fail = 0

function ok(name) {
  console.log(`  ok  ${name}`)
  pass++
}
function no(name, why) {
  console.log(`  FAIL  ${name}\n        ${why}`)
  fail++
}

const has = (re) => re.test(install)

// ---- 0. BEHAVIOUR: actually run the installer -----------------------
//
// The text assertions below cannot see a branch that has been disabled --
// rewriting `if [ -n "$EMBED" ] ...` to `if false` leaves every string in
// the file, so six of them still pass while the flag does nothing. That is
// the mutation this suite was weakest against, and it is the one that
// matters, so the layouts are verified by RUNNING the script and looking at
// the bytes it actually produced.
function runInstaller(args) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-install-'))
  try {
    execFileSync('bash', [INSTALL, dir, '--from', REPO, ...args], { stdio: 'pipe' })
  } catch (e) {
    return { dir, failed: true, stderr: String(e.stderr || '') }
  }
  const files = []
  const walk = (base, rel) => {
    for (const e of readdirSync(base)) {
      const abs = join(base, e)
      const r = rel ? `${rel}/${e}` : e
      if (statSync(abs).isDirectory()) walk(abs, r)
      else files.push(r)
    }
  }
  walk(dir, '')
  return { dir, failed: false, files: files.sort() }
}

const sameBytes = (a, b) => {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

const EMBED_FILES = ['base.css', 'components.css', 'runtime.js', 'theme-guard.js', 'tokens.css']

const LIB_FOR = {
  'tokens.css': join(REPO, 'src/styles/tokens.css'),
  'base.css': join(REPO, 'src/styles/base.css'),
  'components.css': join(REPO, 'src/styles/components.css'),
  'runtime.js': join(REPO, 'src/js/cli-mono.js'),
  'theme-guard.js': join(REPO, 'src/js/cli-mono-theme-guard.js'),
}

const r = runInstaller(['--embed-rename', 'web/oem-ui'])
if (r.failed) {
  no('--embed-rename runs', r.stderr.slice(0, 300))
} else if (JSON.stringify(r.files) !== JSON.stringify(EMBED_FILES.map((f) => `web/oem-ui/${f}`).sort())) {
  no('--embed-rename writes exactly the five renamed files',
     `got ${JSON.stringify(r.files)}`)
} else if (!EMBED_FILES.every((f) => sameBytes(join(r.dir, 'web/oem-ui', f), LIB_FOR[f]))) {
  no('--embed-rename writes the five renamed files',
     'the renamed copy is not byte-identical to the library')
} else {
  ok('--embed-rename writes exactly the five renamed files, byte-identical')
}

const e = runInstaller(['--embed', 'vendor/ui'])
if (e.failed) {
  no('--embed runs', e.stderr.slice(0, 300))
} else if (!existsSync(join(e.dir, 'vendor/ui/cli-mono.js')) ||
           !existsSync(join(e.dir, 'vendor/ui/cli-mono-theme-guard.js')) ||
           existsSync(join(e.dir, 'src/styles/cli-mono'))) {
  no('--embed uses the given directory and no default layout',
     `got ${JSON.stringify(e.files)}`)
} else {
  ok('--embed uses the given directory and writes no default-layout copy')
}

// The escape probe gets its OWN unique destination and asserts the install
// wrote NOTHING anywhere -- not merely that a guessed path is absent.
//
// The previous version checked `join(tmpdir(), 'escape')`, a fixed,
// shared name. Two ways that lies:
//   1. It is not unique, so an unrelated leftover at that path fails the
//      test. Observed in this very repo: the mutation sweep below removes
//      the escape guard, and the run that does so leaves
//      $TMPDIR/escape behind (it is outside the repo, so the sweep's own
//      restore cannot clean it). Every LATER run then fails on a directory
//      this test never created -- a green sweep followed by a red suite,
//      for a defect that does not exist.
//   2. Checking one guessed path cannot tell "rejected" from "wrote
//      somewhere else". Assert the whole parent directory is untouched.
{
  // Unique per run, and the parent is a temp dir we own, so an escape can
  // only land inside a tree that is empty to begin with.
  const sandbox = mkdtempSync(join(tmpdir(), 'cm-escape-'))
  const leaf = `escape-${process.pid}`
  const before = readdirSync(sandbox)
  const esc = (() => {
    try {
      execFileSync('bash', [INSTALL, sandbox, '--from', REPO, '--embed', `../${leaf}`],
                   { stdio: 'pipe' })
      return { failed: false }
    } catch (e) {
      return { failed: true, stderr: String(e.stderr || '') }
    }
  })()
  const escaped = readdirSync(sandbox).filter((f) => !before.includes(f))
  const leakedTo = join(sandbox, '..', leaf)
  const leaked = existsSync(leakedTo)
  rmSync(sandbox, { recursive: true, force: true })
  if (!esc.failed) {
    no('--embed refuses a path outside the target',
       'the installer exited 0 on a ../ path')
  } else if (escaped.length) {
    no('--embed refuses a path outside the target',
       `it still wrote inside the target: ${JSON.stringify(escaped)}`)
  } else if (leaked) {
    no('--embed refuses a path outside the target',
       `it created ${leakedTo}`)
  } else {
    ok('--embed refuses a path outside the target, writing nothing at all')
  }
}

// ---- 1. the flags exist and are advertised --------------------------
for (const flag of ['--embed', '--embed-rename']) {
  if (has(new RegExp(flag.replace(/-/g, '\\-'))) && has(new RegExp(`${flag}\\)`))) {
    ok(`install.sh accepts ${flag}`)
  } else {
    no(`install.sh accepts ${flag}`, `no case arm matching ${flag}`)
  }
}

if (/--embed|--embed-rename/.test(install)) {
  ok('the embedded layout is documented in the script header')
} else {
  no('the embedded layout is documented in the script header',
     'a flag nobody can discover is the same defect as no flag')
}

// ---- 2. --embed-rename produces the RUNTIME.RENAME pair -------------
// The whole reason this flag exists. Assert the two destination names, and
// assert they are attached to the right SOURCE file (a copy that renames
// the guard but serves it under the runtime's name is worse than no rename).
const renamesGuard = /GUARD_DEST=["']\$CSS_DIR\/theme-guard\.js["']/.test(install)
const renamesRuntime = /JS_DEST=["']\$CSS_DIR\/runtime\.js["']/.test(install)
if (renamesRuntime && renamesGuard) {
  ok('the embedded rename serves runtime.js and theme-guard.js')
} else {
  no('the embedded rename serves runtime.js and theme-guard.js',
     `runtime rename=${renamesRuntime} guard rename=${renamesGuard}`)
}

// ---- 3. the embed path is used VERBATIM -----------------------------
// The regression this test exists for: selecting between the two flags with
// ${EMBED_RENAME:-$EMBED} APPENDS rather than chooses, so `--embed web/oem-ui`
// wrote to web/oem-uiweb/oem-ui. Assert the path is assigned on its own.
if (/if \[ -n "\$EMBED" \]; then DIR=["']\$EMBED["']; else DIR=["']\$EMBED_RENAME["']; fi/.test(install)) {
  ok('the embed directory is the flag value, not a concatenation of both')
} else {
  no('the embed directory is the flag value, not a concatenation of both',
     'DIR must be assigned from exactly one of the two mutually exclusive flags')
}

// ---- 4. the path cannot escape the target ---------------------------
// An installer that writes outside the project it was pointed at is a
// footgun; both escapes are rejected before anything is installed.
if (/\*\)\s*die "--embed takes a path INSIDE/.test(install) && /\.\.\/\*\)\s*die "--embed path escapes/.test(install)) {
  ok('an absolute or escaping embed path is refused')
} else {
  no('an absolute or escaping embed path is refused',
     'both the absolute-path and ../ guards must reject before install')
}

// ---- 5. the five files still come from the library ------------------
// A rename must not become a reimplementation: all five installs must read
// from $FROM, so --embed cannot smuggle in a second copy of the truth.
//
// The COUNT is deliberately not asserted as exactly 5: --public installs
// two MORE files from the same $FROM (the verbatim-serve copies), so the
// script legitimately contains seven such installs. Asserting 5 made this
// test fail on correct code. What matters is that no install reads from
// anywhere but $FROM -- every source path starts $FROM/.
const sources = [...install.matchAll(/install -m 0644 "\$FROM\/([^"]+)"/g)].map((m) => m[1])
const want = ['src/styles/tokens.css', 'src/styles/base.css', 'src/styles/components.css',
              'src/js/cli-mono.js', 'src/js/cli-mono-theme-guard.js']
// Every install must read from $FROM. Counting "$FROM/" as a substring of
// each captured source is simpler and escapes nothing, so it cannot be
// broken by one extra backslash in a lookahead (which is what a previous
// version of this test did -- it reported every $FROM install as a stray).
const allSources = [...install.matchAll(/install -m 0644 "([^"]+)"/g)].map((m) => m[1])
const strayInstalls = allSources.filter((s) => !s.startsWith('$FROM/'))
if (want.every((w) => sources.includes(w)) && strayInstalls.length === 0) {
  ok('every installed file is copied from the library, none rewritten')
} else {
  no('every installed file is copied from the library, none rewritten',
     `missing ${JSON.stringify(want.filter((w) => !sources.includes(w)))} ` +
     `non-$FROM installs ${JSON.stringify(strayInstalls)}`)
}

// ---- 6. the embedded layout does not ALSO write the default paths ----
// --embed must be an alternative layout. If it fell through to the
// src/ branch it would drop a second, unserved copy into the consumer --
// precisely the defect this repo already hit with public/.
// The default layout is now assigned inside the discovery fallback (an
// ARRAY of one, not the old single CSS_DIR=), so match either spelling:
// what the test protects is the embed BRANCH, not a variable name.
if (/elif \[ "\$FLAT" -eq 1 \]/.test(install) && /CSS_DIRS?=\(?["']?\$TARGET\/src\/styles\/cli-mono/.test(install)) {
  const embedBlock = install.slice(install.indexOf('-n "$EMBED"'), install.indexOf('elif [ "$FLAT"'))
  if (!/src\/styles\/cli-mono/.test(embedBlock)) {
    ok('the embedded layout does not also write src/styles/cli-mono')
  } else {
    no('the embedded layout does not also write src/styles/cli-mono',
       'the embed branch assigns CSS_DIR before the elif, so the src/ path must not appear inside it')
  }
} else {
  no('the embedded layout does not also write src/styles/cli-mono', 'the if/elif chain shape changed')
}

// ---- 7. BEHAVIOUR: a plain run updates the copy the target SERVES ----
//
// check-design-sync.sh prints `fix: scripts/install.sh <target>` with no
// layout flag. For a target whose layers live under web/src (kanban,
// memory, rpm) or plugin/ (browser-hub) or beside a renamed runtime
// (oem-cdn), that bare command used to create a SECOND copy under src/ and
// leave the served one stale - and the checker then discovered the fresh
// shadow and reported in sync. So the remedy must be performable as
// printed. These run the real script.
function freshTarget(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}
function run(target, args = []) {
  return execFileSync('bash', [INSTALL, target, '--from', REPO, ...args], { stdio: 'pipe' })
}
const libTokens = () => readFileSync(join(REPO, 'src/styles/tokens.css'), 'utf8')
const libJs = () => readFileSync(join(REPO, 'src/js/cli-mono.js'), 'utf8')

// 7a. a stale copy under web/src is refreshed and NO src/ shadow appears.
{
  const t = freshTarget('cm-detect-web-')
  try {
    mkdirSync(join(t, 'web/src/styles/cli-mono'), { recursive: true })
    mkdirSync(join(t, 'web/src/js'), { recursive: true })
    writeFileSync(join(t, 'web/src/styles/cli-mono/tokens.css'), libTokens() + '\n/* stale */\n')
    writeFileSync(join(t, 'web/src/js/cli-mono.js'), '// stale runtime\n')
    run(t)
    if (readFileSync(join(t, 'web/src/styles/cli-mono/tokens.css'), 'utf8') === libTokens()) {
      ok('a bare run refreshes the web/src copy the target already serves')
    } else no('a bare run refreshes the web/src copy the target already serves',
              'the discovered copy was not rewritten with library bytes')
    if (readFileSync(join(t, 'web/src/js/cli-mono.js'), 'utf8') === libJs()) {
      ok('a bare run refreshes that copy runtime even when it is badly stale')
    } else no('a bare run refreshes that copy runtime even when it is badly stale',
              'a stale cli-mono.js must still be recognised by name')
    if (!existsSync(join(t, 'src'))) {
      ok('a bare run creates NO src/ shadow when a copy already exists')
    } else no('a bare run creates NO src/ shadow when a copy already exists',
              'src/ exists: the old default-layout behaviour is back')
  } finally { rmSync(t, { recursive: true, force: true }) }
}

// 7b. a RENAMED runtime is recognised by content and both halves updated.
{
  const t = freshTarget('cm-detect-renamed-')
  try {
    mkdirSync(join(t, 'web/oem-ui'), { recursive: true })
    for (const f of ['tokens.css', 'base.css', 'components.css']) {
      writeFileSync(join(t, `web/oem-ui/${f}`), readFileSync(join(REPO, `src/styles/${f}`), 'utf8'))
    }
    writeFileSync(join(t, 'web/oem-ui/runtime.js'), '// stale\n')
    writeFileSync(join(t, 'web/oem-ui/theme-guard.js'), readFileSync(join(REPO, 'src/js/cli-mono-theme-guard.js'), 'utf8'))
    run(t)
    if (readFileSync(join(t, 'web/oem-ui/runtime.js'), 'utf8') === libJs()) {
      ok('a renamed runtime.js is recognised and refreshed in place')
    } else no('a renamed runtime.js is recognised and refreshed in place',
              'runtime.js was not matched, so a renamed adoption can never be repaired')
    if (!existsSync(join(t, 'src'))) {
      ok('the renamed layout gains no src/ shadow')
    } else no('the renamed layout gains no src/ shadow', 'src/ was created anyway')
  } finally { rmSync(t, { recursive: true, force: true }) }
}

// 7c. the flag-less run still produces the documented default on a target
// that has nothing to update - discovery may only CHOOSE, never replace the
// default for a new project.
{
  const t = freshTarget('cm-detect-new-')
  try {
    run(t)
    if (existsSync(join(t, 'src/styles/cli-mono/tokens.css')) && !existsSync(join(t, 'cli-mono'))) {
      ok('a target with nothing installed still gets the default src/ layout')
    } else no('a target with nothing installed still gets the default src/ layout',
              'expected src/styles/cli-mono/tokens.css and no flat dir')
  } finally { rmSync(t, { recursive: true, force: true }) }
}

// 7d. MUTATION LEVER: force the content threshold off the end and discovery
// must find nothing - which makes 7a fail rather than silently pass. This
// is what proves the tests above are reading discovery's result and not
// just the script succeeding.
{
  const t = freshTarget('cm-detect-lever-')
  try {
    mkdirSync(join(t, 'web/src/styles/cli-mono'), { recursive: true })
    writeFileSync(join(t, 'web/src/styles/cli-mono/tokens.css'), libTokens())
    execFileSync('bash', [INSTALL, t, '--from', REPO],
      { stdio: 'pipe', env: { ...process.env, OEM_UI_INSTALL_PCT: '101' } })
    if (existsSync(join(t, 'src'))) {
      ok('with discovery disabled the script falls back to the default layout (mutation lever works)')
    } else no('with discovery disabled the script falls back to the default layout (mutation lever works)',
              'OEM_UI_INSTALL_PCT=101 should find no copy and create src/')
  } finally { rmSync(t, { recursive: true, force: true }) }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)