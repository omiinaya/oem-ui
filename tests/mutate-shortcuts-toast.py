#!/root/.venvs/mau/bin/python
"""Mutation proof for batch 14: the drawn ⌘K shortcut, the toast
vocabulary (info / loading / action / promise / sticky), and the
dialog's sticky head + foot.

Byte-exact restore, PATTERN ABSENT pre-check, crash counts as kill."""
import subprocess
import sys
from pathlib import Path

ROOT = Path('/root/projects/oem-ui')
HARNESS = [str(ROOT / 'tests/verify-shortcuts-toast.py')]
JS = ROOT / 'src/js/cli-mono.js'
CSS = ROOT / 'src/styles/components.css'
AST = ROOT / 'src/pages/index.astro'
SUITE = ['node', 'tests/run.mjs']

NL = "\n"
TAB = "\t"


def run(cmd, timeout=480):
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True,
                           text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT (counts as kill)'


MUTANTS = [
    # ---- the shortcut ---------------------------------------------------
    ('the shortcut ignores the k key', 'src/js/cli-mono.js',
     "if ((e.key || '').toLowerCase() !== 'k') return;",
     "if (true) return;", 1, 'harness'),
    ('the shortcut never closes what it opened', 'src/js/cli-mono.js',
     TAB * 3 + "if (dlg.open && typeof dlg.close === 'function') dlg.close();" +
     NL + TAB * 3 + "else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();",
     TAB * 3 + "if (false) dlg.close();" + NL + TAB * 3 +
     "else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();",
     1, 'harness'),
    ('the shortcut never opens', 'src/js/cli-mono.js',
     TAB * 3 + "else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();" +
     NL + TAB * 3 + "else if (typeof dlg.show === 'function' && !dlg.open) dlg.show();",
     TAB * 3 + "if (false) dlg.showModal();" + NL + TAB * 3 + "if (false) dlg.show();",
     1, 'harness'),
    # ---- the vocabulary -------------------------------------------------
    ('info severity dropped from the map', 'src/js/cli-mono.js',
     ": severity === 'info' ? 'info'", ": severity === 'never' ? 'info'", 1, 'harness'),
    ('loading severity dropped from the map', 'src/js/cli-mono.js',
     ": severity === 'loading' ? 'loading'", ": severity === 'never' ? 'loading'", 1, 'harness'),
    ('loading never announces aria-busy', 'src/js/cli-mono.js',
     "if (sev === 'loading') box.setAttribute('aria-busy', 'true');",
     "", 1, 'harness'),
    ('info draws no mark', 'src/styles/components.css',
     ".cm-toast--info .cm-toast__mark::before { content: '\\2139\\00a0'; }",
     ".cm-toast--info .cm-toast__mark::before { content: ''; }", 1, 'harness'),
    ('the loading mark stops spinning', 'src/styles/components.css',
     "content: '\\21bb';" + NL + TAB + "display: inline-block;" + NL + TAB +
     "animation: cm-spin 0.9s linear infinite;",
     "content: '\\21bb';" + NL + TAB + "display: inline-block;" + NL + TAB +
     "animation: none;", 1, 'harness'),
    # ---- the action -----------------------------------------------------
    ('the action button is never appended', 'src/js/cli-mono.js',
     "box.appendChild(act);", "void 0;", 1, 'harness'),
    ('the action callback never runs', 'src/js/cli-mono.js',
     "if (typeof el.__cmAction === 'function') el.__cmAction();",
     "if (false) el.__cmAction();", 1, 'harness'),
    ('the action does not retire its toast', 'src/js/cli-mono.js',
     "el.__cmAction();" + NL + TAB + TAB + TAB + TAB + "dismiss(el);",
     "el.__cmAction();" + NL + TAB + TAB + TAB + TAB + "void 0;", 1, 'harness'),
    ('the action floats to the wrong edge', 'src/styles/components.css',
     ".cm-toast__action {" + NL + TAB + "margin-left: auto;",
     ".cm-toast__action {", 1, 'harness'),
    # ---- promise --------------------------------------------------------
    ('promise exports nothing', 'src/js/cli-mono.js',
     "toast.promise = toastPromise;", "void 0;", 1, 'harness'),
    ('promise settles every outcome as err', 'src/js/cli-mono.js',
     "node.className = 'cm-toast cm-alert--' + (ok ? 'ok' : 'err');",
     "node.className = 'cm-toast cm-alert--' + (ok ? 'err' : 'err');", 1, 'harness'),
    ('sticky opt-in ignored - the timer runs anyway', 'src/js/cli-mono.js',
     "if (opts && opts.sticky) life = 0;", "if (false) life = 0;", 1, 'harness'),
    # ---- the sticky chrome ----------------------------------------------
    ('the dialog head stops sticking', 'src/styles/components.css',
     "side variant. */" + NL + TAB + "position: sticky;" + NL + TAB +
     "top: 0;" + NL + TAB + "background: var(--bg-2);",
     "side variant. */", 1, 'harness'),
    ('the dialog foot stops sticking', 'src/styles/components.css',
     "paints. */" + NL + TAB + "position: sticky;" + NL + TAB + "bottom: 0;",
     "paints. */" + NL + TAB + "bottom: 0;", 1, 'harness'),
    # ---- the showcase binding (suite contract) ---------------------------
    ('a hand-written toast loses its binding attribute', 'src/pages/index.astro',
     'class="cm-toast cm-toast--info" data-cm-toast',
     'class="cm-toast cm-toast--info"', 1, 'suite'),
]


def main():
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
        sys.exit(0)

    rc, out = run(SUITE)
    if 'FAIL' in out or rc != 0:
        print('baseline suite not green; aborting')
        sys.exit(2)
    print('baseline suite green', end=' ')
    rc, out = run(HARNESS + ['--baseline'], timeout=300)
    if '0 failed' not in out:
        print('\nbaseline harness not green; aborting')
        sys.exit(2)
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
            results.append((label, killed, 'FAIL-line' if killed and 'build broke' not in out
                            else ('build broke' if 'build broke' in out else 'SURVIVED')))
            print(('  killed' if killed else '  SURVIVED'), '-', label, '::',
                  ('FAIL-line' if killed and 'build broke' not in out else
                   ('build broke' if 'build broke' in out else 'harness green')))
    finally:
        for rel, text in saved.items():
            (ROOT / rel).write_text(text)
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT,
                       capture_output=True, text=True, timeout=180)

    killed = sum(1 for _, k, _ in results if k)
    survived = sum(1 for _, k, _ in results if not k)
    print(f'\nkilled={killed} survived={survived} of {len(results)}')
    print('MUTATION PROOF', 'PASS' if survived == 0 else 'FAIL')
    sys.exit(0 if survived == 0 else 1)


if __name__ == '__main__':
    main()
