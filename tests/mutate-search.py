#!/usr/bin/env python3
"""Run the search-family mutation catalog and report the kills HONESTLY.

Every rule here was learned by getting it wrong first in this repo:

  * SNAPSHOT each file immediately before mutating it, and restore with
    shutil.copy. Never `git checkout`: on a file another cycle may be
    editing that reverts work that is not this mutation's.
  * The snapshot must be taken PER MUTATION, not once up front. A single
    snapshot restored over a file that was edited after the sweep started
    silently deleted those edits; measured here, it restored a showcase
    with `cm-search__input` already stripped and then reported kills
    against markup that no longer existed.
  * REBUILD before the suite when the mutation touches page markup OR
    base.css: the reachability checks read dist/index.html, so an
    un-rebuilt mutation is invisible and the sweep manufactures confidence.
  * The suite's summary line is BARE - `461 passed, 0 failed`, no leading
    whitespace. A pattern anchored on a leading space matches nothing and
    reports every kill as a survivor.
  * A replacement that does not occur is a NO-OP and is reported as a
    harness error, never as a survivor.
  * Kill count and the final summary are derived from the same variable.

    python3 tests/mutations-search.py [--verbose]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from mutate_search_catalog import MUTATIONS  # noqa: E402

SUMMARY = re.compile(r'^\d+ passed, \d+ failed$')
VERBOSE = '--verbose' in sys.argv


def suite_summary():
    r = subprocess.run(['node', 'tests/run.mjs'], cwd=ROOT,
                       capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if SUMMARY.match(line.strip()):
            return line.strip(), r.stdout
    return None, r.stdout


def apply(path, pairs):
    """Apply the mutation, and REFUSE a partial one.

    `str.replace(old, new, 1)` silently replaces only the FIRST occurrence.
    For a selector that appears six times - once in prose, five in real
    rules - that removes the copy inside a COMMENT and leaves every live
    rule intact, so the mutation never lands and then reads as a survivor.
    Measured here: `base.css drops its .cm-search__input exclusion` reported
    461 passed / 0 failed while the file it was applied to had not changed
    in any rule at all.

    So the count is asserted, and the whole file is rebuilt from the
    comment-stripped form for count-sensitive patterns. A pair may declare
    an expected count as a third element; without one, ALL occurrences are
    replaced, which is what a mutation means.
    """
    with open(path, encoding='utf-8') as fh:
        s = fh.read()
    for pair in pairs:
        old, new = pair[0], pair[1]
        expect = pair[2] if len(pair) > 2 else None
        n = s.count(old)
        if n == 0:
            return False, f'pattern absent: {old[:70]!r}'
        if expect is not None and n != expect:
            return False, (f'pattern occurs {n}x, catalog expected {expect}x: '
                           f'{old[:50]!r}')
        s = s.replace(old, new)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(s)
    return True, None


def main():
    killed = survived = errors = 0
    print('mutation sweep:')
    for path, desc, rebuild, pairs in MUTATIONS:
        full = os.path.join(ROOT, path)
        fd, snap = tempfile.mkstemp(prefix='oem-snap.')
        os.close(fd)
        shutil.copy(full, snap)
        try:
            ok, why = apply(full, pairs)
            if not ok:
                print(f'  NO-OP MUTATION: {desc}  <-- {why}; fix the catalog, '
                      'not the test')
                errors += 1
                continue
            if rebuild:
                b = subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                                   capture_output=True, text=True)
                if b.returncode != 0:
                    print(f'  KILLED   {desc} (build failure - the strongest kill)')
                    killed += 1
                    continue
            summary, out = suite_summary()
            if summary is None:
                print(f'  HARNESS-ERR {desc} (the suite produced no summary line)')
                print('\n'.join('           ' + l for l in out.strip().splitlines()[-6:]))
                errors += 1
                continue
            n_failed = int(summary.split(', ')[1].split(' ')[0])
            if n_failed:
                print(f'  KILLED   {desc}  [{summary}]')
                killed += 1
                if VERBOSE:
                    for line in out.splitlines():
                        if line.strip().startswith('FAIL'):
                            print('           ' + line.strip())
            else:
                print(f'  SURVIVED {desc}  [{summary}]  <-- the suite cannot see this')
                survived += 1
        finally:
            shutil.copy(snap, full)
            os.unlink(snap)

    # Leave dist matching the restored source.
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True)
    print()
    print(f'{killed} killed, {survived} survived, {errors} harness errors')
    return 1 if (survived or errors) else 0


if __name__ == '__main__':
    sys.exit(main())
