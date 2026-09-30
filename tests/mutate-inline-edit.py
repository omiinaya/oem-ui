#!/usr/bin/env python3
"""Mutation-check the inline-edit increment.

The whole increment is the claim that the DISPLAY half is an affordance and
not a box. Every mutation below removes one piece of that, and each must die
on the contract check written for it.
"""
import subprocess, pathlib, re, sys, os

C = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
SEL_CHECK = {
    'cm-inline': 'the inline-edit display half is an affordance, not a box',
    'cm-inline--wide': 'the inline-edit display half is an affordance, not a box',
    'cm-inline__input': 'the editing half inherits the field treatment',
}


def in_rule(css, selector, old, new):
    m = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    if not m or old not in m.group(1):
        raise SystemExit(f'cannot scope {old!r} to {selector}')
    return css[:m.start(1)] + m.group(1).replace(old, new, 1) + css[m.end(1):]


MUTANTS = [
    ('cm-inline', 'border-bottom: 1px dotted var(--line);', 'border-bottom: none;',
     'the display half loses its affordance and reads as static text'),
    ('cm-inline', 'cursor: text;', 'cursor: default;',
     'the display half stops advertising that it is editable'),
    ('cm-inline', 'max-width: 22rem;', 'max-width: none;',
     'a long value can no longer ellipsize'),
    ('cm-inline__input', 'border: 1px solid var(--ink-dim);', 'border: none;',
     'the editing half has no box to click into'),
    ('cm-inline--wide', 'max-width: 32rem;', 'max-width: 8rem;',
     'the wide measure is no longer wide'),
]


def run_suite():
    r = subprocess.run(['node', 'tests/run.mjs'], cwd='/root/projects/oem-ui',
                       capture_output=True, text=True, timeout=900)
    out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    m = re.search(r'(\d+) passed, (\d+) failed', out)
    if not m:
        return None, out
    return int(m.group(2)), out


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
