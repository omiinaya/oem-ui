# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A zero-dependency mono/terminal design system: 3 CSS layers, 1 JS runtime,
7 optional Astro components, and a contract test suite. There is no build
step required to *use* it. `npm run build` only builds the showcase.

## Orientation

```
src/styles/tokens.css       the contract — all values, both themes
src/styles/base.css         element defaults, a11y, prose rhythm
src/styles/components.css   all .cm-* components
src/js/cli-mono.js          runtime: theme, scroll-spy, copy, year
src/astro/                  optional Astro components + config.ts
src/pages/index.astro       the showcase — renders everything
tests/run.mjs               contract tests
```

## Rules that are easy to break by accident

1. **Tokens are the only place values live.** No hex, px, or timing literals
   in `components.css`. A hardcoded value is a rebrand bug.
2. **Load order is `tokens → base → components`.** Each layer must work with
   only the layers above it present.
3. **Astro tree-shakes side-effect-only frontmatter imports.** The runtime
   must be loaded with `<script src="../js/cli-mono.js"></script>`. A
   frontmatter `import` compiles fine and silently does nothing at runtime —
   this is the single most likely way to "verify" a broken integration.
4. **The FOUC guard must come before any stylesheet** in `<head>`, inline.
5. **`init()` must stay idempotent.** It is called again on every
   `astro:page-load`. Guard with `data-cm-*-bound`.
6. **The title never truncates in a list row; the description does.** Do not
   "fix" this the other way.
7. **No component hardcodes site identity.** It comes from
   `src/astro/config.ts` or props. A test enforces this.

## Verifying your change

```bash
npm test        # must be green
npm run build   # must compile the showcase
```

`npm test` is a real contract suite, not a smoke test. It computes WCAG
contrast from the actual hex values, parses the actual CSS rules, and
executes the actual runtime against a fake DOM. If you break the theme
default, the row layout, or contrast, it fails.

For visual work, also load the showcase in a browser and check **both
themes** — a contrast or truncation bug is invisible in a passing build.

## Verifying a change in a *consumer* project

Do not stop at "the library builds". Prove the integration:

- copy the four files into the consumer, or link the package
- confirm the FOUC guard is before the stylesheet
- confirm the runtime actually bound: `typeof window.cliMono === 'object'`
- toggle the theme and reload, and confirm it persists
- check one real page, not just the homepage

## Style

- Comments explain **why**, never what. A line that needs a comment to say
  what it does needs a rename instead.
- CSS property order follows the existing files; match the surrounding style
  (tabs, one declaration per line, lowercase hex).
- Public API changes need a README update and a `CHANGELOG.md` entry under
  `[Unreleased]`.

## Do not

- Add a dependency. If something needs a library, solve it in 30 lines or
  leave it to the consumer.
- Add a build step to the published artifact.
- Change the look of an existing component without a changelog entry.
- Lower a test threshold to make a failing check pass. Fix the token.
