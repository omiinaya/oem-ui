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
]