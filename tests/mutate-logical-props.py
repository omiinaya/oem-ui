#!/root/.venvs/mau/bin/python
"""Mutation proof for the Direction baseline (logical properties).

The claim under test: the guard appended to tests/run.mjs catches ANY
reversion of a logical-property conversion. The conversion is a no-op
in LTR, so the geometry can never catch a reversion - only the source
and built-CSS scans can, which is exactly why they exist.

Runner rules (same shape as mutate-navmenu-sub.py, which is the most
recent correct runner in this repo):
  - pre-flight EVERY mutation against the real source; if a pattern is
    absent the runner aborts rather than silently skipping
  - a crashed or timed-out harness is a KILL, never a pass
  - the kill tally and the summary come from the same variable
  - a non-zero build exit is a KILL, not a no-op
  - dist is rebuilt in EVERY mutant window (the guard reads the built
    CSS, so a stale dist would make every mutant a lie)
  - the file is snapshotted BEFORE the first mutation and restored with
    a real copy - `git checkout --` is never used on a shared file

Run: /root/.venvs/mau/bin/python tests/mutate-logical-props.py
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['src/styles/tokens.css', 'src/styles/base.css', 'src/styles/components.css']

# logical property -> the physical twin this branch converted it FROM
TWIN = {
    'margin-inline-start': 'margin-left',
    'margin-inline-end': 'margin-right',
    'padding-inline-start': 'padding-left',
    'padding-inline-end': 'padding-right',
    'border-inline-start': 'border-left',
    'border-inline-end': 'border-right',
    'border-inline-start-width': 'border-left-width',
    'border-inline-start-style': 'border-left-style',
    'border-inline-start-color': 'border-left-color',
    'border-inline-end-width': 'border-right-width',
    'border-inline-end-style': 'border-right-style',
    'border-inline-end-color': 'border-right-color',
    'inset-inline-start': 'left',
    'inset-inline-end': 'right',
}

BUILD_TIMEOUT = 180
SUITE_TIMEOUT = 300


def strip_comments(text):
    return re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)),
                  text, flags=re.S)


def decls_of(text):
    """Yield (selector, prop, value, start, end) for every declaration."""
    masked = strip_comments(text)
    stack = []
    pos = 0
    i, n = 0, len(text)
    while i < n:
        c = masked[i]
        if c == '{':
            stack.append(masked[pos:i].split('}')[-1].strip())
            i += 1
            pos = i
        elif c == '}':
            if stack:
                stack.pop()
            i += 1
            pos = i
        elif c == ';':
            m = re.match(r'\s*([a-zA-Z-]+)\s*:(.*)$', text[pos:i], re.S)
            if m:
                yield (stack[-1] if stack else '', m.group(1).strip(),
                       m.group(2), pos, i)
            i += 1
            pos = i
        elif text[i:i + 2] == '/*':
            j = text.index('*/', i) + 2
            if not text[pos:i].strip():
                pos = j
            i = j
        else:
            i += 1


def physical_revert(prop, value):
    """Return (prop, value) spelled physically, or None if not convertible."""
    if prop in TWIN:
        return TWIN[prop], value
    if prop == 'text-align':
        v = value.strip()
        if v == 'start':
            return 'text-align', re.match(r'\s*', value).group(0) + 'left'
        if v == 'end':
            return 'text-align', re.match(r'\s*', value).group(0) + 'right'
    return None


def plan_mutations():
    out = []
    for rel in FILES:
        path = ROOT / rel
        text = path.read_text()
        for sel, prop, value, start, end in decls_of(text):
            rev = physical_revert(prop, value)
            if not rev:
                continue
            new_prop, new_value = rev
            lead = re.match(r'\s*', text[start:end]).group(0)
            old_decl = f'{lead}{prop}:{value}'
            new_decl = f'{lead}{new_prop}:{new_value}'
            line = text.count('\n', 0, start) + 1
            out.append({
                'rel': rel,
                'line': line,
                'sel': sel,
                'logical': f'{prop}: {value.strip()}',
                'physical': f'{new_prop}: {new_value.strip()}',
                'start': start,
                'end': end,
                'old': text[start:end],
                'new': new_decl,
            })
    return out


def run(cmd, timeout):
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                           timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'')
        if isinstance(out, bytes):
            out = out.decode('utf-8', 'replace')
        return None, out + '\n[TIMEOUT]'


def main():
    plan = plan_mutations()
    args = sys.argv[1:]
    if '--only' in args:
        needle = args[args.index('--only') + 1]
        plan = [m for m in plan if needle in f"{m['rel']}:{m['line']}"]
    if '--limit' in args:
        plan = plan[:int(args[args.index('--limit') + 1])]
    if '--skip' in args:
        plan = plan[int(args[args.index('--skip') + 1]):]
    print(f'planned mutations: {len(plan)}')
    # pre-flight: every mutation must still be present in the real source
    for m in plan:
        text = (ROOT / m['rel']).read_text()
        window = text[m['start']:m['end']]
        assert window == m['old'], (
            f"PRE-FLIGHT FAILED: {m['rel']}:{m['line']} "
            f"`{m['sel']}` expected {m['old']!r} found {window!r}")
    print(f'pre-flight: all {len(plan)} patterns present in the source')

    # The snapshot is HELD IN MEMORY and is the authority. A first run of
    # this runner kept its only copy in a scratch tempdir, and the scratch
    # pruner deleted it mid-sweep: the restore in `finally` then raised
    # FileNotFoundError with mutant 138 still applied to the working tree.
    # The cp snapshot below survives as a fallback artifact, but nothing
    # depends on it anymore, and every restore is byte-verified.
    originals = {rel: (ROOT / rel).read_text() for rel in FILES}

    snapshot_dir = Path(tempfile.mkdtemp(prefix='logical-mutate-'))
    snapshots = {}
    for rel in FILES:
        snap = snapshot_dir / Path(rel).name
        try:
            shutil.copy(ROOT / rel, snap)
            snapshots[rel] = snap
        except OSError as e:  # advisory only
            print(f'note: could not write the cp snapshot for {rel}: {e}')
    print(f'snapshots: memory + {snapshot_dir}')

    def restore(rel):
        (ROOT / rel).write_text(originals[rel])

    killed = 0
    survived = []
    try:
        for idx, m in enumerate(plan, 1):
            target = ROOT / m['rel']
            # the tree must be exactly the pre-mutant content before each
            # window: a failed restore would otherwise chain silently
            assert target.read_text() == originals[m['rel']], (
                f'the tree is not pristine before mutant {idx}: {m["rel"]}')
            text = target.read_text()
            assert text[m['start']:m['end']] == m['old'], (
                f'window drifted before mutant {idx}: {m["rel"]}:{m["line"]}')
            target.write_text(text[:m['start']] + m['new'] + text[m['end']:])

            # a mutant without a build would test the PREVIOUS dist
            build_rc, build_out = run(['npm', 'run', 'build'], BUILD_TIMEOUT)
            if build_rc != 0:
                verdict = 'KILL (build)'
                killed += 1
            else:
                suite_rc, suite_out = run(['node', 'tests/run.mjs'], SUITE_TIMEOUT)
                if suite_rc is None:
                    verdict = 'KILL (timeout)'
                    killed += 1
                elif suite_rc == 0:
                    verdict = 'SURVIVED'
                    survived.append(m)
                else:
                    killed += 1
                    fail = next((l.strip() for l in suite_out.splitlines()
                                 if 'FAIL' in l), 'suite failed')
                    verdict = 'KILL - ' + fail[:110]
            print(f'[{idx}/{len(plan)}] {m["rel"]}:{m["line"]} '
                  f'`{m["sel"][:40]}` {m["logical"]} -> {m["physical"]}: {verdict}',
                  flush=True)
            # restore from the in-memory original, never `git checkout --`,
            # and verify the restore immediately - a silent failed restore
            # would poison every later window in the sweep
            restore(m['rel'])
            assert target.read_text() == originals[m['rel']], (
                f'restore did not take after mutant {idx}: {m["rel"]}')
    finally:
        for rel in FILES:
            restore(rel)
        rc, _ = run(['npm', 'run', 'build'], BUILD_TIMEOUT)
        print(f'restored; final rebuild rc={rc}')

    # the tree must be exactly as the plan found it
    for rel in FILES:
        assert (ROOT / rel).read_text() == originals[rel], (
            f'{rel} did not restore byte-for-byte')

    total = killed + len(survived)
    print(f'killed={killed} survived={len(survived)} of {total}')
    for m in survived:
        print(f'  SURVIVED {m["rel"]}:{m["line"]} `{m["sel"]}` {m["logical"]}')
    shutil.rmtree(snapshot_dir, ignore_errors=True)
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
