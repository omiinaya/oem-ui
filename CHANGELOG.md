# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The showcase is reachable from the LAN. `dev` and `preview` now bind
  `0.0.0.0` (set in both `astro.config.mjs` and the npm scripts) instead of
  Astro's `127.0.0.1` default, which refused connections from any other
  device. A contract test fails if either location loses the bind.
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
