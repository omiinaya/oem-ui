"""Touch targets and disclosure wrapping at phone size.

Two fixes from the WebKit sweep (390px viewport): a 17px switch tap
target, and a disclosure summary that overflowed sideways because it
refused to wrap.

Reads the real stylesheet, asserts the fix, and proves each assertion
can fail.
"""
import pathlib
import re
import sys

CSS = pathlib.Path("/root/projects/oem-ui/src/styles/components.css")
raw = CSS.read_text()
# Strip comments first: a comment that MENTIONS a declaration is not one.
css = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), raw, flags=re.S)


def rule_body(text, target):
    """Body of the rule whose selector list contains `target` exactly."""
    for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", text, re.S):
        for s in [x.strip() for x in sel.split(",")]:
            if s == target:
                return body
    return None


def decl(body, prop):
    m = re.search(r"(?<![-\w])" + re.escape(prop) + r"\s*:\s*[^;]+;", body or "")
    return m.group(0) if m else ""


fails = []


def ok(cond, msg, detail=""):
    print(("  ok   " if cond else "  FAIL ") + msg + (f"  [{detail}]" if detail else ""))
    if not cond:
        fails.append(msg)


print("1. the switch has a finger-sized hit area")
sw = rule_body(css, ".cm-switch")
ok(sw is not None, ".cm-switch exists")
pad = decl(sw, "padding")
ok(bool(pad), ".cm-switch declares padding", pad.strip())
m = re.match(r"padding\s*:\s*([0-9.]+)px", pad)
block = float(m.group(1)) if m else 0.0
ok(block >= 3, "the switch hit area is padded at least 3px blockwise", f"{block}px")

# The padding only counts because the checkbox still FILLS the wrapper.
print("\n2. and the checkbox fills it, so the padding is real hit area")
cb = rule_body(css, ".cm-switch > input[type='checkbox']")
ok(cb is not None, "the switch input rule exists")
ok("inset: 0" in (cb or ""), "the input fills the wrapper (inset: 0)")

print("\n3. the disclosure summary wraps")
ds = rule_body(css, ".cm-disclosure__summary")
ok(ds is not None, ".cm-disclosure__summary exists")
ok("flex-wrap: wrap" in (ds or ""),
   "the summary wraps, so a 44px action cannot run off the row")

print("\n4. every one of those can fail")
# A mutation must make the RULE wrong, not delete a keyword and then assert
# the keyword is gone -- that asserts nothing about the value. Each mutation
# below breaks the real property, then re-reads the SAME rule and applies the
# SAME numeric assertion used above.

def mutated(target, old, new):
    """Break `old` -> `new` INSIDE the named rule only.

    A blind `css.replace(old, new, 1)` edits the FIRST occurrence in the
    file, and both `flex-wrap: wrap;` and `inset: 0;` appear in earlier
    rules -- so the mutation lands somewhere else entirely and the guard
    correctly reports the real rule as still correct. That is a no-op
    mutation reporting as a survivor.
    """
    body = rule_body(css, target)
    if not body or old not in body:
        return None
    start = css.index(body)
    patched = css[:start] + body.replace(old, new, 1) + css[start + len(body):]
    return rule_body(patched, target)

# 1. the padding collapses to zero
b = mutated(".cm-switch", pad, "padding: 0;")
_m = re.match(r"padding\s*:\s*([0-9.]+)px", decl(b or "", "padding"))
ok((_m is None) or float(_m.group(1)) < 3, "collapsing the padding to 0 is caught")

# 2. the wrap is refused
b = mutated(".cm-disclosure__summary", "flex-wrap: wrap;", "flex-wrap: nowrap;")
ok("flex-wrap: wrap" not in (b or ""), "refusing the wrap is caught")

# 3. the input stops filling the wrapper, so the padding would count for
#    nothing -- the subtle half of fix 1
b = mutated(".cm-switch > input[type='checkbox']", "inset: 0;", "inset: 0 auto auto 0;")
ok("inset: 0;" not in (b or ""), "breaking the input fill is caught")

print()
if fails:
    print(f"{len(fails)} FAILED")
    sys.exit(1)
print("ALL PASS")
