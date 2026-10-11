#!/root/.venvs/mau/bin/python
"""Diff two measure-logical-geometry.py dumps. Any delta above float slop is
a real cascade change on the FULL install - the conversion's own noise floor
recorded in that script's header is ZERO deltas between two runs of one build."""
import json, sys, collections

a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
NORM = {  # computed-keyword pairs that are the same LTR alignment
    ("textAlign", "start"): "left", ("textAlign", "left"): "left",
    ("textAlign", "end"): "right", ("textAlign", "right"): "right",
}
def norm(p, v):
    return NORM.get((p, v), v)

deltas = collections.defaultdict(list)
for w in sorted(set(a) | set(b)):
    for bucket in ("els", "pseudo", "doc"):
        if not isinstance(a.get(w, {}).get(bucket), type(b.get(w, {}).get(bucket))):
            continue
        ra, rb = a.get(w, {}).get(bucket), b.get(w, {}).get(bucket)
        if ra is None or rb is None:
            deltas[w].append((bucket, "<missing>", ra is None, rb is None))
            continue
        if bucket == "doc":
            for k in set(ra) | set(rb):
                if ra.get(k) != rb.get(k):
                    deltas[w].append((bucket, k, ra.get(k), rb.get(k)))
            continue
        for key in set(ra) | set(rb):
            if key not in ra or key not in rb:
                deltas[w].append((bucket, key, "<absent>" if key not in ra else "present",
                                  "<absent>" if key not in rb else "present"))
                continue
            if bucket == "els":
                if ra[key].get("r") != rb[key].get("r"):
                    deltas[w].append((bucket, key + " __rect", ra[key].get("r"), rb[key].get("r")))
                da, db = ra[key].get("d", {}), rb[key].get("d", {})
            else:
                da, db = ra[key], rb[key]
            for p in set(da) | set(db):
                x, y = norm(p, da.get(p)), norm(p, db.get(p))
                if x != y:
                    deltas[w].append((bucket, f"{key} .{p}", x, y))

total = sum(len(v) for v in deltas.values())
if not total:
    print("NO-OP CONFIRMED - zero deltas across", sorted(a), "at every viewport")
    sys.exit(0)
print(f"{total} DELTA(S) - the full install CHANGED:")
for w in sorted(deltas):
    print(f"  @{w}: {len(deltas[w])}")
    seen = collections.Counter(d[1].split(' .')[0] for d in deltas[w])
    for k, n in seen.most_common(6):
        print(f"      {k}: {n}")
    for d in deltas[w][:4]:
        print(f"      e.g. {d[1]}: {d[2]!r} -> {d[3]!r}")
sys.exit(1)
