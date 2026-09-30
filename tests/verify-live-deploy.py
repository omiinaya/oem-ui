#!/root/.venvs/mau/bin/python
"""
Assert the PUBLISHED site is the build, not the repository.

This is the check that was missing. For three days every workflow on
oem-ui reported success while ui.mrx.sh served the README: Pages was
configured source={branch:master, path:/}, so classic Pages published
the repo root and rendered README.md as the homepage. The build ran, the
artifact uploaded, the deploy step went green, and the site was wrong.

Green workflows are not evidence that anything was published. The only
evidence is the bytes at the URL.

Three independent signals, because each one alone can lie:

  1. The page must be the built app, not a GitHub-rendered README. A
     README page carries `markdown-body` and a heading whose id matches
     the repo name; the showcase has neither.
  2. The title must match what the SOURCE says. If the deployed title
     differs from the current source title, the deploy is stale no matter
     how recently the workflow went green. This is the check that
     actually fired.
  3. The header must exist as real markup. A page can carry the string
     "cm-header__links" inside a <code> documentation specimen, so
     counting substring occurrences reports success on a page with no
     header at all. Only an element with the class counts.

Run with BASE_URL to point at a preview or a consumer.
"""
import asyncio
import os
import re
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "https://ui.mrx.sh/")
SOURCE_TITLE = "oem/ui — component library"

PROBE = """() => {
  const first = document.body.firstElementChild;
  const header = document.querySelector('header.cm-header');
  const t = document.title;
  return {
    title: t,
    // A GitHub-rendered README.
    isReadme: !!document.querySelector('.markdown-body'),
    firstClass: first ? first.className : '',
    h1Id: document.querySelector('h1') ? document.querySelector('h1').id : '',
    // Real element, not a <code> specimen.
    hasHeader: !!header,
    headerIsRail: header ? header.classList.contains('cm-header--rail') : false,
    navLinks: document.querySelectorAll('.cm-header__link').length,
  };
}"""


async def main() -> int:
    fails = []
    async with async_playwright() as pw:
        browser = await pw.webkit.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        resp = await page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        d = await page.evaluate(PROBE)
        await browser.close()

    print(f"url    {BASE}")
    print(f"status {resp.status if resp else '?'}")
    print(f"title  {d['title']!r}")
    print(f"body   first={d['firstClass']!r} h1#{d['h1Id']}")
    print(f"header present={d['hasHeader']} rail={d['headerIsRail']} links={d['navLinks']}")
    print()

    if resp is None or resp.status != 200:
        fails.append(f"the site did not return 200 (got {resp.status if resp else 'nothing'})")

    # 1. not the README
    if d["isReadme"]:
        fails.append(
            "the page is a GitHub-rendered README (.markdown-body present), "
            "so Pages is publishing the repository root instead of the build"
        )
    if d["h1Id"] == "oem-ui":
        fails.append(
            "h1 id is 'oem-ui' with no slash -- that is the README heading, "
            "not the showcase's <PageHead>"
        )

    # 2. the deployed title must match the current source title
    if SOURCE_TITLE not in d["title"]:
        fails.append(
            f"the deployed title {d['title']!r} is not the current source "
            f"title {SOURCE_TITLE!r}; the deploy is STALE. A green workflow "
            "does not mean anything was published -- check the Pages source "
            "setting (build_type must be 'workflow', not branch+path)."
        )

    # 3. a real header element, not a documentation specimen
    if not d["hasHeader"]:
        fails.append(
            "no <header class=\"cm-header\"> element. Note that the STRING "
            "'cm-header__links' can appear inside a <code> specimen, so its "
            "presence proves nothing; only an element with the class counts."
        )
    elif d["navLinks"] == 0:
        fails.append("the header exists but renders no nav links")

    if fails:
        print("FAIL")
        for f in fails:
            print(f"  FAIL {f}")
        return 1
    print("PASS  the published site is the build, not the repository")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
