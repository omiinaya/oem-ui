#!/usr/bin/env python3
"""Mutation-prove the batch-28 shadcn Menubar parity checks.

    python3 tests/mutate-menubar-parity.py [--suite | --live]

Rules this runner follows, in order:

  1. PRE-CHECK. Every mutant's pattern must appear EXACTLY ONCE in its file
     before anything is touched. A pattern that is not there would make the
     whole run vacuous - nothing to mutate, everything "passes" - so a
     missing or duplicated pattern VOIDS the run (exit 2) instead of
     counting as a kill.
  2. BASELINE. Both harnesses are run on the untouched tree first; if either
     fails, mutants are meaningless (exit 3).
  3. A mutant is KILLED when its harness exits nonzero. A harness that
     crashes, times out or cannot start is a kill - never a pass.
  4. ATTRIBUTION. The FAIL lines are parsed: a kill whose failures include
     one of the six new parity checks (or one of the eight live checks) is
     reported as KILL(new). A kill that only fails OLD checks proves nothing
     about this batch and is reported as KILL(old) - that counts as a
     failure of this proof, not as success.
  5. RESTORE. The file is written back byte-for-byte after each mutant and
     the restore is verified against the bytes read at startup; live
     mutants also rebuild dist, and dist is rebuilt again at the end.

Exit 0 only when every pattern was found exactly once, every harness
baseline passed and every mutant died at the hands of a new check.
"""

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITE = ['node', 'tests/run.mjs']
LIVE = ['/root/.venvs/mau/bin/python', 'tests/verify-menubar-parity.py']
BUILD = ['npm', 'run', 'build']

NEW_SUITE = [
    'the bar is ONE tab stop and init re-derives it',
    'a disabled word is refused by every door that could open it',
    'the bar owns a submenu and leaves its keys to it',
    'a checkbox row in a bar panel flips in place',
    'the bar radio group moves selection, one row at a time',
    'the bar panels compose icons, group labels and hints',
]
NEW_LIVE = [
    'the bar, its four words and their panels are on the page',
    'Tab enters the bar once, and the stop follows focus',
    'the disabled word refuses arrows, Enter and the pointer',
    'the submenu opens Right, returns Left, and the bar keeps its hands off',
    'the checkbox row flips in place, and its glyph follows',
    'the radio group moves selection and draws the dot',
    'the panels compose icons, group labels and hints',
    'the panel measures square, grey and anchored to its word',
]

CHECKBOX_ROW = (
    "<!-- A checkbox item in the SAME list as the plain rows: the glyph\n"
    "\t\t\t\t\t\t     slot carries the check, so the column never moves when it\n"
    "\t\t\t\t\t\t     flips. toggleCheckable() is the dropdown's, unchanged. -->\n"
    "\t\t\t\t\t\t<button type=\"button\" class=\"cm-dropdown__item\" "
    "role=\"menuitemcheckbox\" aria-checked=\"true\" data-cm-check>"
)
MENUBAR_GUARD = (
    "if (e.defaultPrevented) return;\n"
    "\t\tvar bar = e.target && e.target.closest && e.target.closest('[data-cm-menubar]');"
)
DISABLED_RULE = (
    ".cm-menubar__trigger[aria-disabled='true'],\n"
    ".cm-menubar__trigger[aria-disabled='true']:hover {\n"
    "\tbackground: transparent;\n"
    "\tcolor: var(--ink-faint);\n"
    "\tcursor: default;\n"
    "}"
)

# id, file, pattern, replacement, harness ('suite' | 'live'), rebuild?
MUTANTS = [
    ('s01 one authored tab stop', 'src/pages/index.astro',
     'popovertarget="mb-file" aria-haspopup="menu" role="menuitem" tabindex="0">file</button>',
     'popovertarget="mb-file" aria-haspopup="menu" role="menuitem">file</button>',
     'suite', False),
    ('s02 stop skips the disabled word', 'src/js/cli-mono.js',
     "if (trg && trg.getAttribute('aria-disabled') !== 'true') menubarRove(bar, trg);",
     'if (trg) menubarRove(bar, trg);',
     'suite', False),
    ('s03 the specimen ships a disabled word', 'src/pages/index.astro',
     'popovertarget="mb-help" aria-haspopup="menu" role="menuitem" aria-disabled="true" tabindex="-1">help</button>',
     'popovertarget="mb-help" aria-haspopup="menu" role="menuitem" tabindex="-1">help</button>',
     'suite', False),
    ('s04 menubarTriggers filters aria-disabled', 'src/js/cli-mono.js',
     "b.getAttribute('aria-disabled') !== 'true'",
     "b.getAttribute('aria-disabled') !== 'zzz'",
     'suite', False),
    ('s05 the row that owns the submenu', 'src/pages/index.astro',
     'aria-haspopup="menu" aria-controls="mb-export">',
     'aria-haspopup="menu" aria-controls="mb-nowhere">',
     'suite', False),
    ('s06 the bar stands down for a consumed key', 'src/js/cli-mono.js',
     MENUBAR_GUARD,
     "var bar = e.target && e.target.closest && e.target.closest('[data-cm-menubar]');",
     'suite', False),
    ('s07 the bar checkbox row', 'src/pages/index.astro',
     CHECKBOX_ROW,
     CHECKBOX_ROW.replace('role="menuitemcheckbox"', 'role="menuitem"'),
     'suite', False),
    ('s08 toggleCheckable flips both ways', 'src/js/cli-mono.js',
     "item.setAttribute('aria-checked', on ? 'true' : 'false');",
     "item.setAttribute('aria-checked', 'false');",
     'suite', False),
    ('s09 the radio rows share one name', 'src/pages/index.astro',
     'role="menuitemradio" aria-checked="false" data-cm-radio="mb-scale">',
     'role="menuitemradio" aria-checked="false" data-cm-radio="mb-other">',
     'suite', False),
    ('s10 the radio dot rule', 'src/styles/components.css',
     ".cm-dropdown__item[role='menuitemradio'][aria-checked='true'] .cm-dropdown__icon::before { content: \"\\25cf\"; }",
     ".cm-dropdown__item[role='menuitemradio'][aria-checked='zzz'] .cm-dropdown__icon::before { content: \"\\25cf\"; }",
     'suite', False),
    ('s11 a group label in the bar', 'src/pages/index.astro',
     'class="cm-dropdown__group-label" id="mb-grp-create"',
     'class="cm-dropdown__grp-label" id="mb-grp-create"',
     'suite', False),
    ('s12 the icon slot rule', 'src/styles/components.css',
     '.cm-dropdown__icon {\n\tflex: none;',
     '.cm-dropdown__ico {\n\tflex: none;',
     'suite', False),
    ('s13 the group label rule', 'src/styles/components.css',
     '.cm-dropdown__group-label {\n\tpadding:',
     '.cm-dropdown__grp {\n\tpadding:',
     'suite', False),
    ('s14 the disabled word drops to faint ink', 'src/styles/components.css',
     DISABLED_RULE,
     DISABLED_RULE.replace('var(--ink-faint)', 'var(--ink)'),
     'suite', False),
    ('l01 the walk skips the disabled word', 'src/js/cli-mono.js',
     "b.getAttribute('aria-disabled') !== 'true'",
     "b.getAttribute('aria-disabled') !== 'zzz'",
     'live', True),
    ('l02 the disabled word dims to a token', 'src/styles/components.css',
     DISABLED_RULE,
     DISABLED_RULE.replace('var(--ink-faint)', 'var(--ink)'),
     'live', True),
    ('l03 the checked radio draws its dot', 'src/styles/components.css',
     ".cm-dropdown__item[role='menuitemradio'][aria-checked='true'] .cm-dropdown__icon::before { content: \"\\25cf\"; }",
     ".cm-dropdown__item[role='menuitemradio'][aria-checked='zzz'] .cm-dropdown__icon::before { content: \"\\25cf\"; }",
     'live', True),
    ('l04 the bar keeps its hands off a submenu', 'src/js/cli-mono.js',
     MENUBAR_GUARD,
     "var bar = e.target && e.target.closest && e.target.closest('[data-cm-menubar]');",
     'live', True),
]


def run(cmd, timeout):
    """Run a harness. Returns (code, output, note). A crash or timeout is
    reported as a nonzero code - the caller counts it as a kill."""
    try:
        p = subprocess.run(cmd, cwd=str(ROOT), capture_output=True,
                           text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or ''), ''
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'')
        if isinstance(out, bytes):
            out = out.decode('utf-8', 'replace')
        return 999, out, f'TIMEOUT after {timeout}s'
    except Exception as e:                                   # cannot start
        return 998, '', f'CRASH {type(e).__name__}: {e}'


def fail_names(output):
    names = []
    for line in output.splitlines():
        s = line.strip()
        if s.startswith('FAIL'):
            names.append(s[4:].strip())
    return names


def main():
    args = sys.argv[1:]
    only = harness = None
    while args:
        a = args.pop(0)
        if a in ('--suite', '--live'):
            only = a[2:]
        elif a == '--only':
            if not args:
                print(__doc__)
                return 2
            harness = args.pop(0)
        else:
            print(__doc__)
            return 2

    def picked(mid, har):
        if only and har != only:
            return False
        if harness and harness not in mid:
            return False
        return True

    # --- 1. pre-check: every pattern present exactly once ------------------
    originals = {}
    void = []
    for mid, rel, pat, _new, har, _b in MUTANTS:
        if not picked(mid, har):
            continue
        p = ROOT / rel
        text = originals.setdefault(rel, p.read_text())
        n = text.count(pat)
        if n != 1:
            void.append(f'{mid}: {rel} holds {n} copies of the pattern, want 1')
    if void:
        print('VOID - a pattern is not uniquely present, nothing may be counted:')
        for v in void:
            print('   ', v)
        return 2

    # --- 2. baseline: both harnesses green on the untouched tree -----------
    print('baseline ...', flush=True)
    for label, cmd, to in (('suite', SUITE, 600), ('live', LIVE, 300)):
        if only and only != label:
            continue
        code, out, note = run(cmd, to)
        fails = fail_names(out)
        if code != 0 or fails:
            print(f'BASELINE BROKEN - {label} harness fails untouched: {note or code}')
            for f in fails:
                print('   FAIL', f)
            print(out[-3000:])
            return 3
        print(f'  {label}: green ({out.strip().splitlines()[-1] if out.strip() else ""})',
              flush=True)

    # --- 3. mutants --------------------------------------------------------
    killed = survived = old_kill = 0
    start_status = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                                  capture_output=True, text=True).stdout
    for mid, rel, pat, new, har, rebuild in MUTANTS:
        if not picked(mid, har):
            continue
        p = ROOT / rel
        text = originals[rel]
        assert text.count(pat) == 1, mid          # re-assert, cheap
        p.write_text(text.replace(pat, new))
        try:
            if rebuild:
                bc, bout, bnote = run(BUILD, 300)
                if bc != 0:
                    code, out, note = bc, bout, f'BUILD FAILED ({bnote or bc})'
                else:
                    cmd = LIVE if har == 'live' else SUITE
                    code, out, note = run(cmd, 300 if har == 'live' else 600)
            else:
                cmd = LIVE if har == 'live' else SUITE
                code, out, note = run(cmd, 300 if har == 'live' else 600)
        finally:
            p.write_text(text)                     # restore, always
        if p.read_text() != text:
            print(f'RESTORE FAILED for {rel} - tree is dirty, aborting')
            return 4
        names = fail_names(out)
        mine = [n for n in names if any(c in n for c in
                (NEW_LIVE if har == 'live' else NEW_SUITE))]
        if code == 0:
            survived += 1
            verdict = 'SURVIVED (harness green)'
        elif mine:
            killed += 1
            verdict = f"KILL(new): {mine[0]}"
        else:
            killed += 1
            old_kill += 1
            verdict = ('KILL(old): ' + (names[0] if names else (note or f'exit {code}'))
                       + '  <-- not one of the new checks')
        print(f'  {mid:<44} {har:<5} {verdict}', flush=True)

    # --- 4. leave the tree as it was found --------------------------------
    if any(r[5] for r in MUTANTS if picked(r[0], r[4])):
        code, out, note = run(BUILD, 300)
        if code != 0:
            print(f'REBUILD AFTER RESTORE FAILED: {note or code}')
            return 5
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                           capture_output=True, text=True).stdout
    # only MUTATED files must look exactly as they did before the run: new
    # untracked files (the runner itself) are the tree's own business.
    dirty = '\n'.join(l for l in dirty.splitlines()
                      if l and l not in start_status.splitlines()
                      and not l.endswith('mutate-menubar-parity.py'))
    print()
    print(f'killed: {killed}   survived: {survived}   '
          f'killed only by OLD checks: {old_kill}   void: {len(void)}')
    if dirty:
        print('working tree not clean after restore:')
        print(dirty)
    if survived or old_kill or dirty:
        return 1
    print('every mutant died at the hands of a new parity check.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
