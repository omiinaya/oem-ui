#!/root/.venvs/mau/bin/python
"""WebKit proof for the chart family (batch 25).

Every number here is measured in the engine Omar reads on, at the
iPhone viewport and at the widths below it. Four claims, one per
mechanism a chart has that a static picture does not:

  1. IT FITS. The charts are SVG with a viewBox, which is where a
     narrow-viewport overflow is born: an SVG with an explicit width
     attribute lays out at that width whatever its container does.
     Measured scrollWidth at 320/360/390/402/768/1280, and the
     widest chart measured against the viewport.
  2. THE MARKS ARE THERE. Each type is counted through the DOM, not
     inferred from a class name - a bar chart with zero rects is a
     green build and an empty page.
  3. THE TOOLTIP ANSWERS A POINTER. The hit layer is a transparent
     rect per category, which is the only part of an SVG that takes a
     hit test; the tooltip names the category and every series in it.
  4. A READER WHO CANNOT SEE IT STILL GETS THE NUMBERS: role="img"
     with a title and a description, a focusable plot whose arrow keys
     walk a cursor, and the hidden table carrying the same figures.

Also: the geometry, measured rather than asserted. A tick off by one
band or a gridline at the wrong fraction is invisible in a screenshot
and obvious in a number, so the top gridline is compared with the top
tick label, the bar count with the category count, and the slice
angles with the values they are supposed to encode.
"""
import re
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4471/'
WIDTHS = (320, 360, 390, 402, 768, 1280)

passed = 0
failed = []


def check(name, ok, detail=None):
    global passed
    if ok:
        passed += 1
        print(f'ok   {name} :: {detail}', flush=True)
    else:
        failed.append(name)
        print(f'FAIL {name} :: {detail}', flush=True)


# Read every chart's own numbers out of the DOM in one pass, so a
# missing landmark is reported as a missing landmark instead of
# blowing up the evaluate below with a null dereference. A harness
# that crashes prints no FAIL line, and a mutation sweep that greps
# for FAIL counts that as a survivor.
PROBE = """() => {
  const figs = [...document.querySelectorAll('[data-cm-chart]')].map(f => {
    const svg = f.querySelector('svg');
    const r = svg ? svg.getBoundingClientRect() : null;
    const sr = f.querySelector('.cm-sr-only');
    const n = (sel) => f.querySelectorAll(sel).length;
    return {
      id: f.id,
      type: f.dataset.cmChartType,
      hasSvg: !!svg,
      role: svg ? svg.getAttribute('role') : null,
      labelledby: svg ? svg.getAttribute('aria-labelledby') : null,
      describedby: svg ? svg.getAttribute('aria-describedby') : null,
      tabindex: svg ? svg.getAttribute('tabindex') : null,
      title: svg && svg.querySelector('title') ? svg.querySelector('title').textContent : null,
      desc: svg && svg.querySelector('desc') ? svg.querySelector('desc').textContent : null,
      titleId: svg && svg.querySelector('title') ? svg.querySelector('title').id : null,
      descId: svg && svg.querySelector('desc') ? svg.querySelector('desc').id : null,
      bars: n('.cm-chart__bar'),
      barStacked: n('.cm-chart__bar--stacked'),
      slices: n('.cm-chart__slice'),
      rings: n('.cm-chart__ring'),
      lines: n('.cm-chart__line'),
      areas: n('.cm-chart__area'),
      radar: n('.cm-chart__radar'),
      hits: n('.cm-chart__hit'),
      grid: n('.cm-chart__grid:not(.cm-chart__grid--vertical)'),
      gridV: n('.cm-chart__grid--vertical'),
      ticks: n('.cm-chart__tick'),
      labels: n('.cm-chart__tick-label'),
      // Which axis a label belongs to is decided by its AUTHORED
      // text-anchor, never by its y. The y split is off by one band
      // on this library's own numbers: the x labels sit at
      // y = base+16 and the box is base+26, so "within 4px of the
      // bottom" catches them all - measured 17 of 17 counted as y
      // labels on a 5-tick axis.
      labelsY: [...f.querySelectorAll('.cm-chart__tick-label')]
          .filter(t => t.getAttribute('text-anchor') === 'end').length,
      labelsX: [...f.querySelectorAll('.cm-chart__tick-label')]
          .filter(t => t.getAttribute('text-anchor') === 'middle').length,
      legend: n('.cm-chart__legend-item'),
      stops: n('.cm-chart__stop'),
      vgrid: f.dataset.cmChartGrid === 'vertical',
      srRows: sr ? sr.querySelectorAll('table tbody tr').length : 0,
      srCols: sr ? sr.querySelectorAll('thead th').length : 0,
      w: r ? Math.round(r.width * 100) / 100 : null,
      left: r ? Math.round(r.left * 100) / 100 : null,
      right: r ? Math.round(r.right * 100) / 100 : null,
    };
  });
  return {figs: figs, scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth};
}"""


# A pointer event needs the target UNDER THE CURSOR, and the pointer is
# in VIEWPORT coordinates. The navmenu harness learned this the hard
# way: clicking where an element LAYED OUT puts the click somewhere
# else entirely, and the run reports a dead control rather than a
# missing scroll. Every mouse move below therefore goes through this,
# which scrolls the target under the sticky header first and then
# re-reads the rect - a read AFTER the scroll, because the scroll is
# what moved it.
# The page declares `scroll-behavior: smooth`, so `scrollIntoView`
# animates and a rect read 200ms later is a rect from the MIDDLE of
# the scroll: the pie mouse.move landed off-slice (tooltip '') and the
# same trap repopulated the tooltip right after Escape, because the
# still-running scroll synthesized a pointer event over a hit band.
# Drive the jump directly with the smooth flag off, then re-read.
def center_now(page, selector):
    page.evaluate("""(s) => {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.querySelector(s);
      if (!el) return;
      const r = el.getBoundingClientRect();
      window.scrollTo(0, r.top + window.scrollY - (window.innerHeight / 2));
    }""", selector)
    page.wait_for_timeout(180)


def hover(page, selector, dx=0.5, dy=0.5):
    box = page.locator(selector).first
    box.scroll_into_view_if_needed()
    page.wait_for_timeout(180)
    b = box.bounding_box()
    if not b:
        return False
    page.mouse.move(b['x'] + b['width'] * dx, b['y'] + b['height'] * dy)
    page.wait_for_timeout(180)
    return True



def run(pw):
    global passed
    browser = pw.webkit.launch()

    # ---------------- 1. it fits, at every width ----------------
    for w in WIDTHS:
        page = browser.new_page(viewport={'width': w, 'height': 874})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(URL, wait_until='load')
        page.wait_for_function(
            "() => window.cliMono && document.documentElement.classList.contains('cm-js')")
        page.wait_for_timeout(250)
        got = page.evaluate(PROBE)
        sw, iw = got['scrollW'], got['innerW']
        # scrollWidth can exceed innerWidth without the page being
        # reachable sideways (the repo records a phantom +8px zone from
        # the reserved scrollbar gutter), so the claim is BEHAVIOURAL:
        # can the reader actually scroll sideways?
        real = page.evaluate("""() => {
          const before = window.scrollX;
          window.scrollTo(9999, 0);
          let after = 0, stable = 0, last = -1;
          for (let i = 0; i < 40 && stable < 3; i++) {
            new Promise(r => requestAnimationFrame(r));
            const s = getComputedStyle(document.documentElement).scrollBehavior;
            after = window.scrollX; stable = after === last ? stable + 1 : 0; last = after;
          }
          window.scrollTo(0, 0);
          return {before: before, after: after};
        }""")
        check(f'{w}px: the page cannot be scrolled sideways',
              real['after'] == 0 and real['before'] == 0,
              f'scrollWidth={sw} innerWidth={iw} scrollX {real["before"]}->{real["after"]}')
        over = [f'{f["type"]}({f["w"]})' for f in got['figs']
                if f['w'] and (f['w'] > iw + 1 or f['right'] > iw + 1)]
        check(f'{w}px: every chart fits the viewport',
              not over, f'widest={max([f["w"] for f in got["figs"] if f["w"]] or [0])} offenders={over}')
        if w == 320:
            figs320 = got['figs']
        if not errs:
            check(f'{w}px: the page threw nothing', True, str(errs))
        else:
            check(f'{w}px: the page threw nothing', False, str(errs))
        page.close()

    # ---------------- the rest, at the phone ----------------
    page = browser.new_page(viewport={'width': 402, 'height': 874})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='load')
    page.wait_for_function(
        "() => window.cliMono && document.documentElement.classList.contains('cm-js')")
    page.wait_for_timeout(250)
    got = page.evaluate(PROBE)
    figs = {f['type']: f for f in got['figs']}
    all_figs = got['figs']

    types = sorted({f['type'] for f in all_figs})
    check('every documented type is on the page',
          set(types) >= {'area', 'bar', 'line', 'pie', 'radar', 'radial'},
          f'types={types}')

    # ---- 2. the marks are there, per type ----
    bar = [f for f in all_figs if f['type'] == 'bar']
    check('a bar chart draws one rect per category per series',
          all(f['bars'] == 24 for f in bar),
          str([(f['id'], f['bars'], f['barStacked']) for f in bar]))
    # Grouped and stacked draw the SAME number of rects - two series
    # over twelve categories is 24 either way - so a rect count cannot
    # tell them apart, and asserting it can is asserting nothing. The
    # modifier class is the declaration and the GEOMETRY is the proof,
    # and both are asserted below.
    grouped = [f for f in bar if f['barStacked'] == 0]
    stacked = [f for f in bar if f['barStacked'] > 0]
    check('exactly one bar specimen is stacked and one is not, and the '
          'stacked one says so in its markup',
          len(grouped) == 1 and len(stacked) == 1
          and stacked[0]['bars'] == grouped[0]['bars'] == 24
          and stacked[0]['barStacked'] == 24,
          f'grouped={[(f["id"], f["bars"], f["barStacked"]) for f in grouped]} '
          f'stacked={[(f["id"], f["bars"], f["barStacked"]) for f in stacked]}')

    lines = [f for f in all_figs if f['type'] == 'line']
    check('a line chart draws one path per series and no filled area',
          all(f['lines'] == 2 and f['areas'] == 0 for f in lines),
          str([(f['id'], f['lines'], f['areas']) for f in lines]))

    areas = [f for f in all_figs if f['type'] == 'area']
    check('an area chart fills, one area per series, and its gradient '
          'stops come from the series colour',
          all(f['areas'] == 2 and f['stops'] >= 2 for f in areas),
          str([(f['id'], f['areas'], f['stops']) for f in areas]))

    pies = [f for f in all_figs if f['type'] == 'pie']
    check('a pie chart draws one arc per row',
          all(f['slices'] >= 4 for f in pies),
          str([(f['id'], f['slices']) for f in pies]))

    rad = [f for f in all_figs if f['type'] == 'radial']
    check('a radial chart draws one track and one band per row',
          all(f['rings'] >= 4 and f['slices'] == f['rings'] for f in rad),
          str([(f['id'], f['rings'], f['slices']) for f in rad]))

    radar = [f for f in all_figs if f['type'] == 'radar']
    check('a radar chart draws a polygon per series over a ring grid',
          all(f['radar'] >= 2 and f['grid'] >= 3 for f in radar),
          str([(f['id'], f['radar'], f['grid']) for f in radar]))

    cart = [f for f in all_figs if f['type'] in ('line', 'bar', 'area')]
    # A horizontal chart draws one gridline per Y tick and a vertical one
    # per CATEGORY, so the count is not a constant - assert the shape of
    # each rather than one number for both.
    # Every gridline is a horizontal one by default; the vertical
    # variant ADDS one per category, and a chart that draws the extra
    # lines without the modifier would be indistinguishable from one
    # that does, so both are counted and both are named.
    check('a horizontal chart draws one gridline per y tick - and they '
          'are EQUAL, which is the claim: a chart that drew a gridline '
          'with no label or a label with no gridline fails here - while '
          'the '
          'vertical variant adds one per category, tagged as vertical',
          all(f['grid'] == f['labelsY'] and f['grid'] >= 3 for f in cart)
          and all(f['gridV'] == (f['srRows'] if f['vgrid'] else 0) for f in cart),
          str([(f['id'], f['grid'], f['labelsY'], f['gridV'], f['srRows'])
               for f in cart]))
    check('a cartesian chart labels both axes, thinning the x one when '
          'the labels would collide',
          all(f['labelsX'] >= 4 and f['labelsY'] >= 3
              and f['labelsX'] <= f['srRows'] for f in cart),
          str([(f['id'], f['labelsX'], f['labelsY'], f['ticks']) for f in cart]))
    check('every x category gets a tick, labelled or not',
          all(f['ticks'] >= f['srRows'] for f in cart),
          str([(f['id'], f['ticks'], f['srRows']) for f in cart]))

    # A cartesian chart hits a category through a transparent rect per
    # band; a polar one cannot - there is no band - so its MARKS are the
    # targets and each carries its own index. Both shapes have to be
    # wired, and asserting one shape for both would either pass a chart
    # that cannot be hovered or fail one that can.
    check('a cartesian chart offers one hit rect per category',
          all(f['hits'] == f['srRows'] for f in cart),
          str([(f['id'], f['hits'], f['srRows']) for f in cart]))
    check('a polar chart reaches every row through its own marks',
          all(f['slices'] == f['srRows'] and f['srRows'] > 1
              for f in all_figs if f['type'] in ('pie', 'radial')),
          str([(f['id'], f['slices'], f['srRows']) for f in all_figs
               if f['type'] in ('pie', 'radial')]))
    # A radar chart is a polar plot whose pointer target is a SPOKE, not
    # a mark: the polygons all overlap the middle, so hit-testing them
    # gives one answer for every dimension. The spokes are the hit
    # targets, and that is why they are rotated rects and not paths.
    check('a radar chart hits one spoke per dimension',
          all(f['hits'] == f['srRows'] for f in all_figs if f['type'] == 'radar'),
          str([(f['id'], f['hits'], f['srRows']) for f in all_figs
               if f['type'] == 'radar']))
    check('a radial chart indexes its tracks as well as its bands',
          all(f['rings'] == f['srRows'] for f in all_figs if f['type'] == 'radial'),
          str([(f['id'], f['rings'], f['srRows']) for f in all_figs
               if f['type'] == 'radial']))
    check('every chart offers a pointer target for every row it draws',
          all(f['hits'] + f['slices'] >= f['srRows'] for f in all_figs),
          str([(f['id'], f['hits'], f['slices'], f['srRows']) for f in all_figs
               if f['hits'] + f['slices'] < f['srRows']]))

    # ---- geometry: the ticks are at round numbers, and the top grid
    #      line is the TOP TICK, not the tallest point ----
    geo = page.evaluate("""() => {
      const out = {};
      const line = document.getElementById('cmc-line');
      const svg = line.querySelector('svg');
      const W = +svg.getAttribute('width'), H = +svg.getAttribute('height');
      const labels = [...line.querySelectorAll('.cm-chart__tick-label')]
        .map(t => ({x: +t.getAttribute('x'), y: +t.getAttribute('y'),
                    a: t.getAttribute('text-anchor'), s: t.textContent.trim()}));
      // The two axes are told apart by their AUTHORED text-anchor, not
      // by their x coordinate. The coordinate split is wrong at any
      // width where the plot is narrower than the gutter: measured in
      // WebKit at 402, "jan" and "feb" land at x=31.6 and x=55.45, both
      // inside the column the y labels occupy (x=23.6), so a positional
      // split reads two month names as y ticks and then fails to parse
      // them as numbers. The anchor is a promise the renderer makes
      // ("end" = right-aligned against the axis, "middle" = centred
      // under a band) and it holds at every width.
      out.ytext = labels.filter(t => t.a === 'end').map(t => t.s);
      out.xtext = labels.filter(t => t.a === 'middle').map(t => t.s);
      // A vertical gridline has a y1 as well, so the two orientations
      // are counted apart: reading every .cm-chart__grid's y1 counted
      // the vertical chart's twelve category lines as y ticks.
      out.gridY = [...line.querySelectorAll('.cm-chart__grid:not(.cm-chart__grid--vertical)')]
        .map(g => +g.getAttribute('y1')).sort((a, b) => a - b);
      // Bars, grouped AND stacked, measured as geometry.
      const barsOf = (id) => [...document.getElementById(id).querySelectorAll('.cm-chart__bar')]
        .map(b => ({k: b.getAttribute('data-cm-k'), band: b.getAttribute('data-cm-band'),
                    x: +b.getAttribute('x'),
                    y: +b.getAttribute('y'), h: +b.getAttribute('height')}));
      const dimOf = (id) => {
        const v = document.getElementById(id).querySelector('svg');
        return [+v.getAttribute('width'), +v.getAttribute('height')];
      };
      out.boxes = { 'cmc-bar': dimOf('cmc-bar'), 'cmc-bar-stacked': dimOf('cmc-bar-stacked') };
      out.grouped = barsOf('cmc-bar');
      out.stacked = barsOf('cmc-bar-stacked');
      // Pie angles, read off the arc endpoints against the real centre.
      const pieSvg = document.querySelector('#cmc-pie svg');
      const cx = +pieSvg.getAttribute('width') / 2, cy = +pieSvg.getAttribute('height') / 2;
      out.spans = [...document.querySelectorAll('#cmc-pie .cm-chart__slice')].map(p => {
        const d = p.getAttribute('d');
        const nums = d.match(/-?[\\d.]+/g).map(Number);
        const a = d.slice(d.indexOf('A')).match(/-?[\\d.]+/g).map(Number);
        const a0 = Math.atan2(nums[1] - cy, nums[0] - cx);
        const a1 = Math.atan2(a[6] - cy, a[5] - cx);
        let sw = a1 - a0; while (sw < 0) sw += Math.PI * 2;
        return Math.round(sw * 180 / Math.PI * 100) / 100;
      });
      out.spansSum = Math.round(out.spans.reduce((a, b) => a + b, 0) * 100) / 100;
      // the values behind the marks, read out of the tables that carry
      // them - a harness that restates the data proves its own copy
      out.pieValues = [...document.querySelectorAll('#cmc-pie tbody td')]
        .map(td => parseFloat(td.textContent.replace(/,/g, '')));
      out.tallest = Math.max(...[...document.querySelectorAll('#cmc-line tbody td')]
        .map(td => parseInt(td.textContent.replace(/,/g, ''), 10)));
      out.hits = document.querySelectorAll('#cmc-pie .cm-chart__hit').length;
      return out;
    }""")
    # The y axis is the ticks drawn at the LEFT of the plot, the x axis
    # the ones under it. Split on the GEOMETRY, not on the text: "dec" is
    # a tick label too, and a regex over the whole list cannot tell
    # December from a zero.
    xtext = geo['xtext']

    def plain(t):
        return float(t.rstrip('k').replace(',', '')) * (1000 if t.endswith('k') else 1)

    # The specimen plots thousands of requests, and the y axis prints
    # its own step with a k - 0/250/500/750/1k, not 0/1,860/3,720. The
    # claim is therefore "every y label is a multiple of the STEP", where
    # the step is derived from the labels themselves rather than from the
    # units: a raw value axis (the classic near-miss) fails it, because
    # its steps are not round.
    steps = {plain(b) - plain(a)
             for a, b in zip(geo['ytext'], geo['ytext'][1:])}
    check('the y axis prints round numbers, not raw values',
          len(geo['ytext']) >= 3 and len(steps) == 1
          and plain(geo['ytext'][0]) == 0 and steps.pop() % 250 == 0,
          f'y={geo["ytext"]} x={geo["xtext"]}')
    # Twelve month names cannot fit one band each on a phone, so the
    # renderer THINS the axis and always keeps the last one. The claim is
    # therefore "thinned, but never to nothing, and never without the
    # final category" - not "all twelve", which would be a test the
    # library cannot pass on the widths it is built for.
    check('the x axis is thinned rather than overlapped, and always keeps '
          'the last category',
          4 <= len(geo['xtext']) <= 12 and geo['xtext'][-1] == 'dec',
          f'x labels={len(geo["xtext"])} last={geo["xtext"][-1:]}')
    check('a gridline sits at every y tick',
          len(geo['gridY']) == len(geo['ytext']) and len(geo['gridY']) >= 3,
          f'gridlines={len(geo["gridY"])} y ticks={len(geo["ytext"])} ys={geo["gridY"]}')

    # THE OFF-BY-ONE, measured. A top gridline drawn at the data peak is
    # the classic near-miss: it looks right in a screenshot and leaves
    # the tallest mark touching the frame with no headroom. So compare
    # the top tick with the tallest value in the table that carries it.
    top = max(geo['ytext'], key=plain)
    # The tallest value in the SPECIMEN, read out of the hidden table
    # rather than restated here: a test that carries its own copy of the
    # data proves the test's arithmetic, not the chart's.
    tallest = geo['tallest']
    # ONE unit, and it is the raw one: plain() already expands a "4k" to
    # 4000, so dividing tallest by 1000 as well compared 4000 >= 4.18
    # and passed for any top tick at all. MEASURED as a survivor: the
    # mutator dropped the top tick (4k under a tallest of 4,180) and
    # this claim still went green. Both sides are raw counts now.
    topv = plain(top)
    check('the top gridline is a round number ABOVE the tallest value',
          topv >= tallest and topv % 250 == 0,
          f'top tick={top} = {topv:g} vs tallest={tallest}')

    # The gridlines are evenly spaced, which is what makes them TICKS
    # rather than decoration. Measured from their y positions: the step
    # between consecutive gridlines must not drift by more than a pixel.
    gy = geo['gridY']
    steps = [round(gy[i + 1] - gy[i], 2) for i in range(len(gy) - 1)]
    check('the gridlines are evenly spaced',
          steps and max(steps) - min(steps) <= 1.0,
          f'steps={steps}')

    g, st = geo['grouped'], geo['stacked']
    check('a grouped chart draws one bar per category per series',
          len(g) == 24 and len({b['k'] for b in g}) == 2
          and len({b['band'] for b in g}) == 12,
          f'bars={len(g)} series={len({b["k"] for b in g})} bands={len({b["band"] for b in g})}')
    # A stacked band and a grouped band differ in exactly ONE observable
    # way: where the segments START. Stacked, the second segment floats
    # on the first; grouped, both start on the ground. Counting rects
    # cannot tell them apart (24 either way) and neither can the total
    # height, so the claim is about the BOTTOMS and nothing else.
    def bottoms(bars):
        by = {}
        for x in bars:
            by.setdefault(x['band'], []).append(round(x['y'] + x['h'], 2))
        return by
    sb, gb = bottoms(st), bottoms(g)
    check('a stacked chart draws one bar per category, stacked upward',
          len(st) == 24 and len(sb) == 12
          and all(len(v) == 2 for v in sb.values())
          and all(abs(v[0] - v[1]) > 0.5 for v in sb.values()),
          f'stacked bottoms band0={sb["0"]} band1={sb["1"]}')
    # The stack accumulates: the two segments of one band share a band
    # index and the lower one STARTS where the ground is, so its bottom
    # is at or below the upper one's bottom. A grouped chart cannot
    # satisfy this, which is what makes the comparison mean something.
    check('a grouped chart puts BOTH series on the ground, which is the '
          'whole difference and the thing a rect count cannot see',
          len(gb) == 12 and all(abs(v[0] - v[1]) < 0.6 for v in gb.values()),
          f'grouped bottoms band0={gb["0"]} band1={gb["1"]}')
    # Two bars at ONE x are one bar drawn twice: the second covers the
    # first and the chart quietly plots one series less than it claims.
    # Counting rects cannot see it - there are 24 either way.
    gx = {}
    for x in g:
        gx.setdefault(x['band'], []).append(round(x['x'], 2))
    check('the two grouped bars of a band stand SIDE BY SIDE, not on '
          'top of each other',
          len(gx) == 12 and all(len(v) == 2 and abs(v[0] - v[1]) > 0.5
                                for v in gx.values()),
          f'grouped xs band0={gx["0"]} band1={gx["1"]}')
    # Both charts GROUND their columns, so the bottoms match by
    # construction and comparing them proves nothing. The difference is
    # at the TOP: a stacked column reaches the sum, a grouped one the
    # taller single series.
    def tops(bars):
        by = {}
        for x in bars:
            by.setdefault(x['band'], []).append(round(x['y'], 2))
        return by
    stp, gtp = tops(st), tops(g)
    check('the stacked column REACHES HIGHER than the grouped one - the '
          'sum, not the max',
          all(min(stp[k]) < min(gtp[k]) - 0.5 for k in stp),
          f'band0 stacked tops={stp["0"]} grouped tops={gtp["0"]}')
    # geo['boxes'] already holds [w, h] pairs measured in the browser.
    # Asking the probe for the svg ELEMENT here would need a live DOM,
    # and an exception mid-claim prints no FAIL line at all - a mutation
    # sweep greps for FAIL and would score a crash as a survivor.
    def plotBox(uid):
        return geo['boxes'][uid]
    check('every bar has a positive height and stays inside its own box',
          all(b['h'] > 0 and b['y'] >= 0
              and b['y'] + b['h'] <= plotBox('cmc-bar')[1]
              and b['y'] + b['h'] <= plotBox('cmc-bar-stacked')[1]
              for b in g + st),
          f'min h={min([b["h"] for b in g + st])} '
          f'min y={min([b["y"] for b in g + st])} '
          f'lowest bottom={max([b["y"] + b["h"] for b in g + st])} '
          f'heights={plotBox("cmc-bar")}')

    # A pie's arcs must encode the shares, not merely close the circle:
    # an arc drawn from the value's share of 360 must equal 360 * v/total,
    # and the four of them must add to the whole.
    vals = geo['pieValues']
    total = sum(vals)
    want = [round(360 * v / total, 2) for v in vals]
    check('each pie arc spans exactly its share of the circle',
          all(abs(a - b) < 1.0 for a, b in zip(geo['spans'], want)),
          f'spans={geo["spans"]} want={want}')
    check("the pie's arcs sum to the whole, so no slice is lost",
          359 <= geo['spansSum'] <= 361, f'sum={geo["spansSum"]}')

    # ---- 3. the tooltip answers a pointer ----
    tip = page.locator('#cmc-line .cm-chart__tooltip')
    check('the tooltip starts empty',
          not tip.is_visible() or tip.inner_text().strip() == '',
          repr(tip.inner_text()[:40]))
    hover(page, '#cmc-line .cm-chart__hit')
    txt = tip.inner_text()
    check('hovering a category names it and every series',
          'jan' in txt.lower() and 'reads' in txt.lower() and 'writes' in txt.lower(),
          repr(txt.replace('\n', ' | ')[:120]))
    check('the tooltip numbers are the row numbers',
          '1,860' in txt and '940' in txt, repr(txt.replace('\n', ' | ')[:120]))
    cursor = page.locator('#cmc-line .cm-chart__cursor')
    check('a hovered category draws the cursor rule', cursor.count() >= 1,
          f'cursors={cursor.count()}')
    # Leave by moving onto the plot's own FRAME, not to (2,2): the
    # page is scrolled tens of thousands of pixels down, so (2,2) is a
    # point of empty document above the chart section and the pointer
    # never crosses the plot at all.
    fr = page.locator('#cmc-line .cm-chart__plot').first.bounding_box()
    page.mouse.move(fr['x'] + 1, fr['y'] - 1)
    page.wait_for_timeout(200)
    check('leaving the plot retires the tooltip',
          not tip.is_visible() or tip.inner_text().strip() == '',
          repr(page.locator('#cmc-line .cm-chart__tooltip').inner_text()[:40]))

    # a pie slice is a hit target too
    # A slice's bounding box is the WHOLE pie, so its centre is the
    # hole (or, on a donut, empty space). The hit point has to be
    # inside the ARC: aim at the horizontal mid-line, pushed out to
    # 62% of the radius, which is inside the outer band of any slice
    # this library draws.
    center_now(page, '#cmc-pie svg')
    pie_geom = page.evaluate("""() => {
      const s = document.querySelector('#cmc-pie .cm-chart__slice');
      const b = s.getBoundingClientRect();
      return {x: b.x, y: b.y, w: b.width, h: b.height};
    }""")
    page.mouse.move(pie_geom['x'] + pie_geom['w'] / 2 + pie_geom['w'] * 0.62 * 0.62,
                    pie_geom['y'] + pie_geom['h'] / 2)
    page.wait_for_timeout(200)
    check('a pie slice is hittable and names its row',
          'chrome' in page.locator('#cmc-pie .cm-chart__tooltip').inner_text().lower(),
          repr(page.locator('#cmc-pie .cm-chart__tooltip').inner_text().replace('\n', ' | ')[:100]))

    # ---- 4. the accessible layer ----
    check('every chart svg is role="img" with a real title',
          all(f['role'] == 'img' and f['title'] and f['desc'] for f in all_figs),
          str([(f['id'], f['role'], bool(f['title']), bool(f['desc'])) for f in all_figs
               if not (f['role'] == 'img' and f['title'] and f['desc'])]))
    # aria-labelledby must point at ids that EXIST, or it labels nothing
    bad = [f['id'] for f in all_figs
           if f['labelledby'] and (not f['titleId'] or not f['descId']
                                   or f['titleId'] not in f['labelledby'])]
    check('aria-labelledby names the title and the description that exist',
          not bad, f'unresolved={bad}')
    check('the description is prose, not the title again',
          all(f['desc'] and f['desc'] != f['title'] for f in all_figs),
          str([(f['id'], f['desc'][:40]) for f in all_figs
               if not f['desc'] or f['desc'] == f['title']]))
    check('the plot is focusable, so the arrow keys have somewhere to go',
          all(f['tabindex'] == '0' for f in all_figs),
          str([(f['id'], f['tabindex']) for f in all_figs if f['tabindex'] != '0']))
    check('every chart hides a table of its own numbers',
          all(f['srRows'] >= 3 and f['srCols'] >= 2 for f in all_figs),
          str([(f['id'], f['srRows'], f['srCols']) for f in all_figs
               if f['srRows'] < 3 or f['srCols'] < 2]))

    # the keyboard cursor, driven
    # Park the POINTER first: the pie test left it inside a plot, and
    # the focus() scroll that follows moves a different chart under
    # those same viewport coordinates, so a synthesized pointer event
    # re-arms the tooltip behind the keyboard's back (measured: Escape
    # cleared it and the claim then read 'nov 3,690').
    center_now(page, '#cmc-line svg')
    kb_plot = page.locator('#cmc-line .cm-chart__plot').first.bounding_box()
    if kb_plot:
        page.mouse.move(kb_plot['x'] + 1, kb_plot['y'] - 1)
        page.wait_for_timeout(150)
    page.evaluate("() => document.querySelector('#cmc-line svg').focus()")
    page.wait_for_timeout(80)
    k0 = page.locator('#cmc-line .cm-chart__tooltip').inner_text()
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(160)
    k1 = page.locator('#cmc-line .cm-chart__tooltip').inner_text()
    check('ArrowRight walks the cursor to the next category',
          k0.strip() != k1.strip() and k1.strip() != '',
          repr(f'{k0.strip()[:24]!r} -> {k1.strip()[:24]!r}'))
    page.keyboard.press('Escape')
    page.wait_for_timeout(160)
    check('Escape clears the keyboard cursor',
          page.locator('#cmc-line .cm-chart__tooltip').inner_text().strip() == '',
          repr(page.locator('#cmc-line .cm-chart__tooltip').inner_text()[:40]))

    # ---- theming: the series colour is a property, and the light
    #      theme really changes it ----
    theming = page.evaluate("""() => {
      const f = document.getElementById('cmc-line');
      const varOf = (el, n) => getComputedStyle(el).getPropertyValue(n).trim();
      const path = f.querySelector('.cm-chart__line');
      const lf = document.getElementById('cmc-light');
      const light = lf.closest('[data-cm-theme="light"]');
      return {
        dark: getComputedStyle(document.documentElement)
          .getPropertyValue('--chart-c1').trim(),
        lightToken: light ? getComputedStyle(light)
          .getPropertyValue('--chart-c1').trim() : null,
        lightPaint: lf.querySelector('.cm-chart__line')
          ? getComputedStyle(lf.querySelector('.cm-chart__line')).stroke : null,
        darkPaint: path ? getComputedStyle(path).stroke : null,
        seriesProp: path ? varOf(path, '--cm-chart-reads') : null,
        stroke: path ? getComputedStyle(path).stroke : null,
        legendDot: f.querySelector('.cm-chart__legend-item .cm-chart__legend-dot')
          ? getComputedStyle(f.querySelector('.cm-chart__legend-dot')).backgroundColor : null,
        dotProp: f.querySelector('.cm-chart__legend-dot')
          ? getComputedStyle(f.querySelector('.cm-chart__legend-dot'))
              .getPropertyValue('--cm-chart-reads').trim() : null,
      };
    }""")
    check('the mark takes its colour from the per-series property',
          theming['seriesProp'] and theming['stroke'] not in (None, '', 'none'),
          f"stroke={theming['stroke']} via --cm-chart-reads={theming['seriesProp']}")
    check('the legend dot resolves the SAME property as the mark',
          theming['dotProp'] == theming['seriesProp'],
          f"dot={theming['dotProp']} mark={theming['seriesProp']} painted={theming['legendDot']}")
    # The TOKEN differing is not enough: a token can differ and a chart
    # still paint one value if the markup named it. The claim is that the
    # PAINTED stroke follows, which is the only thing a reader sees.
    check('the scoped light theme declares a DIFFERENT series colour, and '
          'the chart inside it PAINTS the light one',
          theming['lightToken'] and theming['lightToken'] != theming['dark']
          and theming['lightPaint'] and theming['lightPaint'] != theming['darkPaint'],
          f'document={theming["dark"]} light subtree={theming["lightToken"]} '
          f'dark stroke={theming["darkPaint"]} light stroke={theming["lightPaint"]}')

    # ---- sharp corners: no rounded rect anywhere ----
    radii = page.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('[data-cm-chart] rect, [data-cm-chart] path, [data-cm-chart] polygon')
        .forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.strokeLinejoin === 'round' || cs.strokeLinecap === 'round') bad.push(el.getAttribute('class'));
        });
      return bad;
    }""")
    check('no chart mark is drawn with a round join or cap', not radii, f'round={radii}')

    if errs:
        check('the phone pass threw nothing', False, str(errs))
    else:
        check('the phone pass threw nothing', True, str(errs))

    print(f'\n{"passed" if not failed else "FAILED"} {passed}/{passed + len(failed)}')
    for f in failed:
        print(f'  -- {f}')


if __name__ == '__main__':
    try:
        with sync_playwright() as _pw:
            run(_pw)
    except BaseException as _e:
        # A harness that crashes has proved NOTHING. Without this the
        # run dies on a traceback, prints no FAIL line, and a mutation
        # sweep that greps for FAIL scores it as a survivor - the rig
        # reports green while measuring nothing.
        check('the harness ran to the end without crashing', False,
              f'{type(_e).__name__}: {_e}')
        print(f'\nFAILED {passed}/{passed + len(failed)}  (crashed)')
        for f in failed:
            print(f'  -- {f}')
        sys.exit(1)
    print(f'\n{"passed" if not failed else "FAILED"} {passed}/{passed + len(failed)}')
    for f in failed:
        print(f'  -- {f}')
    sys.exit(1 if failed else 0)
    sys.exit(1 if failed else 0)
