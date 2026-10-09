#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 19: data table depth.

Byte-exact patterns, pre-checked with --scan, a build in every window
(the harness drives the page, so dist must match the source under test),
restore verified, rebuild at the end. A crash, timeout or missing FAIL
line is a kill - never a survival: only rc == 0 survives.

The headline pattern is the one this batch actually got wrong: the
refresh writes the page INDEX back as data-cm-page on the TABLE, so a
bare closest('[data-cm-page]') matched the table from every click
inside it and a stray refresh un-checked select-all between its native
toggle and its change event. Every other control kept working.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-data-table.py']

JS = 'src/js/cli-mono.js'
CSS = 'src/styles/components.css'
ASTRO = 'src/pages/index.astro'

PATTERNS = [
    # ---- the actual bug: selectors that must not match the table ----
    ('page clicks match the table itself again (the select-all killer)',
     JS, "t.closest('button[data-cm-page]')",
     "t.closest('[data-cm-page]')", 'suite+harness'),

    ('the disabled-state loop writes .disabled onto the table again',
     JS, "querySelectorAll('button[data-cm-page]')",
     "querySelectorAll('[data-cm-page]')", 'suite'),

    # ---- delegation: listeners on document ----
    ('the filter listens on change, so keystrokes never filter',
     JS, "document.addEventListener('input', onTableFilter);",
     "document.addEventListener('change', onTableFilter);", 'suite+harness'),

    ('the selection handler listens on pointerdown, so boxes never move state',
     JS, "document.addEventListener('change', onTableSelectChange);",
     "document.addEventListener('pointerdown', onTableSelectChange);",
     'suite+harness'),

    ('the page handler is defined but never bound',
     JS, "document.addEventListener('click', onTablePageClick);",
     "void onTablePageClick;", 'suite+harness'),

    ('the column-visibility handler is never bound',
     JS, "document.addEventListener('click', onColvisClick);",
     "void onColvisClick;", 'suite+harness'),

    ('the page-size handler is never bound',
     JS, "document.addEventListener('change', onTableSizeChange);",
     "void onTableSizeChange;", 'suite+harness'),

    ('the sort handler is never bound',
     JS, "document.addEventListener('click', onTableSort);",
     "void onTableSort;", 'suite+harness'),

    # ---- one refresh: rows, page slice, footer ----
    ('rows stop being hidden by the shared pass (all rows show)',
     JS, "row.style.display = inPage.indexOf(row) >= 0 ? '' : 'none';",
     "row.style.display = '';", 'suite+harness'),

    ('a shrinking filter can land on an empty tail again',
     JS, 'if (page > pages - 1) page = pages - 1;',
     'if (false) page = pages - 1;', 'suite+harness'),

    ('page ends stop disabling',
     JS, "btn.disabled = kind === 'first' || kind === 'prev'",
     "btn.disabled = kind === 'never' || kind === 'never'", 'suite+harness'),

    ('the page line stops reading page N of M',
     JS, "info.textContent = 'page ' + (page + 1) + ' of ' + pages;",
     "info.textContent = 'page ' + (page + 1) + '/' + pages;", 'harness'),

    ('the no-results row never shows',
     JS, "empty.style.display = matched.length ? 'none' : '';",
     "empty.style.display = 'none';", 'suite+harness'),

    # ---- selection: page model + intersected count ----
    ('select-all covers every row instead of the page',
     JS, 'var all = inPage.length > 0 && onPageSelected.length === inPage.length;',
     'var all = onPageSelected.length > 0;', 'suite+harness'),

    ('a partial page stops reading indeterminate',
     JS, 'allBox.indeterminate = onPageSelected.length > 0 && !all;',
     'allBox.indeterminate = false;', 'suite+harness'),

    ('the count line stops being selected-among-filtered',
     JS, "selFiltered + ' of ' + matched.length",
     "selected.length + ' of ' + rows.length", 'suite+harness'),

    ('select-all stops writing selection onto rows',
     JS, "\t\t\t\trow.setAttribute('aria-selected', t.checked ? 'true' : 'false');",
     "\t\t\t\tvoid row;", 'suite+harness'),

    ('a row checkbox stops writing its own state',
     JS, "\t\t\tif (row) row.setAttribute('aria-selected', t.checked ? 'true' : 'false');",
     "\t\t\tif (false) row.setAttribute('aria-selected', t.checked ? 'true' : 'false');",
     'harness'),

    # ---- filter semantics ----
    ('the global filter stops matching cell text',
     JS, 'if (text.indexOf(q) >= 0) return true;',
     'if (false) return true;', 'suite+harness'),

    ('a column-scoped filter stops matching its column',
     JS, 'return text.indexOf(q) >= 0;',
     'return false;', 'harness'),

    ('every filter degrades to global (scoping lost)',
     JS, "col: input.getAttribute('data-cm-filter') || ''",
     "col: ''", 'harness'),

    # ---- sort ----
    ('numeric cells fall back to lexical order (1180 before 120)',
     JS, r'if (!/^[+-]?[\d\u00a0,\s]+%?$/.test(v)) return null;',
     'if (true) return null;', 'suite+harness'),

    ('the sort direction sign is dropped (descending never happens)',
     JS, 'return sign * cmSortCompare(x.key, y.key);',
     'return cmSortCompare(x.key, y.key);', 'suite+harness'),

    ('no header announces sort direction',
     JS, "other.setAttribute('aria-sort', other === th ? dir : 'none');",
     "other.setAttribute('aria-sort', 'none');", 'suite+harness'),

    # ---- column visibility ----
    ('colvis skips every cell (guard never matches)',
     JS, "if (cell.getAttribute('data-col') !== col) return;",
     'if (true) return;', 'suite+harness'),

    ('colvis always hides, so restoring a column is impossible',
     JS, "var show = item.getAttribute('aria-checked') === 'true';",
     'var show = false;', 'suite+harness'),

    ('colvis stops hiding anything',
     JS, "cell.style.display = show ? '' : 'none';",
     "cell.style.display = '';", 'suite+harness'),

    # ---- css ----
    ('first/last buttons show at phone width again',
     CSS, '.cm-table__far { display: none; }',
     '.cm-table__far { display: inline; }', 'suite+harness'),

    ('the rows-per-page label loses its rule (rendered, unstyled)',
     CSS, """.cm-table__label {
	display: inline-flex;
	align-items: center;
	gap: var(--space-2);
	white-space: nowrap;
}""", '', 'suite'),

    # ---- specimen opt-ins ----
    ('the section stops opting in',
     ASTRO, 'data-cm-datatable', 'data-cm-nope', 'suite+harness'),

    ('the header checkbox stops being a known control',
     ASTRO, 'data-cm-selectall', 'data-cm-nope', 'suite+harness'),

    ('the rows-per-page select stops being a known control',
     ASTRO, 'data-cm-pagesize', 'data-cm-nope', 'suite+harness'),

    ('the table stops opting into sorting',
     ASTRO, '<table class="cm-table" data-cm-sort data-cm-size="10">',
     '<table class="cm-table" data-cm-nope data-cm-size="10">', 'suite+harness'),

    ('the no-results row stops being recognizable',
     ASTRO, 'data-cm-empty', 'data-cm-nope', 'suite+harness'),
]


def run(cmd, timeout=600, capture=False):
    """A build must NOT be captured (house rule: a captured build inside
    a mutator stalls and its 50KB buffer is not worth reading) - so its
    output goes to the terminal and p.stdout is None. The suite and
    harness ARE captured: their verdict is what a kill is decided on."""
    p = subprocess.run(cmd, cwd=ROOT, timeout=timeout, capture_output=capture)
    out = p.stdout.decode('utf8', 'replace') if capture else ''
    return p.returncode, out


def main():
    if '--scan' in sys.argv:
        bad = 0
        for name, rel, pat, _mut, _who in PATTERNS:
            n = (ROOT / rel).read_text().count(pat)
            if n != 1:
                print(f'PATTERN AMBIGUOUS/ABSENT ({n}) - {name}')
                bad += 1
        print(f'{len(PATTERNS) - bad}/{len(PATTERNS)} patterns present')
        return 1 if bad else 0

    rc, _ = run(BUILD)
    assert rc == 0, 'baseline build failed'
    rc, out = run(SUITE, capture=True)
    assert rc == 0 and ' 0 failed' in out, f'baseline suite not green:\n{out[-2000:]}'
    rc, out = run(HARNESS, capture=True)
    assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
    print('baseline suite green | baseline harness green', flush=True)

    killed = survived = 0
    for name, rel, pat, mut, who in PATTERNS:
        target = ROOT / rel
        original = target.read_text()
        assert original.count(pat) == 1, f'PATTERN ABSENT for {name}'
        target.write_text(original.replace(pat, mut, 1))
        try:
            rc_build, _ = run(BUILD)
            assert rc_build == 0, 'mutant build broke'
            verdicts = []
            if 'suite' in who:
                rc_s, out_s = run(SUITE, capture=True)
                verdicts.append(rc_s)
            if 'harness' in who:
                rc_h, out_h = run(HARNESS, capture=True)
                verdicts.append(rc_h)
            # rc != 0 is a kill WHETHER the output has a FAIL line or the
            # run crashed midway - a crash/timeout is a kill, never a
            # survival. Only rc == 0 survives.
            if all(rc == 0 for rc in verdicts):
                print(f'  SURVIVED - {name}', flush=True)
                survived += 1
            else:
                print(f'  killed - {name}', flush=True)
                killed += 1
        except subprocess.TimeoutExpired:
            print(f'  killed (timeout) - {name}', flush=True)
            killed += 1
        except Exception as e:  # build broke or an assert tripped
            print(f'  killed (BUILD/ASSERT) - {name}: {e}', flush=True)
            killed += 1
        target.write_text(original)
        assert target.read_text() == original, f'RESTORE FAILED for {name}'

    print(f'killed={killed} survived={survived} of {len(PATTERNS)}', flush=True)
    run(BUILD)
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
