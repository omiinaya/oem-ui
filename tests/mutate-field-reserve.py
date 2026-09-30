# #
# Two extra mutants for the specificity trap. Kept in their own file
# because the quoting is fiddly: the selector contains double quotes'
# neighbours and a doubled class, and a nested triple-quote is the
# easiest way to turn a mutation run into a SyntaxError.
#
# THE TRAP: dropping the doubled class takes the selector from (0,6,1)
# to (0,3,1), which does not tie the base
# `input:not([type='checkbox']):not([type='radio']):not([type='range'])`
# rule - it LOSES to it. The declaration still parses, `:has()` is still
# supported, and the field silently keeps its 11.2px padding while a
# 28-character value scrolls under the glyph. Nothing but a specificity
# assertion catches that, which is why the check compares against the
# real base selector instead of eyeballing the cascade.
#
# Run with mutate-field-control.py; these are imported, not run alone.
#/

MUTANTS = [
    (
        "field-control-reserve-loses-specificity",
        ".cm-field__control.cm-field__control:has(> .cm-icon-btn) > input {\n"
        "\tpadding-right: calc(var(--tap) + var(--space-2));\n"
        "}",
        ".cm-field__control:has(> .cm-icon-btn) > input {\n"
        "\tpadding-right: calc(var(--tap) + var(--space-2));\n"
        "}",
        "does not outrank the base input rule",
        None,
    ),
    (
        # Still wins the cascade, still specific enough - and still wrong,
        # because the reserve no longer covers the overlay plus a gap. The
        # text clips a hair's breadth from the glyph.
        "field-control-reserve-too-small",
        ".cm-field__control.cm-field__control:has(> .cm-icon-btn) > input {\n"
        "\tpadding-right: calc(var(--tap) + var(--space-2));\n"
        "}",
        ".cm-field__control.cm-field__control:has(> .cm-icon-btn) > input {\n"
        "\tpadding-right: var(--space-1);\n"
        "}",
        "does not leave a gap beside the glyph",
        None,
    ),
    (
        # The reserve applies even with no affordance present, so a plain
        # field in the same container keeps a mystery right padding.
        "field-control-reserve-applies-without-button",
        ".cm-field__control.cm-field__control:has(> .cm-icon-btn) > input {\n"
        "\tpadding-right: calc(var(--tap) + var(--space-2));\n"
        "}",
        ".cm-field__control.cm-field__control > input {\n"
        "\tpadding-right: calc(var(--tap) + var(--space-2));\n"
        "}",
        "reserves no room for its affordance",
        None,
    ),
    (
        # The desktop house style must survive the coarse override. This
        # is the mutation that would turn a legitimate phone fix into an
        # unrequested restyle of every consumer.
        "focus-desktop-house-style-changed",
        ":focus-visible {\n\toutline: 1px solid var(--accent-dim);\n"
        "\toutline-offset: 2px;\n}",
        ":focus-visible {\n\toutline: 3px solid var(--accent-dim);\n"
        "\toutline-offset: 2px;\n}",
        "the desktop focus ring was changed",
        None,
    ),
    (
        "focus-coarse-still-thin",
        "@media (pointer: coarse) {\n\t:focus-visible {\n"
        "\t\toutline: 2px solid var(--accent-dim);\n\t\toutline-offset: 2px;\n"
        "\t}\n}",
        "@media (pointer: coarse) {\n\t:focus-visible {\n"
        "\t\toutline: 1px solid var(--accent-dim);\n\t\toutline-offset: 2px;\n"
        "\t}\n}",
        "coarse-pointer focus ring is 1px",
        None,
    ),
    (
        "focus-coarse-block-deleted",
        "@media (pointer: coarse) {\n\t:focus-visible {\n"
        "\t\toutline: 2px solid var(--accent-dim);\n\t\toutline-offset: 2px;\n"
        "\t}\n}",
        "@media (pointer: coarse) {\n\t.cm-unrelated {\n"
        "\t\toutline: 2px solid var(--accent-dim);\n\t\toutline-offset: 2px;\n"
        "\t}\n}",
        "no coarse-pointer focus rule",
        None,
    ),
    (
        "focus-coarse-loses-offset",
        "@media (pointer: coarse) {\n\t:focus-visible {\n"
        "\t\toutline: 2px solid var(--accent-dim);\n\t\toutline-offset: 2px;\n"
        "\t}\n}",
        "@media (pointer: coarse) {\n\t:focus-visible {\n"
        "\t\toutline: 2px solid var(--accent-dim);\n\t\toutline-offset: 0;\n"
        "\t}\n}",
        "the coarse-pointer focus ring is not offset from the control",
        None,
    ),
    (
        "glyph-spin-no-animation",
        ".cm-glyph-spin { animation: cm-spin 0.9s linear infinite; }",
        ".cm-glyph-spin { color: var(--ink-dim); }",
        ".cm-glyph-spin declares no animation",
        None,
    ),
    (
        # THE ORIGINAL DEFECT, restored: the class name is present and the
        # markup is unchanged, but nothing draws motion - which is exactly
        # what rpm shipped with `animate-spin`.
        "glyph-spin-does-not-loop",
        ".cm-glyph-spin { animation: cm-spin 0.9s linear infinite; }",
        ".cm-glyph-spin { animation: cm-spin 0.9s linear; }",
        "loop forever",
        None,
    ),
    (
        "glyph-spin-private-keyframes",
        ".cm-glyph-spin { animation: cm-spin 0.9s linear infinite; }",
        ".cm-glyph-spin { animation: cm-glyph-wobble 0.9s linear infinite; }",
        "reuse the cm-spin keyframes",
        None,
    ),
    (
        "glyph-spin-unguarded-by-reduced-motion",
        "\t.cm-cursor,\n\t.cm-spec__chip--motion,\n\t.cm-glyph-spin,\n"
        "\t.cm-skeleton__line,",
        "\t.cm-cursor,\n\t.cm-spec__chip--motion,\n\t.cm-skeleton__line,",
        "animated but unguarded under reduced motion",
        None,
    ),
    (
        # THE ORIGINAL DEFECT, restored exactly: the base layer never reset a
        # bare <button>, so the UA face paints. Removing `background: none`
        # from the reset is indistinguishable from the state before the fix
        # - every nav row, tab, chip and row goes silver.
        "button-reset-drops-background-none",
        "button {\n\t-webkit-appearance: none;\n\tappearance: none;\n\tbackground: none;",
        "button {\n\t-webkit-appearance: none;\n\tappearance: none;",
        "keeps the UA button face",
        None,
    ),
    (
        # `background: transparent` satisfies a naive /background/ grep but
        # paints nothing, so the guard must demand `none` specifically.
        "button-reset-background-transparent",
        "button {\n\t-webkit-appearance: none;\n\tappearance: none;\n\tbackground: none;",
        "button {\n\t-webkit-appearance: none;\n\tappearance: none;\n\tbackground: transparent;",
        "keeps the UA button face",
        None,
    ),
    (
        # Removing appearance alone still leaves the UA face in engines that
        # honour -webkit-appearance only - the reset is two declarations
        # because WebKit ignores the bare alias on some controls.
        "button-reset-drops-appearance",
        "button {\n\t-webkit-appearance: none;\n\tappearance: none;\n\tbackground: none;",
        "button {\n\tbackground: none;",
        "clears appearance but not the native",
        None,
    ),
    (
        # THE SECOND DEFECT, restored: the state modifier is dropped, so
        # `button.cm-row { background: transparent }` at (0,1,1) outranks it
        # and the selected row is invisible again.
        "row-on-loses-the-button-case",
        "button.cm-row--on,\nbutton.cm-row--on:hover {\n\tbackground: var(--bg-2);\n}",
        "button.cm-row--on:hover {\n\tbackground: var(--bg-2);\n}",
        "cannot outrank the element default",
        None,
    ),
    (
        # Right selector, no background: the modifier matches but paints
        # nothing, which is the same invisible result.
        "row-on-without-a-background",
        "button.cm-row--on,\nbutton.cm-row--on:hover {\n\tbackground: var(--bg-2);\n}",
        "button.cm-row--on,\nbutton.cm-row--on:hover {\n\tcolor: var(--ink);\n}",
        "cannot outrank the element default",
        None,
    ),
    (
        # A tag is a label. Shrinkable as a flex item, it wraps in a
        # .cm-head-row and comes out two lines tall.
        # A tag is a label. Shrinkable as a flex item, it wraps in a
        # .cm-head-row and comes out two lines tall (measured 43px next to
        # a 24px sibling under identical rules).
        "tag-shrinkable-as-a-flex-item",
        "\t   the text wrap. */\n\tflex: 0 0 auto;",
        "\t   the text wrap. */",
        "a tag is shrinkable as a flex item",
        None,
    ),
    (
        # The meta slot stays nowrap and unshrinkable, so the row body
        # clips the select and it is unreachable at 390px.
        "meta-wrap-not-a-flex-row",
        ".cm-row__meta--wrap {\n\twhite-space: normal;\n\tflex: 1 1 auto;\n\tmin-width: 0;\n\tdisplay: flex;\n\tflex-wrap: wrap;",
        ".cm-row__meta--wrap {\n\twhite-space: normal;\n\tflex: 1 1 auto;\n\tmin-width: 0;\n\tdisplay: flex;",
        "has no wrapping variant",
        None,
    ),
    (
        # The body stays a single line, so the meta slot and the button
        # group overlap instead of stacking.
        "row-body-wrap-removed",
        ".cm-row__body--wrap {\n\tflex-wrap: wrap;",
        ".cm-row__body--wrap {\n\tflex-wrap: nowrap;",
        "carrying a control has no wrapping variant",
        None,
    ),
    (
        # Full-width meta line removed: the slot wraps but still competes
        # with the title for the same line.
        "row-body-wrap-full-line-meta-removed",
        "\tflex: 1 0 100%;\n}",
        "\tflex: 1 1 auto;\n}",
        "competes with the title for the same line",
        None,
    ),
    (
        # The real trap is ORDER, not the value: same specificity, so
        # whichever comes later wins on source order. Renaming the rule
        # reproduces "declared before": the check compares two indexOf
        # positions, and a rule that is not there at all sorts first.
        "tight-input-not-declared-after-the-base-rule",
        ".cm-inline__input.cm-inline__input--tight {\n\twidth: 11ch;",
        ".cm-inline__input.cm-inline__input--typo {\n\twidth: 11ch;",
        "not declared after .cm-inline__input",
        None,
    ),
    (
        # Revert to the over-broad skip: every element carrying a cm-
        # class loses its full width. Measured in the app: a bare select
        # on Access Lists collapsed to 17px inside a 36px parent.
        "bare-width-skips-every-cm-class",
        "input:not([type='checkbox']):not([type='radio']):not([type='range']):not(.cm-inline__input),\ntextarea:not(.cm-inline__input),\nselect:not(.cm-inline__input)",
        "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([class*='cm-']),\ntextarea:not([class*='cm-']),\nselect:not([class*='cm-'])",
        "no longer steps aside for",
        None,
    ),
    (
        # The other direction: the split never steps aside, so the short
        # input is 386px wide again. The anchor must cover the WHOLE
        # selector list - mutating only the input clause leaves
        # textarea/select holding :not(.cm-inline__input), and the check
        # still passes. That is a survivor, not a kill.
        "bare-width-stops-for-nothing",
        "input:not([type='checkbox']):not([type='radio']):not([type='range']):not(.cm-inline__input),\ntextarea:not(.cm-inline__input),\nselect:not(.cm-inline__input)",
        "input:not([type='checkbox']):not([type='radio']):not([type='range']):not(.cm-nothing),\ntextarea:not(.cm-nothing),\nselect:not(.cm-nothing)",
        "no longer steps aside for",
        None,
    ),
]