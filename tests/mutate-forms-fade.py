#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 15: scroll-fade + shimmer + validating forms.

Byte-exact patterns, pre-checked (PATTERN ABSENT beats a silently
surviving mutant), --scan prints every count without running baselines,
and the whole loop restores from the SAVED text of each file, never
from git - restore-on-crash included. Suite contracts carry the source
claims; the WebKit harness carries the behaviours no source check can
see (the timeline actually moving --sf-p, focus, the live count,
reduced-motion emulation)."""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-forms-fade.py']
NL = '\n'
TAB = '\t'

MUTANTS = [
    # ---- suite: the contracts ------------------------------------------
    ('scroll-fade loses its vertical timeline', 'src/styles/components.css',
     '.cm-scroll-fade-y { animation-timeline: scroll(self block); }',
     '.cm-scroll-fade-y { }', 1, 'suite'),
    ('the edge stops are not registered', 'src/styles/components.css',
     '@property --sf-p { syntax: "<number>"; inherits: true; initial-value: 0; }' + NL,
     '', 1, 'suite'),
    ('scroll-fade-none missing', 'src/styles/components.css',
     """/* The stop sign: no mask, no timeline. Declared AFTER the @supports
   gate so equal specificity lands later and wins. */
.cm-scroll-fade--none {
	-webkit-mask-image: none;
	mask-image: none;
	animation: none;
}
""",
     '', 1, 'suite'),
    ('shimmer not behind its gate', 'src/styles/components.css',
     '@supports ((background-clip: text) or (-webkit-background-clip: text)) {',
     '@media screen {', 1, 'suite'),
    ('shimmer not listed in the RM block', 'src/styles/components.css',
     TAB + '.cm-cursor,' + NL + TAB + '.cm-shimmer,',
     TAB + '.cm-cursor,', 1, 'suite'),
    ('the scroll-fade trio leaves the RM block', 'src/styles/components.css',
     TAB + '.cm-shimmer,' + NL + TAB + '.cm-scroll-fade,' + NL
     + TAB + '.cm-scroll-fade-y,' + NL + TAB + '.cm-scroll-fade-x,',
     TAB + '.cm-shimmer,', 1, 'suite'),
    ('the static table mask returns', 'src/styles/components.css',
     'tracks the scroll instead of fading blind. */',
     'tracks the scroll instead of fading blind. */' + NL
     + TAB + 'mask-image: linear-gradient(to right, #000 0%, #000 92%, transparent 100%);',
     1, 'suite'),
    ('cmInitForms not called by init', 'src/js/cli-mono.js',
     TAB + TAB + 'cmInitForms(root);' + NL, '', 1, 'suite'),
    ('no cmInitForms function', 'src/js/cli-mono.js',
     'function cmInitForms(root) {', 'function _deadForms(root) {', 1, 'suite'),
    ('one form loses its opt-in', 'src/pages/index.astro',
     'data-cm-validate data-cm-validate-toast="handle saved"',
     'data-cm-validate-toast="handle saved"', 1, 'suite'),
    ('utilities not registered in the nav', 'src/pages/index.astro',
     "'scrollarea', 'utilities', 'search'", "'scrollarea', 'search'", 1, 'suite'),
    ('the utilities section is renamed away', 'src/pages/index.astro',
     '<section id="utilities" class=', '<section id="utilities-demo" class=', 1, 'suite'),
    # ---- harness: the behaviours ---------------------------------------
    ('validation never marks aria-invalid', 'src/js/cli-mono.js',
     'el.setAttribute(\'aria-invalid\', \'true\');', '', 1, 'harness'),
    ('the error message never shows', 'src/js/cli-mono.js',
     'err.hidden = false;', 'err.hidden = true;', 1, 'harness'),
    ('first invalid is never focused', 'src/js/cli-mono.js',
     'if (first) first.focus();', 'if (false) first.focus();', 1, 'harness'),
    ('reset never clears the marks', 'src/js/cli-mono.js',
     'form.addEventListener(\'reset\', function () {',
     'form.addEventListener(\'reset-disabled\', function () {', 1, 'harness'),
    ('save never proves itself', 'src/js/cli-mono.js',
     'toast(form.getAttribute(\'data-cm-validate-toast\') || \'saved\', \'ok\');',
     'void 0;', 1, 'harness'),
    ('blur mode ignored', 'src/js/cli-mono.js',
     'if (mode === \'blur\') {', 'if (false) {', 1, 'harness'),
    ('the live count never lands', 'src/js/cli-mono.js',
     "bad + ' fields need attention'", "''", 1, 'harness'),
    ('shimmer never sweeps', 'src/styles/components.css',
     'animation: cm-shimmer var(--shimmer-duration, 2s) linear infinite;',
     'animation: none;', 1, 'harness'),
    ('--none does not stop the sweep', 'src/styles/components.css',
     '.cm-shimmer--none { animation: none; background-image: none; color: inherit; }',
     '.cm-shimmer--none { animation: none; background-image: none; }', 1, 'harness'),
    ('the scroll timeline never moves', 'src/styles/components.css',
     '@keyframes cm-sf { from { --sf-p: 0; } to { --sf-p: 1; } }',
     '@keyframes cm-sf { from { --sf-p: 0; } to { --sf-p: 0; } }', 1, 'harness'),
    ('scroll-fade loses its vertical mask', 'src/styles/components.css',
     '\t-webkit-mask-image: linear-gradient(to bottom,\n'
     '\t\ttransparent calc(var(--sf-p, 0) * var(--fade-size, min(12%, 40px)) * var(--sf-top-k, 1)),\n'
     '\t\tblack calc(var(--sf-p, 0) * var(--fade-size, min(12%, 40px)) * var(--sf-top-k, 1)),\n'
     '\t\tblack calc(100% - (1 - var(--sf-p, 0)) * var(--fade-size, min(12%, 40px)) * var(--sf-bot-k, 1)),\n'
     '\t\ttransparent calc(100% - (1 - var(--sf-p, 0)) * var(--fade-size, min(12%, 40px)) * var(--sf-bot-k, 1)));\n'
     '\tmask-image: linear-gradient(to bottom,\n'
     '\t\ttransparent calc(var(--sf-p, 0) * var(--fade-size, min(12%, 40px)) * var(--sf-top-k, 1)),\n'
     '\t\tblack calc(var(--sf-p, 0) * var(--fade-size, min(12%, 40px)) * var(--sf-top-k, 1)),\n'
     '\t\tblack calc(100% - (1 - var(--sf-p, 0)) * var(--fade-size, min(12%, 40px)) * var(--sf-bot-k, 1)),\n'
     '\t\ttransparent calc(100% - (1 - var(--sf-p, 0)) * var(--fade-size, min(12%, 40px)) * var(--sf-bot-k, 1)));',
     '', 1, 'harness'),
]


def file_text(rel):
    return (ROOT / rel).read_text()


def run(cmd, timeout=300):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       timeout=timeout)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def main():
    if '--baseline' in sys.argv:
        rc, out = run(SUITE)
        tail = run(HARNESS, timeout=300)[1][-400:]
        print('baseline:', 'SUITE OK' if 'FAIL' not in out and rc == 0 else 'SUITE RED',
              '|', 'HARNESS OK' if '16 passed, 0 failed' in tail else tail)
        return 0

    saved = {}
    bad = 0
    for label, rel, old, new, count, target in MUTANTS:
        path = ROOT / rel
        text = path.read_text()
        n = text.count(old)
        if n != count:
            print(f'  PATTERN ABSENT ({n} != {count}) {label}', flush=True)
            bad += 1
        saved[rel] = text
    if bad:
        sys.exit(2)
    if '--scan' in sys.argv:
        print(f'all {len(MUTANTS)} patterns present', flush=True)
        return 0

    rc, out = run(SUITE)
    if 'FAIL' in out or rc != 0:
        print('baseline suite not green; aborting')
        return 2
    print('baseline suite green', end=' ', flush=True)
    rc, out = run(HARNESS, timeout=300)
    if '0 failed' not in out:
        print('\nbaseline harness not green; aborting')
        return 2
    print(f'| baseline harness 16/16 | {len(MUTANTS)} mutants pre-checked', flush=True)

    results = []
    try:
        for label, rel, old, new, count, target in MUTANTS:
            path = ROOT / rel
            path.write_text(saved[rel].replace(old, new, count))
            if target == 'suite':
                rc, out = run(SUITE)
                killed = 'FAIL' in out or rc != 0
            else:
                build = subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                                       capture_output=True, text=True, timeout=180)
                if build.returncode != 0:
                    killed = True
                    out = 'build broke'
                else:
                    rc, out = run(HARNESS, timeout=300)
                    killed = '0 failed' not in out or rc != 0
            results.append((label, killed))
            print(('  killed' if killed else '  SURVIVED'), '-', label,
                  '::', 'FAIL-line' if killed else 'ORACLE BLIND', flush=True)
    finally:
        for rel, text in saved.items():
            (ROOT / rel).write_text(text)

    killed = sum(1 for _, k in results if k)
    survived = [l for l, k in results if not k]
    print(f'\nkilled={killed} survived={len(survived)} of {len(results)}')
    if survived:
        print('SURVIVED:', *survived, sep='\n  - ')
        return 1
    print('MUTATION PROOF PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
