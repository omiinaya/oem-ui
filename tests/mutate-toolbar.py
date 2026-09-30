#!/usr/bin/env python3
"""Mutation-check the action-toolbar increment.

The claim: the bar FLOATS over the list, so every part of it exists because
of that - a bottom anchor, a z-index, a themed shadow, a strong border. Each
mutation removes one piece and must die on the check written for it.
"""
import subprocess, pathlib, re, sys, os

C = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
CLAIM = 'the action toolbar sticks to the bottom and survives a scroll'
SEL_CHECK = {'cm-toolbar': CLAIM, 'cm-toolbar__count': CLAIM}


def in_rule(css, selector, old, new):
    m = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    if not m or old not in m.group(1):
        raise SystemExit(f'cannot scope {old!r} to {selector}')
    return css[:m.start(1)] + m.group(1).replace(old, new, 1) + css[m.end(1):]


MUTANTS = [
    ('cm-toolbar', 'bottom: 0;', 'bottom: auto;',
     'the bar stops following the selection and scrolls away'),
    ('cm-toolbar', 'z-index: 10;', 'z-index: auto;',
     'a sticky bar with no z-index is painted under the rows it covers'),
    ('cm-toolbar', 'box-shadow: var(--shadow-card);', 'box-shadow: none;',
     'the floating bar loses its edge and vanishes into a dark page'),
    ('cm-toolbar', 'border: 1px solid var(--ink-dim);', 'border: 1px solid var(--line);',
     'the floating bar takes the faint edge that is for INLINE content'),
    ('cm-toolbar__count', 'color: var(--ink-dim);', 'color: var(--ink);',
     'the count stops reading as a label and competes with the buttons'),
]


def run_suite():
    r = subprocess.run(['node', 'tests/run.mjs'], cwd='/root/projects/oem-ui',
                       capture_output=True, text=True, timeout=900)
    out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    m = re.search(r'(\d+) passed, (\d+) failed', out)
    return (int(m.group(2)), out) if m else (None, out)


if __name__ == '__main__':
    orig = C.read_text()
    os.chdir('/root/projects/oem-ui')
    try:
        base, _ = run_suite()
        if base is None or base != 0:
            print('ABORT: baseline is not green'); sys.exit(2)
        print('baseline green\n')
        killed = named = other = 0
        for sel, old, new, claim in MUTANTS:
            C.write_text(in_rule(orig, sel, old, new))
            fails, out = run_suite()
            if fails is None:
                print(f'  ABORT   {claim}'); break
            if fails == 0:
                print(f'  SURVIVED  {claim}  <-- guard is vacuous')
            else:
                fired = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
                hit = fired[0] if fired else '?'
                if SEL_CHECK[sel] in hit:
                    print(f'  killed  {claim}'); named += 1
                else:
                    print(f'  killed-OTHER  {claim}  (fired on: {hit[:66]})'); other += 1
                killed += 1
            C.write_text(orig)
        print(f'\n{killed}/{len(MUTANTS)} killed ({named} on their own claim, {other} on another)')
    finally:
        C.write_text(orig)
        final, _ = run_suite()
        print('restored; suite green again' if final == 0 else f'RESTORED BUT RED: {final}')
