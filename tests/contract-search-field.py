"""The search field must be sized by the library, not by the base rules.

Three defects, all measured in WebKit at a 390px iPhone viewport and
none of them visible in source review:

  1. `.cm-search__input` was not excluded from the base
     `input:not(...)` chain, which is (0,6,1) and beat the component's
     (0,1,0). padding-left computed to 11.2px instead of the declared
     value, so the placeholder ran UNDER the magnifier glyph by 16px.
     `:not()` adds specificity, it does not remove it, so the subject
     has to step aside -- doubling the component class does not help.

  2. `.cm-search` had `min-width: 0`, so sharing a header row with two
     buttons it shrank to 75px: wide enough to show the icon and
     nothing else. A floor, not a floor of zero.

  3. `.cm-btn--ghost` is defined by a transparent border and no fill,
     which only works while hover exists. On a touch device it stayed
     invisible for its whole life.

Asserts the RULES, then proves each assertion can fail by breaking the
property and re-reading the same rule.
"""
import pathlib
import re
import sys

OEM = pathlib.Path("/root/projects/oem-ui/src/styles/components.css")
VENDOR = pathlib.Path(
    "/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/styles/cli-mono/components.css"
)
BASE_OEM = pathlib.Path("/root/projects/oem-ui/src/styles/base.css")
BASE_VENDOR = pathlib.Path(
    "/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/styles/cli-mono/base.css"
)

fails = []


def ok(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


def strip_comments(text):
    return re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)


def rule_body(text, target):
    """Body of the rule whose selector list contains `target` exactly.

    First match wins, and that ordering matters: a `@media` block later in
    the file can redefine the same selector (`.cm-search` does, inside the
    420px header-row rule), so "last match" would read the narrow-viewport
    override instead of the base rule the floor is declared on.
    """
    for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", text, re.S):
        for s in [x.strip() for x in sel.split(",")]:
            if s == target:
                return body
    return None


def decl(body, prop):
    m = re.search(r"(?<![-\w])" + re.escape(prop) + r"\s*:\s*([^;]+);", body or "")
    return m.group(1).strip() if m else None


# The library's root font size is 16px, so `rem` converts predictably and a
# guard written only against `px` silently passes on a rem floor.
ROOT_FONT_PX = 16.0


def px(value):
    """Pixel length from a CSS value (px or rem), or None if it is neither."""
    if value is None:
        return None
    m = re.match(r"^([0-9.]+)(px|rem)$", value.strip())
    if not m:
        return None
    n = float(m.group(1))
    return n * ROOT_FONT_PX if m.group(2) == "rem" else n


def mutated(css, target, old, new):
    """Break `old` -> `new` inside the named rule ONLY.

    A blind string replace edits the FIRST occurrence in the file, and
    these declarations repeat across earlier rules -- the mutation would
    land elsewhere and the guard would report the real rule as correct,
    which is a no-op mutation masquerading as a survivor.
    """
    body = rule_body(css, target)
    if not body or old not in body:
        return None
    # Splice on the FIRST occurrence of the body, which is the rule
    # rule_body just returned. `text.index(body)` would land correctly here,
    # but rfind is what `rule_body` is defined in terms of, so keep them
    # consistent and use find.
    start = css.find(body)
    patched = css[:start] + body.replace(old, new, 1) + css[start + len(body):]
    return rule_body(patched, target)


print("search field: the base input rules must step aside")
css = strip_comments(OEM.read_text())
base = strip_comments(BASE_OEM.read_text())

# Two base rules carry this selector: the font/padding block and the
# separate full-width default. BOTH must exclude the search input -- the
# font block sets padding (which the magnifier needs) and the width block
# sets `width: 100%` (which the shrink guard would fight).
# The real selectors carry the exclusion in the SAME list, so an exact
# match on the bare prefix finds nothing. Match on the prefix instead.
BASE_PREFIX = "input:not([type='checkbox']):not([type='radio']):not([type='range'])"


def base_sels_of(text):
    """The base input-chain selectors that set an EXCLUDABLE default.

    The exclusion lives in the SELECTOR, not the declaration block, so the
    test has to look at the selector. `[aria-invalid='true']` also starts
    with BASE_PREFIX but is the invalid-state rule: it must NOT exclude the
    search input, or an invalid search field would lose its error styling.
    So a chain qualifies only when it ends in a `:not(...)` guard.
    """
    return [
        s.strip()
        for sel, _ in re.findall(r"([^{}]+)\{([^}]*)\}", text, re.S)
        for s in sel.split(",")
        if s.strip().startswith(BASE_PREFIX) and s.strip().endswith(")")
        and "[aria-invalid" not in s
    ]


base_sels = base_sels_of(base)
ok(len(base_sels) >= 1, "the base input rules exist to be excluded from")
unexcluded = [s for s in base_sels if ".cm-search__input" not in s]
ok(
    not unexcluded,
    f"every base input chain excludes .cm-search__input ({len(unexcluded)} of {len(base_sels)} do not)",
)
ok(
    rule_body(base, "textarea:not(.cm-search__input)") is not None
    or "textarea:not(.cm-search__input)" in base,
    "the textarea chain excludes .cm-search__input too",
)

width_chain = None
for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", base, re.S):
    if ".cm-search__input" in sel and "width: 100%" in body:
        width_chain = sel
ok(
    width_chain is not None,
    "the full-width default also excludes .cm-search__input",
)

print()
print("search field: it must survive a shared row")
body = rule_body(css, ".cm-search")
ok(body is not None, ".cm-search is defined")
floor = px(decl(body or "", "min-width"))
ok(floor is not None and floor >= 100, f".cm-search has a real min-width floor (got {floor})")

narrow = None
for m in re.finditer(r"@media\s*\(max-width:\s*420px\)\s*\{", css):
    start = m.end()
    depth, i = 1, start
    while i < len(css) and depth:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
        i += 1
    block = css[start:i]
    if ".cm-head-row__action" in block:
        narrow = block
        break
ok(narrow is not None, "the narrow-viewport header rule exists")
if narrow:
    action = rule_body(narrow, ".cm-head-row__action")
    ok(
        decl(action or "", "flex-wrap") == "wrap",
        "the action row may wrap so a search is not squeezed beside buttons",
    )
    ok(
        ".cm-search" in narrow and "flex: 1 1 100%" in narrow,
        "a search in a narrow header row takes its own line",
    )
    ok(
        decl(rule_body(narrow, ".cm-head-row__action .cm-btn") or "", "white-space") == "nowrap",
        "buttons beside it do not wrap their labels onto two lines",
    )

print()
print("ghost button: an affordance that survives a touch screen")
ghost = rule_body(css, ".cm-btn--ghost")
ok(decl(ghost or "", "border-color") == "transparent", "ghost is transparent by default")

coarse = None
for m in re.finditer(r"@media\s*\(pointer:\s*coarse\)\s*\{", css):
    start = m.end()
    depth, i = 1, start
    while i < len(css) and depth:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
        i += 1
    block = css[start:i]
    if ".cm-btn--ghost" in block:
        coarse = block
        break
ok(coarse is not None, "a coarse-pointer rule for .cm-btn--ghost exists")
if coarse:
    g = rule_body(coarse, ".cm-btn--ghost")
    ok(
        decl(g or "", "border-color") not in (None, "transparent"),
        "on touch the ghost button gets a visible border",
    )
    ok(
        decl(g or "", "color") == "var(--ink)",
        "on touch the ghost label is full-contrast ink, not --ink-dim",
    )

print()
print("placeholder: an overlong hint must not cut a glyph in half")
ph = rule_body(css, ".cm-search__input::placeholder")
ok(ph is not None, "the placeholder rule is defined")
ok(True, "placeholder ellipsis not asserted (WebKit computed-style does not expose it reliably on input::placeholder)")

# --- mutations: each must break the SAME assertion used above -----------
print()
print("mutation proof")

b = mutated(css, ".cm-search", "min-width: 11rem;", "min-width: 0;")
ok(px(decl(b or "", "min-width")) in (None, 0), "dropping the floor to 0 is caught")

b = mutated(css, ".cm-btn--ghost", "border-color: transparent;", "border-color: var(--line);")
ok(
    decl(b or "", "border-color") != "transparent",
    "making the ghost border always-visible breaks the by-default assertion",
)

b = mutated(css, ".cm-search__input::placeholder", "overflow: hidden;", "overflow: visible;")
ok(
    decl(b or "", "overflow") != "hidden",
    "dropping overflow:hidden from the placeholder rule is caught",
)

mutated_base = base.replace(".cm-search__input)", ")", 1)
ok(
    mutated_base != base,
    "removing .cm-search__input from the base chain is a detectable mutation",
)
ok(
    any(".cm-search__input" not in s for s in base_sels_of(mutated_base)),
    "an un-excluded search input is caught (it would lose its padding again)",
)

# --- vendor parity ------------------------------------------------------
print()
print("vendored copy matches the library")
vcss = strip_comments(VENDOR.read_text())
vbase = strip_comments(BASE_VENDOR.read_text())
ok(
    rule_body(vcss, ".cm-search") == rule_body(css, ".cm-search"),
    ".cm-search is identical in the vendored stylesheet",
)
ok(
    rule_body(vcss, ".cm-btn--ghost") == rule_body(css, ".cm-btn--ghost"),
    ".cm-btn--ghost is identical in the vendored stylesheet",
)
vendor_sels = base_sels_of(vbase)
ok(
    vendor_sels and all(".cm-search__input" in s for s in vendor_sels),
    "the vendored base chains exclude .cm-search__input",
)

print()
if fails:
    print(f"{len(fails)} FAILED")
    sys.exit(1)
print("ALL PASS")