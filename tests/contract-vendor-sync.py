"""Contract test: the vendored oem-ui copy must not drift from the library.

This is the defect that made every library fix look like a no-op: rpm
imports `./styles/cli-mono/*.css` and `./js/cli-mono.js`, hand-copied
snapshots, NOT the library. Editing oem-ui and rebuilding rpm therefore
changed nothing in the shipped bundle - `WEB DEPLOY OK` still returned
200, the test suite still passed, and the page still rendered the old
32px panel headings.

A guard that only runs the library's own tests cannot see this. This one
compares the bytes, and it covers the runtime as well as the CSS: the
first version of this file checked CSS only, and the next library change
(toast severity) was a JS edit that passed the guard while never
reaching the app.

It reads the REAL vendored files and the REAL library files. The deploy
preflight runs it, so drift fails the deploy instead of shipping quietly.
"""
import hashlib
import pathlib
import sys

LIB = pathlib.Path('/root/projects/oem-ui/src')
APP = pathlib.Path('/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src')

# (library-relative, app-relative) - the snapshot the app actually loads
PAIRS = [
    ('styles/tokens.css', 'styles/cli-mono/tokens.css'),
    ('styles/base.css', 'styles/cli-mono/base.css'),
    ('styles/components.css', 'styles/cli-mono/components.css'),
    ('js/cli-mono.js', 'js/cli-mono.js'),
]

# A THIRD copy, and the reason a file-by-file byte comparison is not the
# whole guard. The FOUC theme guard has to run before the first
# stylesheet, so it cannot be a module - rpm inlines it into index.html
# by hand, and the library ships a file that nothing imports. Editing
# the library file changes nothing on the page, silently, exactly like
# the CSS drift did. It is compared as a BODY, extracted from both.
INLINE_SRC = ('js/cli-mono-theme-guard.js',)

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


def md5(p):
    return hashlib.md5(p.read_bytes()).hexdigest()


print('1. the app really loads these snapshots (not the library directly)')
idx = (APP / 'index.css').read_text()
main = (APP / 'main.tsx').read_text()
for lib_rel, app_rel in PAIRS:
    if app_rel.endswith('.css'):
        check(f'./{app_rel}' in idx, f'index.css imports ./{app_rel}')
    else:
        check(f"'./{app_rel}" in main, f'main.tsx imports ./{app_rel}')

print('2. every vendored file is byte-identical to the library')
for lib_rel, app_rel in PAIRS:
    lp, vp = LIB / lib_rel, APP / app_rel
    if not lp.exists():
        check(False, f'{lib_rel} exists in the library')
        continue
    if not vp.exists():
        check(False, f'{app_rel} exists in the vendored copy')
        continue
    same = md5(lp) == md5(vp)
    check(same, f'{lib_rel} matches ({md5(lp)[:8]} / {md5(vp)[:8]})')

print('3. the inlined FOUC guard in index.html matches the library file')
import re
GUARD_RE = re.compile(
    r'\(function \(\) \{\n\ttry \{\n\t\tvar d = document\.documentElement;.*?\n\}\)\(\);',
    re.S)
lib_guard = (LIB / 'js' / 'cli-mono-theme-guard.js').read_text()
html = (APP.parent / 'index.html').read_text()
lg = GUARD_RE.search(lib_guard)
ih = GUARD_RE.search(html)
check(lg is not None, 'the library guard body is extractable')
check(ih is not None, 'index.html inlines a guard body')
if lg and ih:
    same = lg.group(0).strip() == ih.group(0).strip()
    check(same, 'the inlined guard is byte-identical to the library file')
    check('<script' in html[:ih.start()],
          'the inlined guard is in a <script>, not a comment')

print('4. a library-only rule reaches BOTH copies')
# The specific rule this suite exists for. A byte comparison says the
# copies agree; this says they agree on the thing that was actually
# missing, so a guard that silently stopped comparing is still caught.
cls = '.cm-section__title'
lib_css = (LIB / 'styles' / 'components.css').read_text()
vend_css = (APP / 'styles' / 'cli-mono' / 'components.css')
check(cls in lib_css, f'{cls} is in the library')
check(vend_css.exists() and cls in vend_css.read_text(),
      f'{cls} reached the vendored copy (the step that was missed)')

# And the JS rule the toast swap depends on.
fn = 'function toast(msg, severity'
lib_js = (LIB / 'js' / 'cli-mono.js').read_text()
vend_js = (APP / 'js' / 'cli-mono.js')
check(fn in lib_js, 'library toast() takes a severity')
check(vend_js.exists() and fn in vend_js.read_text(),
      'the severity-aware toast reached the vendored runtime')

print()
if fails:
    print(f'FAILED {len(fails)} - run scripts/sync-vendor.sh, then REBUILD')
    sys.exit(1)
print('PASS')
