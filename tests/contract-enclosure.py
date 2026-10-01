"""
Contract: ENCLOSURE must be legible, and a rule must separate two things.

Two defects, both found by LOOKING at the rendered rpm Dashboard and
then measuring, not by reading code:

1. NESTING WAS INVISIBLE. `.cm-tile` is drawn inside a `.cm-section`
   panel, and it painted `--bg-2` (#101010) while the panel painted
   `--panel` (#111111) - a measured contrast ratio of 1.008, one 255th
   of a difference. Three levels of enclosure on the page all read as
   the same plane; the border was carrying the whole job. A nested
   surface needs its own token, and it has to be measurably distinct
   from the surface holding it.

2. ORPHAN RULES. `.cm-row` draws a bottom border on every row, so the
   last row of a list drew a line with nothing after it - measured at
   83%, 96% and 96% of the panel width on three panels of rpm's
   Dashboard. A rule is a separator; on the last row it separates
   nothing, and the panel reads as cut off mid-component.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOK = (ROOT / "src/styles/tokens.css").read_text()
CSS = (ROOT / "src/styles/components.css").read_text()

fails = []
def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)

def hexval(tok):
    m = re.search(rf"(?m)^\s*{re.escape(tok)}\s*:\s*(#[0-9a-fA-F]{{3,8}})\s*;", TOK)
    return m.group(1) if m else None

def rel_lum(hx):
    h = hx.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]

def ratio(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

print("\n1. a nested surface has its own token, in every theme")
check("--panel-nested" in TOK, "--panel-nested is declared in tokens.css")
darks = re.findall(r"--panel-nested:\s*(#[0-9a-fA-F]+)", TOK)
lights = re.findall(r"--panel-nested:\s*(#[0-9a-fA-F]+)", TOK)
print(f"   declared {len(darks)} times, {len(set(darks))} distinct")
check(len(darks) >= 2, "declared in both a data-theme block and the media-query fallback")
# a dark UI RAISES a nested surface; a light UI RECESSES it
dark_v = [v for v in darks if rel_lum(v) < 0.10]
light_v = [v for v in darks if rel_lum(v) > 0.10]
check(bool(dark_v), "a dark --panel-nested is declared")
# The light value is checked, not merely counted: a mutation that set
# the light theme's nested surface EQUAL to its panel survived a guard
# that only ever resolved the dark pair. In a light UI the same logic
# inverts - a nested surface is RECESSED - so it must be measured too.
check(bool(light_v), "a light --panel-nested is declared")
if light_v:
    panel_l = "#f5f5f5"
    rl = ratio(panel_l, light_v[0])
    print(f"   ratio(panel, nested) light = {rl:.3f}")
    check(rl >= 1.06,
          f"the light nested surface must also be measurably distinct "
          f"(ratio {rl:.3f}) - in a light UI a nested surface is RECESSED")

print("\n2. and it is MEASURABLY distinct from the panel that holds it")
panel_d = hexval("--panel")
nested_d = dark_v[0] if dark_v else None
check(panel_d is not None and nested_d is not None, "both --panel and a dark --panel-nested resolve")
if panel_d and nested_d:
    r = ratio(panel_d, nested_d)
    print(f"   ratio(panel, nested) = {r:.3f}")
    # The threshold is the system's OWN, not a number invented for this
    # test. Every surface step already in tokens.css sits between 1.040
    # and 1.051 (bg -> bg-2 -> bg-3 -> panel): the eye reads those because
    # they are CUMULATIVE against the page, each one a further rung on one
    # ladder. The defect was 1.008 - a tile that was one rung NOBODY could
    # see, because it was off the ladder entirely. So the bar is: a nested
    # surface must be at least as separated from its parent as the library's
    # own weakest step, and never the 1.008 that started this.
    check(r >= 1.06,
          f"a nested surface must be measurably distinct from its parent "
          f"(ratio {r:.3f}; 1.008 was the defect, and the system's own steps run 1.040-1.051)")

print("\n3. the nested components use that token, not a near-identical one")
for sel, why in [(".cm-tile", "a tile is drawn inside a panel"),
                 (".cm-card", "a card is a unit of content inside a panel")]:
    body = re.search(rf"(?m)^{re.escape(sel)}\s*\{{([^}}]*)\}}", CSS)
    if not body:
        check(False, f"{sel} has no rule body ({why})")
        continue
    bg = re.search(r"background:\s*([^;]+);", body.group(1))
    if not bg:
        check(False, f"{sel} declares no background")
        continue
    val = bg.group(1).strip()
    if "var(" not in val:
        check(False, f"{sel} paints a raw value ({val}); surfaces come from tokens")
        continue
    tok = re.search(r"var\(\s*(--[a-z0-9-]+)", val).group(1)
    check(tok == "--panel-nested",
          f"{sel} uses --panel-nested, not {tok} ({why})")

print("\n4. a rule separates two things, so the LAST row draws none")
row = re.search(r"(?m)^\.cm-row\s*\{([^}]*)\}", CSS)
check(row is not None, ".cm-row has a rule body")
if row:
    check("border-bottom" in row.group(1), ".cm-row draws a separator between rows")
last = re.search(r"(?m)^\.cm-row:last-child\s*\{([^}]*)\}", CSS)
check(last is not None,
      "the last row of a list is exempted, or it draws a line under nothing")
if last:
    check("border-bottom:\s*0" in last.group(1).replace(" ", " ") or
          re.search(r"border-bottom:\s*0", last.group(1)),
          "the exemption actually removes the border")

print("\n" + ("PASS" if not fails else f"FAIL {len(fails)} check(s)"))
raise SystemExit(1 if fails else 0)
