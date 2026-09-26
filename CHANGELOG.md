# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  not readable anonymously, `npm i cli-mono` was never published, and the
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
