"""Contract test: the vendored oem-ui copy must not drift from the library.

This is the defect that made every library fix look like a no-op: rpm
imports `./styles/cli-mono/*.css`, a hand-copied snapshot, NOT the
library. Editing oem-ui and rebuilding rpm therefore changed nothing in
the shipped bundle - `WEB DEPLOY OK` still returned 200, the test suite
still passed, and the page still rendered the old 32px panel headings.

A guard that only runs the library's own tests cannot see this. This one
compares the bytes.
"""
import hashlib
import pathlib
import sys

LIB = pathlib.Path('/root/projects/oem-ui/src/styles')
VEND = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/styles/cli-mono')

fails = []


def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg)
    if not ok:
        fails.append(msg)


def md5(p):
    return hashlib.md5(p.read_bytes()).hexdigest()


print('1. the vendored directory is the one the app actually imports')
idx = pathlib.Path(
    '/mnt/pve/mrx-thunder/projects/spacetime-rpm/web/src/index.css').read_text()
for name in ('tokens.css', 'base.css', 'components.css'):
    check(f"./styles/cli-mono/{name}" in idx,
          f'index.css imports ./styles/cli-mono/{name}')

print('2. every vendored file is byte-identical to the library')
for name in ('tokens.css', 'base.css', 'components.css'):
    lp, vp = LIB / name, VEND / name
    if not vp.exists():
        check(False, f'{name} exists in the vendored copy')
        continue
    same = lp.exists() and md5(lp) == md5(vp)
    check(same, f'{name} matches the library (lib {md5(lp)[:8]} / vend {md5(vp)[:8]})')

print('3. the library class this suite depends on is present in BOTH copies')
cls = '.cm-section__title'
lib_css = (LIB / 'components.css').read_text()
check(cls in lib_css, f'{cls} is in the library')
if (VEND / 'components.css').exists():
    check(cls in (VEND / 'components.css').read_text(),
          f'{cls} reached the vendored copy (this is the step that was missed)')

print()
if fails:
    print(f'FAILED {len(fails)} - run scripts/sync-vendor.sh')
    sys.exit(1)
print('PASS')
