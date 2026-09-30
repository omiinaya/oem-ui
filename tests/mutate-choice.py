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

    (
        'the page title row stops laying out as a row',
        '\tdisplay: flex;\n\talign-items: center;',
        '\tdisplay: block;\n\talign-items: center;',
        'the title row has no display:flex, so the badge, the title and the action stack as three block children instead of sharing one line',
        '.cm-head-row {',
    ),
    (
        'the title row action leaves the far end',
        '.cm-head-row__action { margin-left: auto; flex: 0 0 auto; }',
        '.cm-head-row__action { margin-left: 0; flex: 0 0 auto; }',
        'the action is not walked to the far end of the row, so it sits beside the title however long the title grows',
        '.cm-head-row__action {',
    ),
    (
        'a narrow title row stops wrapping',
        '.cm-head-row { flex-wrap: wrap; }',
        '.cm-head-row { flex-wrap: nowrap; }',
        '.cm-head-row never wraps, so at 320px the badge, title and a full-word button all compete for one line',
        '.cm-head-row { flex-wrap: wrap; }',
    ),

    (
        'the row-scoped title rule loses the shared size',
        '.cm-head h1,\n.cm-head .cm-head__title,\n.cm-head-row .cm-head__title {',
        '.cm-head h1,\n.cm-head .cm-head__title {',
        '.cm-head__title is only styled as a descendant of .cm-head, so a title inside .cm-head-row inherits the UA default size',
        '.cm-head h1,',
    ),

    (
        'the side sheet falls back to centred',
        '\tmargin: 0 0 0 auto;',
        '\tmargin: auto;',
        'the sheet is not anchored to the right edge, so it renders centred instead of beside the page it describes',
        '.cm-dialog--sheet {',
    ),
    (
        'the side sheet stops running the full edge',
        '\theight: 100%;\n\tmax-height: 100%;',
        '\theight: 60%;\n\tmax-height: 60%;',
        'the sheet is not full height, so it floats in the middle of the backdrop instead of running the full edge',
        '.cm-dialog--sheet {',
    ),
    (
        'the side sheet keeps a side border on a phone',
        '.cm-dialog--sheet {\n\t\twidth: 100%;\n\t\tborder-left-width: 0;\n\t}',
        '.cm-dialog--sheet {\n\t\twidth: min(30rem, 100%);\n\t}',
        'the sheet never goes full width on a narrow viewport, so a 30rem panel is centred in a 390px screen with backdrop showing either side',
        '@media (max-width: 640px) {\n\t.cm-dialog--sheet',
    ),

    (
        'the switch stops being a control',
        "position: absolute;\n\tinset: 0;\n\tmargin: 0;\n\topacity: 0;",
        "position: absolute;\n\tinset: 0;\n\tmargin: 0;",
        'the real checkbox is not transparent, so it draws a second box on top of the track instead of the track being the whole control',
        ".cm-switch > input[type='checkbox']",
    ),
    (
        'the switch input shrinks to a corner',
        "position: absolute;\n\tinset: 0;\n\tmargin: 0;\n\topacity: 0;",
        "position: static;\n\tmargin: 0;\n\topacity: 0;",
        'the real checkbox is not laid over the control, so the visible track is what gets clicked and the input is only reachable by keyboard',
        ".cm-switch > input[type='checkbox']",
    ),
    (
        'the switch knob is dragged to a hardcoded stop',
        'transform: translateY(-50%) translateX(calc(var(--track-w) - var(--knob-d) - (2 * var(--knob-inset)) - 1px));',
        'transform: translateY(-50%) translateX(18px);',
        'the on-state knob position is a literal, so it drifts out of the track the moment the track token changes',
        '.cm-switch > input:checked ~ .cm-switch__track .cm-switch__knob',
    ),
    (
        'the switch knob stops deriving from the track',
        '--knob-d: calc(var(--track-h) - 0.25rem);',
        '--knob-d: 1rem;',
        '--knob-d is a literal, not a calc, so the knob and the track are two independent numbers that can disagree',
        '--knob-d: calc(var(--track-h) - 0.25rem);',
        'src/styles/tokens.css',
    ),
    (
        'the switch stops signalling by weight',
        '.cm-switch > input:checked ~ .cm-switch__track { background: var(--ink); }',
        '.cm-switch > input:checked ~ .cm-switch__track { background: var(--ink-dim); }',
        'the on-state track does not fill with the ink token, so "on" is not carried by weight',
        '.cm-switch > input:checked ~ .cm-switch__track',
    ),

    (
        'the selected row falls back to a tint',
        'background: var(--bg-2);\n\tbox-shadow: inset 3px 0 0 var(--ink);',
        'background: var(--bg-3);',
        'a selected row is not marked with an inset rule, so the only thing distinguishing it is a background tint that disappears in greyscale print',
        '.cm-row--on',
    ),
    (
        'a clickable row stops filling its container',
        'width: 100%;',
        'width: auto;',
        'a clickable row does not fill its container, so it is narrower than the list it sits in and the tap target stops at the text',
        'button.cm-row',
    ),
    (
        'a clickable row keeps the UA background',
        'background: transparent;',
        'background: var(--bg-3);',
        'a clickable row does not clear the UA button background, so it renders as a raised grey box in the middle of the list',
        'button.cm-row',
    ),
    (
        'a clickable row keeps the UA border',
        'border: 0;\n\tborder-bottom: 1px solid var(--line);',
        'border: 1px solid var(--ink-dim);',
        'a clickable row keeps the UA button border, so it draws a second edge beside the row divider',
        'button.cm-row',
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

    The message is the right thing to match on - but the CHECK NAME has

    to be returned too, because a mutant names the check it expects to

    die (its 4th field), and for several checks that name and the message

    are different strings. Returning only the message made every such

    mutant read as WRONG CLAIM even though the right check had failed:

    the runner compared a check name against a set of messages.

    """

    names = set()

    for m in re.finditer(r'FAIL\s+([^\n]+)\n\s+([^\n]+)', out):

        names.add(m.group(1).strip())

        names.add(m.group(2).strip())

    return names

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
        target_path = rel
        if target_path.startswith('tokens.css') or target_path == 'src/styles/tokens.css':
            target_path = 'src/styles/tokens.css'
            rel = 'src/styles/tokens.css'
        original = src_of(LIB, target_path)

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

MUTANTS += [
    # --- the log table: a page that drifts sideways instead of scrolling ---
    # Scoped to the REAL rule. An unscoped `overflow-x: auto` lands in the
    # first rule that declares it, which is not this one.
    ('table-scroll',
     '\toverflow-x: auto;', '\toverflow-x: visible;',
     'the table scrolls inside its own wrapper, not the page',
     '.cm-table-wrap {'),

    # --- a sticky header that lets rows show through it ---
    ('table-sticky',
     '\tposition: sticky;', '\tposition: static;',
     'the log table header stays put while the body scrolls',
     '.cm-table th {'),
    # `background:` alone is satisfied by `transparent`, which is exactly
    # the mutant - so the check has to demand a real token.
    ('table-sticky-bg',
     '\tbackground: var(--panel);', '\tbackground: transparent;',
     'the log table header stays put while the body scrolls',
     '.cm-table th {'),

    # --- the status code falling back to hue ---
    ('status-hue',
     '\ttext-decoration: underline;', '\tcolor: #dc2626;',
     'a status code is marked by weight and glyph, not by hue',
     '.cm-status-code--err {'),
    ('status-tiers-gone',
     '.cm-status-code--warn { color: var(--ink-dim); }',
     '.cm-status-code--warn2 { color: var(--ink-dim); }',
     'a status code is marked by weight and glyph, not by hue',
     '.cm-status-code--warn { color: var(--ink-dim); }'),
    ('status-glyph-only-colour',
     '\ttext-decoration: underline;\n\ttext-underline-offset: 0.2em;',
     '\tcolor: var(--ink-dim);',
     'a status code is marked by weight and glyph, not by hue',
     '.cm-status-code--err {'),
]


MUTANTS += [
    # --- the ranked meter: bars that stop sharing a left edge ---
    ('meter-row-track-literal',
     '\tflex: 1 1 0;', '\tflex: 0 1 auto;',
     'the row meter grows its TRACK, not its label',
     '.cm-meter--row .cm-meter__track {'),
    ('meter-row-label-grows',
     '\tflex: 1 1 auto;', '\tflex: 1 1 0;',
     'the row meter grows its TRACK, not its label',
     '.cm-meter--row .cm-meter__label {'),

    # --- --row that is not a row, or has no order ---
    ('meter-row-not-a-row',
     '\tflex-direction: row;', '\tflex-direction: column;',
     'the row meter is a row',
     '.cm-meter--row {'),
    ('meter-row-no-order',
     '\torder: 3;', '\t/* order dropped */',
     'the row meter is a row',
     '.cm-meter--row .cm-meter__val {'),
]


MUTANTS += [
    # --- the in-table action reverting to a <tr onClick> in everything but name ---
    ('tblaction-ua-background',
     '\tbackground: none;', '\t/* dropped */',
     'the in-table action is a control, not a bare <tr onClick>',
     '.cm-table__action {'),
    ('tblaction-ua-border',
     '\tborder: 0;', '\tborder: 1px solid var(--ink-dim);',
     'the in-table action is a control, not a bare <tr onClick>',
     '.cm-table__action {'),
    ('tblaction-no-tap-floor',
     '\tmin-height: var(--tap);', '\t/* dropped */',
     'the in-table action is a control, not a bare <tr onClick>',
     '.cm-table__action {'),
    ('tblaction-no-cursor',
     '\tcursor: pointer;', '\tcursor: default;',
     'the in-table action is a control, not a bare <tr onClick>',
     '.cm-table__action {'),

    # --- a focus ring nobody can see ---
    ('tblaction-no-focus-ring',
     '.cm-table__action:focus-visible {\n\toutline: 2px solid var(--ink);\n\toutline-offset: 2px;\n}',
     '.cm-table__action:focus-visible { }',
     'the in-table action keeps a visible focus ring',
     '.cm-table__action:focus-visible {'),

    # --- the arrow that only hover reveals ---
    ('tblaction-coarse-arrow',
     '\t.cm-table__action svg { opacity: 1; }',
     '\t.cm-table__action svg { opacity: 0; }',
     'the in-table action hint is always visible without hover',
     '@media (pointer: coarse), (max-width: 680px) {'),

    # --- two equal columns quietly becoming main-plus-aside ---
    ('cols-unequal',
     '.cm-cols--2 { grid-template-columns: 1fr 1fr; }',
     '.cm-cols--2 { grid-template-columns: 1.6fr 1fr; }',
     'cm-cols--2 is two EQUAL columns',
     '@media (min-width: 760px) {'),
]


MUTANTS += [
    # --- the share column that cannot be scanned ---
    ('meter-note-ragged',
     '\tmin-width: 3.5rem;', '\t/* no width */',
     'the meter note is a fixed-width column, not loose text',
     '.cm-meter--row .cm-meter__note {'),
    ('meter-note-left',
     '\ttext-align: right;', '\ttext-align: left;',
     'the meter note is a fixed-width column, not loose text',
     '.cm-meter--row .cm-meter__note {'),
    ('meter-note-proportional',
     '\tfont-variant-numeric: tabular-nums;', '\tfont-variant-numeric: normal;',
     'the meter note is a fixed-width column, not loose text',
     '.cm-meter--row .cm-meter__note {'),
    # --- the fourth part no longer ordered ---
    ('meter-note-no-order',
     '\torder: 4;', '\t/* order dropped */',
     'the row meter is a row',
     '.cm-meter--row .cm-meter__note {'),
]



MUTANTS += [
    # --- the tile is a column, not a list of unrelated labels ---
    ('tile-left-aligned',
     'align-items: center;',
     'align-items: flex-start;',
     'the count tile is centred',
     '.cm-tile {'),
    ('tile-number-proportional',
     'font-variant-numeric: tabular-nums;',
     'font-variant-numeric: proportional-nums;',
     'the tile value is tabular, so a column of them lines up',
     '.cm-tile__val {'),
    # --- an empty bucket must read as empty ---
    ('tile-empty-still-filled',
     'background: transparent;',
     'background: var(--bg-2);',
     'an empty tile is quieter than a marked one',
     '.cm-tile--empty {'),
    ('tile-empty-underline',
     'text-decoration: none;',
     'text-decoration: underline;',
     'an empty tile is quieter than a marked one',
     '.cm-tile--empty .cm-tile__label,'),
    ('tile-empty-full-ink',
     'color: var(--ink-faint);',
     'color: var(--ink);',
     'an empty tile is quieter than a marked one',
     '.cm-tile--empty .cm-tile__label,'),
    # --- the tier is a glyph, not a tint ---
    ('tile-warn-no-glyph',
     "content: '\\25b2\\00a0';",
     "content: '\\00a0';",
     'a tile tier is a glyph, never a tint',
     '.cm-tile--warn .cm-tile__label::before'),
    ('tile-err-no-glyph',
     "content: '\\2716\\00a0';",
     "content: '\\00a0';",
     'a tile tier is a glyph, never a tint',
     '.cm-tile--err .cm-tile__label::before'),
    # --- an inline word that is a control, not decoration ---
    ('cm-link-block',
     'display: inline;',
     'display: inline-block;',
     'the inline navigation word is a real control',
     'button.cm-link {'),
    ('cm-link-boxed',
     'padding: 0;',
     'padding: 0.5em 1em;',
     'the inline navigation word is a real control',
     'button.cm-link {'),
    ('cm-link-no-focus',
     'outline: 2px solid var(--accent);',
     'outline: none;',
     'the inline navigation word is a real control',
     'button.cm-link:focus-visible'),
]


MUTANTS += [
    # --- the icon size belongs to the container ---
    ('btn-icon-unsized',
     'width: 1em;',
     'width: 24px;',
     'a button sizes the icon inside it, so the markup need not',
     '.cm-btn > svg,'),
    ('btn-icon-shrinks',
     'flex: 0 0 auto;',
     'flex: 1 1 auto;',
     'a button sizes the icon inside it, so the markup need not',
     '.cm-btn > svg,'),
    ('row-icon-through-span-gone',
     'button.cm-row > span > svg {',
     'button.cm-row > span > i {',
     'the row button reaches its icon through the title span'),
    ('chip-icon-unsized',
     'width: 0.9em;',
     'width: 1.6em;',
     'a chip sizes its own icon, slightly tighter than a button',
     '.cm-chip > svg'),
]


MUTANTS += [
    # --- the sort header is a control, not a decorated th ---
    ('sortcol-not-a-button',
     'button.cm-table__sort {',
     '.cm-table__sort {',
     'a sorted column is a button in a th, not a clickable th',
     'button.cm-table__sort {'),
    ('sortcol-no-th',
     'th.cm-table__sortcol {',
     'th.cm-table__sortcol-disabled {',
     'a sorted column is a button in a th, not a clickable th',
     'th.cm-table__sortcol {'),
    ('sortcol-narrow-target',
     '\twidth: 100%;',
     '\twidth: auto;',
     'a sorted column is a button in a th, not a clickable th',
     'button.cm-table__sort {'),
    ('sortcol-sub-tap',
     '\tmin-height: var(--tap);',
     '\tmin-height: 24px;',
     'a sorted column is a button in a th, not a clickable th',
     'button.cm-table__sort {'),
    ('sortcol-no-pointer',
     '\tcursor: pointer;',
     '\tcursor: default;',
     'a sorted column is a button in a th, not a clickable th',
     'button.cm-table__sort {'),
    ('sortcol-no-focus',
     'button.cm-table__sort:focus-visible {',
     'button.cm-table__sort:focus {',
     'a sorted column is a button in a th, not a clickable th',
     'button.cm-table__sort:focus-visible {'),
    # --- the direction mark must be drawn from the announced state ---
    ('sortcol-mark-not-from-ariasort',
     "button.cm-table__sort[aria-sort='descending']::after {",
     "button.cm-table__sort[data-dir='descending']::after {",
     'the sort direction is drawn from aria-sort, never from a colour class',
     "button.cm-table__sort[aria-sort='descending']::after {"),
    ('sortcol-idle-marked',
     '\tbackground: transparent;',
     '\tbackground: var(--ink-faint);',
     'the sort direction is drawn from aria-sort, never from a colour class',
     'button.cm-table__sort::after {'),
]

if __name__ == '__main__':

    sys.exit(main())
