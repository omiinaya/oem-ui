#!/usr/bin/env python3
"""Mutation-check the selection + state marks increment.

Every mutation is scoped to its OWN rule body with in_rule(). A `replace(..., 1)`
on a declaration that appears in several rules mutates a different rule and
gets killed by a different check - the tally still reads green, and nothing
was proved.
"""
import subprocess, pathlib, re, sys, shutil, os

C = pathlib.Path('/root/projects/oem-ui/src/styles/components.css')
BACKUP = pathlib.Path('/root/.hermes/cache/scratch/components.css.bak')
SUITE = ['node', 'tests/run.mjs']


def in_rule(css, selector, old, new):
    """Replace `old` only inside the body of `selector`'s rule."""
    m = re.search(re.escape(selector) + r'\s*\{([^}]*)\}', css)
    if not m:
        raise SystemExit(f'no rule for {selector}')
    body = m.group(1)
    if old not in body:
        raise SystemExit(f'{old!r} not in {selector} body')
    newcss = css[:m.start(1)] + body.replace(old, new, 1) + css[m.end(1):]
    assert newcss != css, 'mutation was a no-op'
    return newcss


# Which contract check owns each mutation. A kill is only PROVED if the
# failure names the check that was written for that mutation - a different
# check firing means the guard is not the one we think it is.
SEL_CHECK = {
    'cm-section--on': 'a selected row is a left rule and a tint',
    'cm-dot--on': 'the state mark reads on and off by weight',
    'cm-dot': 'the state mark reads on and off by weight',
}

MUTANTS = [
    ('cm-section--on', 'box-shadow: inset 3px 0 0 var(--ink);', 'box-shadow: none;',
     'a selected row loses its left rule'),
    ('cm-section--on', 'background: var(--bg-2);', 'background: var(--panel);',
     'a selected row loses its tint'),
    ('cm-dot--on', 'background: var(--ink);', 'background: transparent;',
     '"on" becomes indistinguishable from "off"'),
    ('cm-dot', 'width: 0.5rem;', 'width: 0.125rem;',
     'the state mark collapses to a hairline'),
]

def run_suite():
    r = subprocess.run(SUITE, cwd='/root/projects/oem-ui',
                       capture_output=True, text=True, timeout=900)
    out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
    m = re.search(r'(\d+) passed, (\d+) failed', out)
    if not m:
        print('  ABORT: suite produced no tally - a build failure must not read as a kill')
        return None, out
    return int(m.group(2)), out


if __name__ == '__main__':
    orig = C.read_text()
    BACKUP.write_text(orig)
    os.chdir('/root/projects/oem-ui')
    try:
        base_fail, out = run_suite()
        if base_fail is None:
            sys.exit(2)
        if base_fail != 0:
            print('ABORT: baseline is not green:', base_fail, 'failing')
            sys.exit(2)
        print(f'baseline green\n')
        killed = named = other = 0
        for sel, old, new, claim in MUTANTS:
            C.write_text(in_rule(orig, sel, old, new))
            fails, out = run_suite()
            if fails is None:
                print(f'  ABORT   {claim}')
                break
            want = SEL_CHECK[sel]
            if fails == 0:
                print(f'  SURVIVED  {claim}  <-- guard is vacuous')
            elif any(want in l and l.strip().startswith('FAIL') for l in out.splitlines()):
                print(f'  killed  {claim}')
                killed += 1; named += 1
            else:
                fired = [l.strip()[:70] for l in out.splitlines() if l.strip().startswith('FAIL')]
                print(f'  killed-OTHER  {claim}  (fired on: {fired[0] if fired else "?"})')
                killed += 1; other += 1
            C.write_text(orig)
        print(f'\n{killed}/{len(MUTANTS)} killed ({named} on their own claim, {other} on another)')
    finally:
        C.write_text(orig)
        final, _ = run_suite()
        print('restored; suite green again' if final == 0 else f'RESTORED BUT RED: {final}')
