# oem-ui

A mono/terminal design system extracted from [oem/log](https://log.oem.ngo).

Zero dependencies, no build step required. Three CSS layers, one small
runtime, and optional Astro components you can copy in.

**Dark is the default. Light is an explicit choice.**

---

## States

Every async surface needs three things: what it shows before it has
data, what it shows while it loads, and what it shows when it fails. The
system owns all three so no consumer has to invent them.

```html
<!-- empty -->
<div class="cm-state">
  <span class="cm-state__mark" aria-hidden="true">&#8709;</span>
  <p class="cm-state__title">Nothing here yet</p>
  <p class="cm-state__text">One line on what would fill this.</p>
</div>

<!-- loading: a skeleton for a shape you know, a spinner for an action -->
<div class="cm-skeleton" aria-hidden="true">
  <div class="cm-skeleton__line" style="width:60%"></div>
</div>
<span class="cm-spinner" role="status" aria-label="working"></span>

<!-- failure -->
<div class="cm-alert cm-alert--err">
  <span class="cm-alert__mark" aria-hidden="true"></span>
  <div class="cm-alert__body">
    <p class="cm-alert__title">build failed</p>
    <p class="cm-alert__text">What went wrong, and what to do next.</p>
  </div>
</div>
```

Two rules the tests enforce:

- **The alert mark is empty in the markup.** CSS injects the glyph per
  variant, so a literal glyph in the span renders twice.
- **State is never carried by colour alone.** Every alert variant ships
  a distinct glyph (`●` / `▲` / `✕`), and every animation in the system
  is listed together in one `prefers-reduced-motion` block.

## Spacing

**Never write a raw `rem`/`px` spacing value.** The system owns one scale,
`--space-0` (2px) through `--space-10` (96px), and a test rejects any
other number in `base.css` or `components.css`.

- `--space-0` `0.125rem` 2px — hairline nudges, icon to label
- `--space-1` `0.25rem` 4px — tight stacks, inside a control
- `--space-2` `0.5rem` 8px — **the default gap** between related items
- `--space-3` `0.75rem` 12px — label to its value
- `--space-4` `1rem` 16px — between blocks; the workhorse
- `--space-5` `1.25rem` 20px — group separation
- `--space-6` `1.5rem` 24px — between sections
- `--space-7` `2rem` 32px — between major blocks
- `--space-8` `3rem` 48px — between page sections
- `--space-9` `4rem` 64px — above a top-of-page head
- `--space-10` `6rem` 96px — page-level breathing room

The scale is theme-independent and lives in `:root` only. `em`, `calc()`,
`var()`, `auto` and `0` are exempt: those are relative to a font size or
a computed value, not to the rhythm.

## Keeping a consumer in sync

Vendored files go stale silently — the site still builds, still renders,
and just quietly keeps whatever bugs the library has already fixed. Check
and fix with:

```bash
/root/projects/oem-ui/scripts/check-design-sync.sh          # scan every project
/root/projects/oem-ui/scripts/check-design-sync.sh /path/to/site
/root/projects/oem-ui/scripts/install.sh /path/to/site      # re-install
```

`check-design-sync.sh` exits 1 on drift and names the fix command. Run it
in CI if you can; until then, run it after any change to the three CSS
layers or the runtime.

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
/root/projects/oem-ui/scripts/install.sh <your-project-dir>
```

Copies the four files into `<your-project-dir>` in one fixed layout, so every
project on the fleet ends up with identical paths. Idempotent — re-run it any
time to pull the current library.

```bash
# for a project that serves static files from a flat dir
/root/projects/oem-ui/scripts/install.sh <your-project-dir> --flat
```

### Option B — copy the files by hand

```bash
cp -r /root/projects/oem-ui/src/styles <your-project>/src/
cp /root/projects/oem-ui/src/js/cli-mono.js <your-project>/src/js/
```

### Not available yet

- `curl https://raw.githubusercontent.com/...` returns **404** — a private
  repo is not readable anonymously. The README used to document this; it was
  wrong and the install silently produced nothing.
- `npm i oem-ui` returns **404** — never published. Publishing would also
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

### Tabs, dialogs, toasts, dropdowns, tooltips

Five surfaces that sit **on top of** the page. Four of them are native
elements doing native things. There is no dependency and no framework
requirement; the only script is a roving-tabindex handler, and the
runtime is already loaded.

**`.cm-tabs`** — an ARIA-correct tablist. The whole relationship is
markup (`role` + `aria-controls` / `aria-labelledby`); the runtime owns
the one part CSS cannot express, which is the keyboard contract.

```html
<div class="cm-tabs">
  <div class="cm-tabs__list" role="tablist" aria-label="layer ownership">
    <button class="cm-tabs__tab" role="tab" id="t1"
            aria-selected="true"  aria-controls="p1">tokens</button>
    <button class="cm-tabs__tab" role="tab" id="t2"
            aria-selected="false" aria-controls="p2">base</button>
  </div>
  <div class="cm-tabs__panel" role="tabpanel" id="p1"
       aria-labelledby="t1" tabindex="0">…</div>
  <div class="cm-tabs__panel" role="tabpanel" id="p2"
       aria-labelledby="t2" tabindex="0" hidden>…</div>
</div>
```

- Arrow keys move, wrap, and select; `Home` / `End` jump to the ends.
- **One** tab is in the tab order at a time (roving `tabindex`), which is
  the WAI-ARIA pattern. Without it `Tab` walks the entire row.
- The runtime normalises the markup on bind: if two tabs claim
  `aria-selected="true"`, the first wins. A mismatch is a silent ARIA
  lie, and this way the component cannot ship one.
- A panel gets `tabindex="0"` so a keyboard user can scroll it.

**`.cm-dialog`** — a real `<dialog>`, opened with `showModal()`. The
focus trap, `Escape`, the top layer and the inertness of the page behind
are the browser's job; a hand-rolled modal gets every one of them
subtly wrong. Any `<form method="dialog">` inside closes it.

```html
<button class="cm-btn" data-cm-open="confirm">open</button>

<dialog class="cm-dialog" id="confirm" aria-labelledby="confirm-title">
  <form method="dialog" class="cm-dialog__head">
    <h3 class="cm-dialog__title" id="confirm-title">Close the build?</h3>
    <button class="cm-toast__close" aria-label="Close" value="close">&times;</button>
  </form>
  <div class="cm-dialog__body"><p>…</p></div>
  <div class="cm-dialog__foot">
    <button class="cm-btn" value="cancel">cancel</button>
    <button class="cm-btn cm-btn--primary" value="confirm">confirm</button>
  </div>
</dialog>
```

- `::backdrop` paints `--scrim`, which is a **token with a different
  value per theme**. The same alpha over near-black and over near-white
  does not dim the page by the same amount, so one literal is wrong in
  one theme by construction.
- Do not use `role="dialog"` on a `<div>`. A test rejects it.
- Give it `aria-labelledby`; an unnamed dialog is announced as "dialog"
  and nothing else.
- `.cm-dialog` declares `margin: auto` on purpose: a consumer's
  `* { margin: 0 }` reset would otherwise pin the dialog to the corner.

**`.cm-toast`** — a transient alert. Same border weights, same glyphs,
same `--ok` / `--warn` / `--err` words as `.cm-alert`, because a second
prettier alert component is how one system quietly becomes two. Mount
one into a live region:

```html
<div class="cm-toast-region" data-cm-toasts role="status" aria-live="polite"></div>
```

```js
const el = document.createElement('div');
el.className = 'cm-toast cm-toast--ok';
el.setAttribute('data-cm-toast', '');
el.textContent = 'saved';
cliMono.toast(el);          // mounts + schedules retirement
cliMono.dismissToast(el);   // immediate, idempotent
```

- **Retires itself after 6s.** "Transient" is the contract, so somebody
  has to honour it; the close control is `data-cm-toast-close`.
- The region is `pointer-events: none` and each toast is `auto`: a stack
  must never eat a click on the page behind it.
- **Do not put `role="alert"` on the toast.** The region already
  announces the insertion; an alert inside a live region is announced
  twice. The region owns the announcement.

**`.cm-dropdown`** — the native Popover API, so the runtime has nothing
to do with it. `popovertarget` on the trigger, `popover` on the panel,
which buys light-dismiss, `Escape` and focus return for free.

```html
<div class="cm-dropdown">
  <button class="cm-btn" popovertarget="menu1" aria-haspopup="menu">actions</button>
  <div class="cm-dropdown__menu" id="menu1" popover role="menu" aria-label="row actions">
    <button class="cm-dropdown__item" role="menuitem">rename</button>
    <hr class="cm-dropdown__sep" />
    <button class="cm-dropdown__item" role="menuitem" aria-disabled="true">delete</button>
  </div>
</div>
```

- Every item is a real `<button>` with `role="menuitem"`; a disabled
  item is `aria-disabled`, not just dimmed.
- `.cm-dropdown__menu:not(:popover-open) { display: none }` is not
  redundant. The UA sheet hides a closed popover, but any author
  `display` outranks it — without this rule a consumer's reset leaves a
  menu on screen that the author closed.

**`.cm-tooltip`** — a real element, revealed by `:hover` and
`:focus-within`. No JavaScript at all.

```html
<span class="cm-tooltip">
  <button class="cm-btn" aria-describedby="tip1">hover or focus me</button>
  <span class="cm-tooltip__tip" id="tip1" role="tooltip">…</span>
</span>
```

- **A real element, not a `::after`.** `aria-describedby` must resolve
  to something in the accessibility tree, and generated content is not
  there — a `::after` tooltip is invisible to a screen reader no matter
  how good the text is.
- The trigger must be focusable, or `:focus-within` never fires and the
  tip is mouse-only.
- A hidden tip is `visibility: hidden` **and** `pointer-events: none`.
  Transparent-only leaves it swallowing clicks and still reachable by AT.
- Use `--end` when the trigger sits against the right edge; that is an
  edge case you name, not one the reader discovers.

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
| `HeaderLink.astro` | one nav link, `aria-current` when it is this page |
| `Footer.astro` | meta row + status line |
| `PageHead.astro` | kicker / title / sub block |
| `PostHead.astro` | article head with byline |
| `PostRow.astro` | one list row |
| `StatusStrip.astro` | label / value status line |

```astro
---
import Header from '../components/Header.astro';
import HeaderLink from '../components/HeaderLink.astro';
import Footer from '../components/Footer.astro';
---
<Header
  links={[{ href: '/blog/', label: 'notes' }, { href: '/about/', label: 'about' }]}
  homeHref="/"
/>
<slot />
<Footer items={['astro', 'static']} contactHref="mailto:you@example.com" />
```

### The two nav states

A nav link can be in two states at once, and they answer different questions.
Keep them as two attributes or the first scroll event will erase the other.

- **`active`** — *where you are.* Set it on the `Link` (or let `<HeaderLink>`
  decide), and it renders `aria-current="page"`.
- **`is-active`** — *what you are reading.* The runtime's scroll-spy sets it
  on the link whose section you are in. It needs a `[data-cm-nav]` container
  and a target per link, and `<Header>` emits both: the spy id is inferred
  from a `#section` href, so a one-page site gets it for free.

```astro
<!-- multi-page: the current page -->
<HeaderLink href="/blog/">notes</HeaderLink>

<!-- section pages: keep it lit while you read one -->
<HeaderLink href="/docs" matchSegment>docs</HeaderLink>

<!-- one-pager: hand the links to the scroll-spy -->
<Header links={[{ href: '#intro', label: 'intro' }, { href: '#api', label: 'api' }]} />
```

`<HeaderLink>` normalises trailing slashes, query strings, hashes and the
site `base` before comparing, and never marks an external href as current.
It emits only the attribute — the look stays with
`.cm-header__link[aria-current='page']`, so a hand-rolled nav and this
component cannot drift apart.

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

## Documenting the design language

The showcase's foundation section exists so the system can be read, not
just copied: colour swatches, the type scale, every spacing step and the
shape/motion tokens, each rendered from the token it documents. A swatch
paints `var(--ink-dim)`; a spacing bar is `width: var(--space-N)`. Nothing
in that block is typed as a literal, so the page cannot drift away from the
system it demos — and a test enforces that.

`.cm-swatch` and `.cm-spec` are library components, not showcase-local, so
a consumer can document its own tokens the same way.
