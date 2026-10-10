#!/root/.venvs/mau/bin/python
"""Mutation proof for the chart family.

The same rules as tests/mutate-navmenu-sub.py, restated because a proof
file that only shows a clean run proves nothing:

- every pattern is pre-flighted with --scan and the run ABORTS if one is
  absent or ambiguous (count != 1), rather than silently not mutating;
- dist is rebuilt in EVERY mutant window - the harness drives the page,
  so the served build must match the source under test;
- the file is snapshotted before the mutation and restored with `cp`,
  never `git checkout --` (this worktree is shared with other batches);
- a crashed or timed-out suite/harness is a KILL, never a survival: only
  rc == 0 survives, and the kill count and the closing summary are read
  from the same `killed` variable;
- a non-zero build exit is a KILL too (the mutant broke the build, so
  nothing about it can be green), and the build runs in every window;
- a final build restores a clean dist.

The `who` field names the oracle EXPECTED to kill each pattern, decided
by reading which layer can SEE the change. Both oracles are run for
every pattern regardless, so the recorded verdict is measured rather
than assumed - `who` is the prediction the run then checks.

Why these seven and not more:

- `delete a chart type` and `remove a specimen` are the two ways a type
  can vanish (the dispatcher, or the markup), and they are killed by
  DIFFERENT layers: the dispatcher by the harness reading the marks, the
  specimen by the suite's dead-class rule as well.
- The axis mutant drops the TOP tick rather than shifting every tick:
  a shift that keeps 0 and keeps the top still prints round numbers and
  still sits above the tallest point, so it is an equivalent mutant and
  is not claimed. Dropping the top tick is the change a reader can see:
  the top gridline falls below the tallest column.
- The grid mutant deletes the horizontal gridlines but leaves `.cm-chart__grid`
  rendered by the radar's ring polygons, so the suite's dead-class rule
  cannot be what kills it - only the harness counting gridlines against
  y ticks can.
- The theme mutant hardcodes the SERIES property (the one the mark, the
  gradient stop, the legend dot and the tooltip dot all read), which is
  the binding the scoped light-theme claim exists to prove. A literal
  survives every per-element check - the dot still equals the mark - and
  is caught only by the light/dark PAINT comparison.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path('/root/.hermes/cache/scratch')
BUILD = ['npm', 'run', 'build']
SUITE = ['node', 'tests/run.mjs']
HARNESS = ['/root/.venvs/mau/bin/python', 'tests/verify-chart.py']

JS = 'src/js/cli-mono.js'
ASTRO = 'src/pages/index.astro'

PATTERNS = [
    # ---- the type can vanish from the dispatcher or from the page ----
    ('delete a chart type: radar falls through to the cartesian drawer',
     JS,
     "cfg.type === 'radar' ? chRadar(cfg, w, h)",
     "cfg.type === 'radar__' ? chRadar(cfg, w, h)",
     'suite+harness'),

    ('remove a specimen: the radar figure is never rendered',
     ASTRO,
     '<Fragment set:html={CHARTS.radar} />',
     '',
     'suite+harness'),

    # ---- axis math ----
    ('break the axis math: the top tick falls off the ladder',
     JS,
     "for (var t = 0; t <= nice.max + nice.step / 1000; t += nice.step) ticks.push(Math.round(t * 1e6) / 1e6);",
     "for (var t = 0; t < nice.max; t += nice.step) ticks.push(Math.round(t * 1e6) / 1e6);",
     'harness'),

    # ---- the accessible layer ----
    ('remove the accessible role: the svg stops announcing itself as an image',
     JS,
     '\'\" role=\"img\" aria-labelledby=\"\'',
     '\'\" aria-labelledby=\"\'',
     'harness'),

    # ---- structure ----
    ('delete the cartesian grid',
     JS,
     "s += '<g>' + gi + '</g>';",
     "s += '<g></g>';",
     'harness'),

    # ---- the tooltip hit-test ----
    ('break the tooltip hit-test: no target is ever under the pointer',
     JS,
     "var hit = e.target.closest ? e.target.closest('[data-cm-band],[data-cm-slice]') : null;",
     "var hit = null;",
     'harness'),

    # ---- theme-token binding ----
    ('delete the theme-token binding: the series colour is a literal',
     JS,
     "return '--cm-chart-' + chIdent(s.key) + ':var(--chart-c' + s.tone + ')';",
     "return '--cm-chart-' + chIdent(s.key) + ':#808080';",
     'harness'),
]


def run(cmd, timeout=900):
    """capture_output must NOT be used on the build: npm's inherited
    stdio lives in the capture machinery and crashes it."""
    p = subprocess.run(cmd, cwd=ROOT, timeout=timeout, capture_output=True)
    out = p.stdout.decode('utf8', 'replace')
    return p.returncode, out


def scan():
    bad = 0
    for name, rel, pat, _mut, _who in PATTERNS:
        n = (ROOT / rel).read_text().count(pat)
        if n != 1:
            print(f'PATTERN AMBIGUOUS/ABSENT ({n}) - {name}')
            bad += 1
    print(f'{len(PATTERNS) - bad}/{len(PATTERNS)} patterns present')
    return 1 if bad else 0


def main():
    if '--scan' in sys.argv:
        return scan()

    # pre-flight BEFORE touching anything
    if scan():
        print('ABORT: no mutation run without a full pre-flight')
        return 2

    SCRATCH.mkdir(parents=True, exist_ok=True)

    rc, _ = run(BUILD)
    if rc != 0:
        print('KILL: baseline build failed')
        return 2
    rc, out = run(SUITE)
    if rc != 0 or ' 0 failed' not in out:
        print(f'KILL: baseline suite not green:\n{out[-2000:]}')
        return 2
    rc, out = run(HARNESS)
    if rc != 0:
        print(f'KILL: baseline harness not green:\n{out[-2000:]}')
        return 2
    print('baseline build green | baseline suite green | baseline harness green',
          flush=True)

    killed = survived = 0
    results = []
    for name, rel, pat, mut, who in PATTERNS:
        target = ROOT / rel
        snap = SCRATCH / f'mutate-chart-{rel.replace("/", "_")}.bak'
        subprocess.run(['cp', str(target), str(snap)], check=True)  # snapshot BEFORE mutating
        original = target.read_text()
        assert original.count(pat) == 1, f'PATTERN ABSENT for {name}'
        target.write_text(original.replace(pat, mut, 1))
        try:
            verdicts = {}
            rc_build, _ = run(BUILD)
            if rc_build != 0:
                # a mutant that will not build cannot be green anywhere
                verdicts['build'] = rc_build
            else:
                rc_s, _ = run(SUITE)
                verdicts['suite'] = rc_s
                rc_h, _ = run(HARNESS)
                verdicts['harness'] = rc_h
            # rc != 0 is a kill WHETHER a FAIL line was printed or the run
            # crashed midway. Only rc == 0 survives.
            if verdicts and all(v == 0 for v in verdicts.values()):
                print(f'  SURVIVED - {name} ({who}) {verdicts}', flush=True)
                survived += 1
                results.append(('SURVIVED', name, who, verdicts))
            else:
                bad = [k for k, v in verdicts.items() if v != 0]
                print(f'  killed - {name} ({who}) by {bad or ["build"]} {verdicts}',
                      flush=True)
                killed += 1
                results.append(('killed', name, who, verdicts))
        except subprocess.TimeoutExpired:
            print(f'  killed (timeout) - {name}', flush=True)
            killed += 1
            results.append(('killed(timeout)', name, who, {}))
        except Exception as e:
            print(f'  killed (CRASH) - {name}: {e}', flush=True)
            killed += 1
            results.append(('killed(crash)', name, who, {}))
        finally:
            subprocess.run(['cp', str(snap), str(target)], check=True)  # restore with cp, verified below
            restored = target.read_text()
            assert restored == original, f'RESTORE FAILED for {name}'
            snap.unlink(missing_ok=True)

    total = killed + survived
    print(f'killed={killed} survived={survived} of {total}', flush=True)
    for verdict, name, who, verdicts in results:
        print(f'  {verdict}: {name} [predicted {who}] {verdicts}', flush=True)
    run(BUILD)                             # rebuild a clean dist
    # one variable, one summary: killed is what this line prints
    return 1 if survived else 0


if __name__ == '__main__':
    sys.exit(main())
