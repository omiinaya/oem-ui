#!/usr/bin/env python3
"""Mutation-prove the batch-29 guildrail checks.

    python3 tests/mutate-guildrail.py [--suite | --live] [--only PREFIX]

Rules this runner follows, in order (the same rules
`tests/mutate-menubar-parity.py` follows, because a mutation runner whose
own rules are slack proves nothing):

  1. PRE-CHECK. Every mutant's pattern must appear EXACTLY ONCE in its file
     before anything is touched. A pattern that is not there would make the
     whole run vacuous - nothing to mutate, everything "passes" - so a
     missing or duplicated pattern VOIDS the run (exit 2) instead of
     counting as a kill.
  2. BASELINE. The harness is run on the untouched tree first; if it fails,
     mutants are meaningless (exit 3).
  3. A mutant is KILLED when its harness exits nonzero. A harness that
     crashes, times out or cannot start is a kill - never a pass.
  4. ATTRIBUTION. The FAIL lines are parsed: a kill whose failures include
     one of the batch-29 guildrail checks is reported as KILL(new). A kill
     that only fails OLD checks proves nothing about this batch and is
     reported as KILL(old) - that counts as a failure of this proof, not
     as success.
  5. RESTORE. The file is written back byte-for-byte after each mutant and
     the restore is verified against the bytes read at startup; live
     mutants also rebuild dist, and dist is rebuilt again at the end.

Exit 0 only when every pattern was found exactly once, the baseline passed
and every mutant died at the hands of a batch-29 guildrail check.

The composer's own mutants live in `tests/mutate-composer.py`; the two
components share one CSS block, so splitting the runners keeps each
component's kill count attributable to that component's own checks.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITE = ['node', 'tests/run.mjs']
LIVE = ['/root/.venvs/mau/bin/python', 'tests/verify-guildrail-composer.py']
BUILD = ['npm', 'run', 'build']

NEW_SUITE = [
    'batch 29: the contract names are all defined, and none is invented',
    'batch 29: the rail owns its own scroll and cannot stretch its row',
    'batch 29: the tip escapes the rail to the RIGHT without overlapping it',
    'batch 29: every square is --tap on both axes and never widens the rail',
    'batch 29: the pill carries state the reader can see without colour',
    'batch 29: count and dot are exclusive, and the count cannot break the square',
    'batch 29: the tip is a tooltip in the markup and the name is not only the icon',
    'batch 29: the two new components are token-only, with no raw colour or spacing',
    'batch 29: reduced motion kills the new transitions, not the states',
    'batch 29: the font sizes carry the --min-font floor like every other component',
    'batch 29: the new rules sit before .cm-auth, and stack ownership still ends the file',
    'batch 29: the showcase renders both specimens with the contract structure',
]

NEW_LIVE = [
    'desktop: the specimen rail is on the page',
    "desktop: the rail ships the contract's parts",
    'desktop: the guildrail specimen is actually in the viewport',
    'guildrail: the rail is a real scrollport (content overflows it)',
    'guildrail: scrolling the RAIL moves its icons',
    "guildrail: the rail's margin box is still --guildrail-w",
    'guildrail: the grid column beside the rail starts at --guildrail-w',
    "guildrail: the rail's padding box reaches out by the bleed",
    'guildrail: what the rail PAINTS is --guildrail-w, not the bleed',
    'guildrail: the tip is visible on keyboard focus',
    'guildrail: the tip is PAINTED outside the scrollport',
    "guildrail: the tip starts at the rail's PAINTED edge and never overlaps it",
    'guildrail: the tip really extends to the right of the rail',
    'guildrail: the tip is centred on the square it labels',
    'guildrail: the tip is fully inside the viewport, on both axes',
    'guildrail: the tip is capped at the bleed, so its own clip box can hold it',
    'guildrail: a SCROLLED rail still paints its tip outside, on its icon',
    "guildrail: the rail's background is clipped to its CONTENT box",
    'guildrail: clicks fall through the bleed to the column behind',
    'guildrail: the scrollbar is suppressed (it would sit in the bleed)',
    'guildrail: aria-current changes the square, in ink not hue',
    'guildrail: the current square carries the ink, not just the fill',
    'guildrail: the pill reads as a full bar only for the current server',
    'phone: the rail PAINTS --guildrail-w, not the rail plus its bleed',
    "phone: the rail's clip box stays inside the viewport, bleed and all",
    "phone: the rail's bleed does not widen the document",
    'phone: the rail still owns its scroll',
    "phone: prefers-reduced-motion kills the rail's and the composer's transitions",
]

# id, file, pattern, replacement, harness ('suite' | 'live'), rebuild?
MUTANTS = [
    # ---- the box: bounded, scrollable, bleeding, clipped ----------------
    ('s01 the rail loses its bound', 'src/styles/components.css',
     'min-block-size: 0;\n\tmax-block-size: 100%;',
     'min-block-size: 0;',
     'suite', False),
    ('s02 the rail loses its scroll', 'src/styles/components.css',
     'overflow-y: auto;\n\toverflow-x: hidden;\n\tpadding-inline-end: var(--guildrail-bleed);',
     'overflow-x: hidden;\n\tpadding-inline-end: var(--guildrail-bleed);',
     'suite', False),
    ('s03 the bleed is not paid for', 'src/styles/components.css',
     'margin-inline-end: calc(0px - var(--guildrail-bleed));',
     'margin-inline-end: 0;',
     'suite', False),
    ('s04 the width forgets the bleed', 'src/styles/components.css',
     'inline-size: calc(var(--guildrail-w) + var(--guildrail-bleed));',
     'inline-size: var(--guildrail-w);',
     'suite', False),
    ('s05 the trailing edge is a border', 'src/styles/components.css',
     'background-origin: content-box;\n\tbackground-clip: content-box;',
     'background-clip: border-box;',
     'suite', False),
    ('s06 the scrollbar comes back', 'src/styles/components.css',
     '.cm-guildrail::-webkit-scrollbar { display: none; }',
     '.cm-guildrail::-webkit-scrollbar { display: block; }',
     'suite', False),
    # ---- the tip --------------------------------------------------------
    ('s07 the tip stays inside the rail', 'src/styles/components.css',
     'inset-inline-start: 100%;\n\tinset-inline-end: auto;',
     'inset-inline-start: auto;\n\tinset-inline-end: 0;',
     'suite', False),
    ('s08 the tip is uncapped', 'src/styles/components.css',
     'max-inline-size: var(--guildrail-bleed);',
     'max-inline-size: none;',
     'suite', False),
    ('s09 the tip loses its centring', 'src/styles/components.css',
     "transform: translateY(-50%);\n\t/* The tip's own cap",
     "/* The tip's own cap",
     'suite', False),
    ('s10 the wrapper stops centring', 'src/styles/components.css',
     '.cm-guildrail .cm-tooltip {\n\tdisplay: flex;\n\tjustify-content: center;',
     '.cm-guildrail .cm-tooltip {\n\tdisplay: block;',
     'suite', False),
    # ---- the squares ----------------------------------------------------
    ('s11 the square loses the tap floor', 'src/styles/components.css',
     'inline-size: var(--tap);\n\tblock-size: var(--tap);\n\tflex: 0 0 auto;\n\tdisplay: inline-grid;',
     'inline-size: var(--tap);\n\tblock-size: var(--space-5);\n\tflex: 0 0 auto;\n\tdisplay: inline-grid;',
     'suite', False),
    ('s12 the current square drops its ink', 'src/styles/components.css',
     "aria-current='true'] {\n\tbackground: var(--surface-raised);\n\tcolor: var(--ink);\n}",
     "aria-current='true'] {\n\tbackground: var(--surface-raised);\n}",
     'suite', False),
    ('s13 the pill never fills', 'src/styles/components.css',
     ".cm-guildrail__item[aria-current='true'] .cm-guildrail__pill {\n\topacity: 1;\n\ttransform: translateY(-50%) scaleY(1);\n}",
     ".cm-guildrail__item[aria-current='true'] .cm-guildrail__pill {\n\topacity: 0;\n\ttransform: translateY(-50%) scaleY(1);\n}",
     'suite', False),
    ('s14 the idle pill is visible', 'src/styles/components.css',
     'opacity: 0;\n\ttransform: translateY(-50%) scaleY(0.14);',
     'opacity: 1;\n\ttransform: translateY(-50%) scaleY(0.14);',
     'suite', False),
    ('s15 the badge is unbounded', 'src/styles/components.css',
     'max-inline-size: var(--tap);\n\tblock-size: var(--space-4);',
     'max-inline-size: none;\n\tblock-size: var(--space-4);',
     'suite', False),
    ('s16 the dot is huge', 'src/styles/components.css',
     'inline-size: var(--space-2);\n\tblock-size: var(--space-2);\n\tbackground: var(--ink);',
     'inline-size: var(--tap);\n\tblock-size: var(--tap);\n\tbackground: var(--ink);',
     'suite', False),
    ('s17 the separator becomes a border', 'src/styles/components.css',
     'inline-size: var(--tap);\n\tblock-size: 1px;\n\tmargin-block: var(--space-1);\n\tbackground: var(--line);',
     'inline-size: var(--tap);\n\tborder-block-start: 1px solid var(--line);',
     'suite', False),
    ('s18 the add control loses its ink', 'src/styles/components.css',
     '.cm-guildrail__item--add { color: var(--ink-dim); }',
     '.cm-guildrail__item--add { color: var(--ink); }',
     'suite', False),
    ('s19 the home door loses its frame', 'src/styles/components.css',
     '.cm-guildrail__item--home { border-color: var(--line); }',
     '.cm-guildrail__item--home { border-color: transparent; }',
     'suite', False),
    ('s20 a raw colour in the rail block', 'src/styles/components.css',
     'var(--panel);\n\tbackground-origin: content-box;',
     '#232323;\n\tbackground-origin: content-box;',
     'suite', False),
    ('s21 the monogram is unfloored', 'src/styles/components.css',
     'font-size: max(var(--min-font), var(--text-sm));\n\tfont-weight: 700;\n\tline-height: 1;\n\tletter-spacing: 0.04em;',
     'font-size: var(--text-sm);\n\tfont-weight: 700;\n\tline-height: 1;\n\tletter-spacing: 0.04em;',
     'suite', False),
    ('s22 the rail leaves the reduced-motion guard', 'src/styles/components.css',
     '\t.cm-guildrail__item,\n\t.cm-guildrail__pill,\n\t.cm-composer__bar,',
     '\t.cm-guildrail__pill,\n\t.cm-composer__bar,',
     'suite', False),
    ('s23 a new rule lands after .cm-auth', 'src/styles/components.css',
     '.cm-guildrail__item--add { color: var(--ink-dim); }',
     '.cm-auth {}\n.cm-guildrail__item--add { color: var(--ink-dim); }',
     'suite', False),
    # ---- the specimen ---------------------------------------------------
    ('s24 the rail is not a nav', 'src/pages/index.astro',
     '<nav class="cm-guildrail" aria-label="Servers">',
     '<nav class="cm-guildrail" aria-label="Nowhere">',
     'suite', False),
    ('s25 the home item loses aria-current', 'src/pages/index.astro',
     'aria-current="true" aria-label="Direct messages"',
     'aria-label="Direct messages"',
     'suite', False),
    ('s26 the separator is not marked up', 'src/pages/index.astro',
     '<span class="cm-guildrail__sep" role="separator"></span>',
     '<span class="cm-guildrail__sep"></span>',
     'suite', False),
    ('s27 the count is a badge AND a dot', 'src/pages/index.astro',
     '<span class="cm-guildrail__badge" aria-hidden="true">3</span>',
     '<span class="cm-guildrail__badge" aria-hidden="true">3</span>\n'
     '\t\t\t\t\t\t\t\t<span class="cm-guildrail__unread" aria-hidden="true"></span>',
     'suite', False),
    ('s28 a monogram is exposed', 'src/pages/index.astro',
     '<span class="cm-guildrail__icon" aria-hidden="true">OH</span>',
     '<span class="cm-guildrail__icon">OH</span>',
     'suite', False),
    ('s29 the tip is not a tooltip', 'src/pages/index.astro',
     '<span class="cm-tooltip__tip" role="tooltip">OEM HQ</span>',
     '<span class="cm-tooltip__tip">OEM HQ</span>',
     'suite', False),
    ('s30 the add control is not marked up', 'src/pages/index.astro',
     'class="cm-guildrail__item cm-guildrail__item--add"',
     'class="cm-guildrail__item"',
     'suite', False),
    ('s31 a contract name is renamed in the specimen', 'src/pages/index.astro',
     '<span class="cm-guildrail__badge" aria-hidden="true">99+</span>',
     '<span class="cm-guildrail__badges" aria-hidden="true">99+</span>',
     'suite', False),
    # ---- live: measured in WebKit ---------------------------------------
    ('l03 the bleed is not paid for', 'src/styles/components.css',
     'margin-inline-end: calc(0px - var(--guildrail-bleed));',
     'margin-inline-end: 0;',
     'live', True),
    ('l04 the width forgets the bleed', 'src/styles/components.css',
     'inline-size: calc(var(--guildrail-w) + var(--guildrail-bleed));',
     'inline-size: var(--guildrail-w);',
     'live', True),
    ('l05 the trailing edge is a border', 'src/styles/components.css',
     'background-origin: content-box;\n\tbackground-clip: content-box;',
     'background-clip: border-box;',
     'live', True),
    ('l07 the tip stays inside the rail', 'src/styles/components.css',
     'inset-inline-start: 100%;\n\tinset-inline-end: auto;',
     'inset-inline-start: auto;\n\tinset-inline-end: 0;',
     'live', True),
    ('l09 the tip loses its centring', 'src/styles/components.css',
     "transform: translateY(-50%);\n\t/* The tip's own cap",
     "/* The tip's own cap",
     'live', True),
    ('l10 the square loses the tap floor', 'src/styles/components.css',
     'inline-size: var(--tap);\n\tblock-size: var(--tap);\n\tflex: 0 0 auto;\n\tdisplay: inline-grid;',
     'inline-size: var(--tap);\n\tblock-size: var(--space-5);\n\tflex: 0 0 auto;\n\tdisplay: inline-grid;',
     'live', True),
    ('l11 the pill never fills', 'src/styles/components.css',
     ".cm-guildrail__item[aria-current='true'] .cm-guildrail__pill {\n\topacity: 1;\n\ttransform: translateY(-50%) scaleY(1);\n}",
     ".cm-guildrail__item[aria-current='true'] .cm-guildrail__pill {\n\topacity: 0;\n\ttransform: translateY(-50%) scaleY(1);\n}",
     'live', True),
    ('l12 the current square drops its ink', 'src/styles/components.css',
     "aria-current='true'] {\n\tbackground: var(--surface-raised);\n\tcolor: var(--ink);\n}",
     "aria-current='true'] {\n\tbackground: var(--surface-raised);\n}",
     'live', True),
    ('l14 the bleed bleeds the document', 'src/styles/tokens.css',
     '\t--guildrail-bleed: 18rem;',
     '\t--guildrail-bleed: 40rem;',
     'live', True),
]

# ---- proven-equivalent mutations, deliberately NOT in the list -------------
#
# Each of these was run against the live harness, SURVIVED, and was then
# MEASURED in WebKit (mutant applied, page rebuilt, property probed) to
# establish that no correct assertion could ever have caught it. They are
# recorded here rather than kept as mutants, because a mutant nothing can
# kill trains the reader to ignore survivors - the failure mode this file
# exists to prevent. Each is still covered at the SOURCE layer (the sNN
# named), so the invariant is not lost, only its live duplicate.
#
#   bound (s01). Removing `max-block-size: 100%` leaves the rail's used
#     max-block-size at `none`, and it STILL scrolls: measured scrollRange
#     187px against a 16rem stage whose grid row is fixed, so the parent
#     binds the box and the declaration is defensive. Unobservable in this
#     fixture; s01 kills it at the source.
#
#   scroll (s02). `overflow-y: auto` is redundant the moment
#     `overflow-x: hidden` is stated: CSS computes a `visible` axis to
#     `auto` when the other axis is not `visible`. Measured: the mutant's
#     computed overflow-y is still `auto` and the rail still scrolls, so
#     the live harness cannot separate the two. s02 kills it.
#
#   scrollbar (s06). `.cm-guildrail::-webkit-scrollbar { display: block }`
#     changes nothing. Measured in WebKit: `offsetWidth - clientWidth` is 0
#     both pristine and mutated (overlay scrollbars on this engine), and
#     `scrollbar-width: none` already suppresses it. s06 kills the rule.
#
#   tip cap (s08). `max-inline-size: none` never binds, because the widest
#     tip the specimen renders is 166.2px against a 288px bleed - the cap
#     is a contract guarantee for a longer label, not a constraint this
#     fixture exercises. Measured over all nine tips: max 166.2px. s08
#     kills the declaration at the source layer.
#
#   reduced motion (s22). Deleting `.cm-guildrail__item` from the
#     library's reduce guard leaves its transition-duration at 0.00001s
#     anyway: base.css's `@media (prefers-reduced-motion: reduce) {
#     *, *::before, *::after { transition-duration: 0.01ms !important } }`
#     owns it outright. Measured after removing the selector. s22 kills it.


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

    start = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                           capture_output=True, text=True).stdout

    # --- 1. pre-check: every pattern exactly once ------------------------
    texts = {}
    void = []
    for mid, rel, pat, _repl, _har, _rb in MUTANTS:
        if not picked(mid, _har):
            continue
        if rel not in texts:
            texts[rel] = (ROOT / rel).read_text()
        n = texts[rel].count(pat)
        if n != 1:
            void.append((mid, rel, n))
            print(f'VOID  {mid}: pattern found {n}x in {rel} (must be 1)')
    if void:
        print(f'\n{len(void)} mutant(s) V O I D - nothing was mutated. '
              f'Fix the patterns; a vacuous run proves nothing.')
        return 2

    # --- 2. baseline -----------------------------------------------------
    print('baseline:')
    for har, cmd, t in (('suite', SUITE, 600), ('live', LIVE, 600)):
        if not any(picked(m[0], m[4]) and m[4] == har for m in MUTANTS):
            continue
        code, out, note = run(cmd, t)
        tail = [l for l in out.splitlines() if l.strip()][-1:] or ['']
        print(f'  {har:<5} exit {code}  {tail[0][:90]}  {note}')
        if code != 0:
            print(f'BASELINE FAILED for {har} - mutants would be meaningless')
            return 3

    # --- 3. mutants ------------------------------------------------------
    killed = survived = old_kill = 0
    print('\nmutants:')
    for mid, rel, pat, repl, har, rb in MUTANTS:
        if not picked(mid, har):
            continue
        p = ROOT / rel
        text = texts[rel]
        p.write_text(text.replace(pat, repl, 1))
        try:
            if rb:
                code, out, note = run(BUILD, 300)
                if code != 0:
                    print(f'  {mid:<48} {har:<5} BUILD FAILED after mutation '
                          f'({note or code}) - counted as a kill')
                    killed += 1
                    continue
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
        print(f'  {mid:<48} {har:<5} {verdict}', flush=True)
        if code != 0:
            for n in names[:6]:
                print(f'        FAIL {n}', flush=True)
            if not names:
                print(f'        ({note or f"exit {code}"} - no FAIL lines)', flush=True)

    # --- 4. leave the tree as it was found --------------------------------
    if any(m[5] for m in MUTANTS if picked(m[0], m[4])):
        code, out, note = run(BUILD, 300)
        if code != 0:
            print(f'REBUILD AFTER RESTORE FAILED: {note or code}')
            return 5
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                           capture_output=True, text=True).stdout
    # only MUTATED files must look exactly as they did before the run: new
    # untracked files (the runner itself) are the tree's own business.
    dirty = '\n'.join(l for l in dirty.splitlines()
                      if l and l not in start.splitlines()
                      and not l.endswith('mutate-guildrail.py'))
    print()
    print(f'killed: {killed}   survived: {survived}   '
          f'killed only by OLD checks: {old_kill}   void: {len(void)}')
    if dirty:
        print('working tree not clean after restore:')
        print(dirty)
    if survived or old_kill or dirty:
        return 1
    print('every mutant died at the hands of a batch-29 guildrail check.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
