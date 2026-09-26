# Contributing to oem-ui

## The one rule

**Tokens are the contract. Components are the expression. Never hardcode a
value that a token already owns.**

If you find yourself writing a hex code, a pixel value, or a timing in a
component, it belongs in `tokens.css`. That is what makes a rebrand a
one-file change instead of a grep.

## Layer boundaries

| Layer | May depend on | May NOT |
|---|---|---|
| `tokens.css` | nothing | on anything |
| `base.css` | `tokens.css` | define components |
| `components.css` | `tokens.css`, `base.css` | define new tokens |
| `cli-mono.js` | the DOM | require a framework |
| `src/astro/*` | tokens + the config | hardcode site identity |

Loading order is `tokens → base → components`. A layer must work when only
the layers above it are loaded.

## Adding a component

1. Name it `.cm-<block>`, variants `.cm-<block>--<variant>`, internal parts
   `.cm-<block>__<part>`, state hooks `is-<state>`.
2. Use only existing tokens. If you need a new value, add the token first
   and explain why in `CHANGELOG.md`.
3. Ship it on the showcase page (`src/pages/index.astro`) so `npm run build`
   actually compiles it.
4. Add a test to `tests/run.mjs` asserting the class exists.
5. Document it in the README component list with a copy-paste snippet.

## Changing the look of something existing

That is a breaking change, even if it feels small. Add it under
`[Unreleased]` in `CHANGELOG.md` with the before/after, and say plainly which
projects will look different.

## Contrast is a test, not an opinion

`npm test` computes WCAG ratios from the real hex values in `tokens.css`
against every surface each token lands on. If a tweak fails AA, the test
fails — do not lower the threshold to make it pass. If a genuinely
decorative glyph needs to be fainter, give it its own token so it is an
explicit, reviewable choice instead of an accident.

## Before you push

```bash
npm test        # contract tests
npm run build   # compiles every component in the showcase
```

Both must pass. A component that does not compile is not a component.

## Runtime integration

- No frameworks, no bundler assumptions, no `import` statements in the
  runtime. It is a plain IIFE and works from a `<script src>`.
- Anything with a side effect must be re-runnable. `init()` is idempotent:
  it guards against double-binding with a `data-cm-*-bound` marker and
  re-binds on `astro:page-load`.
- Astro tree-shakes side-effect-only frontmatter imports. If you add a
  module the user imports from an `.astro` file, document that it needs a
  `<script src>` tag.

## Tone of the code

Comments explain **why**, not what. If a line needs a comment to say what it
does, rename something instead. If it needs a comment to say why it is the
way it is, that is the comment worth writing.
