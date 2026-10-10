#!/root/.venvs/mau/bin/python
"""Mutation proof for the calendar's multiple mode.

Every mutant reverts ONE thing the multiple contract claims, and the suite
must go red for each. The kill criterion is `node tests/run.mjs` because that
is where the contract lives - tests/verify-calendar.py predates multiple mode
and would be a weaker oracle with an empty mutant list.

Two of these mutants are the ORIGINAL defect re-introduced verbatim (the
range test asked as "not single", and `sel` left holding the whole set), so
a clean run says the new checks really do see the bug they were written for.

A survivor means the suite would pass on broken code. Patterns are asserted
to occur exactly once before the mutation is applied: a drifted pattern is a
loud SKIP, never a phantom survivor.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path('/root/projects/oem-ui')
VENV = '/root/.venvs/mau/bin/python'
JS = 'src/js/cli-mono.js'
PAGE = 'src/pages/index.astro'
FILES = [JS, PAGE]

MUTANTS = [
    # --- the mode is not dispatched at all -----------------------------
    ('multiple falls through to range',
     JS,
     "} else if (calMode(cal) === 'multiple') {",
     "} else if (false) {"),
    # --- a pick grows the set and can never shrink it -------------------
    ('a pick cannot un-pick',
     JS,
     "\t\t\tif (at === -1) set.push(iso);\n\t\t\telse set.splice(at, 1);",
     "\t\t\tif (at === -1) set.push(iso);"),
    # --- the set is never written back, so it dies at the next render ---
    ('the set is not written back',
     JS,
     "\t\t\tcalSet(cal, set.sort());",
     "\t\t\tvoid set;"),
    # --- the ORIGINAL defect: range asked as "not single" ---------------
    ('range is asked as not-single again',
     JS,
     "\t\t\tvar isSel = mode === 'range'\n"
     "\t\t\t\t? (day === start || day === end)\n"
     "\t\t\t\t: (mode === 'multiple' ? picked.indexOf(day) !== -1 : day === sel);",
     "\t\t\tvar isSel = mode === 'single' ? day === sel : (day === start || day === end);"),
    # --- the ORIGINAL defect: sel holds the whole set ------------------
    ('sel is not nulled in multiple mode',
     JS,
     "\t\tvar sel = mode === 'multiple' ? null : cal.getAttribute('data-cm-cal-selected');",
     "\t\tvar sel = cal.getAttribute('data-cm-cal-selected');"),
    # --- the renderer stops reading the set -----------------------------
    ('the cell builder ignores the set',
     JS,
     "\t\tvar picked = mode === 'multiple' ? calList(cal) : [];",
     "\t\tvar picked = [];"),
    # --- Escape no longer clears it -------------------------------------
    ('Escape leaves the set behind',
     JS,
     "\t\t\telse if (calMode(cal) === 'multiple') calSet(cal, []);",
     "\t\t\telse if (false) calSet(cal, []);"),
    # --- the datepicker glue treats multiple as single ------------------
    ('a multiple pick closes a datepicker',
     JS,
     "\t\tif (dp && calMode(cal) === 'single') {",
     "\t\tif (dp && calMode(cal) !== 'range') {"),
    # --- the hover preview runs in multiple mode ------------------------
    ('the range preview runs in multiple mode',
     JS,
     "\t\tif (!day || calMode(cal) !== 'range') return;",
     "\t\tif (!day || calMode(cal) === 'single') return;"),
    # --- the showcase stops demonstrating it ----------------------------
    ('the multiple specimen is not the mode it claims',
     PAGE,
     'id="cal-multiple" data-cm-cal data-cm-cal-mode="multiple"',
     'id="cal-multiple" data-cm-cal data-cm-cal-mode="single"'),
]

def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, **kw)

snapshots = {f: (ROOT / f).read_bytes() for f in FILES}
survivors = []
try:
    for name, rel, old, new in MUTANTS:
        p = ROOT / rel
        src = p.read_bytes().decode()
        n = src.count(old)
        if n != 1:
            print('SKIP        %-42s pattern occurs %d times' % (name, n))
            survivors.append(name)
            continue
        mutated = src.replace(old, new, 1)
        assert mutated != src, 'mutant %s did not change the file' % name
        p.write_bytes(mutated.encode())
        # TWO oracles, and a kill is a kill from either. The suite reads
        # the source shape; the WebKit harness measures the BEHAVIOUR -
        # 'the grid still reads as selected after a month step away and
        # back' is a claim no text assertion can make, and the two
        # survivors of the first run were both of exactly that shape.
        r = run(['node', 'tests/run.mjs'])
        out = (r.stdout or '') + (r.stderr or '')
        # ANSI is emitted even when piped; strip before reading the summary.
        out = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', out)
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL')]
        m = re.search(r'(\d+) passed, (\d+) failed', out)
        killed_by = None
        if m is None:
            killed_by = 'suite summary unreadable'
        elif r.returncode != 0 or m.group(2) != '0':
            killed_by = 'suite'
        else:
            # `npm run build` ran above, and http.server re-opens files per
            # request, so the harness reads THIS mutant's dist.
            h = run([VENV, 'tests/verify-calendar-multiple.py'])
            hout = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', (h.stdout or '') + (h.stderr or ''))
            hfails = [l.strip() for l in hout.splitlines() if l.strip().startswith('FAIL')]
            if h.returncode != 0 or hfails:
                killed_by = 'webkit harness'
                fails = hfails or fails
            elif 'ERROR: server down' in hout:
                killed_by = 'HARNESS ERROR (server down)'
        if killed_by in (None, 'HARNESS ERROR (server down)', 'suite summary unreadable'):
            print('SURVIVOR    %-42s %s' % (name, '(%s)' % killed_by if killed_by
                                            else '(both oracles stayed green)'))
            survivors.append(name)
        else:
            print('killed by %-10s %-34s %s' % (killed_by + ',', name,
                                                fails[0] if fails else ''))
        p.write_bytes(snapshots[rel])
finally:
    for f, data in snapshots.items():
        (ROOT / f).write_bytes(data)
    # Restore must be BYTE-exact: assert it rather than trusting the write.
    for f, data in snapshots.items():
        assert (ROOT / f).read_bytes() == data, 'restore of %s is not byte-exact' % f

print('\n%d/%d mutants killed' % (len(MUTANTS) - len(survivors), len(MUTANTS)))
sys.exit(1 if survivors else 0)
