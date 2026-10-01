"""Contract: a page has a TYPE SCALE and a RHYTHM, and both are tokens.

Two defects this file exists to stop, both found by LOOKING at the
rendered rpm Dashboard against the oem references rather than by
reading the CSS:

  1. No body scale. Thirty-five rules in the components layer declared
     a raw rem literal (0.7, 0.72, 0.8, 0.84, 1.05...), and MEASURED on
     the live Dashboard that produced TWELVE distinct rendered sizes for
     five jobs. Every size differed from its neighbour by a couple of
     pixels, so nothing grouped and the page read as flat.

  2. No rhythm. `.cm-stack` - the class that spaces a page's regions -
     used `--space-2` (8px) while each panel padded itself by 19.2px.
     Outer separation smaller than inner padding means the eye merges
     the panels into one stack before it can see them as regions.

Both are token questions, so both are asserted as tokens.
"""
import re
import sys
from pathlib import Path

LIB = Path('/root/projects/oem-ui/src')
CSS = (LIB / 'styles/components.css').read_text()
BASE = (LIB / 'styles/base.css').read_text()
TOK = (LIB / 'styles/tokens.css').read_text()

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


def rule_body(src, sel):
    m = re.search(r'(?:^|\n)' + re.escape(sel) + r'\s*\{([^}]*)\}', src)
    return m.group(1) if m else None


print('1. the scale is declared as tokens')
SCALE = ['--text-lg', '--text-md', '--text', '--text-sm', '--text-xs', '--text-micro']
for name in SCALE:
    declared = re.search(rf'{re.escape(name)}\s*:\s*([0-9.]+)rem', TOK)
    check(bool(declared), f'{name} is declared in tokens.css')
    if declared:
        print(f'       {name} = {declared.group(1)}rem '
              f'({float(declared.group(1)) * 16:.1f}px)')

# the steps must strictly descend: a scale that does not descend is
# not a scale
vals = []
for name in ['--text-lg', '--text-md', '--text', '--text-sm', '--text-xs', '--text-micro']:
    m = re.search(rf'{re.escape(name)}\s*:\s*([0-9.]+)rem', TOK)
    if m:
        vals.append((name, float(m.group(1))))
desc = all(vals[i][1] > vals[i + 1][1] for i in range(len(vals) - 1))
check(desc, 'the steps strictly descend, so the scale is ordered')

print('\n2. no component rule reaches for a raw rem size any more')
# A heading inside long form copy is a DIFFERENT scale from a body
# label: `.cm-prose h2` is deliberately a step below the section
# heading, and `.cm-rows--stacked .cm-row__title` is a title. Forcing
# them onto the body scale would flatten prose into the UI. They are
# named here so the exemption is visible, not silent.
PROSE_SCALE = re.compile(r'\.cm-prose\s+h[1-6]')
# `font-size: max(var(--min-font), 0.78rem)` is the SAME defect wearing a
# function: the floor is a token but the size it floors is a raw
# literal, so 34 rules escaped a mapping that only matched bare
# `font-size: Nrem`. Both shapes are checked.
OFF_SCALE = re.compile(
    r'font-size:\s*[0-9.]+rem'
    r'|font-size:\s*(?:max|min|clamp)\([^)]*[0-9.]+rem')
raw = []
for i, line in enumerate(CSS.split('\n'), 1):
    if OFF_SCALE.search(line) and not PROSE_SCALE.search(line):
        raw.append((i, line.strip()[:64]))
check(not raw, f'components.css has no raw rem font-size ({len(raw)} found)')
for i, l in raw:
    print(f'       {i}: {l}')

raw_base = []
for i, line in enumerate(BASE.split('\n'), 1):
    if re.search(r'font-size:\s*[0-9.]+(rem|px)', line):
        raw_base.append((i, line.strip()[:64]))
check(not raw_base, f'base.css has no raw size ({len(raw_base)} found)')
for i, l in raw_base:
    print(f'       {i}: {l}')

print('\n3. body and the elements resolve the scale, not a literal')
body = rule_body(BASE, 'body')
check(body and 'var(--text)' in body, 'body resolves --text')
for el in ['h1', 'h2', 'h3']:
    b = re.search(rf'(?:^|\n){el}\s*\{{([^}}]*)\}}', BASE)
    check(bool(b) and 'var(--' in b.group(1),
          f'the bare {el} default names a scale token')

print('\n4. a value may not outshout the heading that introduces it')
# Compare against `.cm-section__title` - the heading a panel actually
# uses - and not the bare `h2` element default. Against `h2` this check
# passed a real defect: the KPI figures and the panel titles both
# computed 18.4px, so a number and its own heading were the same size
# and the eye could not tell which was labelling which. The bare default
# is 16px, which is looser, so it graded the page on a heading that does
# not appear on it.
h2 = rule_body(CSS, '.cm-section__title')
assert h2, '.cm-section__title is not defined'
h2_decl = re.search(r'font-size:\s*([^;}]+)', h2).group(1)


def px(decl):
    # a floored size is `max(var(--min-font), var(--text-md))`: the
    # value that decides the rendering is the SECOND argument
    inner = re.search(r'(?:max|min|clamp)\((.*)\)', decl)
    if inner:
        decl = inner.group(1).split(',')[-1].strip()
    # A token may point at another token (`--head-h2: var(--text-md)`),
    # so this follows the chain rather than assuming one hop. A resolver
    # that gives up on the second hop reports a FALSE failure for a
    # perfectly valid scale, and the fix people reach for is deleting the
    # indirection - which is how two sources for one step came to exist.
    for _ in range(8):
        m = re.search(r'var\(\s*(--[a-z0-9-]+)\s*\)', decl)
        if not m:
            break
        t = re.search(rf'(?m)^\s*{re.escape(m.group(1))}\s*:\s*([^;]+);', TOK)
        if not t:
            return None
        decl = t.group(1).strip()
    m = re.search(r'([0-9.]+)rem', decl)
    if m:
        return float(m.group(1)) * 16
    m = re.search(r'([0-9.]+)rem', decl)
    return float(m.group(1)) * 16 if m else None


for sel in ['.cm-stat__val', '.cm-tile__val', '.cm-card__title', '.cm-dialog__title']:
    b = rule_body(CSS, sel)
    if not b:
        check(False, f'{sel} is defined')
        continue
    d = re.search(r'font-size:\s*([^;}]+)', b)
    v = px(d.group(1)) if d else None
    # A MINIMUM STEP, not just "smaller". 1px of difference measured as
    # indistinguishable on the page: same weight, same white, so a hero
    # numeral and its panel title read at one level. A step you cannot
    # see is not a step.
    gap = px(h2_decl) - v if v is not None else -1
    check(gap >= 3.0,
          f'{sel} ({v}px) must sit at least 3px below the section title '
          f'({px(h2_decl)}px) to be legible as subordinate - the gap is {gap}px')

print('\n5. no scale step sits below the accessibility floor')
floor = re.search(r'--min-font\s*:\s*([0-9.]+)px', TOK)
floor_px = float(floor.group(1)) if floor else None
check(floor_px is not None, '--min-font is declared in px')
for name, v in vals:
    px_v = v * 16
    check(px_v >= floor_px,
          f'{name} ({px_v:.1f}px) is at or above the {floor_px}px floor')

print('\n6. the rhythm: siblings are further apart than a panel pads')
stack = rule_body(CSS, '.cm-stack')
check(bool(stack), '.cm-stack is defined')
gap = re.search(r'gap:\s*var\((--space-\d+)\)', stack or '')
check(bool(gap), '.cm-stack takes its gap off the space scale')
gap_px = None
if gap:
    g = re.search(rf'{re.escape(gap.group(1))}\s*:\s*([0-9.]+)rem', TOK)
    gap_px = float(g.group(1)) * 16 if g else None

# the padding it has to beat: .cm-section--pad
pad_px = None
for decl in re.findall(r'padding:\s*([^;}]+);', CSS):
    vals = re.findall(r'([0-9.]+)rem', decl)
    if len(vals) >= 2:
        v = max(float(x) for x in vals) * 16
        if 15 <= v <= 24:
            pad_px = v if pad_px is None else max(pad_px, v)

check(gap_px is not None and pad_px is not None,
      'the section padding is measurable')
check(gap_px is not None and pad_px is not None and gap_px > pad_px,
      f'the gap between regions ({gap_px}px) exceeds the padding inside '
      f'one ({pad_px}px) - otherwise the panels merge')

print('\n7. the tight variant exists, because a ledger is a different job')
check(bool(rule_body(CSS, '.cm-stack--tight')),
      '.cm-stack--tight is available for a hairline-separated record list')

print()
if fails:
    print(f'FAIL  {len(fails)} check(s)')
    sys.exit(1)
print('PASS')
