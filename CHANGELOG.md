# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **The rail's scroll-spy highlighted sections in the wrong order.** The
  nav said `lists -> states -> ... -> layout -> forms` while the page
  rendered `forms` directly after `lists`, so scrolling lit up `forms`
  early and then jumped BACK UP to `states`. The nav is now built from one
  `SECTION_ORDER` array, and three contract tests assert that the index and
  the document agree position by position. `surface` also had no nav link
  at all, so the spy skipped it silently; it is in the index now.
- **The rail stayed a two-column grid in a short window.** `flex-wrap:
  wrap` is inherited from the bar's nav, and in a COLUMN it wraps ACROSS
  once the children stop fitting the viewport *height*. Measured at
  1280x500: links 1-7 at x=8, links 8-14 at x=143 inside a 231px rail, so
  the index read as an overflow and the brand sat alone. The rail column
  and its link list are both `nowrap` now, and the list is `align-self:
  stretch` so it cannot shrink-wrap past the rail edge either. Proven at
  7 window heights from 900 down to 400 (`tests/verify-rail-short-window.py`).
  6 new contract tests, 26 mutations, 0 survivors.

### Added

- **The desktop nav rail.** `Header` takes a `rail` prop; above 1000px the
  header becomes a fixed column down the leading edge instead of a
  horizontal bar. Opt-in, because three consumers share `cm-header`.
  The showcase opts in and wraps its content in `cm-shell--rail`.
  Pinned by `tests/mutate-rail.py`.

### Fixed
- **`.cm-kv` no longer loses its two columns when a `dt`/`dd` pair is
  wrapped in a `div`.** A `<div>` between a `<dl>` and its own `<dt>`/`<dd>`
  is valid HTML — it is the natural way to give one row a control of its own
  (a link around the whole row, a toggle, a popover trigger) — but the
  wrapper is a real element, and `display: contents` is *ignored* on a grid
  **item**. So the wrapper took a cell of its own: the grid stopped being two
  columns of terms and values and became a grid of stacked blocks.

  Measured in WebKit on a live consumer (oem-portfolio `/certs`) at 1280px,
  before the fix: three wrapped pairs laid out **2-across**, and every `dt`
  shared its left edge with its own `dd` (`dtXs == ddXs == [210, 991, 210]`)
  — the two-column grid the component is built on was not being rendered at
  all. After: `dtXs == [747, 747, 747]`, `ddXs == [878, 878, 878]`, two
  distinct columns, at 1280px and at 768px.

  **The bug is invisible on a phone.** Below 520px the library's own
  `max-width: 520px` rule already stacks `.cm-kv` to one column, so at 390px
  the wrapped and direct lists look identical. A narrow-viewport check —
  the one this repo reaches for first — passes forever. The state the bug
  occurs in is desktop, and the proof is taken there.

  Fixed with `.cm-kv > div, .cm-kv > span { display: contents; }`. The
  child combinator is load-bearing: a descendant selector (`.cm-kv div`)
  also matches a `<div>` nested *inside* a `<dd>` — a value containing a
  rich block — and would flatten that too, which is a worse bug than the
  one being fixed. A test asserts the `>` specifically, and a mutation
  swaps it for a space to prove the assertion fires.

  No sibling margin is added on the wrapper, and that is deliberate: a
  `display: contents` element generates no box, so a margin on it is a
  declaration that cannot paint. The grid's own `gap` does the separating.

### Added
- **`.cm-icon-btn--bare`, a bare glyph for a surface that already has one,
  and a real fix for a tap target that was 44 tall and 32 wide.**

  Driven by two live consumers. dev-blog (log.oem.ngo) and oem-links
  (links.oem.ngo) each hand-rolled a `.theme-toggle` that is
  byte-identical to the other — same 32×32, same no border, same no radius,
  same 0.95rem — with the same rationale in a comment on each side: *"Both
  controls are bare glyphs on the header surface: no box, no border. An
  outlined button next to an unoutlined one reads as a mistake."* The
  library had the boxed form only, so both sites were maintaining a second
  implementation of surface it already owned, and a fix here would never
  reach them. The gap was real and the duplication was the evidence for it.

  Migrating the markup exposed the bug underneath. Measured in WebKit at an
  iPhone viewport against both **live** sites, the hand-rolled toggle was
  **32×44**. `base.css`'s coarse-pointer block gives `button` a
  `min-height: var(--tap)`, and the class declared an explicit `width` and
  `height` with no coarse-pointer override, so the floor stretched the box
  on one axis only: tall enough to pass a height-only check, still 12px too
  narrow to hit comfortably. The variant pins **both** axes from the token,
  which is the only form of this defect that is actually comfortable to tap.

  Building the showcase specimen exposed a second defect that no
  stylesheet-reading check can see. With `width: var(--tap)` correct and
  applied, the bare toggle still measured **37.89×44** inside
  `.cm-spec__sample` (`flex: 1; min-width: 0`): the button was a flex item
  with the default `flex-shrink: 1`, so a tight row squeezed it *below* its
  own declared width. `.cm-icon-btn` now carries `flex: 0 0 auto` — a
  control whose size **is** the measurement cannot be the thing that gives
  way — and a contract test plus a mutation pin it. Deleting the
  declaration restores the exact 37.89px, which is how the mutation was
  proven rather than assumed.

### Fixed
- **`check-design-sync.sh` reported all three real consumers as drifted when
  they were byte-identical, and this repo's own audit could not explain
  its own output.**

  The shadow-copy scan decides whether a vendored file is already accounted
  for with a *string* comparison, `[ "$f" = "$t/${pair##*:}" ]`, where `$f`
  comes from `find "$t"` and therefore never carries a trailing slash. Pass
  the target as `/root/projects/links/` — which is exactly what a
  `for d in /root/projects/*/` loop produces, and exactly what
  `oem-ui-deep-audit.sh` passes — and the comparison fails, so every copy
  `MAP` already owns was reported as an `ORPHAN`.

  The audit counted only lines matching `STALE`, so an `ORPHAN`-only result
  printed the self-contradictory `STALE -- 0 file(s) differ`: a failure it
  could not name. Targets are now normalised once, up front, and both the
  argument path and the no-argument sweep are covered by a test that also
  proves real drift still **fails** through a trailing slash — a fix that
  made the script quiet rather than correct would pass everything else,
  which is the failure mode of every "just relax the assertion" edit.

  Measured: with a clean `--public` consumer installed, `/dir` and `/dir/`
  now both exit 0 and report `in sync`; a one-line edit to `base.css` still
  exits 1 with `STALE` through either spelling.

### Added (previously unreleased)
- **`install.sh --public`, and a drift checker that cannot be fooled by a
  second copy of the runtime.**
  The library ships a runtime in two homes for some consumers. The normal
  one is `src/js/cli-mono.js`. The other is `public/cli-mono.js`, served
  verbatim, because Astro TREATS `<script src>` as a bundler asset
  reference: when the src is a variable it cannot resolve, the tag is
  **dropped from `dist/` entirely** while the HTML comment above it still
  ships, so the page looks wired up and has no runtime at all. `is:inline`
  fixes it, and a copy in `public/` is what makes `is:inline` serve
  something.

  The problem was not the shape. It was that **`install.sh` could not
  produce it**, so a consumer that needed a verbatim copy had to maintain
  one by hand - and `check-design-sync.sh` only compared the five paths in
  its `MAP`, so a `public/` copy was invisible to it by construction.

  Measured, not predicted. oem-portfolio reported **`in sync`** on every
  audit run for three days while the runtime it **served over HTTP** was 140
  lines behind the library:

  | file | state |
  |---|---|
  | `oem-ui/src/js/cli-mono.js` | 684 lines, the origin |
  | `oem-portfolio/src/js/cli-mono.js` | byte-identical - the check passed on this |
  | `oem-portfolio/public/cli-mono.js` | **544 lines, the one the browser ran** |

  The stale copy was missing `initNav` entirely (the drawer, the scrim, the
  body scroll-lock, Escape), the copy-button re-init bind guard, and the
  DOM-read guard key list - which is the black-flash fix. Every green signal
  agreed: the vendored copy was current, the CSS was identical, the build
  was clean.

  What ships:

  - **`install.sh --public`** installs both JS files into `public/` from the
    same `$FROM`, so the two copies cannot disagree with each other, and
    prints the shape (`is:inline`, `import.meta.env.BASE_URL`) so a consumer
    does not go re-deriving it.
  - **`check-design-sync.sh`** gains an `ALT` map for the verbatim homes
    (`public/` and flat). Present, they are compared as hard as `src/js`;
    absent, they are silent, because a consumer needs no verbatim copy and
    demanding one would make the check cry wolf on every project not using
    the flag.
  - **A shadow scan.** `MAP` and `ALT` are still a whitelist, and a
    whitelist is a hole: any other copy the consumer holds is now reported
    as `SHADOW` (it differs) or `ORPHAN` (it is byte-identical on a path
    nothing compares). **Both fail.** An identical copy is not safe - it is
    precisely the state the drift grows out of.

  Two bugs found while building it, both by the suite rather than by
  reading:

  - The shadow scan first skipped candidates by **basename**, which silently
    skipped every file called `cli-mono.js` - including the `public/` one it
    exists to find - because `MAP` also has a file of that name. It now
    matches the full destination path. This is pinned by mutation #4.
  - `ORPHAN` originally failed even a *current* `public/` copy, which would
    have made `--public` unusable. The first version of the test caught it
    by failing on a consumer that was provably in sync.

  `oem-portfolio` is migrated: its `public/` copy now comes from
  `install.sh --public` and is byte-identical to the origin, and its CI runs
  the drift checker over **every** copy the repo holds, `public/` included.
  That CI step degrades to a skip when the runner has no oem-ui checkout,
  because a step that can only ever pass or fail on one machine gets
  deleted rather than obeyed.

  Verified in WebKit at a 390px iPhone viewport, over HTTP, against the
  bytes actually served: `tests/verify-shadow-copy-webkit.py` (12 checks).
  It asserts the progressive-disclosure contract in whichever direction the
  site needs - and oem-portfolio turns out to ship **no** nav toggle, so
  `.cm-js` must *not* be set, and all three nav links must stay visible and
  above the 44px floor. An earlier draft of that probe asserted a drawer
  exists, which is a probe describing a site it was not pointed at.

  Mutation: `tests/mutate-shadow.mjs`, 11 mutations, **11 caught, 0 not
  caught, 0 NO-OPs**. One of them initially survived - making `SHADOW`
  advisory - because the test ran the shadow case while `public/` was still
  stale, so `STALE` alone held the exit code at 1 and the assertion passed
  for the wrong reason. The test now isolates each verdict.

- **`cli-mono-theme-guard.js` — the FOUC guard as a shipped file, and
  three consumers migrated onto it.**
  The fixed guard (reads its key list from `<html>` at run time) existed in
  exactly two places: inside `src/astro/Head.astro`, which `install.sh` does
  not ship, and inside the runtime, which cannot be used from `<head>` —
  the guard runs before the runtime bundle exists, so anything it read from
  the module was empty at that moment.

  The consequence was measured, not predicted: every consumer that owns its
  own `<head>` had re-implemented the guard, and the deep-audit script
  reported five of them. `links` had a `themeInitSnippet(storageKey,
  legacyKeys)` helper that took the key list as a **build-time argument**,
  which is precisely the bug the library fixed — it cannot see a theme saved
  under a legacy key, so every returning light-theme visitor got a black
  flash. `oem-portfolio` still had the older single-hardcoded-key form.
  `dev-blog` had a correct copy that would still drift.

  The guard is now one file, installed by `install.sh`, compared by
  `check-design-sync.sh`, and inlined by consumers with a `?raw` import. All
  three consumers migrated; their hand-rolled copies and `links`'s
  `src/lib/cm-theme.ts` are deleted. `check-design-sync.sh` now treats an
  un*referenced* guard as a **failure** rather than a note: the runtime can
  legitimately go unused in a static site, but an unused guard is a black
  flash, and the file sitting there reads as adoption.

  `Head.astro`'s `themeKey` / `legacyKey` props are now a documented
  fallback for a host that has *not* declared the attributes; they must not
  become a way to build a second key list, which is the original bug.

  **The bug this cycle shipped and caught, which is the reason the file
  carries a warning about itself.** The guard is inlined verbatim into
  `<head>`, and the HTML parser ends a script element at the first closing
  tag it sees *whether or not it is inside a JavaScript comment*. The first
  version of this file documented its own usage by writing the closing tag
  literally in its header comment. The build succeeded, all 269 contract
  tests passed, `links` deployed a working page, and **every visitor got no
  guard at all** — the parser cut the file at the comment, so the shipped
  script was 2,128 bytes of prose with the entire body missing. Found by
  asserting on the built bytes rather than the source.

  The suite now has a check that the guard file contains no
  script-closing-tag sequence, no script tag and no HTML comment sequence
  **anywhere in the file**, a check that the built head carries a real
  self-invoking body positioned before `<meta charset>` and the first
  stylesheet, and `tests/verify-guard-webkit.py`, which seeds a stored theme
  under a *legacy* key in WebKit at a 390px iPhone viewport and measures the
  **painted** background, not just the attribute.

  Measured in WebKit at 390px: 10 cases across three consumers, all
  correct. A legacy-key light theme on `links` paints `rgb(250,250,250)`;
  reverting the guard to the single-key form drops it to `rgb(10,10,10)` —
  the black flash, measured. 0 sideways-scroll and the guard confirmed
  inline in `<head>` on all three. 6 mutations, 6 caught, 0 no-ops.
- **`.cm-chip` — a state chip for table cells and row summaries.**
  The library had `.cm-status` (a full-width strip) and `.cm-tag` (a chip
  with no state), and nothing in between, so every consumer that needed
  "scored / warming / error" in a dense table cell hand-rolled one. The
  first one measured was hermes-hearth's `.pill` family: 20 hex literals,
  four states differentiated **by hue alone**, and the two
  `color: var(--ink-dim)` states (`pill idle` and `pill set`) carrying no
  cue at all.

  Since the palette is greyscale by contract, a state cannot be carried by
  colour, so each state carries a second, non-hue cue as a `::before`
  glyph — circle, triangle, cross — the same treatment `.cm-status`,
  `.cm-toast` and `.cm-alert` already use and for the same reason.
  `.cm-chip--set` is dashed, for "this value is not the default", which the
  value itself cannot say.

  Two forms, not one, and the split is measured rather than taste: the
  **base is a mark** and deliberately does *not* reach `--tap`, because
  forcing the floor on an inline chip in a table cell inflates the row from
  39.6px to 60.5px at 390px (+53%) to make something that is not a target
  look tappable. `.cm-chip--action` is the interactive form and does carry
  `min-height: var(--tap)` from the token.

### Fixed
- **The tap-target check was verifying one component out of four.**
  `INTERACTIVE` listed `cm-tab` and `cm-nav__link`, neither of which has
  ever been a class in this library (the tab is `.cm-tabs__tab`), and a
  `continue` on the un-matched case meant those two were skipped silently
  while the suite reported success. A vacuous pass is worse than a failure
  because it reads as coverage. The list is corrected, the skip is now a
  failure that names the misspelling, and the lookup is a real rule walk
  (recursing into at-rules, accepting a selector list or an ancestor
  prefix) instead of a regex over raw text. `.cm-chip` was in that list
  too, reserved long before the component existed.
- **`.cm-nav-toggle` reached 44px by accident.** The burger's size came
  from the header being a stretched flex row, not from any declaration on
  the button itself — so making the header a plain block would have left
  the phone's only way into the nav as a 12px target (the bar box). The
  floor is now declared on the rule.
- **A check could pass on a sibling's declaration.** `[role='tab']` shares
  one block with `a, button, label, input, textarea, select` and
  `[role='button']`, so asking "does this block mention `var(--tap)`" is
  answered by `a`'s floor and passes with the tab at 20px. The element is
  now named in the prelude and its own value read.

- **The FOUC guard could not see a theme saved under a legacy key.**
  `themeInitScript()` built its key list from the module-level
  `LEGACY_KEYS`, which is still `[]` at the moment the inline `<head>`
  snippet is evaluated — the guard necessarily runs *before* the runtime
  bundle has executed. The emitted snippet therefore carried exactly one
  key, so a returning visitor whose theme lived under a pre-library key
  got a black flash: the precise failure the guard exists to prevent.
  It now reads `data-cm-theme-key` / `data-cm-theme-legacy` from `<html>`
  at run time, which is the same declaration the runtime uses, so the
  guard and the toggle can no longer disagree about where the saved theme
  lives. The existing test passed only because it called
  `setLegacyKeys()` first — something a `<head>` snippet structurally
  cannot do. That test is replaced by two behavioural ones that evaluate
  the snippet in a `<head>`-shaped context with no module state seeded.
  `tests/mutate-fouc-guard.mjs`: 6 mutations, 6 caught, 0 no-op — and the
  first one restores the old implementation verbatim, so the regression
  itself is what gets tested.
- **dev-blog's FOUC guard was in the wrong document position.** It lived
  in `Header.astro`, which renders inside `<body>`, so it ran *after* the
  stylesheets had painted — the flash was still happening. Moved to
  `BaseHead.astro`, the component that owns `<head>` and renders on every
  page, and rewritten to read the same `<html>` attributes the runtime
  does instead of a hand-typed `['oem-log-theme', 'cm-theme']`.
  The library's own `<Head>` had the same hand-typed key list; it now
  reads the same attributes, and accepts `themeKey` / `legacyKey` props.
  Two new contract checks derive the expected keys from each consumer's
  own `<html>` tags, so a guard that searches a different key than the
  runtime will is now a build failure instead of a black flash.
  (The first version of that check asserted "more than one key" and
  failed on oem-portfolio, which legitimately has exactly one; the
  invariant is consistency with `<html>`, not cardinality.)

### Added
- **A `variants` showcase section, and a reachability contract test.** 26
  classes were defined in the stylesheet and rendered nowhere: `.cm-tag`,
  `.cm-tag--accent`, `.cm-rule`, `.cm-rule__label`, `.cm-media`,
  `.cm-status--warn/--err`, `.cm-toast--*`, `.cm-term__line`,
  `.cm-spinner--lg`, `.cm-rows--column/--stacked`, `.cm-row__icon` and
  `.cm-head__title`. Four of them ship to a **live** consumer
  (oem-portfolio renders `cm-tag` and `cm-rule` on its projects pages), so
  this was surface in production that no one had ever seen rendered. A new
  check now walks the BUILT page and fails if any defined class is
  unreachable - and, in the direction that actually bites, if any rendered
  class is styled by no rule (the renamed-without-selector bug).
  `tests/mutate-variants.mjs` mutation-checks both: 10 mutations, 10 caught.
- **`.cm-header__icon-link` is now demonstrated.** The showcase never
  passed `extraLinks`, so a class oem-portfolio's own Header renders was
  unreachable here.
- **Code blocks with a copy button.** `.cm-codebar` (the wrapper that gives a
  `<pre>` a label row and a home for a control), `.cm-copy` (the button) and
  `.cm-copy__state` (a reserved-width glyph slot), plus a `<CodeBlock>` Astro
  component. The runtime has bound `[data-cm-copy]` since it shipped and every
  consumer has it vendored, but **not one page in the fleet had a button
  using it** - a capability that cannot be reached is not a capability. The
  copy control is composed from `.cm-btn .cm-btn--sm` rather than a parallel
  button skin, so it inherits the tap floor and every button fix for free.
- **CI.** `npm ci`, `npm run build`, `npm test` on the pve-scripts
  self-hosted runner, because the Actions minute budget on this account is
  exhausted and a GitHub-hosted runner will not start a job at all. A runner
  was registered for this repo; personal-account runners are per-repo.

### Fixed
- **A long tag overflowed its column.** `.cm-tag` is `inline-flex`, so it is
  a BFC root: it laid out at its own max-content width and a single long
  word pushed 26px past a 220px row, measured in WebKit at both 390 and 320.
  oem-portfolio renders these inside an aside. Fixed with `max-width: 100%`
  + `min-width: 0` + `overflow-wrap: break-word` - **`break-word`, not
  `anywhere`**, which also shrinks min-content sizing and splits `.cm-*`
  identifiers mid-token (a sibling check bans it for exactly that reason).
- **Three consumers were stale** on the `.cm-copy` tap floor
  (`min-height: 0` vs `var(--tap)`), so every copy button on links.oem.ngo
  was under 44px. Re-vendored with `scripts/install.sh`.
- **One click copied twice.** `initCopy` was the only `init*` in the runtime
  with no bind guard, and `init()` runs again on every `astro:page-load`, so
  each run attached another click listener. Measured in WebKit at 390px:
  after a re-`init`, one click on a copy button produced 2 clipboard writes.
  It now carries `data-cm-copy-bound` like the burger, the tabs and the
  dialogs.
- **A successful copy was invisible.** The runtime has set `.is-copied` since
  it shipped and the library had **no rule for it anywhere** - the label text
  changed and the only feedback was the motion. The state now steps to
  `--ink` on a `--bg-3` surface, a non-hue cue that survives greyscale. A
  failure path got an `.is-error` class for the same reason.
- **The copy button destroyed its own glyph slot.** The runtime wrote
  `btn.textContent = 'copied'`, which replaces the button's children, so a
  button carrying a reserved glyph lost it on the first copy and could never
  get it back. The label is now written into a `[data-cm-copy-label]` slot,
  and the button keeps its tick.

### Fixed
- **The repo only worked on the machine it was written on.** A clone
  anywhere else had a symlink pointing into a local NFS mount, hardcoded
  LAN URLs as its test defaults, and absolute paths into a home directory.
  The WebKit harnesses now read `OEM_UI_URL` / `OEM_UI_SCRATCH`, the
  mutation harnesses resolve the repo from their own location, and the sync
  checker defaults to the checkout it lives in.
- **A committed symlink published the storage layout.** The SAME-PATH
  `oem-ui` link is a local convenience; it is now gitignored.
- The scroll-spy attribute assertions matched the burger's
  `data-cm-nav-toggle` prefix, so deleting the real `data-cm-nav` left the
  suite green. Both are now asserted where they are assigned.

### Fixed
- **The mobile drawer rendered 0px tall and was invisible.** `.cm-header`
  carried `backdrop-filter`, which makes an element the containing block
  for `position: fixed` descendants, so the panel's `inset-block: 0`
  resolved against the 62px header instead of the viewport. The blur is
  removed from the header and from `.cm-header__nav` (the panel's own
  parent, which trapped it identically), and `--header-bg` is now solid
  in both themes rather than `rgba(..., 0.92)`, since a translucent header
  with nothing to frost it shows content through it. The panel measures
  320px wide and 781px tall at 390px.
- The burger's `:nth-child(2)` middle-bar rule matched nothing, because
  `::before` and `::after` do not count toward `:nth-child()`. The middle
  bar fell back to `top: 0`, landed on the first, and the burger drew two
  lines.
- The burger now leads on the left edge, as a direct sibling of the brand,
  so `order` has something to order. It was a child of
  `.cm-header__controls`, where no `order` value could move it.

### Changed
- The mobile nav region slices in `tests/run.mjs` were empty, so every
  check in the block was passing vacuously: `indexOf` from an offset
  searches from that offset, and the panel moved into the media query
  after the burger's.
- The tap-floor check asserted the `padding` that used to imply the floor
  rather than the `min-height` that now delivers it.


### Added
- **Mobile nav disclosure.** `.cm-nav-toggle` collapses the header nav into a
  burger panel under 640px, with `aria-expanded` / `aria-controls`, Escape to
  close (focus returns to the button), close-on-link-tap, close-on-outside-click
  and a rotate-to-desktop reset. The collapse is scoped to `.cm-js`, which the
  runtime sets on `<html>` only after it has bound the toggle, so a reader
  without JavaScript keeps every link inline.
- The burger morphs to an X on `aria-expanded="true"`, and the transition sits
  in the existing `prefers-reduced-motion` guard alongside every other
  animation in the system.
- `tests/burger-webkit.py`-style verification: 22 WebKit checks at a 390px
  iPhone viewport, including a JavaScript-disabled context.

### Fixed
- **`SITE.title` was the placeholder `my site`**, so the showcase header read
  `$ my site`. It now reads `$ oem/ui`, matching the `$ oem/links` and
  `$ oem/log` prompt convention. A consumer that copies `config.ts` must
  change it, which the file's own comment now says.
- **An icon button cleared the tap floor in height but not width** — 44x32.
  `min-height: var(--tap)` in the coarse-pointer block could not beat the
  `width: 32px` that `.cm-icon-btn` declares, and base.css loads before
  components.css, so the override had to live beside the class. The burger is
  now exactly 44x44 on a touch pointer.
- **`verify-nav-webkit.py` aborted after its checks** when the showcase outgrew
  WebKit's 32767px full-page screenshot limit, reporting a green suite as a
  crash. The shot is now best-effort and the run reports its real result.

### Added

- **`<strong>` / `<b>` is an element default.**

  The library styled every element it owns except the one a prose block
  leans on hardest. A bare `<strong>` got the browser default, which
  carries **no colour step at all** — only weight. Inside a paragraph
  set in `--ink-dim` there was therefore nothing to read but the stroke
  weight, and on this system's greyscale ramp that is the weakest cue
  available.

  oem-log had re-declared it in **two separate pages, in two separate
  Astro scoped blocks** (`.hero-desc strong`, `.about-body strong`),
  which is the duplication this library exists to prevent: a second
  implementation of surface the design system already owns, so a future
  library fix would never reach it.

  ```css
  strong, b { color: var(--ink); font-weight: 700; }
  ```

  Both cues, deliberately. Weight survives greyscale; colour is the
  second, and it is the same `--ink` / `--ink-dim` pair the row title
  already uses against its description. Measured:

  | | dark | light |
  |---|---|---|
  | `--ink` on `--bg` (legibility) | 16.16:1 | 18.09:1 |
  | `--ink` on `--panel` | 15.41:1 | 17.32:1 |
  | the emphasis step, `--ink-dim` → `--ink` | 2.24:1 | 2.13:1 |

  The step is a *relative* cue and is deliberately below 4.5:1 — WCAG
  measures text against its surface, which the top two rows clear
  comfortably. It is more than double the library's own subtle
  `--ink-faint` → `--ink-dim` step of 1.24:1, which is the bar it has to
  clear to read as emphasis at all.

  An element default rather than a `.cm-*` class, for the same reason
  the form controls are: a bare tag with no class on it is the case that
  has to work, so a class would be a class nobody remembers to add.

  Demonstrated in the showcase's prose section, rendered **inside a real
  `--ink-dim` paragraph** — deliberately a `.cm-lede`, not a `.cm-prose`
  paragraph. `.cm-prose` is itself `--ink`, so a `<strong>` there computes
  to the same colour as its paragraph: the suite was green, the page
  built, and the specimen was invisible. Found by measuring in WebKit,
  not by reading the markup; there is now a test and a mutation for it.

  Measured in WebKit at 390px, both themes, on the built page:

  | theme | `<strong>` | its paragraph | weight |
  |---|---|---|---|
  | dark | `#e8e8e8` | `#9c9c9c` | 700 |
  | light | `#111111` | `#4a4a4a` | 700 |

  Covered by two contract tests (structure + one-owner, and legibility
  computed from the real tokens in both themes) and 11 mutations in
  `tests/mutate-emphasis.mjs`, all killed, none a no-op. The one that
  matters most: **deleting the entire rule** while the word `strong`
  still sits in the comment above it and in the showcase copy. A
  substring check scores that as a pass; the selector parser does not.

- **`.cm-lede`, `.cm-split` and `.cm-back`, plus a measure scale.**

  Three page shapes the library did not own and every consumer had
  re-implemented with its own numbers. oem-portfolio carried a 348-line
  `global.css` holding `max-width: 68ch`, `max-width: 58ch` and a
  `grid-template-columns: 1.6fr 1fr`, none of them named; this library
  had `34ch` typed inline in a single rule. A measure is a property of
  the type, not of a component, so it now has tokens:

  | token | value | for |
  |---|---|---|
  | `--measure` | `68ch` | a reading column — prose, and the lede |
  | `--measure-narrow` | `34ch` | one compact block that must not re-wrap |

  Declared once in `:root` and the same in both themes, so light and dark
  cannot silently disagree about how long a line is. `.cm-state__body`
  now reads `var(--measure-narrow)` instead of its own `34ch`.

  The split's two decisions are baked in rather than left open: it
  **stacks below 700px** (two columns of text on a phone is two
  unreadable columns, so the single-column rule is the default and the
  two-column rule sits inside a `min-width` query), and the columns are
  **`1.6fr / 1fr`**, because the aside holds a label and a value and at
  `1fr` the aside starts wrapping its own values.

  Mutation-checked: `tests/mutate-layout.mjs`, **8 killed, 0 missed,
  0 no-op** — including dropping the token, redeclaring it per theme,
  restoring the raw `ch` literal, un-stacking the split, lifting the
  two-column rule out of its query, and deleting each new rule outright.

  Two of those mutants first reported MISSED, and both times the bug was
  in the test, not the code. A class was "defined" if its name appeared
  anywhere in the file, which a **compound selector**
  (`.cm-back:hover .cm-back__arrow {`) and an **explanatory comment**
  both satisfied, so deleting the whole rule left the suite green. The
  check now walks the rules and requires a class to be a selector on its
  own. A substring search for "is this class defined" is a test that
  stops testing the moment a comment is written well.

- **The drift checker now verifies a vendored layer is actually loaded.**
  It compared bytes and nothing else, so it reported `in sync` for a week
  on a project that had all four files vendored and imported none of them:
  that site rendered its own 264-line design system with `--ink-faint`
  at 2.66:1 contrast, while a byte-identical copy of the fixed values
  sat unused in its `src/`. A copy is not adoption.

  `scripts/check-design-sync.sh` now also reports `UNREACHABLE` for a layer
  no source file references, matched on the file name so both the JS-import
  and the CSS-`@import` routes count (oem-portfolio uses the latter; the
  first version of the check flagged it, which is the same failure as a
  check that never fires). It skips a project with no source files at all —
  that is not drifted, it is not built yet.

  The runtime is reported as a `note`, never a failure: a static site can
  adopt the design system and want no theme toggle. Making it strict is
  the obvious next edit and it would be wrong, so a test pins it.

  Mutation-checked: `tests/mutate-reachability.mjs`, **7 killed, 0 missed,
  0 no-op** — including the mutants that drop the report, drop only the
  non-zero exit, revert to path matching, scan the vendored dir, and gate
  on `src/` existing.

- **`.cm-post-head`, the article variant of `.cm-head`.** `<PostHead>`
  shipped `cm-post-head` on its `<header>` while the stylesheet had no
  rule for it, so the article head rendered with none of the separation
  it was written for. It is now a real class: the same top padding as a
  page head, a `1px` rule under itself, and a `margin-bottom` that
  opens the gap to the prose below — the rule sits on the header and
  the prose is its sibling, so there is no child to collapse against.
  The showcase now renders `<PostHead>` in the prose section, so the
  build compiles the component and the rules are proven in a browser
  rather than only asserted.

- **`.cm-tooltip` demonstrates all four alignment variants.** The row
  had the centred tip and `--below`; the centred case is the one with a
  constraint (a tip is far wider than the button it centres over), so it
  is the one that most needed showing. `--start`, centred, `--end` and
  `--below` are all in the showcase now, which is what makes "reach for
  `--start` or `--end` near an edge" a fact on the page rather than a
  thing a reader has to infer.

### Fixed

- **The page scrolled sideways on a phone, by 27px at a 390px viewport.**
  Measured, not reported: `window.scrollX` went 0 -> 27 and the document
  was pinned at 418px at 390, 375 and 320 alike. Bisecting the tree one
  subtree at a time put it on `.cm-tooltip__tip` and on nothing else —
  hiding the tooltips drops the document from 411px to 320px exactly. A
  tip is routinely far wider than the button it describes (measured 288px
  of tip on a 79px button) and it is `position: absolute`, so an overhang
  widens the document instead of clipping inside it.
  Two parts, and the first is not sufficient on its own:
  - `overflow-x: clip` on the root. `hidden` would also stop the scroll
    but silently breaks `position: sticky` for every descendant, because
    a hidden box becomes the scroll container for its sticky children.
    The header is sticky, so `clip`, which clips without creating a
    scroll container. Re-measured after: the header still sticks.
  - the tip is capped with `min(18rem, 100vw - 2 * var(--gutter))` rather
    than a bare `18rem`, so the cap is right at every width instead of
    only the one it was written for.

  After, in WebKit at `device_scale_factor=3`, `is_mobile`, `has_touch`:
  390 and 375 — the widths this is read at — 0 sideways scroll, all four
  tooltip variants inside the viewport, tips one line tall, header
  sticky, 0 elements under the 12px floor, 0 JS errors. Desktop 1440
  unchanged at 0.

  Known and deliberately not fixed: at 320px a **centred** tip over a
  trigger near the right edge still overhangs and the page still scrolls
  49px there. CSS cannot detect the collision, and pretending otherwise
  would mean shipping a fake. The showcase now demonstrates all four
  alignment variants so the workaround is discoverable from the page,
  and the test pins what is actually claimed rather than this.

- **A shipped Astro component could emit a class no stylesheet defined.**
  The markup and the stylesheet were two hand-maintained lists and
  nothing compared them. `<PostHead>` carried a dead `cm-post-head` for
  months; nothing noticed because the showcase never rendered the
  component, so `astro build` never compiled it either. A dead class
  still builds, ships and renders — it only styles nothing.
  Two checks now close this:
  - every `cm-*` class a component emits must be the **subject** of a
    rule that declares something, in `components.css` or `base.css`.
    "Subject" matters: the first cut accepted a class named anywhere in
    a selector, and a mutation proved it — `.cm-post-head .cm-kicker`
    mentions the class, so deleting `.cm-post-head` outright left the
    suite green. A class named in only a descendant rule styles nothing
    when it is the element.
  - every component in `src/astro/` must be imported **and rendered** by
    the showcase, so nothing ships unrendered. `Head.astro` is exempt
    with a stated reason (the showcase is a single page with an inline
    `<head>`; a second would double the charset, title and theme guard),
    and the exemption fails if the showcase ever does start rendering it.
  - `astroFiles`, the list the "ships" check iterates, was missing
    `Card`, `Meter`, `Stat` and `TimelineItem` — they were added later
    and the list was never updated, so four shipped components were
    never asserted to exist.
  Verified by `tests/mutate-posthead.mjs`: 6 mutations caught, 1
  equivalent (a loose parser is harmless while a class still has
  descendant rules; the compound mutation proves the case), 0 missed,
  0 no-ops, suite green after restore.

### Added

- **Two more components: `.cm-cards` / `.cm-card`, and `.cm-meter`.**
  A card is a unit of content with a title, so it needs more room than
  a `.cm-kv` row and less than a page; the library had no honest way to
  express one, and every consumer was hand-rolling a private version
  that did not line up. Pure CSS, no runtime.
  - The card grid is `auto-fit` with a `min(20rem, 100%)` floor, and
    `.cm-card` is `height:100%` with a `flex:1 1 auto` body. That pair
    is what makes a two-line card and a six-line card in the same row
    share a bottom edge instead of ending ragged.
  - `.cm-card` is `position:relative` + `overflow:hidden` because
    `.cm-card--accent` is a 2px left border: without the clip, a
    bordered card leaves square nubs outside its own `radius`.
  - `.cm-card__link::after` stretches to the whole card so the tap
    target is the card, not 20px of footer text. It is on the **anchor**
    rather than the card, because an overlay pseudo-element on the card
    itself would sit above the text and break selection.
  - `.cm-meter` draws its fill from `var(--cm-meter-fill, 0%)`, which
    the caller sets from the same number it prints beside the bar. A
    fill width set independently of the printed value is a chart that
    disagrees with its own caption, so the two are now structurally
    one value. The `0%` default means a missing property renders an
    empty track rather than a full one.
  - The meter track is `aria-hidden` and the value is real text: a bar
    is a picture of a number, and a screen-reader user gets the
    number, not the picture.
  - `Meter.astro` **throws at build time** on a `pct` outside `0-100`
    (inclusive, so a 100% bar is legal) or a non-finite value. A
    silently clamped bar is a chart that quietly misstates the data.
  - `Card.astro` is slots-only — head, default and foot. A hardcoded
    "status badge" or "credential ID" would bake one consumer's data
    model into the library.
  - New micro-labels are floored at `--min-font` in the existing
    coarse-pointer block, like every other small type in the system.

- **Two record components: `.cm-stats` / `.cm-stat`, and `.cm-timeline`.**
  A metric is not a `.cm-kv` row and a work history is not a `.cm-rows`
  list, so both were being re-declared privately by every consumer that
  needed one. Pure CSS, no runtime.
  - The tile grid is `repeat(auto-fit, minmax(min(9rem, 100%), 1fr))`,
    not a fixed column count: the tile count is data, and a hardcoded 3
    strands a half-row at four tiles and an empty column at two. The
    `min()` keeps a single tile from forcing horizontal scroll at 320px.
  - `.cm-stat__val` is capped **below** the section `h2` and a test
    enforces it. A metric tile is allowed to be emphatic; it is not
    allowed to out-shout the heading that introduces it, and that
    inversion is invisible in review and obvious on the page.
  - The timeline rail and dot are drawn on **`.cm-timeline__item`**, not
    on the list. A rail drawn on the list cannot know where the final
    record is, so it either runs past the last dot (implying an entry
    that does not exist) or needs a script to trim it. On the item,
    `:last-child` ends it and the cost is zero.
  - The dot is a square and is centred on the rail by a negative
    half-width, so the mark and the line can never drift apart. A test
    asserts the offset is exactly `-width / 2`.
  - `--now` marks the current record by **filling** the dot with
    `--ink` rather than introducing a hue. This palette is greyscale;
    a colour here would be the only colour on the page, and it would
    print wrong.
  - `.cm-timeline__body` cancels the inherited `::before` list marker,
    which would otherwise snap a wrapped line back to the container
    edge and run it under the rail.
- **`Stat.astro` and `TimelineItem.astro`.** Both take every string as a
  prop and hardcode no identity. `TimelineItem` emits the rail/dot
  classes itself, because a consumer that forgets one gets an un-drawn
  timeline that looks like a styling bug rather than a missing class.
- **A `records` section in the showcase**, in the nav between overlays
  and prose, and a README section documenting every class above.

- **Five native-first interactive components: `.cm-tabs`, `.cm-dialog`,
  `.cm-toast`, `.cm-dropdown`, `.cm-tooltip`.** Four of the five are the
  platform's own element doing the platform's own thing — a `<dialog>`
  opened with `showModal()`, a menu built on the Popover API, a tooltip
  revealed by `:hover` / `:focus-within` — so focus trapping, light
  dismiss, focus return and the ARIA live-region wiring are the
  browser's job and the library ships no code for them. Only the tablist
  needs script, because the platform has no tab widget and the roving
  `tabindex` is the one part of the ARIA contract that CSS cannot
  express. No dependency was added and no build step.
- **`--scrim`.** The one token the modal backdrop needs, and it is
  defined separately in every theme block including both
  `[data-cm-theme]` subtree scopes. The same alpha over near-black and
  over near-white does not dim the page by the same amount, so a single
  literal is wrong in one of the themes by construction.
- **`cliMono.toast(nodeOrString)` / `cliMono.dismissToast(node)`.** The
  toasts were the one piece of these that genuinely could not be CSS:
  "transient" is a contract, and a contract needs someone to honour it,
  so the runtime mounts a toast into a live region and retires it.
- **`[data-cm-open="<id>"]` opens a dialog.** A consumer writes a button
  and an id rather than a script tag.
- **A new `overlays` section in the showcase**, in the nav between
  states and prose, and a README section documenting all five.

- **`HeaderLink.astro`** — a nav link that knows whether it is the page you
  are on and marks itself `aria-current="page"` when it is. It owns path
  matching, which is the part every consumer gets wrong: trailing slashes,
  query strings, hashes and a `base` prefix are all normalised, and an
  external href is never treated as the current page. The component decides
  only the attribute; the appearance stays with the library's
  `.cm-header__link[aria-current='page']` rule.
- **`<Header>` can express the current page.** `Link` takes `active: true`
  and it renders `aria-current="page"`. The rule for that state has shipped
  in `components.css` since the beginning and nothing could reach it.

### Fixed

- **A toast's close button was dead on any toast created after `init()`.**
  The listener was bound once, inside the init pass, so it only ever
  reached toasts that existed in the initial markup. Every toast the
  showcase creates comes from a click handler, which means the control
  the component documents as "or immediately via its close control" did
  nothing — with no console error and with the contract suite green. The
  binding now happens where the node is created, and the init pass still
  covers hand-written markup. Found by driving the real page in a
  browser; the fake-DOM test that existed built its tree *before* init,
  which is precisely the case that works. There is now a test for the
  other order.
- **The showcase announced every toast twice.** The demo built its toasts
  with `role="alert"` inside a `role="status" aria-live="polite"` region,
  so the region announced the insertion *and* the alert announced itself.
  The region owns the announcement; the toast must not double up. This is
  the same class of bug the alert glyph shipped with earlier, and the test
  that catches it now scans the script as well as the markup, because a
  section-scoped check reads markup that never exists and passes forever.
- **The scroll-spy measured with `offsetTop`.** That is relative to the
  nearest *positioned* ancestor, so a consumer with any positioned wrapper
  around its sections got the wrong link lit. It now measures with
  `getBoundingClientRect()` against the document. The spy was unreachable
  (no component emitted `[data-cm-nav]`), which is why it went unnoticed.
- **The shipped-component test could not see a deleted file.** It asserted a
  filename appeared in a list, which is a statement about the list. It now
  asserts the file exists on disk.

### Changed

- **`Header` wires its links to the runtime scroll-spy.** It emits
  `data-cm-nav` and `data-cm-spy`; the spy id is inferred from a `#section`
  href, so a single-page site gets the spy without repeating `spy` on every
  link. The two nav states stay separate attributes on purpose: `active` says
  where you are, `is-active` says what you are reading, and on a one-page
  site both are true of the same link.

- **`.cm-cursor` was never guarded by `prefers-reduced-motion`.** Every
  other animation in the system was; the blinking prompt was not, and
  a screen that never stops blinking is a real accessibility failure.
- **The three alert variants carried no glyph**, only a border colour,
  so a greyscale print rendered all three identically. Each now ships a
  distinct `\25cf` / `\25b2` / `\2715`, escaped so the source stays
  ASCII.
- **The showcase drew each alert glyph twice** — once as literal text in
  the markup and once from CSS `::before`.

### Changed

- **The project is now `oem-ui`.** Renamed from `cli-mono` (GitHub
  `omiinaya/cli-mono` → `omiinaya/oem-ui`, local `/root/projects/cli-mono` →
  `/root/projects/oem-ui`, `package.json` name, all docs, and the showcase
  copy). The design system itself is unchanged: the `.cm-*` class prefix, the
  `cm-theme` storage key and the installed paths `src/styles/cli-mono/` +
  `src/js/cli-mono.js` are deliberately NOT renamed yet, because oem-links is
  live on them. Renaming the prefix is a separate, later pass.
  `/root/projects/cli-mono` remains as a symlink to the new path so existing
  references keep resolving.

### Added
- **Async state components.** `.cm-skeleton`, `.cm-skeleton__line`,
  `.cm-skeleton__block`, `.cm-spinner`, `.cm-alert` with
  `.cm-alert__mark` / `.cm-alert__body` / `.cm-alert__title` /
  `.cm-alert__text` and `--ok` / `--warn` / `--err` variants, plus
  `.cm-table-wrap`, `.cm-table`, `.cm-table td.num`,
  `.cm-table-wrap:focus-visible` and `.cm-spec__chip--tap`. A surface
  that does not own its own empty/loading/error states lets every
  consumer invent them.
- **A `states` section in the showcase** demonstrating all of them.
- **A foundation section that documents the design language.** Colour
  swatches, the type scale, the eleven-step spacing scale and shape/motion
  specimens, each rendered from the token it documents rather than typed
  beside it: a swatch paints `var(--ink-dim)`, a spacing bar is
  `width: var(--space-N)`. `.cm-swatch` and `.cm-spec` are library
  components, so a consumer can document its own tokens the same way.
- `--swatch-col`, the swatch column floor, derived from the font
  (`1.4em + --space-2 + 15ch`) rather than a magic rem value, so a token
  name that is longer than any we have today still fits its column.

### Fixed

- **`--space-05` renamed to `--space-0`.** A zero-padded first step next
  to plain `1` read as a different scale. The specimen table is what made
  it obvious. The step list and the spacing tests now parse the scale out
  of `tokens.css` instead of restating its names, so a rename cannot break
  them.
- **A token name could be truncated in a swatch.** `--accent-bright`
  rendered as `--accent-bri…`. The chip is now font-relative and the label
  never wraps or ellipsises: a token name is either shown whole or the
  specimen is not a specimen of anything.
- **A specimen row's value pill claimed the whole line once it wrapped**,
  so `--space-10` ballooned to 283px and made its own row taller for no
  reason. It now keeps the width its text needs.
- **The foundation section set `margin-bottom: 1.8rem` inline**, a
  spacing value that is not on the scale, in the one block whose job is to
  prove the scale is used. Now `var(--space-7)`.

### Added

- **Per-project theme storage key.** `<html data-cm-theme-key="...">`
  selects the localStorage key, and `data-cm-theme-legacy="a,b"` lists
  any key the site used before. A value found under an old key is
  honoured and folded into the current one, so renaming a key never
  silently drops a visitor's saved theme. Unconfigured projects keep
  `cm-theme`.
- The theme toggle binds `[data-cm-theme-toggle]` **and** the
  `.theme-toggle` / `.icon` markup the oem projects already ship.

### Fixed

- **The runtime never shipped.** A relative `<script src="../js/cli-mono.js">`
  is not an Astro build asset, so the tag was emitted verbatim and `dist/`
  contained zero JavaScript. In the showcase that meant the theme toggle
  and every runtime feature were dead in the one place that demos them.
  Import the file instead so Vite bundles it.
- **The FOUC guard was rendered inside `<header>`**, which lives in
  `<body>` and runs after the stylesheets have painted. It now belongs in
  `<head>` and is the first node there, before even the charset
  declaration.

### Added

- **`.cm-row__icon`** — a fixed-width slot that centres a glyph or SVG
  beside a row, so the icon column stays aligned down the list
  regardless of what sits in it.
- **`.cm-rows--column`** — the flex-column row body (title over
  description) for dense indexes. The existing `.cm-rows--stacked` stays
  a block for prose-style rows; the two no longer compete for
  `flex-direction`.

### Fixed

- The showcase demonstrated `.cm-kv__hint`, which has never existed in
  the library, with a hardcoded inline margin. A new test asserts every
  `cm-*` class the showcase demos is actually defined, which is how this
  surfaced.

### Added

- **A spacing scale: `--space-0` … `--space-10`** (0.125 → 6rem), the only
  legal vertical and inline rhythm. The two layers previously carried **69
  distinct spacing values**, which is why two heroes built a week apart
  could not share a rhythm and why a tightened gap was indistinguishable
  from a bug. All 37 raw rem values in the library now resolve to a step;
  the largest visual change anywhere on the showcase is **2.4px**, and the
  page is 19px shorter. A test rejects any future raw rem/px spacing value
  in `base.css` or `components.css`, and one asserts the scale stays
  theme-independent so the two themes cannot drift apart.

### Added

- **`scripts/check-design-sync.sh`** — detects when a consumer project's
  vendored files drift from oem-ui source. With no arguments it scans every
  project under `/root/projects`; given paths it checks those. Exits 1 and
  names the fix command. Covered by two tests, both mutation-checked: the
  checker is executable, and it *fails* on a deliberately broken consumer.

  This exists because drift is silent. oem-links kept building and rendering
  fine for a week while 177 lines stayed stale, so every fix made in oem-ui
  after the initial migration was invisible there.

- **Layout regression tests.** The page had two left rails (content at 40px,
  header at 20px) because `main` reserves the gutter in `max-width` and then
  adds horizontal padding on top. Six new tests assert one left rail, one
  corner radius per surface, no doubled card padding, hanging indents, no
  mid-identifier wrapping, and nav separators between items only.

- **Checkbox/radio tap targets.** The drawn box is ~17px by design (it is a
  mark, not a target), but the row around it was only 17px tall too. The
  `.cm-field label` now has `min-height: var(--tap)`, so the whole row is a
  44px target on touch.

### Fixed

- **The drawn checkbox/radio still stretched on iOS.** Verified in real
  WebKit (the iOS engine) rather than Chromium: the box measured
  16.8×44, ratio 0.38 — a clear oval. `min-height: 0`, `align-self: center`
  and `aspect-ratio: 1` pin it to a square mark. The label row keeps the
  44px tap target; the control is the mark, the row is the target.
- `-webkit-appearance: none` now sits alongside `appearance: none`; the
  bare alias is ignored by older WebKit for form controls.

- **Drawn checkboxes and radios stretched into slabs.** Inside a label row
  carrying `min-height: var(--tap)`, a fixed-height child still stretched:
  measured 17x44 (ratio 2.62) instead of 17x17. Now `min-height: 0`,
  `align-self: center` and `aspect-ratio: 1`.
- **The unchecked state was invisible.** `--line` against the fieldset
  surface measured **1.25:1**; WCAG 1.4.11 requires 3:1 for a UI
  component's own edge. Now `--ink-dim` at 6.88:1.
- **The tick rendered as a dot.** Two 44-56% diagonal gradients inside a 3px
  inset shadow left a ~2px band on a 17px box. Replaced with a rotated
  pseudo-element.

- **Checkboxes and radios fell back to Arial.** `appearance: none` removes the
  native control and its font, so every drawn box rendered in Arial inside an
  all-mono design system. They now set `font-family: var(--font-mono)`.
- **Nav links hid their own headings.** The header is `position: sticky` with
  a z-index above the content, so jumping to `#buttons` resolved to top:63px
  while the header bottom was 61px — the heading rendered underneath it.
  `html` now has `scroll-padding-top` driven by a real `--header-h` token
  that the runtime publishes from the measured header via a `ResizeObserver`
  (the header wraps to two rows on a phone: 165px vs 61px, so no static value
  is correct).
- **The demo form mixed input types in one fieldset.** "listed in nav" and
  "pinned" are checkboxes while "public" and "unlisted" were radios in the
  same fieldset, implying a relationship that does not exist. Split into
  `visibility` (checkboxes) and `access` (radios).


- **Form controls.** `input`, `textarea`, `select`, `label`, `fieldset` and
  `legend` are now element defaults in `base.css`, so a bare `<input>` with
  no class is already on-brand — which is the form every one of the 59
  files across the fleet that uses a text field was re-declaring. Text is
  floored at 16px so iOS does not zoom on focus, and every control clears
  `--tap` on a coarse pointer. Checkboxes and radios are drawn rather than
  native, and the `select` arrow is CSS because the platform one vanishes
  against a dark surface.
- **Form layout:** `.cm-field`, `.cm-field__label`, `.cm-field__help`,
  `.cm-field__error`, `.cm-field__req`, `.cm-field-row` (two columns that
  collapse to one), `.cm-form`, `.cm-form__actions` (right-aligned, full
  width and stacked below 520px).
- The showcase is reachable from the LAN. `dev` and `preview` now bind
  `0.0.0.0` (set in both `astro.config.mjs` and the npm scripts) instead of
  Astro's `127.0.0.1` default, which refused connections from any other
  device. A contract test fails if either location loses the bind.
- `scripts/install.sh`. The repo is private and unpublished, so every
  install path the README documented was a 404: `raw.githubusercontent` is
  not readable anonymously, `npm i oem-ui` was never published, and the
  URLs pointed at branch `main` while the default branch is `master`.
  The installer copies the four files into one fixed layout (`--flat` for
  projects serving from a static dir), idempotently, and two tests keep the
  docs honest — one fails if Install prescribes a dead path, the other runs
  the real installer and diffs the result against the source.
- Mobile ergonomics belong to the shared layer. On coarse pointers every
  text-bearing component now floors at `--min-font` (12px) and interactive
  targets meet `--tap` (44px), so a new component inherits both by existing
  rather than by remembering to opt in. The floor is checked exhaustively:
  any selector declaring text under 12px must be covered, so the next
  small-text component cannot ship unfloored.
- `tests/mobile-check.html`, a dev-only harness that renders the built
  showcase at four device widths at once.

### Changed

- The header is styled in `components.css` rather than inside
  `Header.astro`'s `<style>` block. With the CSS scoped to the Astro file,
  every other framework got an unstyled header — the exact opposite of a
  reusable system. A test fails if the rules appear in both layers.

### Fixed

- The invalid form state never applied. `:not()` counts its argument for
  specificity, so the base `input:not(…):not(…):not(…)` rule landed at
  (0,3,1) and beat a plain `[aria-invalid]` at (0,1,1) — the state was
  written and silently lost in the cascade. The rule now matches the base
  selector's specificity, and a test asserts the counts. The state is
  carried by border weight and colour, since the palette is greyscale and
  hue would be the only cue available to a colourblind reader.
- The kicker's `~/` prefix rendered as `~ /`. The parent's `letter-spacing`
  is inherited by generated content, so tracking was applied between the two
  glyphs; the pseudo-element now zeroes it and restores the same gap as a
  margin, so the space after the prefix still matches the rest of the line.
- Inline `code` inside prose and key-value lists rendered at 11.81px on a
  phone. It is sized in `em`, which compounds below the floor, and was not
  matched by the `pre > code` rule; it is now floored at its definition.

- `pre` no longer widens the page on narrow viewports. A long line inside a
  flex or grid column stretched the document instead of scrolling inside the
  block, producing ~21px of horizontal overflow at 380px. `max-width: 100%` and
  `min-width: 0` on both `pre` and `pre > code` contain it; the block now
  scrolls internally.
- The header nav and link row can shrink (`flex-wrap: wrap` + `min-width: 0`),
  so a long nav wraps instead of forcing horizontal page scroll. A mid-range
  breakpoint tightens the link metrics so five links plus the brand stay on one
  row instead of stranding the last one.
- The key-value grid stacks below 520px. The two-column layout gave the value
  cell ~118px on a phone, which wrapped file paths through the middle of an
  identifier.

## [0.1.0] - 2025-09-26

Initial release. The design system behind oem/log, pulled apart into reusable
layers.

### Added

- `tokens.css` — layout, type, motion and color tokens for dark (default) and
  light, plus `data-cm-theme` scoping for subtree theming.
- `base.css` — element defaults, prose rhythm, themed scrollbar, focus rings,
  `prefers-reduced-motion`, `.cm-sr-only`.
- `components.css` — `.cm-*` components: buttons, list rows, status strip,
  page head, byline, list head, list-more, prose, media, cursor, rule,
  terminal panel, key-value grid, tag, footer.
- `cli-mono.js` — zero-dependency runtime: theme (FOUC-safe, persisted),
  sticky header scroll state, scroll-spy, copy-to-clipboard, footer year,
  external link hardening, Astro `astro:page-load` re-init.
- `src/astro/` — optional Astro components: `Head`, `Header`, `Footer`,
  `PageHead`, `PostHead`, `PostRow`, `StatusStrip`, plus `config.ts` as the
  single site-identity source.
- Contract test suite (`npm test`) asserting WCAG AA contrast from the real
  hex values, token single-sourcing, row truncation order, reduced-motion and
  focus-indicator presence, runtime dark-default and theme persistence, and
  that no Astro component hardcodes site identity.
- Showcase site rendering every component.

### Fixed

- Every text token passes WCAG AA (4.5:1) against every surface it renders on,
  in both themes. The original `--ink-faint` values failed (2.66:1 dark,
  3.31:1 light) while carrying real content (row descriptions, dates,
  key-value terms).
- List rows keep title and description on a shared baseline flex row. As
  inline text they collided, and the description overran the date column.
- Only the description truncates in a row. The title is the primary label and
  is never the thing the reader loses.
- Theme persistence uses a single `cm-theme` storage key and is applied
  before first paint, so a light-theme user no longer sees a black flash on
  load.

### Notes

- A frontmatter `import` of `cli-mono.js` in Astro is tree-shaken away and
  the runtime silently does nothing. Use a `<script src>` tag. Documented in
  the README and the test suite.
