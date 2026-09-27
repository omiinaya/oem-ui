#!/usr/bin/env python3
"""
Settle the two pixel-level claims the vision pass made about the header:

  1. "the hairline under the sticky header does not span the full width"
  2. "the second nav row is indented further right than the first"

Both are answered by MEASUREMENT, because this reviewer has reported stale
geometry in this repo before - once flagging a rule that a pixel sample showed
to be full-bleed and correct.

No PIL (the system one is broken here; `_imaging` will not import), so this
carries its own PNG decoder.
"""
import struct
import zlib
from playwright.sync_api import sync_playwright

URL = "http://192.168.1.68:4321/"
SHOT = "/root/.hermes/cache/scratch/rail-scan.png"


def png_rows(path):
    """Minimal PNG decoder -> (width, height, rows) where each row is a list of RGB."""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos, idat, w, h, bpp = 8, b"", 0, 0, 3
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), f"unsupported png {depth}/{ctype}"
            bpp = 3 if ctype == 2 else 4
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    out, prev = [], bytearray(stride)
    p = 0
    for _ in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                b = prev[i]
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out.append([tuple(line[i:i + 3]) for i in range(0, stride, bpp)])
        prev = line
    return w, h, out


def main():
    with sync_playwright() as pw:
        b = pw.webkit.launch()
        c = b.new_context(viewport={"width": 390, "height": 844},
                         device_scale_factor=3, is_mobile=True, has_touch=True)
        p = c.new_page()
        p.goto(URL, wait_until="networkidle")
        p.wait_for_timeout(500)
        p.screenshot(path=SHOT)
        geo = p.evaluate("""() => {
            const hdr = document.querySelector('.cm-header').getBoundingClientRect();
            const nav = document.querySelector('.cm-header__nav').getBoundingClientRect();
            const links = Array.from(document.querySelectorAll('[data-cm-nav] .cm-header__link'))
              .map(e => { const r = e.getBoundingClientRect();
                return {t: e.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height}; });
            return {hdrBottom: hdr.bottom, hdrLeft: hdr.left, hdrRight: hdr.right,
                    navLeft: nav.left, navRight: nav.right, links};
        }""")
        b.close()

    print("=== claim 2: are the wrapped nav rows on ONE rail? ===")
    rows = {}
    for l in geo["links"]:
        rows.setdefault(round(l["y"]), []).append(l)
    for y in sorted(rows):
        xs = [round(l["x"], 1) for l in sorted(rows[y], key=lambda l: l["x"])]
        print(f"  y={y:4.0f}  lefts={xs}")
    alllefts = sorted({round(l['x'], 1) for l in geo['links']})
    # A wrap is only a defect if the CONTINUATION row is indented. The first
    # item of each row is the one that must share a rail.
    firsts = sorted({round(min(l['x'] for l in row), 1) for row in rows.values()})
    print(f"  first item of each row: {firsts} -> one rail: {len(firsts) == 1}")
    print(f"  VERDICT: {'REFUTED - rows share one rail' if len(firsts) == 1 else 'CONFIRMED - rows differ'}")

    print("\n=== claim 1: is the header's bottom rule full-bleed? ===")
    w, h, rowspx = png_rows(SHOT)
    print(f"  image {w}x{h}, header bottom at css {geo['hdrBottom']:.1f}px")
    # find every near-full-width uniform row in the header band
    found = 0
    for y in range(0, int(geo["hdrBottom"] * 3) + 12):
        r = rowspx[y]
        bg = r[0]
        lit = [x for x, px in enumerate(r) if px != bg]
        if not lit or len(lit) / w < 0.9 or len(set(r)) > 3:
            continue
        gaps = [(a, c) for a, c in zip(lit, lit[1:]) if c - a > 1]
        full = lit[0] <= 1 and lit[-1] >= w - 2 and not gaps
        print(f"  row {y} (css {y/3:.1f}px): first={lit[0]} last={lit[-1]} "
              f"frac={len(lit)/w:.3f} colors={sorted(set(r))[:3]} gaps={gaps[:3] or 'none'} "
              f"-> {'FULL-BLEED' if full else 'NOT full-bleed'}")
        found += 1
    if not found:
        print("  no full-width rule row found in the header band")
    print(f"  header box: x {geo['hdrLeft']} -> {geo['hdrRight']} (viewport 390) "
          f"-> spans full width: {geo['hdrLeft'] <= 0.5 and geo['hdrRight'] >= 389.5}")


if __name__ == "__main__":
    main()
