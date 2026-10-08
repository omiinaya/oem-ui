#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 16b: attachment + questionnaire.

Byte-exact patterns, pre-checked (--scan), baselines with a build each,
restore verified, post-run rebuild. A build that breaks under a mutation
counts as a kill; a crash or timeout is a kill, never a silent pass.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
TAB = '\t'

MUTANTS = [
    ('the trigger no longer covers the card', 'src/styles/components.css',
     '.cm-attach__trigger {\n\tposition: absolute;\n\tinset: 0;',
     '.cm-attach__trigger {\n\tposition: static;', 'harness'),
    ('the trigger rises above the actions', 'src/styles/components.css',
     '.cm-attach__trigger {\n\tposition: absolute;\n\tinset: 0;',
     '.cm-attach__trigger {\n\tposition: absolute;\n\tz-index: 2;\n\tinset: 0;', 'harness'),
    ('the media icon slot loses its frame', 'src/styles/components.css',
     '\tborder: 1px solid var(--line-soft);\n\tbackground: var(--panel-nested);',
     '\tbackground: var(--panel-nested);', 'suite'),
    ('error loses the double-rule', 'src/styles/components.css',
     '.cm-attach--error { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }',
     '.cm-attach--error { border-color: var(--ink); }', 'suite'),
    ('the group stops snapping', 'src/styles/components.css',
     '\tscroll-snap-type: x mandatory;\n\tpadding-block: var(--space-1);',
     '\tscroll-snap-type: none;\n\tpadding-block: var(--space-1);', 'harness'),
    ('the group stops scrolling', 'src/styles/components.css',
     '\tdisplay: flex;\n\tgap: var(--space-2);\n\toverflow-x: auto;',
     '\tdisplay: flex;\n\tgap: var(--space-2);', 'harness'),
    ('the quiz bar never fills', 'src/js/cli-mono.js',
     "if (bar) bar.style.width = Math.round((cur / total) * 100) + '%';",
     "if (bar) bar.style.width = '0%';", 'harness'),
    ('progress aria stops tracking', 'src/js/cli-mono.js',
     "progress.setAttribute('aria-valuenow', String(cur));",
     "progress.setAttribute('aria-valuenow', '1');", 'harness'),
    ('validation stops marking the item', 'src/js/cli-mono.js',
     "if (bad) item.setAttribute('data-invalid', '');",
     '', 'harness'),
    ('validation stops setting aria-invalid', 'src/js/cli-mono.js',
     "if (bad) cs[i].setAttribute('aria-invalid', 'true');",
     '', 'harness'),
    ('navigation stops focusing the new legend', 'src/js/cli-mono.js',
     "if (legend) legend.focus();",
     '', 'harness'),
    ('submit stops toasting', 'src/js/cli-mono.js',
     "toast('questionnaire submitted - ' + answers + ' answers', 'ok');",
     '', 'harness'),
    ('submit stops resetting the form', 'src/js/cli-mono.js',
     '\t\t\t\t\tform.reset();\n', '', 'harness'),
    ('skip shows on a required item', 'src/js/cli-mono.js',
     "if (skip) skip.hidden = required(items[active]);",
     "if (skip) skip.hidden = false;", 'harness'),
    ('the shortcut stops selecting', 'src/js/cli-mono.js',
     "\t\t\t\t\t\tchoice.checked = true;", '', 'harness'),
    ('the freeform input loses its name', 'src/pages/index.astro',
     'class="cm-quiz__input" type="text" name="direction_other" aria-label="Another answer"',
     'class="cm-quiz__input" type="text" name="direction_other"', 'suite'),
    ('the progressbar loses its name', 'src/pages/index.astro',
     'role="progressbar" aria-label="Questionnaire progress"',
     'role="progressbar"', 'suite'),
    ('the legend stops being focusable', 'src/pages/index.astro',
     '<legend class="cm-quiz__title" tabindex="-1">What should',
     '<legend class="cm-quiz__title">What should', 'suite'),
    ('the error stops being an alert', 'src/pages/index.astro',
     '<p class="cm-quiz__error" role="alert" hidden>pick an answer',
     '<p class="cm-quiz__error" hidden>pick an answer', 'suite'),
    ('an action loses its accessible name', 'src/pages/index.astro',
     'aria-label="Remove assets.zip"', 'title="x"', 'suite'),
    ('the group loses its keyboard reach', 'src/pages/index.astro',
     'class="cm-attach-group cm-scroll-fade" tabindex="0" role="group"',
     'class="cm-attach-group cm-scroll-fade" role="group"', 'suite'),
    ('the section leaves the nav', 'src/pages/index.astro',
     "'chat', 'attachment', 'quiz', 'search',",
     "'chat', 'attachment', 'search',", 'suite'),
]

SUITE_CMD = 'npm test'
HARNESS_CMD = '/root/.venvs/mau/bin/python tests/verify-attach-quiz.py'


def run_check(cmd, timeout=240):
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (treated as a kill)'


def build():
    """npm test does NOT build; harness windows read dist/, so build each."""
    try:
        r = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True,
                           text=True, timeout=300)
        return r.returncode == 0
    except subprocess.TimeoutExpired:
        return False


if '--scan' in sys.argv:
    bad = 0
    for name, path, old, _new, _t in MUTANTS:
        n = (ROOT / path).read_text().count(old)
        if n != 1:
            print(f'  PATTERN ABSENT - {name}: {path} matches {n}')
            bad += 1
    print(f'{len(MUTANTS) - bad}/{len(MUTANTS)} patterns present')
    sys.exit(2 if bad else 0)

originals = {p: (ROOT / p).read_text() for p in {m[1] for m in MUTANTS}}

assert build(), 'baseline build broke'
rc, out = run_check(SUITE_CMD)
assert rc == 0, f'baseline suite not green:\n{out[-2000:]}'
print('baseline suite green', end=' | ')
assert build(), 'baseline rebuild broke'
rc, out = run_check(HARNESS_CMD, timeout=180)
assert rc == 0, f'baseline harness not green:\n{out[-2000:]}'
print('baseline harness green')
for name, path, old, _new, _t in MUTANTS:
    assert originals[path].count(old) == 1, f'PATTERN ABSENT: {name}'

killed, survived = [], []
for name, path, old, new, target in MUTANTS:
    (ROOT / path).write_text(originals[path].replace(old, new, 1))
    try:
        if not build():
            rc, out, dead = -1, 'build broke under the mutation', True
        else:
            rc, out = run_check(HARNESS_CMD if target == 'harness' else SUITE_CMD,
                                timeout=180)
            dead = (rc != 0) or ('FAIL' in out) or ('not ok' in out)
        (killed if dead else survived).append(
            (name, 'BUILD BROKE' if 'build broke' in out else
             ('TIMEOUT' if rc == -1 else ('FAIL-line' if dead else f'rc={rc}'))))
    finally:
        (ROOT / path).write_text(originals[path])

for p, data in originals.items():
    assert (ROOT / p).read_text() == data, f'RESTORE FAILED: {p}'
assert build(), 'post-run rebuild failed'

print()
for name, how in killed:
    print(f'  killed - {name} :: {how}')
if survived:
    print('SURVIVED:')
    for name, _ in survived:
        print(f'  - {name}')
print(f'killed={len(killed)} survived={len(survived)} of {len(MUTANTS)}')
sys.exit(0 if not survived else 1)