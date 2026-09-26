# cli-mono

A mono/terminal design system extracted from [oem/log](https://log.oem.ngo).

Zero dependencies, no build step required. Three CSS layers, one small
runtime, and optional Astro components you can copy in.

**Dark is the default. Light is an explicit choice.**

---

## Why this exists

A good-looking design that lives inside one project is a design you have to
re-invent every time. This is the same system, pulled apart into layers that
any project can adopt:

- swap the tokens, keep the components
- copy four files, no package manager
- works in Astro, React, Svelte, Hugo, Django, or a plain HTML file

## Install

### Option A — copy the files (recommended for a repo that owns its stack)

```bash
curl -sL https://raw.githubusercontent.com/omiinaya/cli-mono/main/src/styles/tokens.css     -o src/styles/cli-mono/tokens.css
curl -sL https://raw.githubusercontent.com/omiinaya/cli-mono/main/src/styles/base.css       -o src/styles/cli-mono/base.css
curl -sL https://raw.githubusercontent.com/omiinaya/cli-mono/main/src/styles/components.css -o src/styles/cli-mono/components.css
curl -sL https://raw.githubusercontent.com/omiinaya/cli-mono/main/src/js/cli-mono.js        -o src/js/cli-mono.js
```

Copying beats installing: the library is ~25KB of CSS and ~7KB of JS, it will
never change under you, and there is no version to track.

### Option B — install as a package

```bash
npm i cli-mono
```

```js
import 'cli-mono/styles/tokens.css';
import 'cli-mono/styles/base.css';
import 'cli-mono/styles/components.css';
```

### Wire it up

```html
<head>
  <!-- 1. FOUC guard FIRST, inline, before any stylesheet.
          Without it a light-theme user sees a black flash. -->
  <script>
    (function () {
      try {
        var s = localStorage.getItem('cm-theme');
        if (s === 'light') document.documentElement.setAttribute('data-theme', 'light');
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/styles/tokens.css" />
  <link rel="stylesheet" href="/styles/base.css" />
  <link rel="stylesheet" href="/components.css" />
</head>
<body>
  <!-- ... -->
  <script src="/js/cli-mono.js"></script>  <!-- 2. runtime LAST -->
</body>
```

> **Astro gotcha:** import the runtime with a real `<script src="...">` tag at
> the bottom of `<body>`. A frontmatter `import '../js/cli-mono.js'` gets
> tree-shaken out of the bundle and the library silently does nothing. This
> cost an hour once; the test suite now guards the bundle, not just the source.

## Layers

| File | What it owns | When it changes |
|---|---|---|
| `tokens.css` | every color, size, motion value, both themes | rebrand |
| `base.css` | element defaults, prose rhythm, scrollbar, a11y | rarely |
| `components.css` | `.cm-*` component classes | adding components |
| `cli-mono.js` | theme, sticky header, scroll-spy, copy, year | rarely |

Load in that order. Each layer assumes the one above it.

## Components

### Buttons

```html
<a class="cm-btn">Default</a>
<a class="cm-btn cm-btn--primary">Primary</a>
<a class="cm-btn cm-btn--ghost">Ghost</a>
<a class="cm-btn cm-btn--sm">Small</a>
<a class="cm-btn cm-btn--block">Block</a>
<div class="cm-btn-group">…</div>
```

Square corners, 1px borders, 0.12s transitions. The border carries the
weight, not a fill. Ghost is text-only and underlines on hover so it still
reads as a control.

### List rows

The workhorse. One row shape for notes, docs, jobs, or anything enumerated.

```html
<ul class="cm-rows cm-rows--inline">
  <li>
    <a href="/note/1" class="cm-row">
      <span class="cm-row__idx">03</span>
      <div class="cm-row__body">
        <span class="cm-row__title">The title, never truncated</span>
        <span class="cm-row__desc">The description, which truncates</span>
      </div>
      <span class="cm-row__meta"><time datetime="2025-09-26">Sep 25, 2025</time></span>
      <span class="cm-row__sym" aria-hidden="true">▸</span>
    </a>
  </li>
</ul>
```

Add `.cm-rows--stacked` for the tall variant (title over description over
date), used on index pages.

**The truncation rule:** the title is the primary label and never
ellipsizes — it pushes the description instead. Only pathologically long
titles (over 70% of the row) truncate. Do not "fix" this by truncating the
title; a reader scanning for a title must never lose it.

### Page head

```html
<header class="cm-head">
  <p class="cm-kicker">all notes</p>
  <h1>Index</h1>
  <p class="cm-head__sub">12 notes · newest first</p>
</header>
```

`--head-top` and `--head-h1` are the single source for the top-of-page start,
so every route begins its content at the same y. This is deliberate: the
thing that most reliably makes a site feel unpolished is content that jumps
between pages.

### Everything else

```html
<div class="cm-status cm-status--ok"><span class="cm-status__label">status</span><span class="cm-status__value">…</span></div>
<div class="cm-list-head">Index / latest</div>
<div class="cm-section cm-section--pad">…</div>
<div class="cm-prose">…</div>          <!-- long-form, adds the ## marks -->
<div class="cm-media"><img …></div>   <!-- bordered figure -->
<span class="cm-cursor"></span>        <!-- blinking block -->
<div class="cm-rule"><span class="cm-rule__label">next</span></div>
<div class="cm-term">…</div>          <!-- terminal window panel -->
<dl class="cm-kv"><dt>k</dt><dd>v</dd></dl>
<span class="cm-tag">tag</span>
<footer class="cm-footer">…</footer>
```

## Theming

Change the tokens, keep the components.

```css
:root[data-theme='light'] {
  --bg: #ffffff;
  --ink: #000000;
  --accent: #5b8cff;   /* the one place a brand color goes */
}
```

To theme a subtree (an iframe, an embedded widget, a shadow root) use
`data-cm-theme` so you don't fight the document-level theme:

```html
<div data-cm-theme="light">…</div>
```

### JS API

```js
cliMono.getTheme();      // 'dark' | 'light'
cliMono.applyTheme('light');
cliMono.toggleTheme();
cliMono.init(rootEl);    // re-bind after client-side navigation
```

## Astro components

Copy from `src/astro/` and set your identity in `config.ts`:

| Component | Renders |
|---|---|
| `Head.astro` | meta, canonical, OG, FOUC guard |
| `Header.astro` | sticky nav, brand, theme toggle |
| `Footer.astro` | meta row + status line |
| `PageHead.astro` | kicker / title / sub block |
| `PostHead.astro` | article head with byline |
| `PostRow.astro` | one list row |
| `StatusStrip.astro` | label / value status line |

```astro
---
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
---
<Header
  links={[{ href: '/blog/', label: 'notes' }, { href: '/about/', label: 'about' }]}
  homeHref="/"
/>
<slot />
<Footer items={['astro', 'static']} contactHref="mailto:you@example.com" />
```

No component hardcodes site identity — everything comes from `config.ts` or
props, so one library serves many projects.

## Accessibility

- Every text color passes **WCAG AA (4.5:1)** against every surface it lands
  on, in both themes. The test suite computes this from the real hex values,
  so a future tweak that breaks it fails `npm test`.
- Focus is always visible. The house style is a dim 1px outline that
  brightens on interaction; never remove it without replacing it.
- `prefers-reduced-motion` disables the cursor blink and all transitions.
- Decorative glyphs (`▸`, `●`, the cursor) are `aria-hidden`.

## Development

```bash
npm install
npm run dev       # showcase at :4321
npm run build     # static build
npm test          # contract tests (contrast, tokens, runtime, a11y)
```

The `showcase/` and `src/pages/index.astro` pages render every component, so
`npm run build` is a real compile of the whole library.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: tokens are the contract,
new components ship with a test, and if it changes the look of an existing
component, it goes in `CHANGELOG.md`.

## License

MIT
