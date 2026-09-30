#!/usr/bin/env python3
"""Mutation-check the check-row increment.

The claim: the ROW is the tap target, not the 17px box. Every part of the
rule exists because of that, so each mutation removes one piece and must die
on the check written for it.
"""
import subprocess, pathlib, re, sys, os

C = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
CLAIM = 'the check row is the tap target, not the 17px box'


def in_rule(css, selector, old, new):
    m = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    if not m or old not in m.group(1):
        raise SystemExit(f'cannot scope {old!r} to {selector}')
    return css[:m.start(1)] + m.group(1).replace(old, new, 1) + css[m.end(1):]


MUTANTS = [
    ('cm-check', 'min-height: var(--tap);', 'min-height: 0;',
     'the row stops being a target and the only thing to hit is a 17px box'),
    ('cm-check', 'cursor: pointer;', 'cursor: default;',
     'the row stops advertising that the word is clickable'),
    ('cm-check', 'align-items: center;', 'align-items: flex-start;',
     'the box rides above the label instead of on its optical line'),
    ('cm-check:hover', 'color: var(--ink);', 'color: var(--ink-dim);',
     'hover stops lightening the LABEL, so the affordance stays on the hard-to-hit part'),
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
                if CLAIM in hit:
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
