#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 4: the outline button and the range slider.

Driven like a reader: load, look at what the runtime painted, press a
key, hover a button. Everything is MEASURED - computed styles and live
values - never asserted from the source.
"""
import sys, pathlib, struct, zlib
from playwright.sync_api import sync_playwright

def load_png(path):
    """Read a screenshot with the standard library alone.

    Pillow is importable here only through PYTHONPATH, and that build's
    C extension belongs to a different interpreter than Playwright's -
    `import PIL.Image` dies with `cannot import name '_imaging'`. A PNG
    the browser just wrote is a fixed, known shape (8-bit, non-interlaced
    RGB/RGBA), so decoding it is a handful of lines and removes a
    dependency that cannot be trusted.
    """
    data = pathlib.Path(path).read_bytes()
    pos, idat = 8, b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype, _c, _f, inter = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    if depth != 8 or inter != 0:
        raise AssertionError('unexpected PNG shape: depth=%d interlace=%d' % (depth, inter))
    nch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * nch
    out = bytearray(stride * h)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if f == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x - nch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                b = prev[x]
                c = prev[x - nch] if x >= nch else 0
                pr_ = a + b - c
                pa, pb, pc = abs(pr_ - a), abs(pr_ - b), abs(pr_ - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                line[x] = (line[x] + pr) & 255
        elif f != 0:
            raise AssertionError('unknown PNG filter %d' % f)
        out[y * stride:(y + 1) * stride] = line
        prev = line
    def get(x, y):
        o = (y * w + x) * nch
        return (out[o], out[o + 1], out[o + 2])
    return w, h, get

ROOT = pathlib.Path('/root/projects/oem-ui')
URL = 'http://192.168.1.68:4461/'
SHOT = pathlib.Path('/root/.hermes/cache/scratch/_slider.png')
results, problems = [], []

def check(name, ok, detail=''):
    (results if ok else problems).append(name)
    print(('  ok  ' if ok else 'FAIL  ') + name + (' :: ' + detail if detail and not ok else ''))
    return ok

def pct(s):
    try:
        return float(str(s).replace('%', ''))
    except Exception:
        return None

LINE, INK = (38, 38, 38), (232, 232, 232)

def near(a, b, tol=14):
    return all(abs(x - y) <= tol for x, y in zip(a, b))

def probe(page):
    """Screenshot the slider and measure rail, fill and thumb in pixels.

    WebKit answers getComputedStyle(el, '::-webkit-slider-*') with empty
    strings for every property, so the rendered pixels are the only
    instrument that can see a rail at all.
    """
    # Element screenshot rather than a page-level clip: the slider sits
    # far below the fold, and a `clip` box is validated against the
    # captured image - which is the viewport - so it has to be computed
    # by the framework instead of by hand from getBoundingClientRect().
    box = page.eval_on_selector('#f-vol', """el => {
        const r = el.getBoundingClientRect();
        return {x: r.x, y: r.y, width: r.width, height: r.height};
    }""")
    page.locator('#f-vol').screenshot(path=str(SHOT))
    w, h, px = load_png(SHOT)
    rail_rows = [y for y in range(h)
                 if sum(1 for x in range(w) if near(px(x, y), LINE)) > w * 0.6]
    out = {'box': box, 'rail_rows': rail_rows}
    if not rail_rows:
        return out
    top, bot = rail_rows[0], rail_rows[-1]
    mid = top + (bot - top) // 2
    xs = [x for x in range(w) if near(px(x, mid), LINE)]
    x0, x1 = xs[0], xs[-1]
    fill = 0
    for x in range(x0 + 1, x1):
        if near(px(x, mid), INK):
            fill += 1
        else:
            break
    out.update(rail_top=top, rail_bot=bot, rail_h=bot - top + 1,
               fill_px=fill, inner_w=x1 - x0 - 1)
    # the thumb is taller than the rail, so it shows above it
    thumb_rows = [y for y in range(max(0, top - 8), top)
                  if sum(1 for x in range(w) if near(px(x, y), INK)) >= 4]
    if thumb_rows:
        y0 = thumb_rows[0]
        tx = [x for x in range(w) if near(px(x, y0), INK)]
        out.update(thumb_top=y0, thumb_w=tx[-1] - tx[0] + 1,
                   # the extreme corners: a round thumb loses exactly these
                   thumb_corner=px(tx[0], y0),
                   thumb_corner2=px(tx[-1], y0))
    return out

with sync_playwright() as pw:
    b = pw.webkit.launch()
    page = b.new_page(viewport={'width': 402, 'height': 667}, has_touch=True)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    # The showcase module executes after networkidle, so reading the fill
    # straight after goto raced it and reported an empty variable as a
    # product failure. Wait for the runtime to boot and paint.
    page.wait_for_function("() => !!window.cliMono", timeout=15000)
    check('the runtime boots (window.cliMono)', True)
    # The boot paint is an assertion, not a prerequisite: if init() never
    # reaches the slider, waiting quietly for 15s and dying in a traceback
    # reports the mutant as killed with no reason attached, which is the
    # shape of a test nobody can debug.
    try:
        page.wait_for_function(
            "!!document.querySelector('#f-vol') && "
            "!!document.querySelector('#f-vol').style.getPropertyValue('--cm-slider')",
            timeout=15000)
        check('init paints the fill at boot', True)
    except Exception as e:
        check('init paints the fill at boot', False, str(e).splitlines()[0][:140])

    # --- the slider is a real input, painted at load ------------------
    st = page.evaluate("""() => {
        const el = document.querySelector('input.cm-slider');
        if (!el) return {missing: true};
        return {
            missing: false,
            tag: el.tagName, type: el.type,
            min: el.min, max: el.max, value: el.value,
            fill: el.style.getPropertyValue('--cm-slider'),
            out: (el.closest('.cm-field').querySelector('output') || {}).textContent,
            box: el.getBoundingClientRect().width
        };
    }""")
    check('the slider is a native input[type=range]', st.get('tag') == 'INPUT' and st.get('type') == 'range')
    # init() must paint the declared 30 out of 1..90 without any input
    want = (30 - 1) / (90 - 1) * 100
    got = pct(st.get('fill'))
    check('init paints the fill from the value alone', got is not None and abs(got - want) < 0.5,
          'fill=%s want~%.2f' % (st.get('fill'), want))
    check('the fill readout matches the value', st.get('out') == '30', 'out=%r' % st.get('out'))
    check('the rail spans the field', st.get('box', 0) > 200, 'box=%r' % st.get('box'))

    # --- pixels: rail framed, fill sized, thumb square ----------------
    m = probe(page)
    check('the rail is framed (a 10px band of --line, not bare bg)',
          bool(m.get('rail_rows')) and 8 <= m.get('rail_h', 0) <= 14,
          'rail rows=%r' % m.get('rail_rows'))
    if 'fill_px' in m:
        expect = m['inner_w'] * want / 100
        check('the painted fill matches the value in pixels',
              abs(m['fill_px'] - expect) <= 4,
              'fill=%dpx want~%.1fpx of %dpx' % (m['fill_px'], expect, m['inner_w']))
        check('the thumb is a square of ink riding the rail',
              8 <= m.get('thumb_w', 0) <= 14 and near(m.get('thumb_corner', (0,)), INK),
              'thumb_w=%r corner=%r' % (m.get('thumb_w'), m.get('thumb_corner')))
        check('the thumb keeps its corners (a round thumb loses them)',
              near(m.get('thumb_corner', (0,)), INK)
              and near(m.get('thumb_corner2', (0,)), INK),
              'corners=%r %r' % (m.get('thumb_corner'), m.get('thumb_corner2')))

    # --- keyboard drives the fill (delegated input listener) ----------
    page.focus('#f-vol')
    before = page.evaluate("document.querySelector('#f-vol').value")
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(60)
    after = page.evaluate("""() => {
        const el = document.querySelector('#f-vol');
        return {value: el.value, fill: el.style.getPropertyValue('--cm-slider'),
                out: el.closest('.cm-field').querySelector('output').textContent};
    }""")
    want2 = (float(after['value']) - 1) / (90 - 1) * 100
    check('ArrowRight moves the native value', after['value'] != before, '%s -> %s' % (before, after['value']))
    got2 = pct(after['fill'])
    check('the fill follows the key press', got2 is not None and abs(got2 - want2) < 0.5,
          'fill=%s want~%.2f' % (after['fill'], want2))
    check('the readout follows the key press', after['out'] == after['value'],
          'out=%r value=%r' % (after['out'], after['value']))
    m2 = probe(page)
    if 'fill_px' in m2:
        expect2 = m2['inner_w'] * want2 / 100
        check('the painted fill moves with the key press',
              abs(m2['fill_px'] - expect2) <= 4,
              'fill=%dpx want~%.1fpx' % (m2['fill_px'], expect2))

    # --- the outline button inverts on hover --------------------------
    # Scroll it into the viewport first: a hover fired at a coordinate
    # below the fold silently does nothing, and the assertion then reads
    # the un-hovered style as if it were one.
    page.hover('.cm-btn--outline')
    try:
        page.wait_for_function(
            "() => document.querySelector('.cm-btn--outline').matches(':hover')",
            timeout=5000)
    except Exception:
        # Say WHY before failing: an element covering the button and a
        # pointer that never moved are different product bugs.
        dbg = page.evaluate("""() => {
            const el = document.querySelector('.cm-btn--outline');
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
            return {hover: el.matches(':hover'),
                    rect: [r.x, r.y, r.width, r.height],
                    topElement: hit ? hit.tagName + '.' + hit.className : null};
        }""")
        raise AssertionError('the outline button never entered :hover: %r' % (dbg,))
    page.wait_for_timeout(260)
    after_h = page.evaluate("""() => {
        const el = document.querySelector('.cm-btn--outline');
        const cs = getComputedStyle(el);
        return {bg: cs.backgroundColor, color: cs.color,
                ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
                bgv: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()};

    }""")

    def rgb_of(cssvar):
        s = cssvar.strip()
        if s.startswith('#'):
            s = s.lstrip('#')
            if len(s) == 3:
                s = ''.join(c * 2 for c in s)
            return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))
        if s.startswith('rgb'):
            return tuple(int(float(v)) for v in s[s.index('(') + 1:s.index(')')].split(',')[:3])
        return None
    want_bg = rgb_of(after_h['ink'])
    want_fg = rgb_of(after_h['bgv'])
    got_bg = tuple(int(v) for v in after_h['bg'][after_h['bg'].index('(') + 1:after_h['bg'].index(')')].split(',')[:3]) if 'rgb' in after_h['bg'] else None
    got_fg = tuple(int(v) for v in after_h['color'][after_h['color'].index('(') + 1:after_h['color'].index(')')].split(',')[:3])
    check('the outline button fills with ink on hover', got_bg == want_bg, '%r != %r' % (got_bg, want_bg))
    check('the outline button inverts its text on hover', got_fg == want_fg, '%r != %r' % (got_fg, want_fg))
    check('no page errors while driving the slider', not errs, str(errs[:2]))

    # --- phone layout sanity -----------------------------------------
    side = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check('the page does not scroll sideways at 402px', not side)
    b.close()

print('\n%d passed, %d failed' % (len(results), len(problems)))
sys.exit(1 if problems else 0)
