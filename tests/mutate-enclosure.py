"""
Mutation proof for contract-enclosure.py.

Each mutation edits the REAL css, runs the guard, and requires it to
fail. A survivor means the guard cannot see that defect - which is the
whole reason this file exists: a guard that cannot fail is the same
defect as a rule that has no effect.
"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "tests/contract-enclosure.py"
PY = "/root/.venvs/mau/bin/python"
TOK = ROOT / "src/styles/tokens.css"
CSS = ROOT / "src/styles/components.css"

MUTS = [
    ("the nested token is deleted",
     "tokens.css", lambda t: t.replace("--panel-nested: #1a1a1a;", "/* gone */")
                                 .replace("--panel-nested: #ececec;", "/* gone */")),
    ("the nested surface is put back on the panel value (the 1.008 defect)",
     "tokens.css", lambda t: t.replace("--panel-nested: #1a1a1a;", "--panel-nested: #111111;")),
    ("the nested step is too small to see",
     "tokens.css", lambda t: t.replace("--panel-nested: #1a1a1a;", "--panel-nested: #121212;")),
    ("the light theme loses its nested value",
     "tokens.css", lambda t: t.replace("--panel-nested: #ececec;", "--panel-nested: #f5f5f5;")),
    ("the tile goes back to the near-identical surface",
     "components.css", lambda t: t.replace(
         "background: var(--panel-nested);", "background: var(--bg-2);", 1)),
    ("the card goes back to the parent surface",
     "components.css", lambda t: t.replace(
         "background: var(--panel-nested);", "background: var(--panel);", 1)),
    ("the last-row exemption is deleted (orphan rule returns)",
     "components.css", lambda t: t.replace(".cm-row:last-child { border-bottom: 0; }", "")),
    ("the last row keeps its rule",
     "components.css", lambda t: t.replace(
         ".cm-row:last-child { border-bottom: 0; }",
         ".cm-row:last-child { border-bottom: 1px solid var(--line); }")),
    ("the row separator is removed entirely",
     "components.css", lambda t: t.replace(
         "\tborder-bottom: 1px solid var(--line);\n\ttext-decoration: none;",
         "\ttext-decoration: none;")),
]

def run():
    return subprocess.run([PY, str(GUARD)], capture_output=True, text=True).returncode

base = run()
print(f"baseline: guard rc={base} (must be 0)")
if base != 0:
    print("the guard does not pass on the real source; fix that first")
    sys.exit(2)

killed = 0
survivors = []
for name, target, fn in MUTS:
    path = TOK if target == "tokens.css" else CSS
    orig = path.read_text()
    mutated = fn(orig)
    if mutated == orig:
        survivors.append(name + "  [NO-OP MUTATION]")
        print(f"  SURVIVED {name}  [NO-OP MUTATION]")
        continue
    path.write_text(mutated)
    rc = run()
    path.write_text(orig)
    if rc != 0:
        killed += 1
        print(f"  KILLED   {name}")
    else:
        survivors.append(name)
        print(f"  SURVIVED {name}")

print(f"\n{killed}/{len(MUTS)} mutations killed")
if survivors:
    print("SURVIVORS:")
    for s_ in survivors:
        print("  - " + s_)
    sys.exit(1)
print("MUTATION PROOF PASS")
