#!/usr/bin/env python3
"""Mutation-check the grouped-rail-nav checks.

Four guards were just added to oem-ui's suite. Each must FAIL when the thing
it watches is broken, and a pattern that no longer matches must report NO-OP
rather than a pass - a mutation harness that cannot fail is decoration.
"""
import re, shutil, subprocess, sys

CSS = '/root/projects/oem-ui/src/styles/components.css'
BAK = '/tmp/oemui-components.bak'

def suite():
    r = subprocess.run(['node', 'tests/run.mjs'], cwd='/root/projects/oem-ui',
                       capture_output=True, text=True)
    return r.stdout + r.stderr

def failing(out):
    return ' 0 failed' not in out

shutil.copy(CSS, BAK)
base = suite()
if failing(base):
    print('BASELINE IS RED - aborting, a mutation tally would be meaningless')
    print(base[-800:]); sys.exit(1)
print(f"baseline green: {base.strip().splitlines()[-1]}")

def in_rule(css, selector, old, new):
    """Replace `old` ONLY inside `selector`'s own rule body.

    A bare replace(..., 1) hits the FIRST occurrence in the file, and
    `min-height: 0` / `flex-direction: column` appear in other blocks - so an
    unscoped mutant was killed by a pre-existing rail check while MY guard
    never fired. That is a false pass: the tally said 5/5 and only 3 of the
    kills were the guards under test.
    """
    start = css.index(selector + ' {')
    end = css.index('}', start)
    body = css[start:end]
    assert old in body, f'anchor {old!r} is not inside {selector}'
    return css[:start] + body.replace(old, new, 1) + css[end:]

# (name, selector, old, new, expected message fragment)
MUTANTS = [
    ("drop min-height:0 from the group label",
     '.cm-header__group-label', "\tmin-height: 0;\n", "\t",
     "a heading is not a 44px dead target"),

    ("drop align-self:stretch from the group wrapper",
     '.cm-header__group', "\talign-self: stretch;\n", "\t",
     "align-self: stretch"),

    ("drop flex-direction:column from the group wrapper",
     '.cm-header__group', "\tflex-direction: column;\n", "\t",
     "must stack label over links"),

    ("drop width:100% from the group wrapper",
     '.cm-header__group', "\twidth: 100%;\n", "\t",
     "full rail width"),

    ("hardcode the group gap instead of the spacing token",
     '.cm-header__group + .cm-header__group',
     "margin-top: var(--space-4);", "margin-top: 0.9rem;",
     "spacing scale"),

    ("rename the group label class to a private name",
     '.cm-header__group-label', ".cm-header__group-label {", ".cm-header__railhead {",
     "not defined as a selector of its own"),
]

ok = 0
for name, sel, old, new, expect in MUTANTS:
    css = open(BAK).read()
    if sel not in css:
        print(f"  NO-OP   {name}: selector {sel} not found -- FIX THE HARNESS"); continue
    open(CSS, 'w').write(in_rule(css, sel, old, new))
    out = suite()
    killed = failing(out)
    named = expect in out
    if killed and named:
        print(f"  killed  {name}"); ok += 1
    elif killed:
        print(f"  killed-UNNAMED {name}  (suite went red, but not on the expected claim)")
        ok += 1
    else:
        print(f"  SURVIVED {name}  <-- the guard is too weak")

shutil.copy(BAK, CSS)
after = suite()
print()
print(f"{ok}/{len(MUTANTS)} killed")
print("restored:", not failing(after), "|", after.strip().splitlines()[-1])
sys.exit(0 if ok == len(MUTANTS) and not failing(after) else 1)
