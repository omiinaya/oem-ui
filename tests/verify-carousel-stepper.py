#!/root/.venvs/mau/bin/python
"""WebKit proof for batch 7: the carousel scrollport and the stepper."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://192.168.1.68:4321/'
results, errors = [], []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('ok  ' if ok else 'FAIL') + '  ' + name + (' :: ' + str(detail) if not ok or detail else ''))


with sync_playwright() as pw:
    browser = pw.webkit.launch()
    page = browser.new_page(viewport={'width': 402, 'height': 667})
    # smooth scrolling would make every assertion wait on a timeline it does
    # not control; reduced motion makes the write instant and testable.
    page.emulate_media(reduced_motion='reduce')
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("() => window.cliMono && document.querySelector('.cm-carousel__page')")
    page.wait_for_timeout(200)

    # ---------- carousel ----------
    st = page.evaluate("""() => {
      const car = document.querySelector('.cm-carousel');
      const track = car.querySelector('.cm-carousel__track');
      const slides = [...track.children];
      const pages = [...car.querySelectorAll('.cm-carousel__page')];
      const prev = car.querySelector('[data-cm-carousel-prev]');
      const next = car.querySelector('[data-cm-carousel-next]');
      const cur = pages.findIndex(p => p.getAttribute('aria-current') === 'true');
      return { slides: slides.length, pages: pages.length, scroll: track.scrollLeft,
               cur, prevDis: prev.disabled, nextDis: next.disabled,
               docScroll: document.documentElement.scrollWidth,
               vw: window.innerWidth,
               pageW: getComputedStyle(pages[0]).width,
               slideW: slides[0].getBoundingClientRect().width,
               trackW: track.getBoundingClientRect().width,
               radius: getComputedStyle(slides[0]).borderRadius };
    }""")
    check('three slides and three page marks render', st['slides'] == 3 and st['pages'] == 3, st)
    check('slide one is current at rest', st['cur'] == 0, st['cur'])
    check('prev is disabled on the first slide', st['prevDis'] is True, st['prevDis'])
    check('a slide fills the track, so a swipe lands one whole slide',
          abs(st['slideW'] - st['trackW']) < 2, {'slide': st['slideW'], 'track': st['trackW']})
    check('the page marks are tap-sized, not 8px targets', float(st['pageW'].rstrip('px')) >= 40, st['pageW'])
    check('the slide frame is sharp', st['radius'] == '0px', st['radius'])
    check('the carousel scrolls internally without dragging the page sideways',
          st['docScroll'] <= st['vw'] + 1, {'doc': st['docScroll'], 'vw': st['vw']})

    page.click('[data-cm-carousel-next]')
    page.wait_for_function(
        "() => document.querySelectorAll('.cm-carousel__page')[1].getAttribute('aria-current') === 'true'",
        timeout=3000)
    st = page.evaluate("""() => {
      const car = document.querySelector('.cm-carousel');
      const track = car.querySelector('.cm-carousel__track');
      return { scroll: Math.round(track.scrollLeft),
               cur: [...car.querySelectorAll('.cm-carousel__page')]
                      .findIndex(p => p.getAttribute('aria-current') === 'true'),
               prevDis: car.querySelector('[data-cm-carousel-prev]').disabled,
               nextDis: car.querySelector('[data-cm-carousel-next]').disabled };
    }""")
    check('next scrolls the track and lights the second mark', st['cur'] == 1 and st['scroll'] > 0, st)
    check('prev enables once there is somewhere to go back to', st['prevDis'] is False, st)

    page.click('[data-cm-carousel-next]')
    page.wait_for_function(
        "() => document.querySelectorAll('.cm-carousel__page')[2].getAttribute('aria-current') === 'true'",
        timeout=3000)
    st = page.evaluate("""() => document.querySelector('[data-cm-carousel-next]').disabled""")
    check('next disables on the last slide (an end button that scrolls nowhere)',
          st is True, st)

    # jump to the middle mark by clicking it - the marks are controls, not dots
    page.click(".cm-carousel__page[aria-label='slide 2']")
    page.wait_for_function(
        "() => document.querySelectorAll('.cm-carousel__page')[1].getAttribute('aria-current') === 'true'",
        timeout=3000)
    check('clicking a mark lands on that slide',
          page.evaluate("""() => [...document.querySelectorAll('.cm-carousel__page')]
              .findIndex(p => p.getAttribute('aria-current') === 'true')""") == 1)

    # the finger path: the script only READS the scroll, so setting the
    # offset directly must repaint the marks with no button involved.
    page.evaluate("""() => {
      const t = document.querySelector('.cm-carousel__track');
      t.scrollLeft = t.children[2].offsetLeft;
      t.dispatchEvent(new Event('scroll'));
    }""")
    page.wait_for_timeout(200)
    st = page.evaluate("""() => [...document.querySelectorAll('.cm-carousel__page')]
          .findIndex(p => p.getAttribute('aria-current') === 'true')""")
    check('a swipe (scroll without a click) moves the marks too', st == 2, st)

    # keyboard: the track is focusable, so the slides are reachable
    page.evaluate("() => document.querySelector('.cm-carousel__track').focus()")
    before = page.evaluate("() => document.querySelector('.cm-carousel__track').scrollLeft")
    # Two things this has to prove, because each one alone passes on the
    # WRONG implementation:
    #   - parked on the LAST slide, ArrowRight clamps to itself, so a
    #     direction-free "did it move?" check is blind at the end.
    #   - the UA already scrolls a focused scroll container a line at a
    #     time, so "it moved" passes even with our keydown deleted. The
    #     claim we own is one SLIDE per press, landing on the snap offset.
    # where slide two REALLY sits, in the track's own coordinates:
    # offsetLeft is measured against a positioned ancestor and came out 40px
    # larger than the scroll offset that actually lands on the slide.
    expect = page.evaluate("""() => {
      const t = document.querySelector('.cm-carousel__track');
      const s = document.querySelectorAll('.cm-carousel__slide')[1];
      return t.scrollLeft + (s.getBoundingClientRect().left - t.getBoundingClientRect().left);
    }""")
    page.keyboard.press('ArrowLeft')
    page.wait_for_function(
        "() => document.querySelector('.cm-carousel__track').scrollLeft < " + str(before) + " - 10",
        timeout=3000)
    after = page.evaluate("() => document.querySelector('.cm-carousel__track').scrollLeft")
    check('the arrow key lands exactly one slide away (snap offset, not a UA line-scroll)',
          abs(after - expect) <= 2, {'after': after, 'expect': expect})
    check('the focused track scrolls from the keyboard', after < before, {'before': before, 'after': after})

    # ---------- stepper ----------
    st = page.evaluate("""() => {
      const steps = [...document.querySelectorAll('[data-cm-stepper] .cm-step')];
      const marker = steps[0].querySelector('.cm-step__marker');
      return {
        n: steps.length,
        done: steps.filter(s => s.classList.contains('is-done'))
                   .map(s => s.querySelector('.cm-step__label').textContent.trim()),
        current: steps.map(s => s.classList.contains('is-current')),
        aria: steps.map(s => s.getAttribute('aria-current')),
        radius: getComputedStyle(marker).borderRadius,
      };
    }""")
    check('the stepper renders four steps', st['n'] == 4, st)
    check('at rest the first step reads done and the second is current',
          st['done'] == ['plan'] and st['current'] == [False, True, False, False], st)
    check('aria-current="step" sits on the current step at rest',
          st['aria'] == [None, 'step', None, None], st['aria'])
    check('the marker is sharp', st['radius'] == '0px', st['radius'])

    steps = page.query_selector_all('[data-cm-stepper] .cm-step')
    steps[3].click()
    # WebKit applies a class change a frame late under reduced motion, so a
    # straight read compares against the PREVIOUS state (measured: bg read as
    # --bg-2 one tick after the class was already correct). Wait for the
    # value, not for a coin-flip duration.
    page.wait_for_function("""() => {
      const m = document.querySelectorAll('[data-cm-stepper] .cm-step')[3].querySelector('.cm-step__marker');
      return getComputedStyle(m).backgroundColor === 'rgb(232, 232, 232)';
    }""", timeout=3000)
    st = page.evaluate("""() => {
      const steps = [...document.querySelectorAll('[data-cm-stepper] .cm-step')];
      return { current: steps.map(s => s.classList.contains('is-current')),
               done: steps.filter(s => s.classList.contains('is-done')).length,
               aria: steps.filter(s => s.getAttribute('aria-current') === 'step').length,
               bg: getComputedStyle(steps[3].querySelector('.cm-step__marker')).backgroundColor };
    }""")
    check('clicking step four makes exactly one step current',
          st['current'] == [False, False, False, True] and st['aria'] == 1, st)
    check('everything before the new current step reads done', st['done'] == 3, st['done'])
    check('the current marker inverts to ink',
          st['bg'] in ('rgb(232, 232, 232)', 'rgb(17, 17, 17)'), st['bg'])

    steps = page.query_selector_all('[data-cm-stepper] .cm-step')
    steps[0].click()
    st = page.evaluate("""() => {
      const steps = [...document.querySelectorAll('[data-cm-stepper] .cm-step')];
      return { done: steps.filter(s => s.classList.contains('is-done')).length,
               current: steps.map(s => s.classList.contains('is-current')),
               aria: steps.filter(s => s.getAttribute('aria-current') === 'step').length };
    }""")
    check('going back clears the steps that are no longer done',
          st['done'] == 0 and st['current'] == [True, False, False, False] and st['aria'] == 1, st)

    # mobile: the connector must EXIST (it hangs off the li, which has
    # siblings) and be hidden under the stacked row. Reading only `display`
    # would also pass for a rule that never matched at all - which is
    # exactly the bug the first version of this component shipped with.
    conn = page.evaluate("""() => {
      const li = document.querySelector('[data-cm-stepper] > li');
      const cs = getComputedStyle(li, '::after');
      return { display: cs.display, content: cs.content };
    }""")
    check('the connector rule actually matches its li (content is painted)',
          conn['content'] not in ('none', 'normal'), conn)
    check('at 402px the connector is hidden under the stacked row', conn['display'] == 'none', conn)

    # and at desktop width it must be there, because a stepper whose steps
    # never connect reads as a list of unrelated labels
    desk = browser.new_page(viewport={'width': 1280, 'height': 900})
    desk.goto(URL, wait_until='networkidle')
    desk.wait_for_function("() => window.cliMono && document.querySelector('[data-cm-stepper]')")
    wide = desk.evaluate("""() => {
      const li = document.querySelector('[data-cm-stepper] > li');
      const cs = getComputedStyle(li, '::after');
      return { display: cs.display, content: cs.content, width: cs.width };
    }""")
    check('at 1280px the connector is visible between steps',
          wide['content'] not in ('none', 'normal') and wide['display'] != 'none'
          and float(wide['width'].rstrip('px')) > 0, wide)
    desk.close()

    check('no sideways scroll for the page as a whole',
          page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))
    check('no page JS errors', not errs, errs[:3])

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
for n, _, d in failed:
    print(f"  FAIL {n}: {d}")
sys.exit(1 if failed else 0)
