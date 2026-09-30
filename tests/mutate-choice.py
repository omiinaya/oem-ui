#!/usr/bin/env python3

"""Mutation-check the choice + disclosure contract.

Every mutation is SCOPED to the rule it names. An unscoped

`SRC.replace(old, new, 1)` mutates whichever occurrence comes FIRST in a

115KB stylesheet, which is routinely a different class 20KB away - the

mutant then dies on a neighbour's guard and the run reports a false

KILL. Slice to the rule's own body first; the one exception is a mutant

that is explicitly about a different selector, which carries

`scope=<that selector>`.

A missing anchor ABORTS. Reporting it as SURVIVED inflates a real gap

and hides a harness bug.

The own-claim detector keys on the assertion MESSAGE, so rewording a

check means re-keying this file in the same edit.

"""

import importlib.util

import re

import shutil

import subprocess

import sys

import tempfile

from pathlib import Path

LIB = Path(__file__).resolve().parent.parent

CSS = 'src/styles/components.css'

NODE = shutil.which('node')

assert NODE, 'node must be on PATH to run the suite'

NL = chr(10) + chr(9)   # the library indents with a tab, not spaces

# (label, anchor, replacement, the claim that must fire, scope)

#   scope None -> the .cm-seg__opt / .cm-seg / .cm-disclosure family, resolved

#                from the anchor's own selector

MUTANTS = [
    (
        'the selected option loses its inset rule',
        '\tbox-shadow: inset 0 -2px 0 var(--ink);',
        '',
        'the selected option marks itself with an inset rule',
        ".cm-seg__opt[aria-pressed='true']",
    ),
    (
        'the selected option gets a THICKER border instead',
        '\tbackground: var(--panel);',
        '\tbackground: var(--panel);\n\tborder: 2px solid var(--ink);',
        'a thicker border on the selected option widens the box',
        ".cm-seg__opt[aria-pressed='true']",
    ),
    (
        'the segmented control becomes a block, not an inline control',
        '\tdisplay: inline-flex;',
        '\tdisplay: flex;',
        'a segmented control is an inline control inside a form row',
        '.cm-seg {',
    ),
    (
        'the segmented control stops wrapping',
        '\tflex-wrap: wrap;',
        '\tflex-wrap: nowrap;',
        'a segmented control must wrap its options instead of clipping them',
        '.cm-seg {',
    ),
    (
        'the coarse-pointer tap floor is gone',
        '.cm-seg__opt { min-height: var(--tap); }',
        '.cm-seg__opt { }',
        'a coarse pointer must get the tap floor on each option',
        '.cm-seg__opt { min-height: var(--tap); }',
    ),
    (
        'the native marker is shown again beside our own',
        '.cm-disclosure__summary::-webkit-details-marker { display: none; }',
        '.cm-disclosure__summary::-webkit-details-marker { }',
        'the native marker must be hidden',
        '.cm-disclosure__summary::-webkit-details-marker { display: none; }',
    ),
    (
        'the disclosure affordance never turns',
        '\ttransform: rotate(90deg);',
        '\ttransform: none;',
        'the disclosure affordance must turn with state',
        '.cm-disclosure[open] > .cm-disclosure__summary .cm-disclosure__mark',
    ),
    (
        'the rotation is unscoped, so it turns while closed',
        ".cm-disclosure[open] > .cm-disclosure__summary .cm-disclosure__mark {" + NL + "transform: rotate(90deg);",
        ".cm-disclosure > .cm-disclosure__summary .cm-disclosure__mark {" + NL + "transform: rotate(90deg);",
        'the rotation must be scoped to the open state',
        ".cm-disclosure[open] > .cm-disclosure__summary .cm-disclosure__mark {" + NL + "transform: rotate(90deg);",
    ),
    (
        'a closed panel is only un-rendered, not hidden',
        '.cm-disclosure__body[hidden] { display: none; }',
        '.cm-disclosure__body[hidden] { }',
        'a hidden panel must be stated as display:none',
        '.cm-disclosure__body[hidden] { display: none; }',
    ),
    (
        'the disclosure action is not walked to the end',
        '\tmargin-left: auto;',
        '\tmargin-left: 0;',
        'the action must be walked to the far end of the row',
        '.cm-disclosure__action',
    ),
    (
        'the action does not stay centred when the summary wraps',
        '\talign-self: center;',
        '\talign-self: baseline;',
        'the action must stay centred on its own line when the summary wraps',
        '.cm-disclosure__action',
    ),
    (
        'the page head badge loses its inset rule',
        '\tbox-shadow: inset 3px 0 0 var(--ink);',
        '\tbox-shadow: none;',
        'the badge has no inset rule, so it reads as an unlabelled grey square',
        '.cm-head__badge {',
    ),
    (
        'the page head badge paints a gradient',
        '\tbackground: var(--bg-2);',
        '\tbackground: linear-gradient(to bottom right, #7c3aed, #2563eb);',
        'the badge paints a gradient; the library marks state with an inset rule, not a hue',
        '.cm-head__badge {',
    ),
    (
        'the badge glyph falls back to markup sizing',
        '.cm-head__badge > svg { height: 1rem; width: 1rem; }',
        '.cm-head__badge > svg { height: 24px; width: 24px; }',
        'the badge glyph is sized in markup instead of CSS, so a consumer that omits the class renders an icon at its default 24px',
        '.cm-head__badge > svg',
    ),

]

def src_of(d, rel=None):

    return (d / (rel or CSS)).read_text()

def run(d):

    r = subprocess.run([NODE, 'tests/run.mjs'], cwd=d,

                       capture_output=True, text=True, timeout=1200)

    return re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)

def failures(out):

    """The MESSAGE under each FAIL, not the check name.

    `FAIL  <name>` then an indented message. The name is the summary;

    the message is the claim that actually fired, and it is the message

    that distinguishes WHICH assertion in a multi-assertion check

    tripped. Matching the name reports a false WRONG CLAIM.

    """

    return {m.group(1).strip() for m in

            re.finditer(r'FAIL\s+[^\n]+\n\s+([^\n]+)', out)}

def apply(src, anchor, repl, scope):

    """Edit ONLY the rule named by `scope`, or the rule the anchor sits in.

    An unscoped `src.replace(old, new, 1)` is the single most common way a

    mutation run reports a false kill: in a 115KB stylesheet the first

    occurrence of a declaration is routinely a different class 20KB away,

    and the mutant then dies on a neighbour's guard.

    `body` is the declarations BETWEEN the braces. Slicing from `start`

    (the `{`) instead of `start + 1` keeps the brace in the body, so a

    replacement whose text does not include it silently drops the

    selector and the rule stops existing - a no-op that reads as a

    mutant that changed nothing.

    """

    if scope:

        i = src.index(scope)

    else:

        i = src.index(anchor)

    # A one-line rule (`.x { display: none }`) has no braces to slice

    # between: the next `{` belongs to a DIFFERENT rule entirely. When the

    # scope and the anchor are on the same line, the edit is that line.

    nl = src.find(NL, i)

    brace = src.find('{', i)

    # A one-line rule is one line with braces ON it, so the line that

    # CONTAINS the opening brace is the line that ends the rule.

    if brace != -1 and src.find(NL, brace) > src.find('}', brace):

        line_start = src.rfind(NL, 0, i) + 1

        return src[:line_start] + src[line_start:].replace(anchor, repl, 1)

    start = brace

    j = src.index('}', start)

    body = src[start + 1:j]

    if anchor in body:

        return src[:start + 1] + body.replace(anchor, repl, 1) + src[j:]

    # A mutant that rewrites a SELECTOR has nothing in the body to anchor

    # on, so the edit span is the rule text itself - selector included.

    if anchor in src[i:j + 1]:

        return src[:i] + src[i:j + 1].replace(anchor, repl, 1) + src[j + 1:]

    return None

def main():

    base_out = run(LIB)

    m = re.search(r'(\d+) passed, (\d+) failed', base_out)

    if not m or m.group(2) != '0' or int(m.group(1)) == 0:

        print('ABORT - no clean baseline:\n' + base_out[-900:])

        return 2

    print('baseline: %s passed, 0 failed' % m.group(1))

    print()

    original = src_of(LIB)

    killed = 0

    for label, anchor, repl, claim, *rest in MUTANTS:

        scope = rest[0] if rest else None

        rel = rest[1] if len(rest) > 1 else CSS

        if rel != CSS:

            original = src_of(LIB, rel)

        mutated = apply(original, anchor, repl, scope)

        if mutated is None:

            print('  ANCHOR-MISSING  %s' % label)

            print('            anchor not in the rule it names: %r' % anchor)

            print('ABORT - a mutation that never landed is not a survivor.')

            return 2

        if mutated == original:

            print('  NO-OP  %s  (the edit changed nothing)' % label)

            return 2

        tmp = Path(tempfile.mkdtemp())

        try:

            dst = tmp / 'lib'

            # The repo root holds a self-referential `oem-ui` symlink (an

            # NFS artefact) and copytree follows it, so ignore the name.

            # `dist` is an INPUT to the suite - the built-page checks read

            # it - so excluding it turns the run into a wall of unrelated

            # failures that hide which claim actually fired.

            shutil.copytree(LIB, dst, ignore=shutil.ignore_patterns(

                'node_modules', '.git', 'oem-ui'))

            (dst / rel).write_text(mutated)

            out = run(dst)

            named = failures(out)

            if not named:

                verdict = 'SURVIVED'

            else:

                hit = [n for n in named if claim[:40] in n]

                verdict = 'killed' if hit else 'WRONG CLAIM'

            if verdict == 'killed':

                killed += 1

            print('  %-12s %s' % (verdict, label))

            if verdict != 'SURVIVED':

                print('            on %r' % claim[:60])

            else:

                tally = re.search(r'\d+ passed, \d+ failed', out)

                if tally:

                    print('            (suite still %s)' % tally.group(0))

        finally:

            shutil.rmtree(tmp, ignore_errors=True)

    total = len(MUTANTS)

    print('\n%d/%d killed, each on its own claim' % (killed, total))

    return 0 if killed == total else 1

if __name__ == '__main__':

    sys.exit(main())
