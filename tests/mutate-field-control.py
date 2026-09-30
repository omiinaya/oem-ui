#!/usr/bin/env python3
"""Scoped mutants for .cm-field__control.

Every mutant edits ONE declaration inside ONE rule body, and each asserts
its OWN claim - never a neighbour's. A run that reports ANCHOR-MISSING or
a missing baseline ABORTS rather than reporting survivors: a mutation
that never landed proves nothing.

Rules carry a backup, restore on every exit path, and a byte-exact
compare against the backup runs after each restore so an interrupted run
can never leave a mutant behind as the working tree.
"""
import shutil
import subprocess
import sys
from pathlib import Path

CSS = Path("/root/projects/oem-ui/src/styles/components.css")
# The focus-ring mutants live in base.css, so the backup/restore has to
# cover BOTH files or a run leaves a mutant behind in a file it never
# snapshotted - and a green suite over a dirty tree proves nothing.
SRC = Path("/root/projects/oem-ui/src/styles")
FILES = ["components.css", "base.css"]
BAKS = {f: Path("/root/.hermes/cache/scratch/%s.bak" % f) for f in FILES}

# (label, anchor, replacement, claim substring the check must print, scope)
MUTANTS = [
    (
        "field-control-not-relative",
        ".cm-field__control { position: relative; display: flex; }",
        ".cm-field__control { position: static; display: flex; }",
        "not a positioning context",
        None,
    ),
    (
        "field-control-btn-not-absolute",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 0;
	transform: translateY(-50%);
}""",
        """.cm-field__control > .cm-icon-btn {
	position: static;
	top: 50%;
	right: 0;
	transform: translateY(-50%);
}""",
        "not pinned to the control",
        None,
    ),
    (
        "field-control-btn-no-right",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 0;
	transform: translateY(-50%);
}""",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 4px;
	transform: translateY(-50%);
}""",
        "not pinned to the control",
        None,
    ),
    (
        "field-control-btn-not-vertically-centred",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 0;
	transform: translateY(-50%);
}""",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 12%;
	right: 0;
	transform: translateY(-50%);
}""",
        "not centred on the control",
        None,
    ),
    (
        "field-control-btn-no-translate",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 0;
	transform: translateY(-50%);
}""",
        """.cm-field__control > .cm-icon-btn {
	position: absolute;
	top: 50%;
	right: 0;
	transform: none;
}""",
        "not centred on the control",
        None,
    ),
    (
        "field-control-input-no-flex",
        ".cm-field__control > input { flex: 1 1 auto; min-width: 0; }",
        ".cm-field__control > input { flex: 0 1 auto; min-width: 0; }",
        "does not absorb the overlay",
        None,
    ),
    (
        "field-control-input-no-minwidth",
        ".cm-field__control > input { flex: 1 1 auto; min-width: 0; }",
        ".cm-field__control > input { flex: 1 1 auto; min-width: 40px; }",
        "does not absorb the overlay",
        None,
    ),
    (
        # taps the OTHER check: the tap floor itself, on the class that
        # carries it. Scoped to the coarse-pointer block.
        "bare-icon-btn-loses-tap-floor",
        """@media (pointer: coarse) {
	.cm-icon-btn--bare { width: var(--tap); height: var(--tap); }
}""",
        """@media (pointer: coarse) {
	.cm-icon-btn--bare { width: 32px; height: 32px; }
}""",
        "not sized to the tap floor on a coarse pointer",
        None,
    ),
    (
        "bare-icon-btn-loses-height-only",
        """@media (pointer: coarse) {
	.cm-icon-btn--bare { width: var(--tap); height: var(--tap); }
}""",
        """@media (pointer: coarse) {
	.cm-icon-btn--bare { width: var(--tap); height: 32px; }
}""",
        "not height",
        None,
    ),
    (
        "bare-icon-btn-moves-to-base-class",
        """@media (pointer: coarse) {
	.cm-icon-btn--bare { width: var(--tap); height: var(--tap); }
}""",
        """@media (pointer: coarse) {
	.cm-icon-btn { width: var(--tap); height: var(--tap); }
}""",
        "not sized to the tap floor on a coarse pointer",
        None,
    ),
    (
        "code-invalid-loses-ink",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: var(--ink);\n\tbox-shadow: inset 0 -2px 0 var(--ink);\n}",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: var(--ink-dim);\n\tbox-shadow: inset 0 -2px 0 var(--ink);\n}",
        "does not mark with ink",
        None,
    ),
    (
        "code-invalid-loses-underline",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: var(--ink);\n\tbox-shadow: inset 0 -2px 0 var(--ink);\n}",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: var(--ink);\n\tbox-shadow: none;\n}",
        "no underline mark",
        None,
    ),
    (
        "code-invalid-grows-a-hue",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: var(--ink);\n\tbox-shadow: inset 0 -2px 0 var(--ink);\n}",
        ".cm-code[aria-invalid='true'] {\n\tborder-color: #f00;\n\tbox-shadow: inset 0 -2px 0 var(--ink);\n}",
        "literal colour, not a palette token",
        None,
    ),
]

# The specificity mutants live in a sibling file because their selectors
# contain doubled classes and quoting them inline was itself a syntax
# error. They are appended here so ONE run proves the whole rule.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location(
    'mfr', str(Path(__file__).parent / 'mutate-field-reserve.py'))
_mfr = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mfr)
MUTANTS.extend(_mfr.MUTANTS)


def restore():
    for f, b in BAKS.items():
        shutil.copy2(b, SRC / f)


def main():
    for f in FILES:
        if not (SRC / f).exists():
            sys.exit(f + " is missing; refusing to run")
        shutil.copy2(SRC / f, BAKS[f])
    original = {f: (SRC / f).read_bytes() for f in FILES}

    # Non-empty baseline or abort - an empty run would report "survived"
    # for every mutant and that is indistinguishable from a broken suite.
    base = subprocess.run(
        ["node", "tests/run.mjs"], cwd="/root/projects/oem-ui",
        capture_output=True, text=True,
    )
    if base.returncode != 0:
        sys.exit("baseline is RED; aborting\n" + base.stdout[-800:])
    print("baseline green:", base.stdout.strip().splitlines()[-1])
    if base.stdout.count("  ok  ") < 100:
        sys.exit("baseline suspiciously short; aborting")

    killed, survived, aborted = 0, [], []
    try:
        for label, anchor, repl, claim, _scope in MUTANTS:
            restore()
            # The anchor decides which file is being mutated - a blind
            # write to components.css would report ANCHOR-MISSING for every
            # base.css mutant and quietly prove nothing.
            target = next((f for f in FILES if anchor in (SRC / f).read_text()), None)
            if target is None:
                counts = {f: (SRC / f).read_text().count(anchor) for f in FILES}
                aborted.append((label, f"anchor not unique: {counts}"))
                print(f"ABORT  {label}: anchor matched {counts}")
                continue
            path = SRC / target
            src = path.read_text()
            assert src.count(anchor) == 1, (label, target, src.count(anchor))
            path.write_text(src.replace(anchor, repl))
            run = subprocess.run(
                ["node", "tests/run.mjs"], cwd="/root/projects/oem-ui",
                capture_output=True, text=True,
            )
            out = run.stdout + run.stderr
            if claim in out:
                killed += 1
                print(f"  KILL {label:42} on: {claim[:44]}")
            elif run.returncode == 0:
                survived.append((label, claim))
                print(f"SURVIVE {label:42} claim: {claim[:44]}")
            else:
                # failed, but not on this mutant's own claim: a build
                # error must never be counted as a kill
                aborted.append((label, "failed on a different error"))
                print(f"ABORT  {label:42} failed on something else")
    finally:
        restore()
        for f in FILES:
            if (SRC / f).read_bytes() != original[f]:
                sys.exit("RESTORE FAILED on " + f
                         + " - the working tree is not the original")
        print("restore verified byte-exact on %d files" % len(FILES))

    print(f"\n{killed} killed, {len(survived)} survived, {len(aborted)} aborted "
          f"of {len(MUTANTS)}")
    for l, c in survived:
        print("SURVIVED:", l, "->", c)
    for l, why in aborted:
        print("ABORTED:", l, "->", why)
    return 1 if (survived or aborted) else 0


if __name__ == "__main__":
    sys.exit(main())