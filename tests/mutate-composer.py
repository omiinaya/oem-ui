#!/usr/bin/env python3
"""Mutation-prove the batch-29 composer checks.

    python3 tests/mutate-composer.py [--suite | --live] [--only PREFIX]

Same five rules as `tests/mutate-guildrail.py` and
`tests/mutate-menubar-parity.py`: pre-check every pattern exactly once
(a missing pattern VOIDS the run), establish a green baseline first,
count a crash or timeout as a kill, attribute every kill to a batch-29
COMPOSER check (a kill that only fails old checks is a failure of this
proof), and restore each file byte-for-byte.

The guildrail's mutants live in `tests/mutate-guildrail.py`.
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
    'batch 29: the composer bar is the focus affordance',
    'batch 29: nothing caps the field, so the consumer can grow it to six lines',
    'batch 29: the reply strip is hidden by attribute, above the bar',
    'batch 29: sending lives on the FORM, and the input stays usable',
    'batch 29: a disabled textarea dims the whole box, through :has',
    'batch 29: the typing line is layout only, and the marker owns the semantics',
    'batch 29: the two new components are token-only, with no raw colour or spacing',
    'batch 29: reduced motion kills the new transitions, not the states',
    'batch 29: the font sizes carry the --min-font floor like every other component',
    'batch 29: the new rules sit before .cm-auth, and stack ownership still ends the file',
    'batch 29: the showcase renders both specimens with the contract structure',
    'batch 29: the composer documents the consumer JS rather than implementing it',
]

NEW_LIVE = [
    'desktop: the specimen rail is on the page',
    'composer: the field\'s own skin is off (the bar carries it)',
    'composer: base.css\'s 2x--tap reservation is overridden, not inherited',
    'composer: nothing caps the field\'s height (auto-grow is the consumer\'s)',
    'composer: the field fills the bar between the attach button and the tools',
    'composer: focus-within moves the BAR\'s border, not just the field\'s outline',
    'composer: [hidden] really hides the reply strip',
    'composer: un-hiding the strip puts it ABOVE the bar, and the bar moves down',
    'phone: the composer field is one row grown to at least the floor',
    'phone: prefers-reduced-motion kills the rail\'s and the composer\'s transitions',
]

# id, file, pattern, replacement, harness ('suite' | 'live'), rebuild?
MUTANTS = [
    # ---- the bar: the frame IS the focus affordance ---------------------
    ('s01 the bar stops changing on focus', 'src/styles/components.css',
     '.cm-composer__bar:focus-within { border-color: var(--focus); }',
     '.cm-composer__bar:focus-within { border-color: var(--line); }',
     'suite', False),
    ('s02 the bar loses its own frame', 'src/styles/components.css',
     '.cm-composer__bar {\n\tdisplay: flex;\n\talign-items: flex-end;',
     '.cm-composer__bar {\n\tdisplay: flex;\n\talign-items: center;',
     'suite', False),
    ('s03 the bar takes the panel fill', 'src/styles/components.css',
     'background: var(--panel-nested);\n\ttransition: border-color var(--cm-t) var(--cm-ease);',
     'background: var(--panel);\n\ttransition: border-color var(--cm-t) var(--cm-ease);',
     'suite', False),
    # ---- the field: no cap, no skin, the width of what is left ----------
    ('s04 the field is capped at one row', 'src/styles/components.css',
     'max-block-size: none;',
     'max-block-size: var(--tap);',
     'suite', False),
    ('s05 the field keeps the 2x--tap reservation', 'src/styles/components.css',
     'min-block-size: var(--tap);\n\tpadding: 0;\n\tborder: 0;',
     'min-block-size: calc(var(--tap) * 2);\n\tpadding: 0;\n\tborder: 0;',
     'suite', False),
    ('s06 the field keeps its own skin', 'src/styles/components.css',
     'background: transparent;\n\tresize: none;',
     'resize: none;',
     'suite', False),
    ('s07 the field loses its specificity tie', 'src/styles/components.css',
     '.cm-composer__bar > textarea.cm-composer__input {',
     '.cm-composer__bar .cm-composer__input {',
     'suite', False),
    ('s08 the field stops taking the leftover width', 'src/styles/components.css',
     'flex: 1 1 auto;\n\tinline-size: auto;',
     'inline-size: auto;',
     'suite', False),
    # ---- the reply strip ------------------------------------------------
    ('s09 the reply strip ignores hidden', 'src/styles/components.css',
     '.cm-composer__reply[hidden] { display: none; }',
     '.cm-composer__reply[hidden] { display: flex; }',
     'suite', False),
    ('s10 the strip is a column, not a row', 'src/styles/components.css',
     '.cm-composer__reply {\n\tdisplay: flex;\n\talign-items: center;',
     '.cm-composer__reply {\n\tdisplay: block;',
     'suite', False),
    ('s11 the strip loses its leading rule', 'src/styles/components.css',
     'border-inline-start: 1px solid var(--line);\n\tcolor: var(--ink-dim);',
     'color: var(--ink-dim);',
     'suite', False),
    # ---- states ---------------------------------------------------------
    ('s12 sending does not show busy', 'src/styles/components.css',
     '.cm-composer[data-cm-sending] .cm-composer__send { color: transparent; }',
     '.cm-composer[data-cm-sending] .cm-composer__send { color: var(--ink); }',
     'suite', False),
    ('s13 the disabled box does not dim', 'src/styles/components.css',
     '.cm-composer:has(.cm-composer__input:disabled) .cm-composer__bar {\n\tborder-color: var(--line-soft);',
     '.cm-composer:has(.cm-composer__input:disabled) .cm-composer__bar {\n\tborder-color: var(--line);',
     'suite', False),
    ('s14 a disabled send still reads live', 'src/styles/components.css',
     '.cm-composer:has(.cm-composer__input:disabled) .cm-composer__send {\n\tcolor: var(--ink-faint);\n\tcursor: not-allowed;',
     '.cm-composer:has(.cm-composer__input:disabled) .cm-composer__send {\n\tcolor: var(--ink);\n\tcursor: not-allowed;',
     'suite', False),
    # ---- the row's furniture --------------------------------------------
    ('s15 the tools do not take the tail', 'src/styles/components.css',
     'flex: 0 0 auto;\n\tmargin-inline-start: auto;',
     'flex: 0 0 auto;',
     'suite', False),
    ('s16 the send button loses its verb ink', 'src/styles/components.css',
     '.cm-composer__send {\n\tposition: relative;\n\tborder-color: var(--ink-dim);',
     '.cm-composer__send {\n\tposition: relative;',
     'suite', False),
    ('s17 the typing line loses its spacing', 'src/styles/components.css',
     '.cm-composer__typing { margin: var(--space-1) 0 0; }',
     '.cm-composer__typing { margin: 0; }',
     'suite', False),
    ('s18 the tap floor on the named controls goes', 'src/styles/components.css',
     '@media (pointer: coarse) {\n\t.cm-composer__attach,\n\t.cm-composer__send {\n\t\tinline-size: var(--tap);\n\t\tblock-size: var(--tap);\n\t}\n}',
     '@media (pointer: coarse) {\n\t.cm-composer__attach {\n\t\tinline-size: var(--tap);\n\t\tblock-size: var(--tap);\n\t}\n}',
     'suite', False),
    ('s19 a raw colour in the composer block', 'src/styles/components.css',
     '.cm-composer__replyclose { color: var(--ink-faint); }',
     '.cm-composer__replyclose { color: #666666; }',
     'suite', False),
    ('s20 the composer leaves the reduced-motion guard', 'src/styles/components.css',
     '\t.cm-composer__bar,\n\t.cm-composer__attach,\n\t.cm-composer__send { transition: none; }',
     '\t.cm-composer__bar { transition: none; }',
     'suite', False),
    # ---- the specimen ---------------------------------------------------
    ('s21 the composer specimen loses its bar', 'src/pages/index.astro',
     '<div class="cm-composer__bar">',
     '<div class="cm-composer__bars">',
     'suite', False),
    ('s22 the reply strip ships visible', 'src/pages/index.astro',
     'class="cm-composer__reply" hidden',
     'class="cm-composer__reply"',
     'suite', False),
    ('s23 the tools are not authored', 'src/pages/index.astro',
     '<div class="cm-composer__tools">',
     '<div>',
     'suite', False),
    ('s24 the send button is not marked up', 'src/pages/index.astro',
     'class="cm-icon-btn cm-composer__send" aria-label="Send message"',
     'class="cm-icon-btn" aria-label="Send message"',
     'suite', False),
    ('s25 the field is not a one-row textarea', 'src/pages/index.astro',
     'rows="1" placeholder="Message #general" aria-label="Message"',
     'rows="3" placeholder="Message #general" aria-label="Message"',
     'suite', False),
    ('s26 the typing line is not a status', 'src/pages/index.astro',
     '<span class="cm-marker cm-shimmer" role="status">Ciel is typing…</span>',
     '<span class="cm-marker cm-shimmer">Ciel is typing…</span>',
     'suite', False),
    ('s27 the attach control is not marked up', 'src/pages/index.astro',
     'class="cm-icon-btn cm-composer__attach" aria-label="Attach a file"',
     'class="cm-icon-btn" aria-label="Attach a file"',
     'suite', False),
    ('s28 the README stops documenting Enter', 'README.md',
     '| **Enter sends** | consumer | a real `<form>` so the client can bind a keydown; the library never binds one |',
     '| **Enter sends** | nobody | nothing |',
     'suite', False),
    # ---- live: measured in WebKit ---------------------------------------
    ('l01 the bar stops changing on focus', 'src/styles/components.css',
     '.cm-composer__bar:focus-within { border-color: var(--focus); }',
     '.cm-composer__bar:focus-within { border-color: var(--line); }',
     'live', True),
    ('l02 the field is capped at one row', 'src/styles/components.css',
     'max-block-size: none;',
     'max-block-size: var(--tap);',
     'live', True),
    ('l03 the field keeps the 2x--tap reservation', 'src/styles/components.css',
     'min-block-size: var(--tap);\n\tpadding: 0;\n\tborder: 0;',
     'min-block-size: calc(var(--tap) * 2);\n\tpadding: 0;\n\tborder: 0;',
     'live', True),
    ('l04 the field keeps its own skin', 'src/styles/components.css',
     'background: transparent;\n\tresize: none;',
     'resize: none;',
     'live', True),
    ('l05 the field loses its specificity tie', 'src/styles/components.css',
     '.cm-composer__bar > textarea.cm-composer__input {',
     '.cm-composer__bar .cm-composer__input {',
     'live', True),
    ('l06 the reply strip ignores hidden', 'src/styles/components.css',
     '.cm-composer__reply[hidden] { display: none; }',
     '.cm-composer__reply[hidden] { display: flex; }',
     'live', True),
    ('l07 the strip is a column, not a row', 'src/styles/components.css',
     '.cm-composer__reply {\n\tdisplay: flex;\n\talign-items: center;',
     '.cm-composer__reply {\n\tdisplay: block;',
     'live', True),
    ('l08 the composer leaves the reduced-motion guard', 'src/styles/components.css',
     '\t.cm-composer__bar,\n\t.cm-composer__attach,\n\t.cm-composer__send { transition: none; }',
     '\t.cm-composer__bar { transition: none; }',
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

    start = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                           capture_output=True, text=True).stdout

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

    if any(m[5] for m in MUTANTS if picked(m[0], m[4])):
        code, out, note = run(BUILD, 300)
        if code != 0:
            print(f'REBUILD AFTER RESTORE FAILED: {note or code}')
            return 5
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=str(ROOT),
                           capture_output=True, text=True).stdout
    dirty = '\n'.join(l for l in dirty.splitlines()
                      if l and l not in start.splitlines()
                      and not l.endswith('mutate-composer.py'))
    print()
    print(f'killed: {killed}   survived: {survived}   '
          f'killed only by OLD checks: {old_kill}   void: {len(void)}')
    if dirty:
        print('working tree not clean after restore:')
        print(dirty)
    if survived or old_kill or dirty:
        return 1
    print('every mutant died at the hands of a batch-29 composer check.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
