# Changelog

## Unreleased — shadcn-parity primitives

- Added square-cornered kbd, pagination, avatar, native-exclusive accordion,
  aspect-ratio box, destructive button, joined button group, and left/top/
  bottom sheet variants. The right sheet remains the default.
- The runtime now supports opt-in single/multi `.cm-seg` groups,
  arrow/Home/End navigation in a popover menu, and a working search-clear
  button. All are delegated so dynamically inserted markup is covered.
- Verified the built gallery in WebKit at 320–1280px. The three batches'
  harnesses killed 6/6, 8/8 and 10/10 seeded faults respectively.
- **Table sort is now real.** The CSS drew a direction glyph from
  `aria-sort`, and the showcase declared `descending` on Method and
  `ascending` on Client, with nothing that ever sorted a row. The glyph
  rule named the BUTTON while the attribute lives on the `th`, so WebKit
  computed `background: rgba(0,0,0,0)` and `clip-path: none` — a live
  column indistinguishable from a dead one. Both are fixed: the rule
  reads the `th`, and `table[data-cm-sort]` opt-in sorting clicks,
  toggles, resets other columns, and applies a declared order at load.
  Numeric cells sort as numbers; rows are moved, never rebuilt.
- `install.sh` without a layout flag now updates the copy a project
  already serves (content-share identification, plus our own filenames
  so a badly stale runtime is still recognised) instead of writing an
  unserved `src/` copy beside it. It creates `src/` only when it finds
  nothing to update. Seven behaviour tests cover it.
- Added `.cm-progress` / `.cm-progress__fill`, the determinate sibling of
  `.cm-spinner`. The knob is ONE custom property — `--cm-progress` — and the
  fill stays 100% wide, translated out of sight by
  `translateX(calc(var(--cm-progress, 0%) - 100%))`: a width transition
  repaints layout, a transform interpolates on the compositor, and the
  track stays full-width so the empty part is a measurement rather than an
  absence. Height comes from `--space-1`; the fill's transition is silenced
  in the one reduced-motion guard. The showcase renders 33/66/100% bars as
  real `progressbar` elements, and the contract test asserts the four claims
  separately — the var() CAUSE, the semantics, the showcase demonstration,
  and the pairing that `aria-valuenow` and `--cm-progress` are the same
  number (the eye and assistive tech must not read two different values).
  Mutation-checked 6/6, each kill attributed to its own assertion.

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- **Every `<select>` in the library, and in every consumer, was an unmarked
  text box — the arrow was declared and then silently eaten.** `base.css`
  fills a field with the `background` SHORTHAND (`background: var(--bg-2)`),
  and the shorthand resets `background-image` to `none`. The arrow IS a
  `background-image` — two `linear-gradient` wedges in `currentColor` — and
  the arrow rule is a bare `select` at **(0,0,1)** while the field block is
  **(0,1,1)**. Source order could never have saved it.

  **MEASURED in WebKit on this repo's own showcase, before: 390x844 and
  1280x900 both computed `appearance: none` AND `background-image: none`.**
  The library removed the native arrow and painted nothing in its place, so
  the control had no affordance at all. Enumerating `sheet.cssRules` named
  the owner — the only way to tell "the declaration is missing" from "a
  higher-specificity rule is resetting it", and the two have different fixes.

  THREE fixes, each one found by measuring rather than by reading, and the
  last two only exist because the first two were measured:

  1. The field block fills with `background-color`, so `background-image` is
     no longer in a fight it loses.
  2. With the arrow painting, `padding-right` still computed **11.2px**
     instead of the declared **32px** — so the content box ended INSIDE the
     second wedge and a long option ran under the arrow. The arrow rule now
     repeats the field block's own two exclusions, tying it at (0,2,1) with
     source order settling the tie. Fixing the fill alone would have shipped
     an arrow that overlapped its own value.
  3. That same (0,2,1) then reached `<select multiple>` — a list box opens no
     popup, so a chevron on it is a control that does nothing — and forced
     the arrow onto it. The element rule now also excludes `[multiple]`.

  **AFTER, measured in WebKit at 390x844, 375x667 and 1280x900, both themes:**
  `background-image` is the two-`currentColor`-gradient pair, `padding-right`
  **32px**, and the arrow repaints with the ink — `rgb(232,232,232)` dark,
  `rgb(17,17,17)` light — from the same declaration, with no image, icon font
  or extra DOM. Zero page errors.

- **NEW: `.cm-select` / `.cm-select--multi`.** The arrow was only ever an
  ELEMENT default, and an element default cannot reach a **scoped** adoption:
  a `make-scoped-entry.mjs` consumer gets `components.css` and cannot import
  `base.css` at all (52 bare-element rules, and unlayered CSS outranks every
  Tailwind `@layer`). So a scoped consumer's selects fell back to the UA
  widget — a native chevron drawn for the platform, on a dark mono surface.
  This is the same gap `.cm-surface` closes for the page paint, and the same
  answer: put it in a class. `.cm-select--multi` is the second half — a list
  box drops the chevron and scrolls its own overflow.

  The class restates the ELEMENT DEFAULTS as well as the arrow —
  `appearance: none` above all, or a scoped consumer keeps the native widget
  **and** paints the gradient and the control shows **two chevrons**. That
  restatement is why a test compares the class against `base.css` property by
  property: two copies held together by a measurement is the `.cm-surface`
  pattern; two copies without one is a rebrand waiting to happen, and here it
  would also be a control that renders differently depending on how the
  consumer installed the library.

  Driven by a consumer, not imagined: spacetime-rpm carries three
  hand-`<select>`ed cert/ACL pickers styled with `.cm-code`, and
  spacetime-kanban two logged-in filters with a raw `appearance-none` +
  hand-written padding — five sites, two authors, one widget.
  **3 contract checks, 512 tests total. 20 mutations, 20 killed, 0 survived,
  0 no-ops.**

- **A `[popover]` dropdown could not be placed by CSS at all - every
  `.cm-dropdown` menu opened ~24,800px away from its own button.**
  `.cm-dropdown__menu` is `position: absolute` with `right: 0` and
  `top: calc(100% + 4px)` - all three written as if the containing block
  were `.cm-dropdown`. It is not: a popover lives in the TOP LAYER, and a
  top-layer element's containing block is the INITIAL CONTAINING BLOCK.
  So the UA's own popover default (measured in WebKit: `inset: 0;
  margin: 0; width: fit-content`) wins the horizontal pair - `left: 0`
  beats an over-constrained `right: 0` - and the `100%` in `top` resolves
  against the viewport's height.

  **MEASURED** on this repo's own showcase in WebKit, with the runtime's
  inline styles cleared so the reading is CSS alone:

  | viewport | `getComputedStyle(menu).top` | menu (document) | trigger (document) | menu when scrolled to the trigger |
  |---|---|---|---|---|
  | 390 x 844 | **`848px`** (844 + 4 = the ICB, not the parent) | **(0, 848)** | (40, 25576) | **24,286px above the viewport** - off screen |
  | 1280 x 900 | `904px` | **(0, 904)** | (356, 19116) | off screen |

  The `top` reading is the whole diagnosis: `calc(100% + 4px)` computing
  to the viewport height plus the gap means the containing block IS the
  viewport. CSS has no selector that can name the trigger, so the
  runtime anchors the menu instead - `position: fixed` at the trigger's
  right edge, four pixels below it, flipped above when it would leave the
  viewport, clamped inside, and re-pinned on scroll and resize while it
  is open.

  The listener is captured at `document` rather than bound per element:
  `toggle` does not bubble but it DOES pass through the capture phase,
  and a consumer that re-renders its rows replaces the menu nodes, taking
  any per-node binding with them. **AFTER**, measured in WebKit at
  390 x 844 / 375 x 667 / 1280 x 900: menu `position: fixed`, `dx` from
  the intended x **0 / 0 / 0.3px**, vertical **below / below /
  flipped-above**, all three fully inside the viewport, zero page
  errors. The defect was found by adopting a consumer, not by a test:
  **1 contract test, 4 mutations, 4 killed**, 0 survived.

- **The drift checker could not SEE a Python consumer, and a consumer it
  cannot see is one it cannot migrate.** `hermes-hearth`
  (`/root/browser-hub`, the hearth console, now the first Python
  consumer of this library) has no `.astro`/`.ts`/`.js`/`.css`/`.html`
  anywhere outside its vendored `cli-mono/`, so its reachability source
  set came out EMPTY and the whole pass silently skipped: it could vendor
  the library, load none of it, and report `in sync` every run. Two
  fixes - `*.py` joins the source set (**measured: 0 files -> 18**), and
  lines beginning `#` are stripped from the blob exactly as HTML comments
  already were (a filename in a Python comment is not a page loading
  it).

  Plus `EXTRA_CONSUMER_ROOTS` (default `$HOME/browser-hub`), because a
  consumer is not defined by where it lives: the no-argument sweep walks
  `$CONSUMER_ROOT/*/`, and this adoption was reported as neither a
  consumer nor a holdout. Known limit, written into the script: the name
  check is satisfied by `server.py`'s asset allowlist, so removing the
  page's `<link>` does not trip it - the page-level guarantee for a
  Python consumer is that consumer's own suite, which killed exactly that
  edit.

- **No `.cm-*` class painted a surface, so a scoped adoption had to hand-write
  one at every root — and omitting it renders BLACK TEXT ON A WHITE PAGE.**
  Every other class in the layer is padding and colour *within* a surface.
  The paint itself lives in `base.css`, on the bare `body` element — and a
  scoped adoption (`make-scoped-entry.mjs`) deliberately cannot import that
  file, because it is 52 bare-element rules and unlayered CSS outranks every
  `@layer` in a Vite/PostCSS build.

  The measured cost: **spacetime-memory** and **spacetime-kanban** both
  render `style={{ background: 'var(--bg)', color: 'var(--ink)' }}` by hand
  at the root of their tree. Two copies of one declaration, by two authors,
  which is the definition of a second implementation.

  `.cm-surface` is that paint as a class, and `.cm-surface--flat` drops the
  vignette for an app that already paints its own fixed chrome. It resolves
  only tokens the scoped entry already emits (`--bg`, `--ink`, `--vignette`,
  `--font-body`, `--text`), so a scoped adoption needs nothing the
  generator does not write.

  **MEASURED** in WebKit on the showcase, both themes: dark island
  `#e8e8e8` on `#0a0a0a` = **16.16:1**, light island `#111` on `#fafafa` =
  **18.09:1**. With the class stripped from the live page, the island
  computes `rgba(0, 0, 0, 0)` and the same `#e8e8e8` ink lands on the page
  behind it — **1.23:1**. Load-bearing, not decorative.

  The showcase demonstrates it as an ISLAND with a masked backing, not as a
  stripe on a page whose `<body>` already paints: nested inside the showcase
  a class with no declarations at all looks identical, which is exactly the
  defect, and a specimen that cannot fail is not a specimen. Five contract
  tests, including one that reads base.css's `body` and requires
  `.cm-surface` to agree with it — so a scoped adoption and a full one cannot
  paint the same product two ways. **6 mutations, 6 killed**
  (`scripts/mutate-surface.mjs`), 0 survived.

  The class sits beside `.cm-section`, not at the end of the layer, because
  two of this repo's own checks slice their block from a marker to END OF
  FILE — a new class appended after either marker reads as that block's
  private vocabulary and the suite goes red.

- **The README told scoped adopters to use a class that does not exist.**
  It stated that `base.css` "(`cm-theme` sets `background: var(--bg);
  color: var(--ink)`)". There is no `.cm-theme` selector anywhere in the
  library: `cm-theme` is the *storage key* the runtime writes to
  `localStorage`, a string. A reader following that sentence went looking
  for a rule that was never shipped, and the section's whole point — how to
  get a surface — had no answer. Corrected to name the bare `body` rule,
  to say plainly that `cm-theme` is a key rather than a class, and to point
  at `.cm-surface`. `spacetime-kanban`'s `App.tsx` carries the same wrong
  claim in a code comment and is fixed next cycle, when that consumer is
  migrated onto the class.

- **`install.sh <dir>` on a consumer whose app lives in `web/` writes a
  second, unserved copy at the repo root.** Re-vendoring after the surface
  change produced an untracked `src/js/`, `src/styles/` in
  **spacetime-kanban**, **spacetime-memory** and **spacetime-rpm**, plus a
  `cli-mono/` beside `web/cli-mono/` in **hermes-articles** — stray trees,
  none tracked, none served. The checker then reported each of those
  consumers ORPHAN and STALE while the real vendored files under `web/`
  sat untouched.

  What makes it a trap: this looks exactly like the drift the command was
  run to fix, and `check-design-sync.sh` itself recommends `install.sh`, so
  the tool's own advice manufactures the next problem. Re-vendoring was
  finished by copying the three stylesheets into each consumer's EXISTING
  `cli-mono/` directory. A `--web` flag that vendors under `web/` when an
  app is found there is the real fix and is NOT shipped in this cycle; it
  is the one loose end left behind.

- **A scrim the CONSUMER shipped never got its class, so on a phone the
  drawer had no veil and no way out.** `initNavToggle` looks for
  `[data-cm-nav-scrim]` and creates one only if the page has not got it
  already — and the class assignment lived *inside* that create-branch.
  Every rule that styles the scrim is `.cm-js .cm-nav-scrim`, a **class**
  selector, because the veil must not exist for a no-JS reader. So a
  consumer that ships its own node got an unstyled empty `<div>`.

  Two consumers do exactly that: `<div data-cm-nav-scrim />` in
  **spacetime-rpm** and **spacetime-kanban** — both React apps where the
  scrim belongs inside the tree, after the header.

  **MEASURED** in WebKit, drawer open, before → after:

  | | before | after |
  |---|---|---|
  | `className` | `''` | `cm-nav-scrim` |
  | box | **353 × 0** | 375 × 667 (and 393 × 852) |
  | `position` | `static` | `fixed` |
  | `opacity` | `1` (unconditional) | `0` closed → `1` open |
  | `pointer-events` | `auto` | `none` closed → `auto` open |
  | tap outside dismisses | **no** | yes (`aria-expanded` → `false`) |

  Zero height is the whole bug: `inset: 0` never applied, so there was no
  veil — and since the scrim is what swallows the outside tap, and the
  drawer covers the full 375px of a phone's width, a reader had no way to
  dismiss it except Escape.

  Fixed by applying the class to whatever node was found, created or
  supplied. `classList.add` is idempotent, so re-running `init()` over an
  already-bound document stays free.

  The new test runs the **real runtime** against a document that supplies
  its own scrim. A source regex cannot see this branch at all — the old
  assignment was present in the file and every `cm-nav-scrim` string check
  matched it happily. Mutation-checked: restoring the original
  create-branch-only placement fails it.

- **A GROUPED rail never got the rail's link geometry at all — and the
  showcase could not see it, because the showcase was not the shape.**
  Found by adopting `spacetime-kanban`, which is the second consumer to
  use rpm's rail markup. Every rail link rule was scoped with a direct
  child combinator, `.cm-header--rail .cm-header__links > .cm-header__link`,
  but a grouped rail nests a SECOND `.cm-header__links` inside each
  `.cm-header__group`, so its links are one level deeper and matched
  nothing.

  **MEASURED** in WebKit at 1280×900, one rail, two nests:

  | | flat rail | grouped rail (before) |
  |---|---|---|
  | `min-height` | 44px | **34px** |
  | `padding` | 0 20px | **1.6px 11.2px** |
  | `align-items` | center | **normal** |
  | `margin-inline` | 8px | **0px** |
  | current marker | `2px solid var(--accent)` | **`border-left-width: 0px`** |

  Two defects in one. The tap floor was gone — 34px is a fine pointer's
  inline row, and the rail is supposed to be 44px whatever the pointer is.
  And the current-page marker was *invisible*: the active rule set
  `border-left-color`, but the base rule's `border-left: 2px solid
  transparent` never applied, so the width stayed 0. A rail whose entire
  reason to exist is telling you where you are could not do that.

  The `>` was not gratuitous: a bare descendant selector restyled the
  showcase's own `.cm-header__link` SPECIMENS as rail rows (7 of them, at
  y=2622 and y=3551). Both constraints are satisfied by the rail block's
  own scoping — it sits inside `@media (min-width: 1000px)` and under
  `.cm-header--rail`, and the specimens are not under a rail — so the fix
  is a second selector joined by a comma, not a loosened one. **Both nests
  share ONE rule body**, which is what makes a later edit unable to give
  the flat case geometry the grouped case lacks.

  **The showcase is what let this live.** Its grouped specimen nested a
  plain `<div>`, so its links stayed direct children and every rail rule
  applied to them. The demo was passing because the demo was wrong. The
  specimen now nests a real `.cm-header__links` inside the group —
  rpm's shape — inside a real `.cm-header--rail`, with two labelled groups
  and five rows so the marker is visibly one row and not five. Nesting is
  **necessary and not sufficient**: every rail rule is keyed on
  `.cm-header--rail`, and a nest-only fixture matched no rail rule at all
  and measured `min-height: auto`, `display: block`, height 14.3px at
  1280×900 — a specimen demonstrating the unstyled links it was added to
  disprove, which is the same failure as the original one wearing a
  passing check. There is now a check for that too
  (`the grouped-rail fixture is a REAL rail, not just the nest`), and its
  `aria-current` assertion was added only after the first mutation sweep
  showed the older nest check surviving its deletion: the slice was
  delimited by a closing-div sequence the new markup no longer produced,
  the boundary index returned −1, and the assertion passed off *other*
  specimens' `aria-current`. 6 mutations, 6 killed.

  One existing test is **reversed in part**, and the reason is worth the
  space: `the rail link rules are scoped to direct children of the list`
  asserted the `>` for the specimen reason while remaining silent about
  the consumer reason. It could not tell "excluded a specimen" from
  "excluded every real grouped rail", which is why it was green for years
  against a rail that did not work. It is now two claims — nothing under
  a rail matches a bare `.cm-header__link`, and a group-nested link IS
  styled — and `a rail link keeps the tap floor` matches the selector LIST
  (`[^{]*`) so it still reads the rule that owns the property after the
  selectors are comma-joined.

  **6 mutations, 6 killed, 0 survived, 0 no-op** — run against the
  INDEXED tree, so no sibling cycle's uncommitted hunk could make a real
  kill look like a survivor. The mutations: drop the grouped selector;
  keep it but flatten `min-height` to `0` on the shared rule (the flat
  case still looks right, so only a grouped-scoped check catches it);
  drop the grouped current-link selectors; delete the showcase fixture;
  un-nest it back to a plain div (the original defect, reproduced);
  drop `aria-current` so no marker is demonstrated.

- **spacetime-kanban adopts the library (new consumer).** Its 13-item
  sidebar, its phone drawer and its mobile bar were a second
  implementation of surface the library already owns, so it silently kept
  every tap-floor and disclosure bug the library had since fixed.

  **MEASURED** in WebKit before the migration, at 393×852: the hamburger
  was **28×28**, all **15 visible buttons were under 44px**, nav rows were
  36px, and `cm-js` was never set on `<html>`. After: the rail links and
  the phone drawer measure **49px**, and the burger is the library's.

  The adoption is **SCOPED**, generated by `make-scoped-entry.mjs`. That
  is not a preference — measured against kanban's own built CSS, **5 of
  the library's 47 theme-independent tokens are declared by Tailwind with
  DIFFERENT values** (`--text-lg`, `--text-sm`, `--text-xs`, `--radius`,
  `--font-mono`), and Tailwind v4 var()-indirects every utility through
  them, so a bare `:root` import silently retypes the whole app. The
  library's own page surface came with it: the rail, the phone disclosure,
  the `cm-alert` and `cm-spec` vocabulary, and the runtime that sets
  `cm-js` and publishes `--header-h` for the anchor offset.

  The consumer's own suite (194 vitest tests) and `npm run build` both
  pass; `check-design-sync.sh` now sees it, which is the point — a
  consumer the checker cannot see is a consumer nobody migrates.

- **The stack primitive shipped a 204px sideways scroll to every project
  that adopted it.** Measured in WebKit at a 320px viewport:
  `documentElement.scrollWidth` was **524px**, against a 320px client —
  204px of sideways scroll on the showcase and on `oem-portfolio` and
  dev-blog both, all three of which had adopted `.cm-stack`.

  It was invisible in the source because the stack only changed the
  CONTAINER. Every over-wide child was already there and previously
  harmless, because block layout lets a child overflow instead of
  propagating. A column flex container does not: it lays children out on
  the cross axis, and a flex item's automatic minimum size is its content's
  min-content size, so the child pushes the container, and the container
  pushes the page.

  Four separate causes, each isolated by measurement rather than by
  reading the stylesheet:

  - the flex cross-axis minimum (`.cm-stack > *` needs `min-width: 0`);
  - `.cm-rows--inline .cm-row__title` had `flex: 0 0 var(--measure-title)`
    at 42ch — measured 328.72px — inside a row 240px wide. The basis is now
    `min(var(--measure-title), 100%)`: the same token, capped at the width
    the row actually has, so both promises hold at once (no silent shrink
    at 681-780px, no overflow at 320px);
  - `.cm-row__meta` had `min-width: 0` and `max-width: 100%` but no clip,
    so its `nowrap` content's scrollWidth (484px) propagated up through
    `overflow: visible` ancestors. `overflow: hidden` is the other half of
    that pair;
  - a table typed inside `.cm-prose` had no rules at all, so it fell back
    to UA defaults. `#prose` alone accounted for the last 4px; hiding any
    single `th` in it removed them.

  Also: the stack had **two** definitions that disagreed on `--tight`, so
  which step a page received depended on the cascade. One owner now.

  MEASURED after, at 320/360/402/480px: `scrollWidth` equals the viewport
  width at every one, against 524px at all of them before.

- **A `position: sticky; bottom: 0` action bar with nothing above it
  covered the page for its whole length.** `.cm-toolbar` is correct — a bar
  acting on a selection belongs where the thumb already is — but the
  showcase specimen was a bare child of a 48,000px section, so `bottom: 0`
  parked it on the viewport bottom for the entire document. Measured over
  the "spacing" prose and every section after it, at every scroll position,
  on all three viewports. The specimen now has the bounded container and
  the list a real selection acts on.

  `tests/verify-chrome-covers.py` walks the document in 400px steps at
  three viewports and fails if sticky or fixed chrome covers text or a
  control. Three of its own readings were wrong first and are documented
  in the probe: `scroll-behavior: smooth` makes `scrollTo` return before
  the scroll applies; sticky table headers and sticky columns legitimately
  overlap each other; and a chrome element trivially overlaps the elements
  inside it, so every bar "covers" its own buttons.

- **The library had tokens but no owner for the space between blocks, so
  five projects disagreed about it.** Measured at 390px in WebKit, the gap
  between the heading block and the content under it was **exactly 0.0px**
  in every project that used this library — oem-ui, oem-portfolio,
  dev-blog, oem-links and log.oem.ngo. One cause: `.cm-head` set no bottom
  margin and nothing else claimed it. Inside oem-ui the page had grown
  **128 hand-written inline margin declarations** to patch around it.

  A token scale cannot fix this. A token says *which* number is correct;
  it does not say *who applies it*. Without an owner, each project invents
  its own value and they drift apart by construction.

  `.cm-stack` is that owner. Put it on the page's main flow element and
  separation between its children becomes one value; `.cm-stack--section`
  is the top-level rhythm (24px, `--stack-section`). A stack owns its
  spacing outright, so `gap` and child margins must not both apply — hence
  `.cm-stack > * { margin-block: 0 }`, deliberately placed **last** in
  `components.css` because at equal specificity order decides, and earlier
  it lost every tie to `.cm-head`, `.cm-status` and `.cm-section`. Steps
  are one family: `--tight`, `--snug`, `--section`, `--airy`, `--loose`,
  plus `--flush` for children that must touch (a row list whose rows carry
  their own dividers).

  **MEASURED** after: **37 top-level joins, every one exactly 24.0px**, at
  320 / 390 / 402 / 768 / 1280px, and the same on the live log.oem.ngo
  after deploy. Reverting the class off `<main>` fails 20 of 37 joins;
  reintroducing a single inline `margin-bottom` on one section fails with
  a message naming the declaration.

- **The runtime now binds markup that arrives after it boots — a library bug
  no existing consumer could have found.** `init()` binds to whatever exists
  when it runs, and it is called once on `DOMContentLoaded`. In a static page
  that is the whole document, so it is correct. In a SPA it is nothing: the
  framework commits its tree *after* this module evaluates, so every
  `querySelector` in `init()` returns null and — crucially — nothing ever
  retries.

  The result is not a crash. It is a page that looks wired up and is not:
  `.cm-js` is never set, so the header's burger stays `display:none`; the
  sticky header never gets its scrolled shadow; and `initHeader` never
  publishes `--header-h`, so anchor jumps land under the bar.

  **MEASURED** on spacetime-memory's web app (React 19, Vite) in WebKit at
  390×844: with auto-init alone the burger measured **0×0** and could not be
  clicked at all. One manual `cliMono.init(document)` after the commit set
  `.cm-js`, gave the burger **44×44**, and opened the drawer with all 6 links
  at 781px. The runtime was always correct and the *order* was not.

  The fix is a `MutationObserver` on the `body` subtree that re-runs `init`
  when `.cm-*` markup actually appears, and it is bounded on purpose: a
  document that already has library markup arms nothing at all, and the
  observer disconnects as soon as one full pass binds. `init()` is idempotent
  — every binder guards on a dataset flag — so a re-run over already-bound
  nodes is free and cannot double-bind a click handler.

  **`subtree: true` is load-bearing and is asserted as such.** Without it,
  observing `<body>` reports only its direct children, so a React commit into
  `#root` is invisible and the SPA case is silently not fixed. The first
  mutation sweep reported this mutation SURVIVING, because the test's
  `MutationObserver` shim ignored its options argument and could not tell
  `subtree: true` from `subtree: false`. The shim now records what it was
  asked to watch.

  Two tests run the runtime against a document that is **empty at boot** and
  gains its header afterwards. A regex over the source cannot tell whether the
  re-run is reachable. Getting them honest took four shim fixes, and each one
  read exactly like a runtime bug: a bare `{}` for the button threw on
  `undefined.cmNavBound`; `getAttribute` written as an arrow threw on
  `this.attrs` because the runtime calls it *unbound* as
  `documentElement.getAttribute(...)`; `documentElement` needed a real `style`
  for `--header-h`; and the observer shim ignored its options.

  `tests/mutate-late-markup.mjs` ships in the same commit because it shipped
  with two real defects: it restored with `writeFileSync(TARGET, SNAP)`,
  passing the **path** instead of the **contents**, which truncated the
  runtime to one line and left the tree unparseable; and its final
  verification compared the file against a snapshot it had already deleted, so
  that corruption read as a clean restore. It now restores by content and
  proves the tree byte-identical before reporting. **7 mutations, 7 killed, 0
  survived, 0 no-op** — including one that correctly *survives* (appending an
  unmatchable selector only widens an OR-list) and is recorded as
  `SURVIVED-OK` rather than counted as a kill.

- **A new adoption path for consumers that cannot import the library
  globally: `scripts/make-scoped-entry.mjs`.** `install.sh` covers the easy
  case — a static site that can link `tokens.css`, `base.css` and
  `components.css` and let them reach `:root`. It cannot cover a consumer
  whose bundler inlines Tailwind into `@layer`s, and that consumer is real:
  hermes-articles (React + Vite + Tailwind) vendored four library files and
  imported none of them, so its 385 markdown tables kept a second,
  hand-rolled implementation of surface the library already owns.

  Two of the three stylesheets cannot simply be imported there, and the
  reasons are worth stating because both are silent:

  - `base.css` carries **52 bare-element rules**, and unlayered CSS outranks
    every Tailwind `@layer` regardless of specificity. Importing it whole
    overrides the consumer's own utilities.
  - `tokens.css` declares its entire scale on a bare `:root`. Importing it
    leaks the library palette to the document root — and this consumer's
    `--accent` (library grey vs app blue) and `--radius` (10px vs 0.5rem)
    collide on the way in.

  What is safe to import is `components.css`: every rule in it is either
  `.cm-*`-scoped or a non-`cm-` class only ever emitted as a compound under
  a `.cm-` parent, plus `html` and a media-query `pre`. That was measured,
  not assumed.

  So the generator emits a scoped entry point instead: the `@import` of the
  consumer's own vendored `components.css` **first**, then the
  theme-independent scale copied verbatim from `tokens.css :root` and the
  two `[data-cm-theme]` colour blocks copied verbatim from the themed ones,
  all re-scoped to `[data-cm-theme]`. The consumer opts in with the
  library's own documented scoped hook, so nothing reaches the document
  root. Copying rather than importing is what makes it drift-proof, and it
  has to be copied: a hand-written scale was measured **wrong in 17 of 44
  values** on the first attempt at exactly this.

  `--check` is the anti-rot guarantee and is what the two drift mutations
  kill: a rebrand that changes `tokens.css` fails the check rather than
  silently missing the consumer.

  Three defects this path reproduced, each of which shipped a green build:
  the `@import` emitted after a declaration block (PostCSS drops it — the
  built CSS then held **0** occurrences of `cm-prose-table` while the build
  still succeeded), a vendored path guessed wrong with no warning at all,
  and a vendored `cli-mono.js` so stale it predated `initTableLabels`.

- **The reset-safe list marker only worked in one of two load orders.** The
  `ul, ol { list-style-type: disc }` default added in f679a8b is `(0,0,1)`, and
  Tailwind v3 preflight's `ol,ul,menu{list-style:none}` is *also* `(0,0,1)`.
  Equal specificity means the winner is decided by source order, so the reset
  wins outright whenever it loads after the library — and a Vite/PostCSS build
  inlines `@tailwind base` into the same stylesheet as the consumer's own CSS,
  so which file is imported decides the outcome.

  MEASURED in WebKit at 390px against a real preflight: preflight-first gives
  `ul { list-style-type: disc }`, preflight-after gives `none`. In the losing
  ordering every bullet and number in every article disappears while
  `padding-left` still reads 1.4em, so the paragraph renders as a deliberate
  list with nothing in it. This is the library's own claimed consumer:
  hermes-articles renders 1,772 bullet items across 35 articles, and its build
  currently inlines preflight ahead of nothing at all (it vendors four library
  files that nothing imports).

  The obvious fix is a regression, and it was measured before being rejected.
  `.cm-prose ul` is `(0,1,1)`, which beats the reset — and also beats every
  markerless rule in the library, all of which are `(0,1,0)` (`.cm-rows`,
  `.cm-cards`, `.cm-projects`, `.cm-timeline`, `.cm-swatch`). A `.cm-rows`
  nested in prose goes from `none` to `disc`, putting a bullet on every row of
  every list component.

  What ships is `.cm-prose ul:not([class])` at `(0,2,1)`. It beats the reset in
  **either** order and cannot match a list that carries a class, because a
  classed list belongs to whoever gave it the class. Measured, both orders:

  ```
  prose ul   disc        ol   decimal
  .cm-rows   none        .list-none  none
  ```

  The tests assert the **selector**, not the value: a surviving
  `list-style-type: disc` with the specificity guarantee dropped passes every
  value-shaped check and reintroduces the bug. The mutation harness carries
  that inert-value mutant explicitly, and the flat `.cm-prose ul` form that
  looks equivalent and is not.

- **`install.sh --astro` shipped the components without the module they
  import, so `<Header>` could not be installed and used.** `Header.astro` and
  `HeaderLink.astro` both do `import { isCurrentPage } from './current'`, and
  the installer's loop matched `*.astro config.ts` — it copied both components
  and not `current.ts`.

  Every green signal agreed the installer worked: `ls` succeeded, the install
  exited 0, and `check-design-sync.sh` reported the consumer **in sync**.
  The consumer's build stayed green too, for the worst possible reason — an
  unresolvable import only fails when something imports that component, so a
  site that had not yet adopted `<Header>` never compiled it.

  REPRODUCED against a real Astro consumer (`links.oem.ngo`) on 2026-10-04.
  With the helper removed, `astro build` exits 0 and emits only `/index.html`.
  Add one page importing `<Header>` and the build fails:
  `Module not found. src/astro/HeaderLink.astro:2:30`. So the library's
  flagship component — the one carrying the measured 18×44 tap floor and the
  phone burger, the fixes `--astro` exists to deliver — was uninstallable in
  practice, and `current.ts` is only the first shared helper to land.

  Fixed by installing the whole closure (`*.astro *.ts`), and asserted by a
  new check that parses every relative import out of every shipped component
  and requires it to resolve **in the installed tree**. That derivation
  matters: listing `current.ts` by hand would pass again the moment the next
  helper landed, which is the same hand-kept list that caused this. The
  resolver mirrors Vite's (extensionless specifiers, `?raw` suffixes) so it
  reports a missing module rather than a spelling difference.

  Four mutations, all killed: reverting the glob to `*.astro config.ts`;
  dropping it to `*.astro`; adding a new helper a component imports; and
  that last one with the shipped-list check neutralised, which only the
  closure check catches.

- **Three element defaults an article body needs were inherited from the
  user agent, and every CSS reset in existence erases that.** An article body
  is the one surface whose markup is not written by hand: it comes out of a
  markdown renderer as bare `<ul>`, `<ol>` and `<th>`. `list-style-type` on
  the lists and `font-weight` on the header cell are UA defaults, so a
  consumer adopting this library on any reset-based stack — Tailwind,
  Bootstrap, most frameworks — loses them.

  MEASURED in WebKit at 390 and 375, this `base.css` with a Tailwind v3
  preflight ahead of it: `ul` and `ol` computed `none` instead of `disc` /
  `decimal`, and `th` computed `400` — identical to every `td` beside it.

  Both failures are silent, which is what made them worth fixing. The bullet
  list keeps its `padding-left: 1.4em`, so it still reads as a deliberate
  indent with nothing in it. The header cell keeps its background and its
  colour, so it still reads as a header while every cell in the table weighs
  the same. Across hermes-articles' real corpus: 1,772 bullet items and 818
  numbered ones in 35 articles.

  Nothing regresses, checked rather than assumed: `.cm-rows`, `.cm-cards`,
  `.cm-stats`, `.cm-meters` stay markerless at (0,1,0), `.cm-table th` keeps
  its deliberate 400 and `.cm-prose-table th` its 600.

  Demonstrated by a new `#proselists` showcase section holding exactly what
  a renderer emits — a classless `<ul>`, a classless `<ol>` and a bare
  `<th>` table. 483 tests pass (4 new), 12 mutations all caught, and the
  WebKit verifiers report 18 measurements for the declaration and 54 for the
  rendered section.

- **oem-portfolio adopts the library's project cards, and two gaps it hit
  on the way come back as `.cm-prose-measure` and `.cm-inline-link`.**
  `218ac5b` promoted oem-portfolio's project cards into the library as
  `.cm-projects` / `.cm-project` — but the promotion copied the CSS and
  never migrated the emitter, so the site kept shipping its own
  `project-grid` / `project__*` alongside. Two implementations of one
  component, and the consumer's copy is the one that cannot receive a fix.
  This cycle migrates the markup and deletes the duplicate rules.

  Measured before and after in WebKit (390×844 and 1440×900), the grid is
  unchanged: `276px 276px 276px` / `350px` columns, 16px gap, 120px cards,
  left edges 290/582/874 at desktop and 20 on a phone. The one intended
  delta is the card's fill, `rgb(17,17,17)` → `rgb(26,26,26)`: the library
  paints a card on `--panel-nested` because `--panel` on `--panel` is a
  1.008 contrast ratio — one 255th of a difference — which is why three
  levels of enclosure used to read as the same plane.

  The consumer's copy had already drifted where the library had moved on.
  Its `.split` was missing `.cm-split__aside { min-width: 0 }`, and its
  hover rule was scoped `a.project:hover` while the library's is
  `.cm-project:hover` — the library version is right, because the reserved
  slot is a `<div>` that must not carry a hover state at all.

  Four rules went with the migration because nothing emitted them:
  `.project__stack li` (the page emits `<span class="cm-tag">` children,
  not `<li>`), `.project__private`, `.project-page__links`, and
  `.inline-link`. `src/styles/global.css` goes from 306 lines to 56, and
  the only rule left in it is the underline treatment on bare links.

  **1. `.cm-prose-measure` — new.** Prose beside an aside was still sized
  by the page rather than by the reader's column: `body` sets `--maxw` for
  a full-width column, so a `.cm-split`'s prose block inherits the whole
  page width. oem-portfolio's project page hardcoded `max-width: 68ch` to
  work around it — which is exactly what `--measure` already holds. A
  consumer re-typing a token as a literal is how a token quietly stops
  being a token, so the value becomes a class that references it. The
  `> :first-child { margin-top: 0 }` reset is load-bearing, not tidiness:
  MEASURED 40px of dead space above the first paragraph without it.

  **2. `.cm-inline-link` — new, and it is a measured bug rather than a
  style.** The coarse-pointer block in `base.css` puts
  `min-height: var(--tap)` on bare `a`, and **min-height does nothing on
  an inline box** — so every link inside running prose escaped the floor.
  MEASURED in WebKit at an iPhone viewport: 34px tall. `inline-block` is
  the only display that honours the height while still flowing inside the
  sentence; the vertical padding is then cancelled by a matching negative
  margin so the hit area grows without the paragraph gaining space.

  That last part is the one worth keeping, because the naive fix is
  invisible to every other check. MEASURED differential on the showcase at
  390px, paragraph height ÷ line-height: **10.9988** with the negative
  margin, **11.8321** without it — 4.83px of padding pushed the block past
  its own last line. Both builds wrap to eleven lines, so a line-count
  assertion passes the broken one. `tests/verify-inline-link-webkit.py`
  asserts the ratio is a whole number, and separately that the link reaches
  44px and is not `display: inline` — because those two are the same bug,
  and a test that checks one half cannot see the other.

  Contract tests for both, and a mutation harness
  (`tests/mutate-prose-measure.mjs`): 13 mutations, 13 killed, 0 survived,
  0 harness errors. Six of them target the inline-link invariant alone —
  `display: inline`, a deleted `min-height`, a deleted negative margin, a
  literal `44px`, a deleted underline and an untinted one are each killed
  on their own.

  **3. The affordance, found by looking at the screenshot.** Vision
  reported the specimen as showing no link affordance, and it was right.
  `base.css` gives bare `a` `--ink-dim` with no underline while
  `.cm-prose` sets its body to `--ink`, so a link inside a paragraph
  measured **2.24:1 against the text around it** in dark and **2.13:1** in
  light — a link quieter than its own sentence. It still clears AA against
  the *page* (7.21:1 / 8.49:1), and that is the trap: both numbers are
  true, and only one of them describes whether a reader sees a link,
  because the comparison that decides that is the paragraph rather than
  the page. An AA-against-the-background check cannot see this class of
  defect at all. `.cm-inline-link` is now underlined, tinted
  `--ink-faint` — which is how a link reads without relying on colour.

- **`.cm-search` is demonstrated, tokenised and — for the first time —
  actually focusable. Three of the ten rpm pages that ship it had no
  working focus ring at all.**
  The previous cycle added the component's CSS and shipped it with three
  defects that no test could see, because there were no tests and no
  showcase section. Ten `spacetime-rpm` pages (`web/src/components/
  SearchField.tsx` plus nine raw inputs) already emit this markup.

  **1. The focus ring did not exist.** `.cm-search__input:focus-visible`
  declared `outline: 2px solid var(--focus)` and `--focus` was never
  declared in any layer. An undefined custom property inside a shorthand
  invalidates the declaration at computed-value time, so the entire
  `outline` shorthand collapsed. MEASURED in WebKit at 390×844, 375×667 and
  1440×900 before the fix: `outline-style` computed to **`none`**. There
  was no ring to see, in either theme, on any page. A CSS-text scan reads
  that line as perfectly well-formed, which is why it survived. `--focus`
  is now declared in `:root` as an **alias** of `--accent-dim` — `var()`
  substitutes at computed-value time, so each theme paints its own value
  and there is no second hex to keep in step.

  **2. The field was under the 16px form-text floor.** `font-size:
  max(var(--min-font), var(--text-sm))` computed to **14px**. iOS zooms the
  viewport on focus for any form text under 16px, so tapping the search
  field zoomed the whole page and left the reader panned into a layout
  they could not get back from. The base `input:not(...)` rule carries the
  16px floor, but it now *excludes* `.cm-search__input` by name (to win the
  padding specificity fight), so nothing else was setting it. MEASURED
  16px after the fix.

  **3. A modifier rpm ships and the library never defined.**
  `SearchField.tsx` emits `cm-search cm-search--wide`; there was no such
  rule, so the wide variant silently rendered at the default measure.

  Also fixed while measuring:

  - The glyph had no `width/height`, so a lucide icon rendered at the
    replaced-element default (24px) — wider than the 16px the left-gutter
    arithmetic assumes. Now `1em`, the same rule `.cm-btn > svg` states.
  - The clear button's `32px` and the input's `padding-right` were two
    independent literals. Both now derive from a new token,
    **`--search-clear: 32px`**, so a typed value cannot run under the X the
    moment the button changes size. The input's bare `44px` became
    `var(--tap)`.
  - The clear button was 32px of chrome on a phone too. It now takes
    `var(--tap)` under `@media (pointer: coarse)` and stays 32px on a fine
    pointer — measured 44px coarse / 32px fine at 390px, 375px and 1440px.
  - **The showcase section omitted `cm-search__input` from its own inputs**,
    so four of the classes it demonstrated were unreachable on the built
    page. Caught by the reachability test, not by a screenshot.

  The showcase now has a `search` section demonstrating both states (empty
  and filled, since the clear button only exists once there is something to
  clear) and the `--wide` modifier. 15 mutations, all killed:
  `python3 tests/mutate-search.py`.

- **Three tests that were watching a SHAPE, not a rule, all failed the moment
  a real rule changed shape. Fixed so they watch the invariant.**
  HEAD arrived red at 453 passed / 3 failed. None of the three was a
  regression in the library; all three were probes that had grown too
  specific to notice a legitimate change.

  1. `the code field cannot re-break the 16px form-text floor` hard-coded the
     base input selector's exact `:not()` chain. Adding
     `.cm-search__input` to that chain — a correct fix for a real
     specificity bug — made the test report *"the base input selector was not
     found; this test is watching the wrong rule"*, which is exactly what it
     says, and what it was doing. The chain is now matched as a repeated
     `(?::not\(\.[a-z0-9_-]+\))*`, so the invariant survives the chain
     growing. Two traps inside that rewrite, both measured:
     - the char class must include `_` and digits, or it stops at
       `.cm-search__**input**` — a probe reading as "the rule is gone" while
       the rule is right there;
     - every repeated group needs its **own** colon: `(?::not\(...\))*`, not
       `(?:not\(...\))*`. The second is a well-formed regex that matches the
       literal text `not(` and returns null. That single typo cost three
       rebuild cycles before it was read out character by character.
  2. `every var() a component rule names resolves to a declared token` read
     `var(--x)` and flagged every fallback as dangling. The sheet uses
     `var(--x, default)` deliberately in five places (`--header-h`,
     `--table-max-h`, `--cm-stat-cols`, `--cm-cards-cols`, `--cm-meter-fill`),
     so the check cried wolf on five correct rules. It now separates the two
     cases: only a var() with **no** fallback is unresolved. Its self-check
     also compared the unique-name count (69) against a threshold of 100,
     when tokens.css holds 139 *declarations* and ~69 *names* — the dark and
     light blocks redeclare the same names, which is the point of a theme
     pair. The assertion now counts declarations and separately floors the
     name count.
  3. A stray `declsFor(...)[0]` in this cycle's own new test indexed the
     *first character* of a joined string, so a passing rule read as a
     failing one. Worth recording because the failure is silent and looks
     like a CSS defect.

- **`--search-clear` (32px) is the chrome size of an inline clear button,
  and it is deliberately not `--tap`.**
  Whether a control takes the tap floor is a question about the POINTER and
  the control's ROLE, so it is answered in `components.css`
  (`.cm-search__clear` steps to `var(--tap)` under
  `@media (pointer: coarse)`), while the *chrome* size is a token so the
  input's `padding-right` can be derived from it. A `--tap-sm` was tried
  once before and deleted: with `--tap` also 44px it made `.cm-btn--sm`
  compute exactly `.cm-btn`'s height, so a "small" variant rendered at
  44px and the dense-row decision it exists for was gone.

- **`<Footer status>` takes fragments now, because a site that wanted a
  sequenced status had to hand-build its separators — and built the ones this
  library had already deleted.**
  `status` was a single string, so the status line was a bare text node with
  no layout at all. A site whose status is a *sequence* ("● all systems
  nominal │ ● sig: origin only") had no way to express that, so it built the
  separators itself. dev-blog did exactly that, and the shape it built is the
  one `d2ec654` removed from the meta row: a `::after` on
  `:not(:last-child)`, which attaches the separator to the item it *follows*
  and therefore strands it at the end of every wrapped line.

  MEASURED on dev-blog's live footer before this change, in WebKit, by
  reading the rendered `::after` of the last item on each visual line:

  | viewport | lines | lines ending with a separator |
  |---|---|---|
  | 390×844 | 3 | **2** |
  | 402×874 | 3 | **2** |
  | 360×640 | 3 | **2** |
  | 320×667 | 3 | **2** |
  | 430×932 | 2 | **1** |
  | 1280×900 | 1 | 0 |

  Five of six viewports, every phone width — on a live consumer, in
  production, six weeks after the library deleted the pattern.

  `status` is now `string | string[]`, and the row is a wrapping flex row
  using the *same pairing* as `.cm-footer__meta`: the separator is a
  `::before` on the fragment it PRECEDES, so whatever follows it belongs to
  the same flex item and the two cannot be split across a wrap. A string
  still works and renders byte-identically to before (one fragment, one
  leading dot), so this is additive for every existing caller — links and
  oem-portfolio both pass a string today.

  The showcase fixture is three fragments *on purpose*: two fit on one line
  at every width down to 320, so a two-fragment fixture never produces the
  wrap that the invariant is about. Measured — the row wraps at 390/402/360/
  320/430 and does not at 1280. `::before` costs a wrapped line may now
  *start* with a separator; that is the tradeoff of the direction, not a new
  bug, and it is the reason the assertion is "no line ENDS with a separator"
  rather than "no line contains one".

  Verified in WebKit at 390×844, 402×874, 320×667, 360×640, 430×932 and
  1280×900 (`tests/verify-footer-status-webkit.py`): zero stranded separators
  at every width. The same probe was run against an `::after` mutant and
  reported the strand at all five phone widths, so the check can fail.

  Twelve mutations, all killed: `scripts/mutate-footer-status.mjs`.

- **`.cm-btn--sm` was not smaller than `.cm-btn`. It was the same button.**
  The previous entry in this file added `--tap-sm: 44px` and pointed
  `.cm-btn--sm` at it, on a principle that is correct and an implementation
  that defeated itself: *"a smaller label may shrink a control's chrome,
  never its hit area."*

  With `--tap` also 44px, that made the small variant compute **exactly the
  base button's height**. MEASURED in WebKit by isolating each variant in an
  identical empty container, so the comparison is like-for-like rather than
  two different rows of a button group:

  | viewport | `.cm-btn` | `.cm-btn--sm` | |
  |---|---|---|---|
  | 402×874 (coarse) | 44 | 44 | floor applied |
  | 375×667 (coarse) | 44 | 44 | floor applied |
  | 1280×900 (fine)   | 44 | **28** | variant is real |

  A modifier that renders its base's box is not a modifier. It passed every
  existence test in the suite because the class was still *defined* and still
  *rendered* — the only thing wrong was that it did nothing.

  `--tap-sm` is deleted, and the floor is asserted **per pointer** instead,
  which is the question that was actually being asked:

  ```css
  .cm-btn--sm { padding: 0.4em 0.9em; font-size: var(--text-xs); min-height: 0; }
  @media (pointer: coarse) { .cm-btn--sm { min-height: var(--tap); } }
  ```

  28px next to its neighbours where density is the point; 44px for a thumb.
  This is the mechanism `.cm-copy` and `.cm-state__actions .cm-btn` already
  use, and it has to live in `components.css` rather than `base.css`'s
  coarse-pointer block, because `base.css` loads first and a rule there would
  lose the cascade to `min-height: 0` at equal specificity, silently.

  **A test that forbade this was wrong, and is recorded as wrong.** One
  asserted the coarse-pointer floor must *never* touch `.cm-btn--sm`,
  "because that resizes every dense toolbar row on a phone". MEASURED at 402
  and 375: the floor costs **16px** of extra height in one `.cm-btn-group`
  and adds **zero** extra wrap lines — every group wraps to the same 3 lines
  either way. It was defending a 16px cost against a 28px tap target on a
  phone. It now asserts the rule stays *scoped* to `.cm-btn--sm` and comes
  from the token, which is the thing that would actually have leaked.

- **Two modifiers shipped by rpm were never rendered by the showcase.**
  `cm-row__meta--nowrap` and `cm-row__meta--tight` have been in
  `components.css` and in production use since the 20:18 commit —
  `ProxyHosts.tsx` emits both literally — while the "every class the library
  defines is rendered somewhere" test had been reporting them as dead. The
  deep-audit script excused them as *"proven: GENERATED by a component prop"*,
  which is a heuristic that greps `src/astro/*.astro` for a template literal
  and cannot tell a component-generated modifier from one a consumer's JSX
  emits by hand. An excuse is not a demonstration: the showcase now renders
  both, with the same address twice so `--tight` is visibly doing something.

  MEASURED at 402 and 375: the tight slot's children are separated by
  **4.2px, 0px, 0px** — one space before the address, and none at the colon,
  which is the whole point. The un-tightened slot spaces every child.

- **The card/meter colour scan could not see a real hex, and could see a
  comment.** That check reads the raw file on purpose, because the block
  marker `/* ---------- cards ----------` *is* a comment and a stripped read
  finds nothing. That is right, and it had a cost: the block's own
  measurement note cites two hex values (`--bg-2 (#101010)` on
  `--panel (#111111)`) and the scan tripped on the explanation of why the
  rule exists. The marker lookup now happens on raw text and the colour scans
  run on the slice with comments stripped — the scan is about declarations.
  The note stays; deleting the measurement to make a test green is backwards.

- **`tests/mutate-tap-floor.sh` — 12 mutations, all killed.** Every
  assertion above has been broken on purpose and confirmed to go red,
  including the two that did not at first:

  - The sweep initially reported **3 survivors** that were no-ops, because it
    mutated `src/pages/` without rebuilding and the reachability test reads
    `dist/index.html`. A sweep that skips the rebuild manufactures
    confidence out of nothing; it now rebuilds before each run.
  - `.cm-btn` matched **two** rules carrying `min-height: var(--tap)`, so an
    unscoped regex matched the second and a mutation flattening the *base*
    to `min-height: 0` left the suite green. The assertion is now scoped to
    the first `.cm-btn {` rule.
  - Two further "survivors" were genuinely broken mutations — `.replace(x, 1)`
    against a class rendered on two rows — not weak tests, and the harness
    now asserts its own patterns matched.

  A sweep that cannot count its own kills reports success for a mutation that
  never landed, so `KILLS` and `TOTAL` come from one counter and any survivor
  exits non-zero.

- **`install.sh --astro`: the components are now installable at all.**
  Until this flag existed, `install.sh` shipped the three CSS layers and
  the two JS files — and **nothing from `src/astro/`**. The components are
  the largest part of this library and they carry the fixes that matter to
  a consumer: the 18×44 tap floor on the header's icon link, the phone
  burger, and the generated footer separator that cannot strand at the end
  of a wrapped line. The installer shipped the stylesheet that *styles*
  them without ever shipping them, so a consumer had no supported way to
  adopt them and hand-rolled a parallel implementation instead.

  That is not theoretical. `links.oem.ngo` — live, in production — is
  carrying the exact shape this library deleted in the entry below. Its
  footer emits separators as **elements** (`<span class="dot">·</span>`)
  inside a `flex-wrap: wrap` row. MEASURED in WebKit against the live site
  at 320/360/390/402/430 × {667,844}: **a line ends with a stranded `·` at
  10 of 12 phone widths**, and at 320×667 the footer renders three lines
  for three fragments. Its header is equally hand-rolled: the theme toggle
  measures **32×32** against this library's 44px floor, and the `<header>`
  carries **no `.cm-*` class at all**, so the scroll-spy and
  `[aria-current='page']` rules cannot see it.

  The drift checker could not name any of it, and that is the real lesson.
  `check-design-sync.sh` compares the five vendored files byte-for-byte and
  they genuinely are in sync where they exist — the defect lives in files
  the checker does not know exist. A check that only verifies what it can
  see is green precisely when the divergence moves somewhere it cannot
  reach.

  ```
  scripts/install.sh <project> --astro     # -> <project>/src/astro/
  ```

  **`config.ts` is the one file the installer will not overwrite.** A
  component copy is a vendored artifact: re-syncing it is the point, and
  drift is a bug. `config.ts` is the opposite — it holds the site's own
  title, author and email, so overwriting it would republish the
  library's placeholder identity over a real site on the next routine sync.
  It is kept, and the skip is **reported by name**, so "the installer ran"
  never reads as "the installer overwrote my site".

  **`CodeBlock.astro` was shipping untested.** The suite's shipped-file
  list was the only place the component set was written down, and
  `CodeBlock.astro` was missing from it — so it was invisible to the tests
  while the new installer copied it into every consumer. Both directions
  are now asserted: each listed component exists and is non-empty, **and**
  every `.astro`/`.ts` file in `src/astro/` is claimed by the list. Nine
  mutations in `scripts/mutate-install-astro.mjs` (8 killed, 1 documented
  expected survivor) cover the flag, the copy, the config protection, the
  re-sync and the completeness check.

- **A footer separator that cannot strand itself at the end of a wrapped
  line.**
  `.cm-footer__meta` is `flex-wrap: wrap`, and the separator between meta
  fragments used to be a `<span class="cm-footer__bar">·</span>` — its own
  flex item, like any other. So it could be the **last thing on a line with
  nothing after it**: `© 2026 @omiinaya ·` on line one, the fragments on
  line two. MEASURED in WebKit on the showcase: stranded at **320, 360,
  390, 402 and 430** — every phone width tried.

  The separator is therefore no longer an element. It is generated by the
  item it **precedes**, so it belongs to that item and the two can never be
  split across a wrap:

  ```css
  .cm-footer__meta > *:not(:first-child)::before { content: '·'; }
  ```

  Three details, each of which is a mutation in
  `scripts/mutate-footer-sep.mjs`:

  1. **`::before`, not `::after`.** An `::after` on `:not(:last-child)`
     also stops the separator being its own flex item, but it keeps the
     dot attached to the **preceding** item — so when that item ends a
     wrapped line the dot is still the last thing on it. Same bug, other
     position. A probe that only looked for a separator *element* reports
     the `::after` version as clean; only measuring the last item per
     visual line catches it.
  2. **`:not(:first-child)`**, so the row does not lead with a dot.
  3. **The glyph is asserted, not the property.** `content: none` is
     *declared*, so a `/content/` match passes it.

  The invariant this buys: a wrapped line may **start** with a separator
  and never **end** with one. `tests/verify-footer-sep-webkit.py` measures
  the rendered geometry at five widths and is proven to fail on the old
  markup (`REPRODUCED: 1 line ends with a stranded separator`).

  **`.cm-footer__bar` is deleted, not kept as a shim.** `sullen.sh` and
  `oem-portfolio` were the last two emitters; both are migrated and the
  class is gone. A back-compat rule for markup nobody ships is dead CSS
  with a comment explaining why it is dead — the exact thing the
  reachability check exists to refuse. Both consumers are now **in sync**
  per `check-design-sync.sh`, and oem-portfolio's own 30 tests pass.

- **A table for prose, because every article-shaped consumer hand-rolled
  one — and got a scrollbar under every table in the article.**
  `.cm-prose-table` — the table that lives *inside* a paragraph, as
  distinct from `.cm-table`, which is a data grid. This is not an
  imagined component: `hermes-articles` renders **397 markdown
  pipe-tables across 34 of its 35 articles** and had no library
  component for them, so its `index.css` carries a second implementation,
  `.article-content .table-wrapper`, with `min-width: max-content` —
  which forces horizontal scrolling on **every** table whether or not it
  needs one. Three decisions are measured rather than chosen, all in
  WebKit:

  1. **`table-layout: fixed`.** `width: 100%` on a table is *advisory*
     against the cells' intrinsic min-content width. On the six-column
     showcase fixture, `table-layout: auto` laid the table out at
     **1074px inside a 739px column** — 335px past the edge, at both
     860px and 1100px viewports. This is the one that matters: it is
     invisible in a screenshot of a narrow table.
  2. **`overflow-wrap: break-word`, and specifically NOT
     `word-break: break-word`.** The two sound interchangeable and are
     opposites in practice — `word-break: break-word` breaks *eagerly* at
     every character, producing rows of **44 lines**, one word per line,
     and a URL cell 60px wide and 1071px tall. Verified by A/B in the
     live page rather than reasoned about, because reading the source
     proves nothing about the cascade.
  3. **Below 760px each row stacks** into a labelled block, with the
     column name read from `data-label` via `content: attr()`. The
     breakpoint came from geometry rather than taste: the table has 0px
     of overflow of its own column at *every* width tested, so overflow
     is not the reason to stack — but six columns share 96px each at
     700px, and a sentence in a 96px column is a single unreadable line.

  Measured at 393 / 375 / 320 / 900px: **0px of overflow of the section's
  own column at every width**, stacking on the three phone widths, a real
  table at desktop, all 24 fixture cells labelled, and the long-URL cell
  broken inside its row rather than dragging the page wide.

  Two details that are load-bearing rather than decorative. The `thead` is
  **clipped**, not `display: none`d — a hidden `<th>` leaves a table of
  values with no headers for a screen reader — which is why `data-label`
  must be on every cell, and why the contract test that forbids `nowrap`
  everywhere else *skips the rule that clips it*, since `nowrap` is
  correct and necessary there. And there is **no `max-height`**: the
  article page owns the vertical scroll, so the data grid's 30rem cap
  would put a second scrollbar inside a paragraph and cut a table off
  mid-row.

  Twelve contract tests and **nine mutations, all nine killed, 0 no-op,
  0 survived**. The mutation harness is
  `scripts/mutate-prose-table.mjs` (`node scripts/mutate-prose-table.mjs`).
  Three of its safeguards exist because of defects it caught in the tests
  rather than in the component:

  1. **An unscoped mutation pattern rewrites the wrong rule.**
     `overflow-wrap: break-word` appears in five rules across
     `components.css` and `String.replace` only rewrites the first — so
     the mutation was landing on a different component and the
     `word-break` guard it was meant to exercise **never ran at all**.
     Every pattern is now scoped to a declaration only this component
     has, and the harness **refuses** to run a scoped pattern that does
     not match exactly once rather than reporting it as a kill.
  2. **A single-replace mutation cannot fail.** Stripping one of four
     `data-label`s still leaves three, so the check — which asks that
     *none* are missing — passed and the mutation looked harmless. It is
     now an explicit all-sites mutation.
  3. **A suite can go red for the wrong reason.** Each mutation names the
     substring of the expected check's failure, so a kill that happened
     to come from an unrelated failing assertion is reported as such
     instead of counting as proof. (The first version of mutation 3 did
     exactly that: the right check fired, but an earlier assertion inside
     it tripped first.)

  The kill counter is incremented in the same branch that prints `KILLED`,
  and the summary line is derived from that counter alone.

- **A breadcrumb, because two consumers each hand-rolled one and got it
  wrong three ways.**
  `.cm-crumbs` / `.cm-crumbs__link` / `.cm-crumbs__sep` /
  `.cm-crumbs__here` — the trail above a detail page. This is not an
  imagined component: `gantree` and `gantree-ui-icons` each carry a
  **byte-identical** 14-line copy of `.crumbs` / `.crumb-sep` /
  `.crumb-here` in `web/src/styles/global.css`, and nothing in this
  library owned the shape, so the copy was free to be wrong. All three
  defects were measured, not guessed:

  1. **No tap floor.** The hand-rolled row is bare text at `0.78rem`,
     which renders 12.48px tall against a `--tap` floor of 44px — a
     **31.52px shortfall on the row a thumb lands on first** when backing
     out of a page. Measured in WebKit at 393x852 with `pointer: coarse`,
     every `.cm-crumbs__link` is now exactly **44.00px**.
  2. **The separator was a live character.** `&rsaquo;` in a `<span>`
     sits in the text run between two destinations. It is now a
     `.cm-crumbs__sep` carrying `aria-hidden="true"`.
  3. **The current crumb was unmarked.** The hand-rolled last crumb is a
     `<span>` that merely differs in colour — invisible to a screen
     reader and in greyscale print, the only print mode this system has.
     It now carries `aria-current="page"`, the same attribute
     `.cm-header__link` already uses, asserted against that rule so a
     second private convention cannot grow.

  **The separator decision was reversed by measurement, and the first
  answer was wrong.** It shipped as a `::after` on the link, with a
  comment claiming generated content "leaves the accessibility tree
  entirely". A CDP read of `Accessibility.getFullAXTree` says otherwise:

      ::after on the link              link name `store›`   <- SPOKEN
      <span aria-hidden> in the link   link name `store`    <- silent
      <span aria-hidden> between links link name `store`    <- silent

  `::after` content is part of name-from-content, so the shape that reads
  as the clever one is the only one that gets announced, with
  `ignored: false` — not a reporting artifact. So the separator is real
  markup with `aria-hidden="true"`, which is what the consumer already
  had, and the library version earns its place on the floor, the wrap and
  `aria-current`. `tests/measure-crumb-separator-ax.py` keeps the three
  shapes comparable so this is not re-decided from memory.

  **A screenshot found what the geometry probe had half-measured.** With
  the separator as a sibling flex item it is its own flex child, so
  `flex-wrap` is free to break on either side of it: the 5-level trail at
  393px put a lone chevron at the start of row 2 and another at the end,
  and the wrapped row began at **left 56px instead of 40px**. Nesting the
  separator inside its link makes link+separator one unbreakable box;
  left edges went from `[40, 56, 107, 213]` to `[40, 107, 225]`, so every
  row now starts on the margin. It is still silent, because `aria-hidden`
  is what silences it and nesting changes nothing about that.

  The trail wraps rather than scrolling: a deep trail overflows a phone
  column, and the first crumb is the one guaranteed way out of the page.
  Verified at 393x852 (3 rows) and 375x667 (4 rows), plus desktop 1440
  (1 row). Both themes clear AA: crumb links 7.21:1 dark / 8.49:1 light,
  current crumb 16.16:1 / 18.09:1. 11 new contract tests, 11 mutations
  all caught and 0 no-op, including the inert-value mutant
  (`min-height: 44px` instead of `var(--tap)`) and the one that moves the
  separator back out of its link.

- **The header's icon link was 18px wide, and no test ever looked at it.**
  `.cm-header__icon-link` - the glyph link a header carries, the one that
  ships the GitHub mark with the link so the two cannot be separated - got
  its `min-height` from base.css's coarse-pointer element floor, and its
  WIDTH from the 18px inline `<svg>` it wraps, because nothing in the
  library sized the box. Measured on dev-blog at 390x844 in WebKit with
  `pointer: coarse`: **18x44**. The theme toggle beside it, a
  `.cm-icon-btn`, measured 44x44. Two controls in one header, one built
  for a finger and one not, and the tap-floor sweep was green the whole
  time because `cm-header__icon-link` was never on its list.

  The rule is now byte-identical to the one `.cm-icon-btn--bare` already
  had, and for the same reason - a floor satisfied on ONE axis is the
  defect, not the guarantee:

      @media (pointer: coarse) {
          .cm-header__icon-link { width: var(--tap); height: var(--tap); }
      }

  After: 44x44. `cm-header__icon-link` joins `INTERACTIVE` and
  `PINS_BOTH_DIMENSIONS`, so the existing sweep now asks the right
  question of it. Three mutations, all caught: the rule deleted, the rule
  reduced to one axis, and the rule set to an inert `8px` literal. That
  third one is the reason the check reads the `var(--tap)` reference
  rather than testing that a `width` was declared - `8px` is declared, and
  a value-shaped test would pass it.

  Found by re-syncing five consumers onto the current library and then
  MEASURING them, which is the argument for doing both: no consumer could
  report this, because every one of them vendors the same rule.

- **`.cm-section__title` shipped for rpm and was rendered nowhere.** The
  class was correct, in the stylesheet, and dead: the library's own suite
  reported it as unreachable CSS on a page that reaches all 270 others.
  rpm had meanwhile hand-written the whole block eighteen times, and the
  showcase had its own third spelling. So the missing thing was never the
  class - it was an OWNER. `<SectionHead>` is that owner, and it is the
  same shape rpm writes by hand:

      <div class="cm-section">                 <-- the panel
        <SectionHead title="OIDC Providers" sub="…">
          <span slot="action"><button class="cm-btn">Add</button></span>
        </SectionHead>

  The 26 showcase section headings were converted to it, which is what
  makes both classes live: measured in WebKit at 375/390/1440, 26 titles
  and 22 subs now render, and the scale genuinely separates - page title
  31.2px, section title 18.4px. Before this the two were both 32px/w700,
  which is why the scale looked one-step-only on the one page that should
  show it.

  * `sub` is a SLOT, not a string prop, and that is measured rather than
    preferred. 14 of the 22 section ledes carry a real `<code>` element
    for a class name; a string prop would have printed the tag as visible
    text. A test asserts the element is live AND that no escaped markup
    leaked in, so the choice cannot be quietly reverted.

  * `--head-h2` is now a token. The class sized itself from a literal
    `1.15rem`, so the step between a panel heading and a page title could
    not be retuned without editing a rule instead of a scale. The test
    asserts the `var()` reference, not the presence of `font-size` -
    a literal satisfies the second and misses the first.

  * The `level` prop exists because rpm renders one of these as an `h3`
    inside a dialog; a component that hardcodes `h2` silently breaks the
    document outline of every consumer that needs a different one.

- **A selector LIST is one rule, and two glyph tests were reading it as
  none.** Pairing the alert and toast severity glyphs into
  `.cm-alert--ok .cm-alert__mark::before, .cm-alert--ok .cm-toast__mark::before { … }`
  is smaller, valid CSS, and it broke `status is never carried by colour
  alone` and `the variants are the same three as .cm-alert` at the same
  time: both read `selector {`, so the comma inside the list made the
  alert half invisible. The page rendered perfectly in WebKit - the guards
  were measuring their own reading, not the browser. The glyph rules are
  now one selector each, and the tests walk selector lists via
  `declForSelector`, which is what the variant test in this repo already
  did for exactly this reason.


- **oem-log's header is the library's, and it was 58px too tall.** The
  rows migration left ONE second implementation of the design system
  standing in that project: 170 lines of scoped CSS in a single
  component, re-implementing the sticky bar, the brand, the
  pipe-separated nav, the theme toggle, the GitHub link and three
  breakpoints. Two of its rules were measurable defects at 390x844 in
  WebKit --

    the header was 121px tall, because the nav WRAPPED onto a second
    row below the brand and nothing stopped the wrap. 63px after.

    the theme toggle measured 32x44 -- a pill. `base.css` gives every
    button `min-height: var(--tap)` on a coarse pointer, and the
    hand-rolled toggle declared only width and height, so half its box
    came from the floor and half from the glyph box. That is precisely
    the failure `.cm-icon-btn--bare` exists for, in a site that had
    never adopted it.

  It also decided "which link am I on" by hand, in a `.nav-active`
  class this library cannot see. `<HeaderLink>` owns that decision and
  normalises the trailing slash, the query, the hash and the site base
  before comparing, so `/blog` stays current on `/blog/` and on
  `/blog/a-post`.

  Three of the WebKit checks that guard this were wrong before they
  were right, and all three failed the same way -- by reporting a
  phantom defect -- so they are worth naming:

  * Counting a WRAPPED header by the distinct top edges of its children
    returned 2 on a correct one-row header, because a closed drawer
    keeps its links in the DOM at height 0 and every one of them
    reports `top: 0`. That is a phantom row. Filter to children with
    height > 0 and the count means rows a reader can actually see.
  * "the current link is underlined" failed on the base rule's `none`,
    read from a 0x0 element inside a closed drawer. Computed style on a
    hidden element describes nothing. That claim is asserted at desktop
    width, where the nav is a row and it is true.
  * "the header stays pinned" passed on a page that had not scrolled.
    `scrollTo` clamps, so a 353px document asked for 600 lands at 0 and
    the header is never given a chance to move. Assert the document
    ACTUALLY MOVED before asserting the header stayed put.

  The mutation harness shipped the same disease and is fixed the same
  way: it printed `KILLED` without incrementing the counter, so six real
  kills reported as "0 killed", and it filed a mutation that broke the
  build as a NO-OP because the preview stopped answering. A compile
  failure is the strongest kill available and is now recorded as one.
  Final count: 15 contract tests, 124 WebKit checks, 9 mutants killed,
  0 missed, 0 no-op.

- **oem-ngo-brand is a consumer, and adopting the library fixed a
  contrast failure in both of its themes.** It is the first `--flat`
  consumer: plain HTML at the project root, no `src/` tree. Both of its
  pages hand-declared the token set, and the copy they carried failed
  WCAG AA for body text in dark AND light -- `--ink-faint` at `#555555`
  on `#0a0a0a` is 2.66:1, and `#8a8a8a` on `#fafafa` is 3.31:1. The
  library's own values are 5.81:1 and 4.96:1. The migration deletes
  those declarations rather than moving them, so the pages now inherit
  the contrast the library already fixed and no longer have a copy to
  go stale.

  Their hand-rolled theme write is gone too, replaced by the library's
  canonical FOUC guard loaded verbatim as the first node in `<head>`.
  The old one ran a single line of script and read no storage key at
  all, so a visitor who had chosen the light theme got exactly the
  dark flash the guard exists to prevent -- the bug the guard's own
  header records for this project by name.

  Migrating it required fixing `check-design-sync.sh` first: it had two
  defects that made every `--flat` consumer report "in sync". See the
  entry below.

- **The drift checker could not see the `--flat` layout it documents.**
  `install.sh --flat` is the documented install for a project with no
  `src/` tree, and two defects made every such consumer report the same
  comfortable lie.

  `js_dir_for` stripped the project root with `${d#"$t"/}`, which
  returns its input UNCHANGED when there is nothing to strip -- and in
  a flat install the vendored JS directory IS the project root. Every
  lookup became `$t/$JD/cli-mono.js` = `/a/b//a/b/cli-mono.js`. Measured:
  both JS files of a byte-identical flat install reported MISSING,
  alongside a recommendation to re-run `install.sh`, which would have
  written a second, unserved copy under `src/js/` and left the served
  one just as invisible.

  The reachability scan -- the pass added because dev-blog vendored the
  whole library and loaded none of it -- walked `$t/src` for
  astro/ts/js/css/mjs. A static project has none of those: its pages
  are plain `.html` at the root, so the source set came back empty and
  the entire pass was skipped. A flat consumer could vendor the
  library, load none of it, and pass every run: the dev-blog bug again,
  in the one layout the checker could not see, silent for the whole
  life of the flag. Scanning `$t` needs `-prune`, or the sweep walks
  `node_modules` and times out at 180s; it now runs in 76s.

  Two more defects surfaced with it. A guard INLINED verbatim -- which
  is what the guard's own header recommends, and what spacetime-rpm
  ships -- puts no filename on the page, so a name-only match called a
  shipped, wired guard UNREACHABLE; it is now matched by a signature
  generated FROM the guard source, so it cannot rot out of agreement
  with its own file. And naming the guard in a COMMENT is not loading
  it, so HTML comments are stripped from the blob before the check asks
  what a page actually wires up.

  394 tests (was 393). The mutation harness reports 13 killed, 0
  missed, 0 no-op -- including six new mutants, and two pre-existing
  ones that had gone NO-OP against this cycle's edits and would
  otherwise have read as passes.

- **A consumer the drift checker could not see was serving a runtime 175
  lines behind the library.** `oem-cdn` compiles its admin assets into the
  binary with `include_str!`, keeps the vendored layers at `web/oem-ui/`
  and names the runtime `runtime.js` after its own asset route. Every
  discovery path in `check-design-sync.sh` was keyed on the installer's
  LAYOUT -- a directory called `cli-mono`, files called `cli-mono*.js` --
  so the project was reported MISSING five files it actually ships. That
  is the crying-wolf end state, and it was also burying the real defect:
  `GET /admin/oem-ui/runtime.js` returned HTTP 200 with a runtime missing
  `initTooltipClamp`, `initMeasureReadout` and `pxOf`. Measured at 175
  differing lines.

  Discovery is now by CONTENT: a vendored layer is the library's file,
  wherever it is and whatever it is called. The filename survives as a
  FALLBACK, not a replacement, because a shadow copy truncated to one
  line shares 0% of the library's lines -- a copy named after the library
  is a claim about the library, and an unresolvable claim is a failure to
  name rather than a file to skip in silence.

  A renamed copy is ADOPTION and passes when it is byte-identical; only
  the drift is a failure, and it is reported on the renamed path. A
  correct consumer must pass, because a checker that fails one teaches
  the reader to ignore it.

  The generalisable lesson is the one this repo keeps re-learning: **a
  whitelist of paths is a hole, and replacing a name check with a
  content check is not automatically safer.** The two signals fail in
  opposite directions -- the name finds a copy that was destroyed, the
  content finds a copy that was renamed -- and a rewrite that keeps only
  one of them is a silent regression wearing the costume of a fix. 4/4
  mutants killed, including the one where the drift is reported but the
  exit code is not set, which survives a status-only assertion because
  an unrelated verdict already holds the exit non-zero.

- **The log table's sticky header was not sticky, and a green test said it
  was.** `position: sticky` on `.cm-table th` was asserted for a full cycle
  while the header visibly rode the page down. The cause: `overflow-x: auto`
  on `.cm-table-wrap` computes `overflow-y` to `auto` as well (only `visible`
  is forced to the other axis), so the wrapper is a scrollport on BOTH axes
  and `th` is sticky to the WRAPPER -- which only ever scrolls sideways, so
  there is nothing to stick to. Measured in WebKit at 393x852: 27px of page
  scroll produced exactly 27px of header drift.

  Viewport-sticky inside a horizontally scrolling ancestor is a CSS
  constraint, not a WebKit quirk, so the fix makes the wrapper a real
  vertical scrollport: `.cm-table-wrap` gains `max-height: var(--table-max-h,
  30rem)`. Header drift is now 0px at both 393x852 and 375x667.

  The lesson generalises past tables, and it is the sharpest one recorded
  here: **asserting the CAUSE, not the EFFECT.** `position: sticky` is the
  effect, and it is exactly the thing that lied. A CSS-text test can read a
  correct-looking value off a rule whose layout is broken. Assert the
  property that makes the effect possible, and measure the effect in the
  engine (`tests/verify-table-webkit.py`).

  The showcase log grew from 3 rows to 12 because a sticky header on a
  table that fits is a sticky header nobody has tested. That is now a test
  too. 4/4 mutants killed, including `max-height: none` -- declared, but
  inert, which is the mutation a value-shaped test misses.

- `check-design-sync.sh` now distinguishes syncing a file from ADOPTING it.
  Importing `components.css` is a claim about a filename; it says nothing
  about whether a page emits a class the file defines. `dev-blog` imported
  all three layers and rendered no `.cm-header` at all -- its header is
  built from its own un-prefixed classes. It is now reported as a note,
  because using your own header is a design choice, but the gap between
  "in sync" and "adopted" is no longer silent.

- The published site is the BUILD, not the repository. Pages was configured
  `source={branch: master, path: /}` while the deploy workflow used
  `actions/deploy-pages`. Those are two incompatible publishing mechanisms:
  classic Pages served the repo root, so GitHub rendered `README.md` as the
  homepage and the Astro build was never served at all. Every workflow
  reported success for three days while `ui.mrx.sh` showed a page with no
  `<header>` and a title from a commit before the mobile-drawer fix.
  `build_type` is now `workflow`, and `tests/verify-live-deploy.py` asserts
  the deployed bytes rather than trusting a green run.

- The mobile drawer is ONE column at every viewport height. `.cm-header__links`
  is `flex-direction: column` but inherited `flex-wrap: wrap` from the bar
  rule, and on a column that wrap runs ACROSS. When the 16 rows stopped fitting
  the panel's height they broke into a second column at x=179, and the panel is
  only `min(86vw, 320px)` wide, so `layout`, `forms`, `auth` and `readme` landed
  outside it -- unreachable, and `scrollHeight == clientHeight` meant the drawer
  could not scroll to them either. Measured at 402x667: 12 rows in column one,
  4 stranded. The trigger is HEIGHT, not width: the list needs 869px of panel,
  so any viewport under about 800px tall wrapped, which is most phones once
  Safari's chrome is counted. `flex-wrap: nowrap` makes the single column
  `overflow-y` scroll, which the panel already allowed.
  `tests/verify-drawer-column.py` drives WebKit over 5 widths x 10 heights and
  reads the number of distinct left edges from the DOM, so a wrapped column is
  measured rather than eyeballed.
- Added the shadcn **outline button** (`.cm-btn--outline`: the border is the
  body, hover fills with ink and inverts the text) and a native
  **range slider** (`input.cm-slider`) — framed rail, square thumb, fill
  mirrored to `--cm-slider` at boot and on `input`, readout mirrored to a
  sibling `<output>`. Everything is measured, not asserted from source: the
  harness decodes its own screenshots because WebKit answers
  `getComputedStyle(el, '::-webkit-slider-*')` with empty strings. 8/8
  seeded faults killed.
- **The suite now reports at the end of the file.** The verdict used to print
  in the middle, so every check appended after it — the rhythm block, then
  anything a later batch added — ran but could neither be counted nor fail the
  run. 8 checks were silently dead; they are counted now (514 → 522).

- Added `.cm-hovercard` (panel hidden with `visibility` at rest, opened by
  `:hover` **and** `:focus-within`) and `.cm-input-group` / `__addon` (one
  control with a single collapsed seam). The seam is collapsed on the addon,
  not the field: the base input rule is (0,3,1) and a group selector would
  lose that cascade. 5/5 seeded faults killed in WebKit.
- The suite verdict is now an `exit` handler instead of a line of output in
  the middle of the file, so checks appended as it grows are always counted
  and can always fail the run. One check it had been hiding (the flat
  consumer drift case) surfaced immediately and passed on re-run.

- Added `.cm-otp` (six-cell OTP: digits replace-and-advance in `keydown`,
  Backspace clears before it retreats, a pasted code fills the group) and
  `.cm-command` (palette inside the native `<dialog>`: substring filter,
  groups that hide when empty, a roving row mirrored to
  `aria-activedescendant`, and a query that never survives a reopen).
  The cell rule is a descendant pair so it beats the base `input` rule at
  (0,1,1); an explicit `[hidden] { display: none }` is required because
  the item rule's `display: flex` outranks the UA's. 31/31 WebKit checks,
  9/9 seeded faults killed.
- Added `.cm-carousel`: a horizontal scrollport with snap, arrow/mark controls that disable at the ends, tap-sized page marks and arrow keys that move exactly one slide (the UA only line-scrolls a focused container).
- Added `.cm-stepper`: an `<ol>` of steps with done/current/future states, a connector between steps that collapses to a stacked row on narrow screens, and opt-in click-to-move via `data-cm-stepper`.
- `fix: the stepper connector targeted `.cm-step:not(:last-child)`, which can never match - each button is the only child of its own `<li>` - so the first version shipped with no connector at any width.
- `fix: carousel landing coordinates came from `slide.offsetLeft`, measured against a positioned ancestor 40px away at 402px; scroll-snap had been quietly rescuing every wrong landing.

- Added `.cm-popover`: a sharp card on the platform `popover`. The top layer,
  the focus return, Escape and the light-dismiss are the browser's; the runtime
  owns only alignment - left-aligned to its trigger (the POP_SEL in the
  dropdown's toggle handler gained the card, so the one handler covers both),
  flipped above when it will not fit below, clamped inside the gutter. The card
  element starts with `pointer-events: none` because the UA's
  `[popover]:not(:popover-open) { pointer-events: none }` is in the UA
  stylesheet, which author styles always beat.
- Added `.cm-combobox`: an input over a listbox, filtering as you type, with
  an active row mirrored to `aria-activedescendant`, an Enter/click choice
  that fires `cm:change`, and a list that is `display: none` at rest (the
  option rule's `display: flex` outranks the UA's `[hidden]`). The committed
  value comes from `data-value` falling back to the label span, never from
  `textContent`: a row carries a hint, and the hint is not the value.
- `fix: an anchored card stopped 276px short of its trigger during a long
  smooth scroll`. The re-anchor was debounced through `requestAnimationFrame`,
  and the callback that eventually ran still had the page's old position in
  it - the last scroll event of a 26,000px jump arrived at scrollY 520. It now
  anchors on the event, and the trailing frame loop built as belt-and-braces
  was deleted once mutation testing showed removing it changed nothing: an
  unproven rAF running for the life of an open card is a cost, not a fix.
- `fix: a choice re-opened the list it had just closed` (WebKit does not blur
  a focused field on an outside click, so focusing back fired `filter()`), and
  `fix: the value read the whole row including its hint` (`deno 2secure`).
- Popover + combobox: 18/18 WebKit checks, 10/10 seeded faults killed (9 in
  the harness, 1 in the contract suite).

- Added `.cm-ctx` (context menu) and `.cm-menubar` / `.cm-menubar__trigger`
  / `.cm-menubar__menu`. Both reuse the dropdown's panel and rows; they
  differ only in WHERE a panel opens and how the keys walk. The context
  menu opens at the POINTER - clamped to the viewport - and closes on an
  outside press, Escape or scroll. It is `popover="manual"` because light
  dismiss closes the interaction the menu was born in: measured in WebKit,
  the panel opened at 2,469ms and the right-click's `mouseup` closed it at
  2,471ms. A manual popover also gets no focus return, so the runtime
  stashes and restores it, and the context-menu key (no pointer: 0,0)
  anchors to the focused element. The menubar walks its words with
  Left/Right/Home/End, opens with ArrowDown, and while a menu is open walks
  to the NEIGHBOURING menu instead of the items; panels hang from the left
  edge of their word and `aria-expanded` is mirrored onto the trigger
  because the platform does not manage it on `[popover]`.
- `fix: the pointer menu opened 25,836px down the page` - the branch that
  replaced `pinPopover()` for context menus set up dismissal and never
  called `anchorPopover()`, so the panel sat at its static position.
- `fix: the menubar's first pass could not be walked at all` - the vm test
  double answered `querySelectorAll` with `[]`, so the trigger lookup that
  now compares `[popovertarget]` values (rather than building a selector
  that needs escaping) found nothing and every fake menu stayed unanchored.
- 16/16 seeded faults killed (14 WebKit, 2 contract-suite).
- Added `.cm-tree` (with `data-cm-tree`) and `.cm-resizable` panels
  (`[data-cm-resize]`). The tree keeps NO state of its own: open/closed
  is native `<details>`, clicks and `aria-expanded` included, and the
  arrows expand a branch by calling `.click()` on its summary rather
  than assigning `open`, so a consumer listening for clicks hears the
  keyboard too. What the runtime adds is what the platform lacks -
  arrows walking VISIBLE rows with one roving `tabindex`, ArrowRight
  opening a closed branch and landing on its first child (stepping
  inside when it is already open), ArrowLeft closing or stepping out to
  the parent. "Visible" is `checkVisibility()`, not `getClientRects()`:
  WebKit lays out rows behind a closed branch (they report a perfect
  rect) while painting nothing, so the cheap test walks the cursor into
  the dark - the harness steps over a closed branch to prove it. Leaves
  are real links and share the summary's row class; indentation comes
  from nesting, never a depth written into a style.
- The resizable seam turns ONE knob, `--cm-resize`, into both the
  painted split and `aria-valuenow`, read from the same `pct` in the
  same statement, so the handle cannot describe a layout that is not on
  screen. The drag uses pointer capture (mouse, pen and touch are one
  path) with `touch-action: none`; the axis comes from the group's
  `flexDirection`, so under 640px the panels stack, the seam turns
  horizontal, the same number measures height, and `aria-orientation`
  flips to match. Keyboard steps are 16px - a pixel step is the same
  gesture at any width - and Home/End jump to the declared range.
- Measured the reduced-motion trap: the house guard sets every
  transition to `0.01ms`, which is instant for a person but not for a
  synchronous computed-style read, so the first harness run measured
  the START value of a change it had just made and called a working
  component broken. The harness now settles a frame after each
  gesture - and that measurement bug is exactly what the `0.01ms`
  transition hides from anyone who writes the same test.
- 24/24 WebKit checks; 16/16 seeded faults killed.

- Added the calendar: `.cm-cal` with `[data-cm-cal]`, one mode each for
  single and range. The month is a real `<table role="grid">` of
  `<button>` days - focus, activation and the cell semantics are the
  platform's - and the runtime redraws it from `data-cm-cal-month` on
  every change, one roving tab stop over the days actually visible.
  Arrows walk days and weeks, Home/End take the Sunday and the Saturday,
  PageUp/PageDown move a month under the same date (Shift: a year),
  Escape clears; Enter and Space are the native button click, not our
  code. The range has DayPicker's three transitions - a pick on a
  complete range starts a new one, an open start takes the next pick as
  its end, a pick before that start re-anchors - and hovering an open
  start previews the days between. Disabled dates are `aria-disabled`
  (reachable with the arrows, declined by `calPick`), today is read from
  the clock at render, and selection is reported three ways: ARIA, the
  `data-*` the markup reads back, and the inverted cell.
- The grid's pitch is DECLARED, not negotiated: `width: calc(var(--tap) *
  7)`. Asked for `max-content`, the table answered 316px - cells
  computing to 45px with a 44px day inside - and a card that hugs a
  stretched table still showed the drift. The harness now draws the card
  at 420px and asserts the pitch does not move.
- `fix: a pick dropped focus to <body>` - `calRender` REPLACES the picked
  button, so without `calFocus(cal, iso)` every click left focus on the
  document and the next arrow key landed nowhere. Caught by the harness
  assertion "the pick that rebuilt the grid kept the focus on the day".
- `fix: the hover card hung 8px off a 320px viewport` - the panel sits at
  `left: 0` of a wrapper it did not choose and pure CSS cannot clamp, so
  `document.scrollWidth` read 328 at a 320 viewport on the showcase's own
  page (menus already clamp in `anchorPopover`; this is that rule for a
  panel that never opens through JS). `cmClampHovercards` runs at init and
  on resize; a consumer with no JS keeps the CSS-only behaviour.
- `fix: the showcase scrolled sideways at 320px` - two causes: the hover
  card above, and a page-level overflow in older sections that predates
  this batch (hiding almost ANY section clears it; measured, logged, not
  yet pinned - flagged separately rather than papered over).
- The harness pins `scroll-behavior: smooth` off for its run: with smooth
  scrolling, Playwright can measure a day, have the page still scrolling
  when the press lands, and click a cell that moved - measured as a click
  on `2026-10-20` that changed nothing while the next click worked.
- 34/34 WebKit checks; 21/21 seeded faults killed.

- Added the drawer: `.cm-drawer` on top of the bottom sheet - a 44px grab
  strip with a square-ended bar, pointer-captured drag on the HANDLE only
  (a body gesture would fight the content's scroll), straight-line
  transform with no easing, and one decision at release: past 96px or 40%
  of the sheet's height the native `close()` runs - focus restored by the
  platform - and short of it the sheet snaps home. An upward pull clamps
  at zero; a `close` listener scrubs the inline transform so Escape
  mid-drag cannot leave the next open hanging mid-screen. The body clears
  the home indicator via `env(safe-area-inset-bottom)`.
- Added the field wiring contract (`cmInitFields`): generated `id`/`for`
  when missing (consumer ids win), `aria-describedby` MERGED - never
  replaced - so a hand-written hint keeps its slot while help and error
  nodes join it, and `aria-required` only where a native `required` is
  absent. It runs at init and on the documented `cliMono.init(document)`
  path a SPA calls after its commit; the observer itself is bounded on
  purpose (a document that already has library markup arms nothing).
- `fix: every static dialog specimen painted nothing` - the previews are
  `<dialog>` elements laid out in the page (`position: static`), which the
  user agent still hides as `dialog:not([open])`. The sheet section has
  been describing four invisible dialogs. `cm-dialog--spec` re-shows them,
  and the harness reads height so it cannot regress silently.
- The 320px width oracle changed from "first read of `scrollWidth`" to a
  settled measurement: this page reports +8px of sideways extent on a
  fresh load in an EMPTY zone (reproduced on the previous batch's build,
  so it predates this one; one invalidation of the overlays head-row
  collapses it for good). What the harness now asserts are the truths a
  user can feel - the settled width, and `html { overflow-x: hidden }` so
  the strip that cannot be seen cannot be panned either.
- The runtime-readiness wait replaced blind timeouts: `networkidle` can
  fire while the bundle has not yet executed, so the harness waits for
  the `cm-js` hook the runtime itself sets instead of guessing at
  milliseconds.
- The preview frame needed two more passes before it was honest: with the
  sheet modifiers stripping side borders and claiming 100% width, the
  in-flow preview read as two hairlines instead of a dialog (vision
  review), and its fixed `height`/`max-height` cropped the body text
  mid-line. `cm-dialog--spec` now restores all four borders, bounds the
  width, centres the block - and the specimens lost their fixed heights,
  with a harness assertion that no preview's scrollHeight exceeds what it
  shows.
- 34/34 WebKit checks; 21/21 seeded faults killed (20 WebKit, 1
  contract-suite - the safe-area rule, which `env()` makes invisible to a
  desktop harness).

- Added the date picker as a **composition, not a new mechanism**: the
  calendar sits in a `[popover]` panel wearing the `.cm-popover` frame,
  so anchoring, `aria-expanded`, light dismiss and Escape are the
  popover machinery already in the library. What a composition owes is
  the two things neither half knows, and both live in `calPick` - the
  one path a pick takes: the picked day is written into the input as ISO
  (read back AFTER the pick, so re-clicking the selected day clears
  it), and a completed pick closes the panel while month navigation
  never reaches that branch. `popovertarget` on the caret is
  declarative; the FIELD is bound by `cmInitDatepickers` because
  MEASURED in WebKit a UA only invokes a popover from an element with an
  activation behavior - clicking the readonly input with the attribute
  set opens nothing.
- Added the scroll area: `overflow-y: auto`,
  `max-height: var(--scroll-h, 18rem)`, `overscroll-behavior: contain` -
  one knob, the box scrolls its own content, and the end of the list
  cannot drag the page behind it.
- `fix: the calendar could not fit a 320px screen - pinned at last`. In
  `table-layout: fixed` the FIRST ROW defines the columns, so
  `th { width: var(--tap) }` made the grid refuse to be narrower than
  seven taps no matter what its own width said: MEASURED 309px inside a
  240px card, 362px right edge on a 320px screen, clipped. Below 360px
  the columns now follow the table (`calc(100% / 7)`) and the days
  follow the columns (`min(var(--tap), 100%)`); everything wider keeps
  44px columns to the pixel. The grid FITS instead of scrolling a card.
- `fix: the phantom scrollWidth is pinned, not just tolerated`. The
  328-at-320 that two batches of oracles tripped over was the hover card
  clamp: it pins the panel to the viewport's right gutter (312), but
  `body.scrollWidth` measures the ABSOLUTE layout edge -
  wrap.left + padding + extent = 328 exactly. It was never scrolled
  (`html` clips x) and never seen (the clamp had moved it), but it was
  always there. Below 360px the panel stops claiming 18rem and sits
  inside its column, so the showcase now measures **320 at 320**.
  Two calendar oracles that had to be softened to admit the old design
  were re-derived: the card must be a scroll CONTAINER
  (`overflow-x: auto`, not merely scrollable-looking), and the clamp is
  observed by its fingerprint (`style.left` rewritten).
- The shadcn/ui catalog was re-audited at 64 components: **56
  implemented, 8 declined by decision** (six conversation/AI-family
  components, Chart as a Recharts wrapper, Direction as an RTL helper),
  with Navigation Menu - the one substitution - landing as the rail +
  sticky header. The mapping lives in the README under *shadcn/ui
  parity status*.
- Proven: suite 547/0; datepicker 17/17 WebKit checks with 13/13 seeded
  faults killed; calendar 34/34 with 23/23 killed (the two new mutants
  are the tiny-viewport rules - each killed by the fitting oracle).

## Batch 14 - the drawn shortcut, the toast vocabulary, the sticky chrome

A feature-level parity audit (fetch each shadcn doc page, diff its
documented behaviour against this repo with file evidence) found that
several promises on this page were drawn but never kept. This batch
pays them down:

- **`⌘K` / `Ctrl+K` is wired, not decorative.** One global `keydown`
  guards on `metaKey || ctrlKey`, `preventDefault`s so the browser's
  own quick-find stays out of it, and toggles the palette through the
  same `showModal()` path as its trigger. The palette's existing
  `close` listener clears the query, so a keyboard close leaves the
  next open starting clean. Grep for `metaKey` found no handler
  anywhere before this - the glyph was a promise the page could not
  keep. (`⌘B` is deliberately not bound: nothing in this library owns
  a global sidebar toggle yet, and inventing one for a kbd chip would
  be another promise in search of behaviour.)
- **The toast vocabulary is complete**: `info` (quiet `ℹ`) and
  `loading` (a spinning `↻` - the one mark that moves - with
  `aria-busy`), an `action` option whose button speaks `cm:action`
  while the node is still mounted, `duration` overrides, the explicit
  `{ sticky: true }` opt-in to no timer, and `toast.promise` - one
  node through loading -> ok/err instead of three racing toasts.
  Both new marks are EMPTY spans with CSS-injected glyphs (the
  house's own rule), and the spin joins the one reduced-motion block.
- **The dialog's head and foot stick to the dialog's own edges.** The
  dialog is the scrollport, so a long body scrolls between a title
  that stays and actions that stay reachable - shadcn's documented
  sticky behaviour with no consumer CSS.
- **Five hand-written toast specimens were carrying dead ×
  controls**: `initToasts` binds `[data-cm-toast]`, and the authored
  specimens lacked the attribute. They carry it now, and the contract
  counts bindable == specimens so the gap cannot reopen silently.

Proven: suite 549/0; `tests/verify-shortcuts-toast.py` 16/16 WebKit
checks (toggle + focus + query reset, both severities, action edge +
retirement, promise through success and failure, sticky outliving the
six seconds, headDelta/footDelta at exactly ±1 under a 500px scroll)
with 18 mutants killed (mutator: `tests/mutate-shortcuts-toast.py`).

## Batch 15 - the utils pair (scroll-fade, shimmer) and validating forms

Three areas the feature-level audit called PARTIAL are now honest:

- **scroll-fade**: a mask driven by `animation-timeline: scroll(self
  ...)` off the scrollport's OWN position - no listener, no jank.
  One registered number (`@property --sf-p`) interpolates the edge
  stops; edge modifiers (`--t --b --l --r --s --e`), px size steps,
  `--none`, and a static rest-state fallback where the timeline is
  unsupported. Every `.cm-table-wrap` wears `.cm-scroll-fade-x` now,
  replacing the hardcoded gradient that existed for the same measured
  reason (806px of table in a 308px box, no scrollbar hint).
- **shimmer**: a `color-mix(currentColor)` sweep clipped to text
  behind a `background-clip` @supports gate (unsupporting engines
  keep plain text - never transparent text), `--once/--reverse/--none`
  modifiers, three knobs as custom properties, and the animation
  listed in the one reduced-motion block.
- **validating forms**: `form[data-cm-validate]` runs the browser's
  own `checkValidity()` and renders shadcn's documented behaviours -
  `aria-invalid` + `data-invalid` + message in `.cm-field__error` +
  first-offender focus + polite count. Modes map to their table
  (submit default, blur, input). `novalidate` keeps one voice;
  success toasts; reset clears. No schema library, no re-implemented
  email regex.

Proven: suite + `tests/verify-forms-fade.py` WebKit checks
(scroll-linked `--sf-p` actually moves with the scroll, static
fallback mask, shimmer clip/color/animation, reduced-motion emulation
turning the sweep off, the full submit/fill/reset/blur validation
flows), and suite 550/0 + WebKit 17/17 + 23/23 mutants killed
(mutator: `tests/mutate-forms-fade.py`).

## Added

### Batch 16: the conversation family, attachment, questionnaire

**Bubble, message, marker** - shadcn's chat trio as pure composition,
no runtime. Seven bubble tones as border/ink treatments (base = strong
inverted default, `ghost` full-width, `danger` with the house
double-rule), the documented 80% cap as `--bubble-max`, edge-anchored
reactions announced once as a single `role="img"` image, `cm-msg` with
a bottom-anchored avatar and header/footer that follow the side,
groups with the empty-avatar rhythm, and `cm-marker` inline / bordered
/ labeled-separator (icon `aria-hidden`, author-supplied role,
composing `cm-shimmer` on the typing indicator).

**Attachment** - the composed file card: media/content/actions, a
full-card trigger painted above the content and below the actions, five
upload states (shimmer in flight, double-rule on error, reason kept in
text), three sizes, two orientations, an image variant, and a snapping
`cm-attach-group` composing `cm-scroll-fade`.

**Questionnaire** - `data-cm-quiz`, the house's second init-owned
runtime: `fieldset`+`legend` items, named progressbar, native
radio/checkbox keyboard preserved, freeform input beside fixed choices,
letter/number shortcuts, explicit skip, validation that jumps to the
first unanswered required item (focus follows), and a submit that
toasts then wipes with a full `form.reset()`.

Proven: suite 552/0; `tests/verify-chat.py` (WebKit, 12 checks) with
a 12-mutant run (`tests/mutate-chat.py`, rc 0); `tests/verify-attach-quiz.py`
(WebKit, 14 checks) with a 22-mutant run (`tests/mutate-attach-quiz.py`,
rc 0). The vision pass corrected three real defects: the error frame is a
true double rule (border line + `outline-offset: -4px` companion, proven
by pixel profile), the action pair keeps 8px between 44px targets, and
the stacking contract now enforces ONE owner (DOM paint order, no
`z-index` ladder).

## Added

### Batch 17: message scroller

Completes the chat family (6/6). `data-cm-scroller` (init-owned):
labelled focusable viewport mirroring `data-scrollable` /
`data-following` / `data-current-anchor`, inert jump controls
(`tabindex=-1` + `data-active=false`), `scrollToMessage` with a peek of
the previous turn, `role="log"` content, `content-visibility` rows,
live-edge pinning through a ResizeObserver, outline-driven
`data-track-visible` intersection tracking, and `data-start-at-end`
so the frame opens at the live edge with no flash.

Proven: suite 553/0 (the source contract pins roles, mirrors, the
observer list and the phone type-floor), `tests/verify-scroller.py`
(WebKit, 11 checks) with a 16-mutant run (`tests/mutate-scroller.py`,
rc=0). Three findings shaped the final shape: the one-shot pin at bind
raced `content-visibility` intrinsic sizing and stranded the frame
mid-log (fixed by a bounded re-pin loop that stands down for any scroll
it did not ask for), the outline must live INSIDE the frame for the
jump click and the aria-current highlight to exist at all, and the
late-markup watcher only arms on a cold document - so that proof loads
the library blank and lets the scroller arrive, instead of asserting a
surface the library deliberately never watches.

## Fixed

- Two stacking checks demanded a literal `z-index: <number>`, which fails on
  the correct tokenised form (`var(--z-header)`) and cannot catch the real
  defect: a reference to a token nobody defines, which the browser drops
  to `auto`. They now resolve through `tokens.css` and fail for either.

- Squared off the macOS traffic lights (`e79e3d5`): `.cm-term__dot` lost its
  `border-radius: 50%` to the sharp sweep, so three round window controls
  rendered as three square boxes. Circles restored (fixed `4px` on the 8px
  box, not a percentage), added to the sharp guard's exception list next
  to radio and spinner, and pinned by a check that fails if they square
  up again.
- The header bar no longer paints outside its own box. Between the phone
  drawer (640px) and the rail (1000px) the bar's nav was `flex-wrap: wrap`
  with a fixed 60px height and `overflow: visible`, so a wrapped second row
  rendered BELOW the header and on top of the page content. Measured at
  700px: the link list ran y=35 to y=77 inside a header ending at y=61, and
  `elementFromPoint(200, 70)` returned a `.cm-header__link`. The band now
  keeps one row that scrolls sideways, with the scrollbar suppressed, and
  the brand and theme toggle are pinned so the row is what shrinks.
  `tests/verify-bar-containment.py` hit-tests the region under the header at
  nine widths.

## [Unreleased]

- **The showcase's own section ledes were rendering beside their titles,
  one word per line.** `.cm-head-row__text` is `display: flex` in a ROW --
  deliberately, so a caller who wraps a `.cm-head__badge` with a title gets
  the icon BESIDE the text. But a section head is a title and a lede, and
  in a row they land SIDE BY SIDE. Measured in WebKit at 375px: the title's
  `min-width: min(100%, 12rem)` floor took 192px of a 295px column and left
  the lede 91px wide at x=244, 527px tall, wrapping one word per line. The
  column is `nowrap` with no clipping ancestor, so the lede also overflowed
  to x=436 -- a horizontal overflow on the showcase's own header, at three
  of the four widths measured.

  The fix is a `:has()` rule that makes the column a COLUMN only when it
  holds a lede, so a badge-and-title pair stays a row. Verified across all
  28 instances on the page: every title+lede pair stacks with the lede at
  the title's left edge and full column width, and the one badge case is
  still a row with the badge at left=40 and the title at left=74.

  Two fixes were measured wrong on the way there, and both are recorded
  because the next person will try them:

  - Putting the floor on the COLUMN (`flex: 0 1 12rem`) instead of on each
    child collapsed the title to 9px wide, one word per line, 200px tall.
    That is the exact regression commit 89301ee exists to prevent: the
    "a title may wrap but may not collapse" invariant belongs to the
    title, not to the wrapper.
  - Making the lede a `flex: 1 1 auto` sibling does not help either; in a
    nowrap ROW the children are laid out beside each other regardless of
    how they size.

  The showcase's `.cm-push` / `.cm-stick-top` row used `.cm-row__meta`
  without `--wrap`, so its prose ran to x=499 on a 375px viewport. That is
  the library's own documented escape hatch (`.cm-row__meta--wrap`, added
  for exactly this), so the specimen was wrong, not the class.

- **`check-design-sync.sh` called a byte-identical consumer drifted.** The
  `drift in <target>` header and the `fix:` line were driven by "was there
  any output at all" rather than by the verdict. `RENAMED` is ADOPTION and
  does not set `stale`, so oem-cdn -- whose `web/oem-ui/` copy is
  byte-identical to the library -- exited 0 while its own output read
  `drift in ... oem-cdn` and printed a remedy that cannot perform the
  repair: `install.sh <target>` writes the canonical `src/` layout, which
  that project does not serve, so following it adds a second, unserved copy
  and the next run reports the same thing. The exit code said clean and
  the text said drift, and the text is what a human reads.

  `out` is now informational and `tstale` (reset per target) is the verdict,
  so only a finding prints `drift in` and `fix:`. An adoption-only target
  reports `in sync` WITH its `RENAMED` lines and a `re-vendor with:
  --embed-rename <dir>` hint instead.

- **`install.sh` learned `--embed` and `--embed-rename`** (in the previous
  cycle, landed in 1f1333a). No documented invocation could produce the
  path oem-cdn actually serves: `--flat` puts CSS in `<target>/cli-mono/`
  and JS at the top level, and the default and `--public` both assume
  `src/` or `public/`. The 11 contract tests for it were written
  standalone and never wired into `run.mjs`, so `npm test` never ran
  them; they run now, and `tests/mutate-sync-verdict.sh` proves the
  verdict split above.

- **Two mutation harnesses were writing outside the repo.**
  `tests/mutate-install-layout.sh` mutation #4 removes the path-escape
  guard, so that run really installs into `../<name>` -- into `$TMPDIR`,
  outside the repo, where the restore trap cannot reach it. The leftover
  `$TMPDIR/escape` then failed every LATER run of the test it had just
  passed, for a defect that did not exist. Both harnesses now sandbox
  inside the repo and the trap removes it. The escape probe also
  asserted a fixed, shared path; it now gets a unique destination and
  asserts the install wrote nothing at all.

- **`tests/mutate-sync-verdict.sh` pointed at LIVE consumers and lied.**
  It used oem-cdn and dev-blog as fixtures, both edited by concurrent runs
  of this cron, so a mid-sweep re-vendor made oem-cdn genuinely stale and
  all five mutations "died" for the wrong reason -- five identical
  detection strings, which is the tell. It builds its own ADOPT and DRIFT
  consumers byte-for-byte now, and preflights them: if the fixtures no
  longer exercise both halves it reports FIXTURE BROKEN and exits rather
  than reporting meaningless kills.

### Added

- **`.cm-row--on`** - the list-row form of the selected treatment, the same inset rule `cm-section--on` uses. A tinted row is the one signal that disappears in greyscale print, and a selected row is information the reader has to see.

- **`button.cm-row`** - a row that is itself the control. It keeps the row geometry and clears the UA button chrome, so a navigable list does not have to hand-write `background`, `border` and `padding` in a style prop at every call site.

### Added

- **`.cm-switch`** - an on/off control for "this whole behaviour is on or off", as distinct from `cm-check`'s "include this row". The knob's position carries the state, and the on-state track fills with the ink token, so nothing is signalled by hue. The `<input type=checkbox>` stays on top at zero opacity and is the real control: tap target, focus target, form value. Replaces the two-div-with-a-translate toggle in Templates, which had no role, no name and no keyboard path. Knob geometry derives from `--track-h` via `--knob-d`, so both ends stay flush when the track changes.

- **Switch geometry tokens** (`--track-w`, `--track-h`, `--knob-d`, `--knob-inset`).

### Added

- **`.cm-dialog--sheet`** - a side sheet built on the same native `<dialog>` as the confirm modal, anchored to the right edge instead of the centre. Only the frame changes, so the focus trap, Escape, the top layer and the inertness of the page behind it stay the platform's job. Full-width and flush below 640px, with a sticky head. Replaces the hand-rolled `fixed inset-0` overlay that had none of those.

### Added

- **`.cm-head-row`** (`__text`, `__action`) - the page title ROW: badge,
  name + sub, and the page's own action on one line. `.cm-head` is the
  document-head variant, a vertical stack with `--head-top` above it, so
  using it here put the action button *under* the title and duplicated a
  top padding inside an already-padded card. The action is walked to the
  far end with `margin-left: auto`, not `justify-content`, so a long title
  shrinks and wraps without the action drifting off the edge. Below 420px
  the row wraps and the action takes the full width.


- **`.cm-head__badge`** - the square glyph on a page title row. Seven
  pages each drew a gradient square beside their title, in seven different
  gradients. The library forbids gradients: glyph + weight is the whole
  palette, and a hue is the only signal that fails in greyscale. The badge
  is an inset square on the ink token - the same mark `.cm-section--on`
  already uses to show selection - and sizes its own glyph in CSS so a
  consumer cannot leave the icon at its default 24px.


- **`.cm-disclosure__action`** - the one interactive thing a `<summary>`
  may hold, walked to the end of the row. A delete button sitting hard
  against the last chip makes the row stop reading as one line of summary
  text, and `align-self` keeps it on the summary's optical line when the
  row wraps at 390px. `margin-left: auto` on the only legal child.

- **`.cm-seg` / `.cm-seg__opt`** - a compact set of mutually exclusive
  choices, one always selected. The platform has no widget for it and it
  is not a tab bar: tabs switch panels and span the full width, while a
  segmented control is an inline choice inside a form row - "allow /
  deny", "on / off", "http / https". The selected option is marked with
  an inset rule and a panel fill, the same two signals
  `.cm-tabs__tab[aria-selected]` uses, because a thicker border would
  widen the box and walk the whole row sideways. Options wrap rather than
  clip on a 390px screen, and a coarse pointer gets the tap floor.
- **`.cm-disclosure` and friends** - a summary row that reveals a panel.
  `<details>`/`<summary>` gives keyboard and find-in-page for free, but
  the marker is a browser triangle the library cannot restyle into the
  mono look, so the marker is hidden and the affordance is drawn as a
  glyph slot that turns with state. Five contract checks,
  mutation-verified (8/8).


- **`.cm-stack`** - a vertical run of records. Tailwind's `space-y-*` is what
  every data page reached for, and eleven surfaces wrote the same one-line gap
  by hand, each a different value. Opt-in by design: `.cm-rows` resets the
  list but deliberately carries no gap, because a ledger's rows are separated
  by their own border and a list of cards is not. A rule that reaches a plain
  `.cm-rows` with a gap is now a contract failure, not a preference.

- `cm-header__group` / `cm-header__group-label`: grouped rail nav. An
  application rail has labelled groups, and the flat `.cm-header__links`
  could not express one without faking the label out of a link - which
  inherits the 44px tap floor onto a heading that is not a target. The
  label declares `min-height: 0` for exactly that reason. Six contract
  checks added, mutation-verified (6/6).
- **`--measure-title`, and a specimen that reports its own live state.** The
  inline list row now gives its title column a named measure, so a list
  reads as a table instead of a ragged stack of lines. It ships with a
  foundation specimen rendered *from* the token (`max-width:var(--measure-title)`,
  which resolves to 404.578125px) and a runtime readout that reports the
  live excerpt width, or `excerpt handed off` when the column is out of
  play. The readout MEASURES the row rather than restating the media
  query breakpoints, so it cannot disagree with the stylesheet it
  documents; it reuses its node on re-init because `init()` runs again on
  every Astro page-load. With scripting off the specimen still renders
  from the token and the readout is simply absent.

- **Selection and state marks** (`.cm-section--on`, `.cm-dot`, `.cm-dot--on`): a data surface needs a selected row and a live/off indicator, and twelve consumers each invented one - in hue. A selected row is a left rule and a tint, not an outline, so a column of them scans as a column; on is a FILLED dot and off is a HOLLOW one, so the distinction survives greyscale.

- **Inline edit** (`.cm-inline`, `.cm-inline--wide`, `.cm-inline__input`): a data surface is mostly values you want to change in place, and every consumer rewrote the same double-click-to-edit span with its own padding and ring. The display half is a DOTTED UNDERLINE and a text cursor, not a box - a box on every cell turns a table into a form. The editing half inherits the font and the measure, so the value does not change size the instant you click it.

- **Action toolbar** (`.cm-toolbar`, `.cm-toolbar__count`): the bar that acts on a multi-selection, which three consumers each wrote as a sticky flex row with their own border, background, shadow and z-index. It sticks to the BOTTOM - the count lives at the top of the page and the actions belong where the thumb already is - so it needs a numeric z-index (a sticky with `z-index: auto` is painted under the rows it covers), the themed shadow, and the strong border that a floating surface needs.

- **Check row** (`.cm-check`): the base layer already draws the checkbox down to the tick, so the CONTROL needs no class - what was missing is the row. Twenty-three checkboxes across six surfaces each wrote their own flex label, and at 390px a 1.05rem box is a target you can miss while the word beside it is what a person aims at. The row carries the tap floor, so the word and the box are one target, and hover lightens the label rather than just the box.


### Fixed

- **`.cm-head__title` is styled inside `.cm-head-row`, not only inside
  `.cm-head`.** The selector was a descendant, so a title in the row variant
  fell back to the UA default size and the row measured 119px instead of one
  line. The showcase rendered fine only because its specimen sat inside a
  `.cm-head` ancestor.

- **The drift checker could not see a consumer whose layers are not at the
  repo root.** `spacetime-rpm` serves its admin console from `web/`, so it
  keeps them at `web/src/styles/cli-mono/`, and every comparison hardcoded
  `src/`. The result was the worst of both: rpm was reported MISSING on all
  five files and ORPHAN on the two it did compare, i.e. a *correct*
  consumer reported as broken - the crying-wolf end state - while the bare
  scan skipped it entirely, so `oem-ui-deep-audit.sh` listed rpm as "NOT on
  oem-ui" when rpm was one. It cost days: rpm carried `cm-check`,
  `cm-toolbar` and `cm-toolbar__count` - `.cm-*` names the library did not
  own, in the one file no consumer imports - and nothing ever named them.
  A target's install root is now DISCOVERED from the layer's content rather
  than assumed from its path.
- **Surface built inside a vendored layer is now named.** A vendored
  `components.css` that is ahead of the library reported only "N lines
  differ", which does not say that the extra lines are `.cm-*` names
  nothing else owns. `RESERVED` lists them. An override of a library part
  stays silent, because that is legal; defining a library-prefixed name is
  the defect.

### Fixed
- A rail control placed in `.cm-header__controls` (a sign-out button) was
  aligned and padded but never given the `--tap` floor its sibling links get
  from the rail rule, so it measured 31px against a 44px target.
- **Brace balance is now a contract check.** This suite was 326 passed / 0
  failed while `components.css` carried an unbalanced `}` that made every
  consumer's bundler refuse the file. No existing check parsed the file for
  balance, which is why they all stayed green. A CSS file that does not
  parse is the one defect a consumer cannot work around.

### Fixed
- **The inline row no longer starves its own excerpt.** The title column
  was `flex: 0 0 42ch` with `flex-shrink: 0`, so it held 404px and never
  gave any back; the excerpt, the only shrinkable child, absorbed the
  entire deficit and collapsed. Measured in WebKit at 700px it rendered
  **5.11px** wide — present, non-zero, unreadable, and a false pass for
  any check that only asks whether the column collapsed. The band spanned
  681-1024px and no media query covered it. Both columns now name measure
  tokens, and the widths at which the row cannot afford both are measured
  rather than guessed: 5px-step sweeps with the queries neutralized put
  the starve bands at **≤844px** and **1000-1055px**. The rail band
  *recovers* on both sides (153.11px at 1060px, 205.11px at 995px) because
  `--maxw` caps the content column, so the obvious `min-width: 1000px`
  would hide an excerpt measuring 205.11px at 1440px. The title keeps
  `flex-shrink: 0` deliberately: it carries `overflow: hidden`, which
  zeroes its automatic minimum, so `flex: 0 1` clipped titles across
  681-780px — trading a squeezed excerpt for a truncated primary label.
- **A tooltip near a screen edge no longer scrolls the whole page sideways.**
  A tip is `width: max-content`, and whether it fits depends on where its
  TRIGGER sits, which CSS cannot read. The cap was `100vw - 2*gutter`, which
  is right for a tip centred on its trigger and wrong for every anchored
  variant: `--start` pins the tip's left edge to the trigger's, so a
  trigger at x=131 in a 360px window leaves 229px, not 360. Measured 52px of
  sideways scroll at 360 and 92px at 320, plus 91px with JS disabled.
  `anchor-size()` is the real fix and WebKit 26.6 has no support for it, so
  there are now two caps: a tight viewport-fraction floor in CSS (what a
  no-JS reader gets) and a runtime clamp that measures the trigger and only
  ever tightens the floor. 0 sideways scroll at 320/360/390, with and
  without JS. The old `KNOWN 320` line in
  `tests/verify-no-sideways-scroll.py` was never asserted, which is a
  silent skip; 320 is now a hard failure.

### Added
- **`.cm-kv--link` — a key/value row whose whole row is the link.** Link
  only the `<dt>` and the target is the term: measured **14px tall** in
  WebKit at an iPhone viewport, a third of the 44px floor, because `<dt>`
  is inline and `min-height` is ignored on an inline box. The `<a>` wraps
  the row and owns the two columns, so the grid moves down one level onto
  it. Padding is cancelled with an equal negative margin, so the target
  grows without pushing the text away from the row above it. Stacks below
  520px, the same breakpoint as the base `.cm-kv`. Measured in WebKit at
  1280: 835.63×44, term and value 128px apart on the same row, and
  `elementFromPoint` in the column gap resolves to the row rather than to
  a hole.
  Demonstrated in the `layout` section, covered by
  `tests/mutate-kv-link.mjs` (15 mutations, 15 caught, 0 no-op) and
  measured by `tests/verify-kv-link-webkit.py`.

### Fixed
- **oem-portfolio defined four `cm-` classes from its own stylesheet.**
  `.kv-links`, `.cm-kv__pair`, `.cm-kv__ref`, `.cm-kv__term` and
  `.cm-kv__val` were a second implementation of the row link, written
  under the library's **reserved prefix** — so the same `.cm-*` name lived
  in two files and which one won was a question of import order nobody
  wrote down. Worse, the whole block was **dead**: its rules were scoped to
  a `.kv-links` wrapper that no page ever rendered, so `certs.astro` was
  carrying three class names that styled nothing. Removed, replaced by the
  library variant, and the page now leans on the `.cm-kv` pair wrapper
  (`display: contents`) for its two columns. A check now walks the
  consumer's own stylesheet and fails on any `.cm-*` name the library does
  not own — distinguishing that from a legitimate override of a library
  part, which `.cm-footer__meta a` is.

- **The auth card's title sat 16px left of the form under it.** The card
  carries the padding, and the first version zeroed it on the head only —
  so `.cm-card__body` kept its own 16px and the heading looked outdented.
  Measured in WebKit at 390px and 1100px, in both cards, both themes:
  `headAlign` was `[16, 16]`, now `[0, 0]`. The vision reviewer caught
  this one and reading the CSS did not. Three of its other four claims
  (an off-centre card, a divider missing its rules, buttons touching)
  measured as false, which is why it is measured rather than trusted.
- **The login surface was a second implementation of the form system.**
  The first draft added 21 classes (`.cm-login__field`, `__label`,
  `__error`, `__submit`, `.cm-submit`, `.cm-totp`, `.cm-pass`, `.cm-user`
  …) alongside components the library already owns. A field is
  `.cm-field`, an error is `.cm-alert--err`, a submit is
  `.cm-btn--primary`, a title is `.cm-card__title`. The duplication is
  the failure mode the migration rules describe: a fix made in one place
  never reaches the other. They were also **never demonstrated** - no
  showcase section, no test, no README entry - so the suite was red on
  arrival. 17 classes removed, 4 kept (below).
- **`.cm-code-input` declared ten properties that could never apply.**
  The base input rule is
  `input:not([type=checkbox]):not([type=radio]):not([type=range])`,
  which is (0,3,1) because `:not()` counts its argument - so a (0,1,0)
  class rule loses on every property it restates. Verified in WebKit at
  390px: with `font-family`, `font-size`, `color`, `background`,
  `border`, `border-radius`, `padding`, `width`, `min-height` and
  `line-height` all deleted, every computed value is byte-identical and
  the box is still 201.63x44. The rule now states only the three
  properties that genuinely differ from a prose field.
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

- **Auth surfaces, composed from the form system rather than beside it.**
  `.cm-auth` (centred full-viewport frame), `.cm-auth--wide`,
  `.cm-card--auth`, `.cm-code-input` (a one-time code, centred and
  tracked out) and `.cm-divider` (a rule with a word in it). A consumer
  writes no CSS: the frame owns the centring and the measure, on its
  CHILD so the frame's padding cannot fight a `max-width`. Demonstrated
  in the `auth` section of the showcase, both frames, 8 contract tests,
  12 mutations (12 caught, 0 no-ops), and 17 WebKit assertions at 390px
  and 1200px in both themes.

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
