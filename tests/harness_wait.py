"""Load-aware waits for the oem-ui WebKit harnesses.

WHY THIS EXISTS
---------------
The harnesses used to pin a fixed ceiling on their boot wait (15000 ms, and
3000 ms in three places): wait_for_function("() => !!window.cliMono").

Measured on this host 2026-10-10 while it ran a KVM guest and a rustc build at
load average 40: the runtime boots correctly but takes 9.9s, 12.5s and 13.7s in
three separate runs. A 15s ceiling therefore fails intermittently on a box
that is simply busy, and the failure surfaces as a Playwright TimeoutError --
indistinguishable, to a reader of the log, from "the runtime never booted".
Seven harnesses failed that way while the product was fine.

The runtime boots. The ceiling was wrong. Scaling it with load keeps a fast
run fast and stops a busy box manufacturing phantom defects.
"""

import os


def boot_timeout(base=30000, floor=8000):
    """Milliseconds to allow for the runtime to boot, scaled by host load.

    base is the ceiling on an idle box. The scale factor grows as the
    1-minute load average climbs past the core count, because that is when
    the browser process stops getting scheduled promptly. Capped at 6x so a
    wedged box still fails in finite time rather than appearing to hang.
    """
    try:
        load = os.getloadavg()[0]
    except (OSError, AttributeError):
        return base
    try:
        cores = os.cpu_count() or 1
    except Exception:
        cores = 1

    # 1.0 at or below the core count; +25% for each extra load-unit above it.
    ratio = 1.0 + 0.25 * max(0.0, (load - cores) / max(cores, 1))
    return int(min(base * 6, max(floor, base * ratio)))


def wait_boot(page, timeout=None):
    """Wait for the runtime to boot, then return (bool, ms_used).

    Deliberately returns a bool instead of raising: a boot timeout is an
    INFRASTRUCTURE verdict, not a product one, and the harness must report
    it as such rather than dying in a traceback at the top of the log.
    """
    ms = timeout if timeout is not None else boot_timeout()
    try:
        page.wait_for_function("() => !!window.cliMono", timeout=ms)
        return True, ms
    except Exception:
        return False, ms
