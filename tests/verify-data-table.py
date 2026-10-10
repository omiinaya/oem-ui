#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 19: data table depth.

Filtering, pagination, column visibility and row selection - the four
things that make a grid a tool. The control that broke first here was
"select all": the refresh writes the page INDEX back as data-cm-page on
the TABLE, so a bare closest('[data-cm-page]') matched the table from
every click inside it and a stray refresh un-checked the box between
its native toggle and its change event. So the selection phase drives
REAL clicks and asserts the checked state HOLDS.

Every count below is derived from the specimen's own 23 rows, so a
mutant that changes page math, filter semantics, sort comparators or
the selection model has a number to disagree with.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
SC = '#data-table'
TBL = SC + ' table'

passed = 0
failed = []


def check(name, ok, detail=None):
    global passed
    if ok:
        passed += 1
        print(f'ok   {name} :: {detail}')
    else:
        failed.append(name)
        print(f'FAIL {name} :: {detail}')


def vis(page):
    """Rows on screen, empty row excluded."""
    return page.evaluate("""() => [...document.querySelectorAll(
        '#data-table tbody tr:not([data-cm-empty])')]
        .filter(r => r.style.display !== 'none').length""")


def empty_shown(page):
    return page.evaluate(
        "() => document.querySelector('#data-table [data-cm-empty]')"
        ".style.display !== 'none'")


def info(page):
    return page.evaluate(
        "() => document.querySelector('#data-table [data-cm-pageinfo]')"
        ".textContent.trim()")


def selcount(page):
    return page.evaluate(
        "() => document.querySelector('#data-table [data-cm-selcount]')"
        ".textContent.trim()")


with sync_playwright() as pw:
    b = pw.webkit.launch()
    page = b.new_page(viewport={"width": 402, "height": 667})
    page_errors = []
    page.on('pageerror', lambda e: page_errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => window.cliMono")
    page.evaluate(
        "() => document.querySelector('#data-table').scrollIntoView({block:'center'})")
    page.wait_for_timeout(400)

    # ---- A. the specimen starts as shipped: 10 on page one of three.
    a = page.evaluate("""() => ({
        vis: [...document.querySelectorAll('#data-table tbody tr:not([data-cm-empty])')]
            .filter(r => r.style.display !== 'none').length,
        size: document.querySelector('#data-table table').getAttribute('data-cm-size'),
        page: document.querySelector('#data-table table').getAttribute('data-cm-page'),
        empty: document.querySelector('#data-table [data-cm-empty]').style.display })""")
    check('initial shape: 10 rows, size 10, page 0, empty hidden',
          a['vis'] == 10 and a['size'] == '10' and a['page'] == '0'
          and a['empty'] == 'none', a)
    check('initial footer reads page 1 of 3 / 0 of 23',
          info(page) == 'page 1 of 3'
          and selcount(page) == '0 of 23 rows selected',
          f'{info(page)} | {selcount(page)}')

    # ---- B. filter narrows rows AND footer together.
    page.fill(SC + ' input[data-cm-filter]', 'failed')
    page.wait_for_timeout(150)
    check('filter "failed": 4 rows, page 1 of 1, count over the filtered',
          vis(page) == 4 and info(page) == 'page 1 of 1'
          and selcount(page) == '0 of 4 rows selected',
          f'{vis(page)} | {info(page)} | {selcount(page)}')

    # ---- C. no results: the empty row appears, exactly shadcn's shape.
    page.fill(SC + ' input[data-cm-filter]', 'zzz')
    page.wait_for_timeout(150)
    check('filter "zzz": no rows, the no-results row shows',
          vis(page) == 0 and empty_shown(page),
          f'vis={vis(page)} empty={empty_shown(page)}')
    page.fill(SC + ' input[data-cm-filter]', '')
    page.wait_for_timeout(150)
    check('clearing the filter restores the page',
          vis(page) == 10 and info(page) == 'page 1 of 3'
          and not empty_shown(page),
          f'{vis(page)} | {info(page)}')

    # ---- D. a filter that SHRINKS results from page 3 lands on a REAL
    # page (clamped), never the empty tail of the old one.
    page.click(SC + ' [data-cm-page="next"]')
    page.click(SC + ' [data-cm-page="next"]')
    page.wait_for_timeout(150)
    at_three = info(page) == 'page 3 of 3' and vis(page) == 3
    page.fill(SC + ' input[data-cm-filter]', 'failed')
    page.wait_for_timeout(150)
    check('filtering from page 3 clamps to a real page, not an empty tail',
          at_three and info(page) == 'page 1 of 1' and vis(page) == 4,
          f'was3={at_three} now={info(page)} vis={vis(page)}')
    page.fill(SC + ' input[data-cm-filter]', '')
    page.wait_for_timeout(150)

    # ---- E. pagination on the phone: ends honest, far buttons hidden.
    dis = page.evaluate("""() => {
        const g = k => document.querySelector(
            `#data-table [data-cm-page="${k}"]`).disabled;
        return { first: g('first'), prev: g('prev'), next: g('next') }; }""")
    far = page.evaluate("""() => ['first','last'].map(k => {
        const el = document.querySelector(`#data-table [data-cm-page="${k}"]`);
        return el.offsetParent === null; })""")
    check('at 402: first/prev disabled on page 1, next alive',
          dis == {'first': True, 'prev': True, 'next': False}, dis)
    check('at 402 the first/last buttons are hidden behind the 760px rule',
          far == [True, True], far)
    page.click(SC + ' [data-cm-page="next"]')
    page.wait_for_timeout(150)
    check('next walks to page 2 of 3 with a full page of rows',
          info(page) == 'page 2 of 3' and vis(page) == 10,
          f'{info(page)} vis={vis(page)}')
    page.click(SC + ' [data-cm-page="next"]')
    page.wait_for_timeout(150)
    tail = page.evaluate("""() => ({
        info: document.querySelector('#data-table [data-cm-pageinfo]')
            .textContent.trim(),
        next: document.querySelector('#data-table [data-cm-page="next"]').disabled,
        prev: document.querySelector('#data-table [data-cm-page="prev"]').disabled })""")
    check('page 3: 3 rows, next disabled, prev alive',
          tail == {'info': 'page 3 of 3', 'next': True, 'prev': False}
          and vis(page) == 3, {**tail, 'vis': vis(page)})

    # ---- F. desktop: first/last come back and jump. We are sitting on
    # the LAST page (E ended there), so `last` must be honestly
    # disabled right now - that is its own assertion before we jump.
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(300)
    far2 = page.evaluate("""() => ({
        vis: ['first','last'].map(k => {
            const el = document.querySelector(`#data-table [data-cm-page="${k}"]`);
            return el.offsetParent !== null; }),
        lastDis: document.querySelector('#data-table [data-cm-page="last"]').disabled })""")
    check('at 1280 the first/last buttons return, and last is disabled here',
          far2['vis'] == [True, True] and far2['lastDis'], far2)
    page.click(SC + ' [data-cm-page="first"]')
    page.wait_for_timeout(150)
    first_ok = info(page) == 'page 1 of 3' and vis(page) == 10
    page.click(SC + ' [data-cm-page="last"]')
    page.wait_for_timeout(150)
    check('first/last jump to the ends',
          first_ok and info(page) == 'page 3 of 3' and vis(page) == 3,
          f'first={first_ok} now={info(page)} vis={vis(page)}')
    page.set_viewport_size({"width": 402, "height": 667})
    page.wait_for_timeout(300)

    # ---- G. rows-per-page: the position is KEPT then clamped (the
    # source comment promises a bigger page must not throw the reader
    # back to page one under them), then 25 shows all 23 on one page.
    # We arrive here on page 3 of 3 at size 10.
    page.select_option(SC + ' select[data-cm-pagesize]', '20')
    page.wait_for_timeout(150)
    check('size change keeps position then clamps: page 3 -> page 2 of 2',
          info(page) == 'page 2 of 2' and vis(page) == 3
          and page.evaluate(f"() => document.querySelector('{TBL}')"
                            ".getAttribute('data-cm-size')") == '20',
          f'{info(page)} vis={vis(page)}')
    page.click(SC + ' [data-cm-page="prev"]')
    page.wait_for_timeout(150)
    check('prev lands on a full page 1 of 2 (20 rows)',
          info(page) == 'page 1 of 2' and vis(page) == 20,
          f'{info(page)} vis={vis(page)}')
    page.select_option(SC + ' select[data-cm-pagesize]', '25')
    page.wait_for_timeout(150)
    check('size 25 fits all 23 rows on one page',
          vis(page) == 23 and info(page) == 'page 1 of 1',
          f'{vis(page)} | {info(page)}')
    page.select_option(SC + ' select[data-cm-pagesize]', '10')
    page.wait_for_timeout(150)
    check('back to size 10 restores the three-page shape',
          vis(page) == 10 and info(page) == 'page 1 of 3',
          f'{vis(page)} | {info(page)}')

    # ---- H. column visibility: the menu stays open for multi-toggle,
    # the mouse and the keyboard take the same path, hiding the header
    # and every cell of that column.
    page.click(SC + ' [popovertarget="dt-cols"]')
    page.wait_for_timeout(200)
    check('the columns menu opens as a popover',
          page.evaluate("() => document.getElementById('dt-cols')"
                        ".matches(':popover-open')"))
    page.click(SC + ' [data-cm-col="by"]')
    page.wait_for_timeout(150)
    cv = page.evaluate("""() => ({
        open: document.getElementById('dt-cols').matches(':popover-open'),
        aria: document.querySelector('#data-table [data-cm-col="by"]')
            .getAttribute('aria-checked'),
        hidden: [...document.querySelectorAll('#data-table [data-col="by"]')]
            .filter(e => e.style.display === 'none').length,
        total: document.querySelectorAll('#data-table [data-col="by"]').length })""")
    check('clicking "by" hides its 23 cells + header and keeps the menu open',
          cv['open'] and cv['aria'] == 'false'
          and cv['hidden'] == 24 and cv['total'] == 24, cv)
    page.focus(SC + ' [data-cm-col="project"]')
    page.keyboard.press('Space')
    page.wait_for_timeout(150)
    kb = page.evaluate("""() => ({
        aria: document.querySelector('#data-table [data-cm-col="project"]')
            .getAttribute('aria-checked'),
        hidden: [...document.querySelectorAll('#data-table [data-col="project"]')]
            .filter(e => e.style.display === 'none').length })""")
    check('Space on a column row toggles it too (delegated keyboard)',
          kb['aria'] == 'false' and kb['hidden'] == 24, kb)
    page.click(SC + ' [data-cm-col="by"]')
    page.focus(SC + ' [data-cm-col="project"]')
    page.keyboard.press('Space')
    page.wait_for_timeout(150)
    rest = page.evaluate("""() => ({
        hidden: [...document.querySelectorAll('#data-table [data-col]')]
            .filter(e => e.style.display === 'none').length,
        aria: [...document.querySelectorAll('#data-table [data-cm-col]')]
            .map(e => e.getAttribute('aria-checked')) })""")
    check('both columns restore to fully visible',
          rest['hidden'] == 0 and rest['aria'] == ['true', 'true', 'true', 'true'],
          rest)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    check('Escape closes the columns menu',
          not page.evaluate("() => document.getElementById('dt-cols')"
                            ".matches(':popover-open')"))

    # ---- I. selection: the box that used to un-check itself.
    page.click(SC + ' [data-cm-selectall]')
    page.wait_for_timeout(150)
    sel1 = page.evaluate("""() => ({
        checked: document.querySelector('#data-table [data-cm-selectall]').checked,
        indet: document.querySelector('#data-table [data-cm-selectall]').indeterminate,
        rows: document.querySelectorAll(
            '#data-table tbody tr[aria-selected="true"]').length,
        count: document.querySelector('#data-table [data-cm-selcount]')
            .textContent.trim() })""")
    check('select-all HOLDS: checked, 10 page rows, "10 of 23"',
          sel1['checked'] and not sel1['indet'] and sel1['rows'] == 10
          and sel1['count'] == '10 of 23 rows selected', sel1)

    page.click(SC + ' tbody tr:not([data-cm-empty]) [data-cm-select]')
    page.wait_for_timeout(150)
    sel2 = page.evaluate("""() => ({
        checked: document.querySelector('#data-table [data-cm-selectall]').checked,
        indet: document.querySelector('#data-table [data-cm-selectall]').indeterminate,
        count: document.querySelector('#data-table [data-cm-selcount]')
            .textContent.trim(),
        row0: document.querySelector(
            '#data-table tbody tr:not([data-cm-empty])')
            .getAttribute('aria-selected') })""")
    check('unchecking one row: 9 of 23, header indeterminate, row false',
          not sel2['checked'] and sel2['indet']
          and sel2['count'] == '9 of 23 rows selected'
          and sel2['row0'] == 'false', sel2)

    # ---- J. the count line is selected-AMONG-FILTERED: 9 selected,
    # 12 rows match "ci", 5 of the selected are ci rows.
    page.fill(SC + ' input[data-cm-filter]', 'ci')
    page.wait_for_timeout(150)
    check('with "ci" filtered: "5 of 12" (selected INTERSECT filtered)',
          selcount(page) == '5 of 12 rows selected'
          and info(page) == 'page 1 of 2',
          f'{selcount(page)} | {info(page)}')
    page.fill(SC + ' input[data-cm-filter]', '')
    page.wait_for_timeout(150)
    check('clearing the filter restores "9 of 23"',
          selcount(page) == '9 of 23 rows selected', selcount(page))

    # ---- K. selection lives in the DOM, so a page turn changes nothing.
    page.click(SC + ' [data-cm-page="next"]')
    page.wait_for_timeout(150)
    persist = selcount(page) == '9 of 23 rows selected'
    page.click(SC + ' [data-cm-selectall]')
    page.wait_for_timeout(150)
    plus = selcount(page) == '19 of 23 rows selected'
    page.click(SC + ' [data-cm-selectall]')
    page.wait_for_timeout(150)
    minus = selcount(page) == '9 of 23 rows selected'
    page.click(SC + ' [data-cm-page="prev"]')
    page.wait_for_timeout(150)
    check('selection persists across page turns; select-all works per page',
          persist and plus and minus,
          f'persist={persist} plus={plus} minus={minus}')

    # ---- L. sort: asc, desc, and NUMERIC for the number column (a
    # lexical sort would open at 1180, not 77).
    page.click(SC + ' th[data-col="project"] .cm-table__sort')
    page.wait_for_timeout(150)
    s1 = page.evaluate("""() => ({
        aria: document.querySelector('#data-table th[data-col="project"]')
            .getAttribute('aria-sort'),
        first: document.querySelector(
            '#data-table tbody tr:not([data-cm-empty]) td[data-col="project"]')
            .textContent.trim() })""")
    check('first click on project sorts ascending',
          s1['aria'] == 'ascending' and s1['first'] == 'browser-hub', s1)
    page.click(SC + ' th[data-col="project"] .cm-table__sort')
    page.wait_for_timeout(150)
    s2 = page.evaluate("""() => ({
        aria: document.querySelector('#data-table th[data-col="project"]')
            .getAttribute('aria-sort'),
        first: document.querySelector(
            '#data-table tbody tr:not([data-cm-empty]) td[data-col="project"]')
            .textContent.trim() })""")
    check('second click sorts descending',
          s2['aria'] == 'descending' and s2['first'] == 'sullen.sh', s2)
    page.click(SC + ' th[data-col="size"] .cm-table__sort')
    page.wait_for_timeout(150)
    s3 = page.evaluate("""() => ({
        aria: document.querySelector('#data-table th[data-col="size"]')
            .getAttribute('aria-sort'),
        vals: [...document.querySelectorAll(
            '#data-table tbody tr:not([data-cm-empty]) td[data-col="size"]')]
            .slice(0, 5).map(td => td.textContent.trim()),
        info: document.querySelector('#data-table [data-cm-pageinfo]')
            .textContent.trim(),
        count: document.querySelector('#data-table [data-cm-selcount]')
            .textContent.trim(),
        indet: document.querySelector('#data-table [data-cm-selectall]').indeterminate })""")
    check('size column sorts NUMERICALLY (77, 96, 120 ... not 1180 first)',
          s3['aria'] == 'ascending'
          and s3['vals'] == ['77', '96', '120', '148', '205'], s3)
    check('sorting keeps page and selection intact',
          s3['info'] == 'page 1 of 3'
          and s3['count'] == '9 of 23 rows selected' and s3['indet'],
          s3)

    # ---- M. delegated markup: a filter input APPENDED at runtime and a
    # tbody REWRITTEN by a framework both keep working - the listeners
    # live on document, the state lives in the DOM. Each late input gets
    # an id so removals are exact: two live filters intersect (every
    # active filter must hold), which is right but makes state leak
    # between sub-steps if inputs linger.
    page.evaluate("""() => {
        const i = document.createElement('input');
        i.type = 'search'; i.id = 'late-global';
        i.setAttribute('data-cm-filter', '');
        i.placeholder = 'late filter';
        document.querySelector('#data-table .cm-table__bar').appendChild(i);
        i.value = 'queued';
        i.dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)
    check('a filter input appended at runtime filters on input',
          vis(page) == 4 and info(page) == 'page 1 of 1'
          and selcount(page) == '2 of 4 rows selected',
          f'vis={vis(page)} | {info(page)} | {selcount(page)}')
    page.evaluate("""() => {
        document.getElementById('late-global').remove();
        document.querySelector('#data-table input[data-cm-filter]')
            .dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)

    # column-SCOPED filtering: data-cm-filter="by" searches only the by
    # column. 'omar' matches 7 rows there (2 of them selected); 'live'
    # matches NOTHING in that column even though 12 rows carry it as
    # status - the scoping is what makes that difference.
    page.evaluate("""() => {
        const i = document.createElement('input');
        i.type = 'search'; i.id = 'late-col';
        i.setAttribute('data-cm-filter', 'by');
        document.querySelector('#data-table .cm-table__bar').appendChild(i);
        i.value = 'omar';
        i.dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)
    check('column-scoped filter searches only its column (omar: 7 of the by column)',
          vis(page) == 7 and info(page) == 'page 1 of 1'
          and selcount(page) == '2 of 7 rows selected',
          f'vis={vis(page)} | {info(page)} | {selcount(page)}')
    page.evaluate("""() => {
        const i = document.getElementById('late-col');
        i.value = 'live';
        i.dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)
    check('a column filter cannot see other columns (live in by: 0 rows)',
          vis(page) == 0 and empty_shown(page)
          and selcount(page) == '0 of 0 rows selected',
          f'vis={vis(page)} empty={empty_shown(page)} | {selcount(page)}')
    page.evaluate("""() => {
        document.getElementById('late-col').remove();
        document.querySelector('#data-table input[data-cm-filter]')
            .dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)

    # a tbody replaced wholesale (the framework-rewrite case)
    page.evaluate("""() => {
        const t = document.querySelector('#data-table table');
        const tb = t.tBodies[0];
        window.__oldTb = tb;
        const n = document.createElement('tbody');
        for (let i = 0; i < 3; i++) {
            const tr = document.createElement('tr');
            tr.setAttribute('aria-selected', 'false');
            tr.innerHTML = '<td class="cm-table__check"><input type="checkbox" '
                + 'data-cm-select aria-label="select row"></td>'
                + '<td data-col="status">live</td>'
                + '<td data-col="project">fresh-' + i + '</td>'
                + '<td data-col="by">ci</td>'
                + '<td class="cm-table__num" data-col="size">10</td>'
                + '<td></td>';
            n.appendChild(tr);
        }
        t.replaceChild(n, tb);
    }""")
    page.evaluate("""() => {
        const i = document.querySelector('#data-table input[data-cm-filter]');
        i.dispatchEvent(new Event('input', {bubbles: true}));
    }""")
    page.wait_for_timeout(150)
    rewired = (vis(page) == 3 and info(page) == 'page 1 of 1'
               and selcount(page) == '0 of 3 rows selected')
    page.click(SC + ' [data-cm-selectall]')
    page.wait_for_timeout(150)
    rewired2 = (selcount(page) == '3 of 3 rows selected'
                and page.evaluate("""() => document.querySelectorAll(
                    '#data-table tbody tr[aria-selected="true"]').length""") == 3)
    check('a rewritten tbody filters and selects through the same delegation',
          rewired and rewired2,
          f'vis={vis(page)} info={info(page)} count={selcount(page)} '
          f'selectall={rewired2}')
    page.evaluate("""() => {
        const t = document.querySelector('#data-table table');
        t.replaceChild(window.__oldTb, t.tBodies[0]);
    }""")
    page.fill(SC + ' input[data-cm-filter]', 'x')  # force a refresh
    page.fill(SC + ' input[data-cm-filter]', '')
    page.wait_for_timeout(150)
    check('the original tbody comes back with its selection state intact',
          vis(page) == 10 and info(page) == 'page 1 of 3'
          and selcount(page) == '9 of 23 rows selected',
          f'{vis(page)} | {info(page)} | {selcount(page)}')

    check('no page errors in the data table', not page_errors, page_errors)
    b.close()

print(f'---\npassed {passed}/{passed + len(failed)}')
if failed:
    for f in failed:
        print(' FAILED:', f)
    raise SystemExit(1)
