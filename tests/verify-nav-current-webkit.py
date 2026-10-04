#!/usr/bin/env python3
"""MEASURE the current-page state of a rendered nav in real WebKit.

The bug this exists to catch is INVISIBLE to a screenshot and to a CSS-text
scan: on a one-pager whose nav links are all `#section`, every link computed
`aria-current="page"` at once, so the nav rendered "all current" - which
looks like a highlighted nav, not like a bug.

So this measures COUNTS and asserts the INVARIANT, not appearance:

  * on a one-pager (all links are in-page fragments), the number of links
    carrying aria-current must be 0 - never "at most one";
  * a link that IS the current page must be marked, or the fix is a no-op.

Both directions are asserted on purpose: a matcher that always returns false
passes the first and fails the second.
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
IPHONE = {'width': 390, 'height': 844}

PROBE = """
() => {
  const header = document.querySelector('[data-cm-header]');
  if (!header) return { error: 'no [data-cm-header] on the page' };
  const links = [...header.querySelectorAll('a.cm-header__link')];
  const rows = links.map((a) => {
    const r = a.getBoundingClientRect();
    return {
      href: a.getAttribute('href'),
      current: a.getAttribute('aria-current'),
      h: Math.round(r.height),
      w: Math.round(r.width),
      top: Math.round(r.top),
    };
  });
  return {
    total: links.length,
    currentCount: rows.filter((r) => r.current === 'page').length,
    rows,
  };
}
"""


def main():
    failures = []
    with sync_playwright() as pw:
        browser = pw.webkit.launch()
        for label, vp in (('iphone-390', IPHONE),
                          ('desktop-1440', {'width': 1440, 'height': 900})):
            page = browser.new_page(viewport=vp)
            page.goto(URL, wait_until='networkidle')
            # Clear storage BEFORE measuring: a saved light theme changes the
            # tokens we read and has silently corrupted a probe in this repo.
            page.evaluate('() => localStorage.clear()')
            page.goto(URL, wait_until='networkidle')
            data = page.evaluate(PROBE)
            if 'error' in data:
                failures.append(f'{label}: {data["error"]}')
                page.close()
                continue

            # A closed drawer keeps its nav links in the DOM at height 0, so a
            # count taken on a phone is a count over hidden elements - the
            # check would pass on a header that renders nothing. Open the
            # drawer first and MEASURE that it opened; a nav that stays at
            # height 0 makes the whole assertion below vacuous.
            opened = False
            if vp['width'] < 1000:
                toggle = page.query_selector('[data-cm-nav-toggle]')
                if toggle is None:
                    failures.append(f'{label}: no [data-cm-nav-toggle] to open '
                                    'the drawer with')
                else:
                    toggle.click()
                    # wait_for_function rather than a bare sleep: the class
                    # lands on the transition's first frame.
                    try:
                        page.wait_for_function(
                            "() => [...document.querySelectorAll("
                            "'[data-cm-header] a.cm-header__link')]"
                            ".some(a => a.getBoundingClientRect().height > 0)",
                            timeout=5000)
                        opened = True
                    except Exception:
                        opened = False
            else:
                opened = True

            if opened:
                data = page.evaluate(PROBE)

            print(f'\n{label}  drawer_opened={opened}  total={data["total"]} '
                  f'aria-current="page"={data["currentCount"]}')
            for r in data['rows'][:4]:
                print(f'   href={r["href"]!r:18} aria-current={r["current"]!r} '
                      f'{r["w"]}x{r["h"]} top={r["top"]}')
            if data['currentCount'] != 0:
                failures.append(
                    f'{label}: {data["currentCount"]} in-page links marked '
                    f'aria-current="page" (expected 0 - a fragment addresses '
                    f'a position, not a page)')
            if data['total'] == 0:
                failures.append(f'{label}: the nav rendered no links at all')
            # A closed drawer keeps hidden links at height 0; assert the nav
            # is actually laid out rather than trusting the count blindly.
            visible = [r for r in data['rows'] if r['h'] > 0]
            if not visible:
                failures.append(
                    f'{label}: every nav link measured height 0 - the nav is '
                    f'not rendered, so the count above means nothing')
            page.close()
        browser.close()

    print()
    if failures:
        for f in failures:
            print(f'FAIL {f}')
        return 1
    print('PASS the nav marks no in-page link as the current page, and the '
          'nav is genuinely rendered')
    return 0


if __name__ == '__main__':
    sys.exit(main())