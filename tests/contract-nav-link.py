"""A nav item must paint as a nav item, whether it is an <a> or a <button>.

This rule exists because of a measured regression. The library declared
`text-decoration: underline` on the current nav item, intending it as a
deliberate marker. It did nothing for years, because rpm rendered the
nav as <button> elements and a button has no UA underline to override.
When the nav became real links -- which it must be, so it is
right-clickable, middle-clickable, openable in a new tab, and survives a
reload -- the same rule started applying, and the current item picked up
an underline that underlined its entire row.

The lesson is that a library rule can be silently inert for as long as
the app happens to use the wrong element, and then switch on the day
someone fixes the markup. Assert the PAINT, not the presence of the
declaration.

Reads the real vendored stylesheet, which is what the browser loads.
"""
import re
import sys
from pathlib import Path

CSS = Path("/root/projects/oem-ui/src/styles/components.css")
raw = CSS.read_text()
# Strip comments first. A comment that MENTIONS a declaration is not a
# declaration -- and here the comment explaining the removed underline
# literally contains the words "text-decoration: underline", which made
# the guard read its own explanation as a live rule.
text = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)


def rule_for(selector):
    """Return the declarations of the rule whose selector list matches."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        sels = [s.strip() for s in m.group(1).split(",")]
        if selector in sels:
            return m.group(2)
    return None


fail = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        fail.append(name)


base = rule_for(".cm-header__link")
active = rule_for(".cm-header__link[aria-current='page']")

check("the nav link rule exists", base is not None)
check("the current-item rule exists", active is not None)

if base is not None:
    check("a nav item is never underlined at rest",
          "text-decoration: underline" not in base,
          "the base .cm-header__link must not underline")

if active is not None:
    # The whole point: the current marker is weight + colour, not an
    # underline. An underline on a full-width nav row is a defect.
    check("the current nav item does not underline",
          "text-decoration: underline" not in active,
          "current-item rule still declares an underline")
    check("the current nav item still has a distinct weight",
          re.search(r"font-weight:\s*(700|bold|[6-9]00)", active) is not None)
    check("the current nav item still steps its colour up",
          "color:" in active)

# And the guard above only means something if it would fail: prove the
# mutation that reintroduces the underline is caught by the same rule the
# library declares.
# Target the CURRENT-ITEM rule's own declaration, not the first
# `text-decoration: none` in the file -- an earlier version of this guard
# mutated an unrelated rule and reported the mutation as a no-op, which is
# the exact failure this guard is supposed to detect.
_active_body = rule_for(".cm-header__link[aria-current='page']")
_marker = _active_body
assert _marker is not None and "text-decoration: none" in _marker, \
    "cannot locate the declaration to mutate"
mutated = text.replace(_marker, _marker.replace(
    "text-decoration: none", "text-decoration: underline"), 1)
assert mutated != text, "the mutation did not apply at all"
recheck = re.search(
    r"([^{}]+)\{([^{}]*)\}", mutated
)
m_active = None
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", mutated):
    sels = [x.strip() for x in m.group(1).split(",")]
    if ".cm-header__link[aria-current='page']" in sels:
        m_active = m.group(2)
        # BREAK, or the LAST matching rule wins instead of the one we
        # mutated. Without it this guard reported its own mutation as a
        # no-op and failed -- the mirror image of the defect it exists
        # to catch.
        break
# This asserts that the MUTATED css WOULD trip the real check above --
# i.e. that reintroducing the underline makes the guard fail.
check("the guard would FAIL if the underline came back",
      (m_active is not None and "text-decoration: underline" in m_active
       and "text-decoration: underline" not in active) is True,
      "mutation was a no-op" if m_active is None or "underline" not in m_active else "")

print(f"\n{'ALL PASS' if not fail else str(len(fail)) + ' FAILED: ' + ', '.join(fail)}")
sys.exit(1 if fail else 0)