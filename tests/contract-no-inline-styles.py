"""No inline style may hold a static design value.

MEASURED, 2026-10-01: rpm carried 22 inline style props, every one of
them a fixed design decision -- a gap, a padding, a flex direction, an
alignment, a max-height. Each was a rhythm value or a spacing value that
lived in markup instead of the library, which means:

  - the showcase could not render it, so nothing downstream could learn it
  - no guard that reads the library could see it
  - changing the rhythm meant editing a page, not the system

That is the same defect class as the raw `rem` font-size literals: the
design system had an intent, and the app was expressing it by hand.

The ONE legitimate case is a CSS custom property carrying a number that
is computed at runtime -- a meter percentage, a column count derived from
an array. There is no class for "this number"; a class could only
hardcode it, which is the same lie told elsewhere. Those are allowed,
and the classifier below reports them separately so the distinction
stays visible rather than becoming an unwritten rule.

A literal written through a custom property is NOT runtime data: it is a
constant wearing a data-shaped hat, and it is rejected here.
"""
import re
import sys
from pathlib import Path

SRC = Path("/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src")

def _style_bodies(text):
    """Yield the contents of each `style={{ ... }}`, brace-balanced.

    A non-greedy regex stops at the FIRST `}}`, which is wrong the moment
    the value contains an object or a cast -- `as React.CSSProperties}}`
    ends the match early and the whole prop is skipped. A guard that
    silently skips the case it exists to catch is worse than no guard.
    """
    for m in re.finditer(r"style=\{\{", text):
        i = m.end()
        depth, start = 1, i
        while i < len(text) and depth:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        yield m.start(), text[start:i - 1]
# --custom-prop: value   (both quote styles, and the `['x' as string]` form)
CUSTOM = re.compile(r"['\"]?(--[a-z0-9-]+)['\"]?(?:\s+as\s+string\s*)?\]?\s*:\s*(.+?)\s*\}?\}?$", re.M)

fail, allowed = [], []

for f in sorted(SRC.rglob("*.tsx")):
    if "/test/" in str(f):
        continue
    text = f.read_text()
    rel = str(f.relative_to(SRC))
    # A prose comment that merely mentions `style={{ width }}` is a note
    # about the antipattern, not an instance of it. Blanking comments
    # keeps line numbers intact.
    code_only = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)),
                       text, flags=re.S)

    # A JSX element may only carry ONE className. Two is a syntax-level
    # mistake that still compiles under some configs and silently drops
    # one of them -- it cost three real bugs in one pass here.
    for m in re.finditer(r"className=(\"[^\"]*\"|'[^']*'|\{`[^`]*`\})", text):
        pass
    # A JSX open tag: `<` followed by a name and attributes, ending at the
    # `>` that closes it. Attributes may contain `>` inside a string or an
    # arrow, so match to the first `>` that is not inside quotes.
    for m in re.finditer(r"<[A-Za-z][\s\S]*?>", code_only):
        tag = m.group(0)
        if len(re.findall(r"\bclassName=", tag)) > 1:
            line = text[:m.start()].count("\n") + 1
            fail.append(f"{rel}:{line}  an element carries two className props")

    for start, body in _style_bodies(code_only):
        line = text[:start].count("\n") + 1
        props = CUSTOM.findall(body)

        if props:
            for name, value in props:
                v = value.strip()
                # Runtime data only if the value is an expression.
                is_literal = not ("`" in v or "{" in v or "+" in v
                                  or v.startswith("props") or "concat" in v)
                if is_literal:
                    fail.append(
                        f"{rel}:{line}  custom property {name} set to the CONSTANT {v!r} "
                        f"-- a literal through a custom property is not runtime data"
                    )
                else:
                    allowed.append(f"{rel}:{line}  {name} = {v}")
            continue

        # Anything else in a style prop is a static design value.
        fail.append(f"{rel}:{line}  static inline style: {' '.join(body.split())[:88]}")

print(f"legitimate runtime custom properties: {len(allowed)}")
for a in allowed:
    print(f"  OK   {a}")

if fail:
    print(f"\n{len(fail)} REJECTED:")
    for x in fail:
        print(f"  FAIL {x}")
else:
    print("\nno static inline styles")

print(f"\n{'ALL PASS' if not fail else str(len(fail)) + ' FAILED'}")
sys.exit(1 if fail else 0)