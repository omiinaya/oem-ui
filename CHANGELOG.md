# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
