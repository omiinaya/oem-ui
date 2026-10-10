#!/usr/bin/env python3
"""Diff two geometry JSONs from tests/measure-logical-geometry.py.

Prints every delta above a threshold. Zero output (plus the summary line)
is the only acceptable result for the logical-properties conversion:
logical and physical resolve to the same physical property in an LTR
document, so the rendered geometry must be byte-identical.
"""
import json
import sys
from pathlib import Path

TOL = float(sys.argv[3]) if len(sys.argv) > 3 else 0.51

# `text-align: start` and `text-align: left` are the same alignment in an
# LTR document but compute to DIFFERENT keywords, so a computed-value
# diff would report the spelling as a delta. Canonicalise the keyword on
# both sides; the physical alignment itself is still compared exactly.
KEYWORDS = {'textAlign': {'start': 'left', 'end': 'right'}}


def canon(prop, val):
    return KEYWORDS.get(prop, {}).get(val, val)


def load(p):
    return json.loads(Path(p).read_text())


def main():
    a, b = load(sys.argv[1]), load(sys.argv[2])
    deltas = []
    for w in sorted(a, key=int):
        A, B = a[w], b[w]
        if set(A) != set(B):
            deltas.append(f'{w}: top-level keys differ')
            continue
        for k in ('doc', 'pageErrors'):
            if A[k] != B[k]:
                deltas.append(f'{w}: {k}: {A[k]} -> {B[k]}')
        for sect, name in (('els', 'element'), ('pseudo', 'pseudo')):
            ka, kb = set(A[sect]), set(B[sect])
            for miss in sorted(ka ^ kb):
                deltas.append(f'{w}: {name} {miss}: present in only one build')
            for key in sorted(ka & kb):
                ra, rb = A[sect][key], B[sect][key]
                if name == 'element':
                    for i, ax in enumerate(ra['r']):
                        if abs(ax - rb['r'][i]) > TOL:
                            deltas.append(
                                f'{w}: {name} {key} rect[{i}]: {ra["r"]} -> {rb["r"]}')
                    fields = ra['d']
                else:
                    fields = ra
                for p in fields:
                    va, vb = canon(p, fields[p]), canon(p, rb.get(p, fields[p]))
                    if va != vb:
                        deltas.append(
                            f'{w}: {name} {key} {p}: {fields[p]!r} -> {rb.get(p)!r}')
    print(f'{len(deltas)} deltas above {TOL}px / exact-computed-value')
    for d in deltas[:200]:
        print('  ' + d)
    if len(deltas) > 200:
        print(f'  ... {len(deltas) - 200} more')
    return 1 if deltas else 0


if __name__ == '__main__':
    sys.exit(main())
