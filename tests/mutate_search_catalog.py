"""The mutation catalog, as data.

Each entry is (file, description, needs_rebuild, [(old, new), ...]).
A pair that does not occur is a NO-OP and the runner says so loudly.
"""
Q = chr(34)
NL = chr(10)
TAB = chr(9)

COMP = 'src/styles/components.css'
TOK = 'src/styles/tokens.css'
PAGE = 'src/pages/index.astro'
BASE = 'src/styles/base.css'

FOCUS_RULE = ('.cm-search__input:focus-visible { outline: 2px solid var(--focus); '
              'outline-offset: 1px; }')

MUTATIONS = [
    (COMP, 'the search focus ring drops to a 1px hairline', False, [
        (FOCUS_RULE,
         '.cm-search__input:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }'),
    ]),
    (COMP, 'the search focus ring stops referencing --focus', False, [
        (FOCUS_RULE,
         '.cm-search__input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }'),
    ]),
    (COMP, 'the search field loses the 16px form-text floor', False, [
        ('font-size: max(var(--min-font), 1rem);' + NL + TAB + 'color: var(--ink);',
         'font-size: max(var(--min-font), var(--text-sm));' + NL + TAB + 'color: var(--ink);'),
    ]),
    (TOK, '--focus is deleted (the exact bug that shipped)', False, [
        (TAB + '--focus: var(--accent-dim);' + NL, ''),
    ]),
    (COMP, 'the gutter stops deriving from --search-clear', False, [
        ('padding-right: calc(var(--space-3) + var(--search-clear) + var(--space-2));',
         'padding-right: var(--space-4);'),
    ]),
    (COMP, 'the clear button stops taking --search-clear', False, [
        ('width: var(--search-clear);' + NL + TAB + 'height: var(--search-clear);',
         'width: 32px;' + NL + TAB + 'height: 32px;'),
    ]),
    (TOK, '--search-clear aliases --tap (a knob that cannot be turned)', False, [
        ('--search-clear: 32px;', '--search-clear: var(--tap);'),
    ]),
    (COMP, 'the coarse clear button loses the tap floor', False, [
        ('@media (pointer: coarse) {' + NL + TAB + '.cm-search__clear {' + NL
         + TAB + TAB + 'width: var(--tap);' + NL + TAB + TAB + 'height: var(--tap);' + NL
         + TAB + '}' + NL + '}', ''),
    ]),
    (COMP, 'the search glyph stops being sized (replaced-element default)', False, [
        (TAB + 'width: 1em;' + NL + TAB + 'height: 1em;' + NL + '}' + NL
         + '.cm-search__clear {',
         TAB + 'width: 24px;' + NL + TAB + 'height: 24px;' + NL + '}' + NL
         + '.cm-search__clear {'),
    ]),
    (BASE, 'base.css drops its .cm-search__input exclusion', True, [
        (':not(.cm-search__input)', ''),
    ]),
    (PAGE, 'the showcase drops cm-search__input from the markup', True, [
        (' class=' + Q + 'cm-search__input' + Q, ''),
    ]),
    (PAGE, 'the showcase stops rendering cm-search--wide', True, [
        ('cm-search cm-search--wide', 'cm-search'),
    ]),
    (PAGE, 'the clear button loses its accessible name in the showcase', True, [
        (' aria-label=' + Q + 'clear filter' + Q, ''),
    ]),
    (PAGE, 'the search glyph stops being aria-hidden in the showcase', True, [
        ('<span class=' + Q + 'cm-search__icon' + Q + ' aria-hidden=' + Q + 'true' + Q + '>',
         '<span class=' + Q + 'cm-search__icon' + Q + '>'),
    ]),
    (PAGE, 'the section index drops the search entry (scroll-spy skips it)', True, [
        ("'forms', 'search', 'auth'", "'forms', 'auth'"),
    ]),
]
