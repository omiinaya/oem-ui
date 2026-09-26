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

The repo is **private** and **not published to npm**, so the two paths below
are the only ones that work today. Everything on this fleet is local, so the
installer is the default.

### Option A — the installer (recommended)

```bash
/root/projects/cli-mono/scripts/install.sh <your-project-dir>
```

Copies the four files into `<your-project-dir>` in one fixed layout, so every
project on the fleet ends up with identical paths. Idempotent — re-run it any
time to pull the current library.

```bash
# for a project that serves static files from a flat dir
/root/projects/cli-mono/scripts/install.sh <your-project-dir> --flat
```

### Option B — copy the files by hand

```bash
cp -r /root/projects/cli-mono/src/styles <your-project>/src/
cp /root/projects/cli-mono/src/js/cli-mono.js <your-project>/src/js/
```

### Not available yet

- `curl https://raw.githubusercontent.com/...` returns **404** — a private
  repo is not readable anonymously. The README used to document this; it was
  wrong and the install silently produced nothing.
- `npm i cli-mono` returns **404** — never published. Publishing would also
  make the repo public, which is a deliberate choice, not an oversight.

Both become live the day this repo goes public, with no code change.

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

### Forms

Controls are **element defaults**, not classes. A bare `<input>` is already
on-brand; you only add classes for the layout around it.

```html
<div class="cm-field">
  <label class="cm-field__label" for="url">url <span class="cm-field__req">*</span></label>
  <input id="url" type="url" placeholder="https://" aria-invalid="true" aria-describedby="url-err">
  <p class="cm-field__error" id="url-err">! must include the scheme.</p>
</div>

<div class="cm-field-row">…</div>          <!-- two columns, stacks on a phone -->
<form class="cm-form">
  <div class="cm-form__actions">…</div>    <!-- right-aligned, stacks below 520px -->
</form>
```

- Text is **16px minimum** so iOS does not zoom the viewport on focus. The
  mobile floor is 12px; forms deliberately sit above it.
- `aria-invalid="true"` gives a 2px border instead of 1px. The palette is
  greyscale, so the state is carried by weight, not hue — the only cue a
  colourblind reader would otherwise miss.
- `.cm-field__help` is the neutral hint; `.cm-field__error` is the failure
  message. Keep the `!` prefix so the state does not rely on colour alone.
- Checkboxes and radios are drawn in CSS; `select` has a CSS arrow, because
  the platform one disappears against a dark surface.

> **Specificity trap.** The base rule is
> `input:not([type=checkbox]):not([type=radio]):not([type=range])`, and
> `:not()` counts its argument — that is (0,3,1). A plain
> `input[aria-invalid='true']` is (0,1,1) and **loses silently**. Match the
> base selector when you add a state; a test asserts the counts.

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
npm run dev       # showcase on the LAN at http://<lan-ip>:4321
npm run build     # static build
npm test          # contract tests (contrast, tokens, runtime, a11y, LAN bind)
```

Both `dev` and `preview` bind `0.0.0.0`, so the showcase is reachable from any
device on your network. Astro's default is `127.0.0.1`, which gives you a
"connection refused" from a phone or laptop no matter what port you open, so
the bind is set in `astro.config.mjs` **and** in the npm scripts, with a test
that fails if either one loses it. Verify on the LAN IP, not localhost:

```bash
hostname -I | awk '{print $1}'                    # your LAN IP
curl -s -o /dev/null -w '%{http_code}\n' http://$(hostname -I | awk '{print $1}'):4321/
```

This is a static showcase with no write routes and no credentials, so it is
fine unauthenticated inside your own network. It is bound to the LAN only: no
DNS record points at it and no port is forwarded on the router.

The `showcase/` and `src/pages/index.astro` pages render every component, so
`npm run build` is a real compile of the whole library.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: tokens are the contract,
new components ship with a test, and if it changes the look of an existing
component, it goes in `CHANGELOG.md`.

## License

MIT
