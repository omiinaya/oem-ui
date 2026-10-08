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

### Vertical rhythm — `.cm-stack`

A token scale on its own does not give consistency; a token says *which
number*, not *who applies it*. With nothing owning the space between
blocks, every project picked its own value — and the same 0px gap between
a heading and the content under it showed up in every one of ours.

`.cm-stack` is the thing that owns that space. Put it on the page's main
flow element and the separation between its children becomes one value:

```html
<main class="cm-stack cm-stack--section">
```

```css
.cm-stack { display: flex; flex-direction: column; gap: var(--stack-gap); }
.cm-stack > * { margin-block: 0; }  /* the stack owns it, not the children */
```

A stack OWNS its spacing, so `gap` and child margins must not both apply —
hence the margin reset. That reset sits **last** in `components.css` on
purpose: at equal specificity, order decides, and placing it earlier loses
every tie to `.cm-head`, `.cm-status` and `.cm-section`.

| class | gap | use |
| --- | --- | --- |
| `.cm-stack` | `--stack-gap` (20px) | a plain run of related blocks |
| `.cm-stack--tight` | `--stack-tight` (12px) | a dense list |
| `.cm-stack--snug` | `--space-3` 12px | one step tighter |
| `.cm-stack--section` | `--stack-section` (**24px**) | the top-level rhythm of a page |
| `.cm-stack--airy` | `--space-7` 32px | a section that wants air |
| `.cm-stack--loose` | `--space-8` 48px | page-level separation |
| `.cm-stack--flush` | `0` | children that must touch — a row list whose rows carry their own dividers |

Retune a whole site from one line:

```css
:root { --stack-section: var(--space-7); }  /* 32px everywhere */
```

**Use `--flush` where rows carry their own separators.** `cm-rows` draws
dividers between its rows; stacking it with the default gap pulls the rows
apart and leaves a stray rule hanging in the margin.

The scale is theme-independent and lives in `:root` only. `em`, `calc()`,
`var()`, `auto` and `0` are exempt: those are relative to a font size or
a computed value, not to the rhythm.

### A sticky bar needs a bounded parent

`.cm-toolbar` is `position: sticky; bottom: 0`. That is correct — a bar
that acts on a selection belongs where the thumb already is. But sticky
positions resolve against their **containing block**, so a bar with
nothing above it inside a very tall parent pins to the viewport bottom for
the whole document. On the showcase that was measured over the prose and
every section below it, at every scroll position.

Give it a bounded box and the content it acts on:

```astro
<div class="cm-stack cm-stack--tight" style="min-height: 22rem; overflow: hidden">
  <ul class="cm-rows cm-rows--inline" style="flex: 1">
    <li class="cm-row"><span class="cm-row__title">api.example.com</span></li>
    <!-- ... -->
  </ul>
  <div class="cm-toolbar">
    <span class="cm-toolbar__count">3 items selected</span>
    <button class="cm-btn cm-btn--sm">enable all</button>
  </div>
</div>
```

`tests/verify-chrome-covers.py` checks the general case: it walks the
document in 400px steps and fails if any sticky or fixed element covers
text or a control.

## Keeping a consumer in sync



Vendored files go stale silently — the site still builds, still renders,
and just quietly keeps whatever bugs the library has already fixed. Check
and fix with:

```bash
./scripts/check-design-sync.sh                                # scan every project
./scripts/check-design-sync.sh /path/to/site
./scripts/install.sh /path/to/site                            # re-install
```

`check-design-sync.sh` exits 1 on drift and names the fix command. Run it
in CI if you can; until then, run it after any change to the three CSS
layers or the runtime.

## Why this exists

A good-looking design that lives inside one project is a design you have to
re-invent every time. This is the same system, pulled apart into layers that
any project can adopt:

- swap the tokens, keep the components
- copy five files, no package manager
- works in Astro, React, Svelte, Hugo, Django, or a plain HTML file

## Install

The repo is **private** and **not published to npm**, so the two paths below
are the only ones that work today. Everything on this fleet is local, so the
installer is the default.

### Option A — the installer (recommended)

```bash
./scripts/install.sh <your-project-dir>
```

Copies the five files into `<your-project-dir>`. Idempotent — re-run it any
time to pull the current library.

**A plain run updates the layout the target already vendors.** The installer
looks for copies the project has (`tokens.css` recognised by content share,
JS recognised by content or by being ours by name) and refreshes every one of
them — `web/src/…`, `plugin/…`, a flat root copy, a renamed `runtime.js`, a
`public/` verbatim copy. It creates the default `src/` layout only when it
finds nothing to update, which is what makes the checker's bare `fix:` line
correct for every layout instead of depositing a second, unserved copy.

```bash
# for a project that serves static files from a flat dir
./scripts/install.sh <your-project-dir> --flat

# for an Astro project that must serve the runtime VERBATIM
./scripts/install.sh <your-project-dir> --public
```

`--public` exists because Astro TREATS `<script src>` as a bundler asset
reference: when the src is a variable it cannot resolve, **the tag is
dropped from `dist/` entirely** while the HTML comment above it still ships,
so the page looks wired up and has no runtime. The fix is `is:inline`, which
needs the file in `public/` to have something to serve:

```astro
---
const base = import.meta.env.BASE_URL;   // never a leading "/"
---
<script is:inline src={base + "cli-mono.js"}></script>
```

Keep that copy **generated**. Hand-maintaining it is how oem-portfolio ended
up serving a runtime 140 lines behind the library while its own
`src/js/cli-mono.js` stayed byte-identical and every drift check passed —
the copy lived on a path the checker did not know about. `install.sh
--public` produces it from the same source as `src/js`, and
`check-design-sync.sh` now compares both.

### Option B — copy the files by hand

```bash
cp -r src/styles <your-project>/src/
cp src/js/cli-mono.js <your-project>/src/js/
```

### Option C — a consumer that cannot import the library globally

Some consumers cannot take `tokens.css` and `base.css` at all, and the
reasons are structural rather than preference:

- **`base.css` carries 52 bare-element rules** (`a`, `h1`, `table`…), and
  unlayered CSS outranks every Tailwind `@layer` *regardless of specificity*.
  A bundler that inlines `@tailwind base` into your stylesheet will let the
  library's `a` rules override your own utilities.
- **`tokens.css` declares its whole scale on a bare `:root`.** Import it and
  the library palette reaches your document root — where it collides with a
  consumer's own `--accent` and `--radius`.

That is the shape of a React + Vite + Tailwind app. For those, generate a
**scoped** entry point:

```bash
# vendor first, so the generator's import path resolves
./scripts/install.sh <your-project> --flat

node scripts/make-scoped-entry.mjs \
  --out <your-project>/src/cm-prose.css \
  --components ../cli-mono/components.css
```

That emits the consumer's `@import` of its own vendored `components.css`
**first**, then the theme-independent scale and the two `[data-cm-theme]`
colour blocks copied verbatim from `tokens.css`, all re-scoped to
`[data-cm-theme]`. `components.css` is the one stylesheet that is safe to
import directly — every rule in it is `.cm-*`-scoped or a non-`cm-` class only
ever emitted as a compound under a `.cm-` parent.

Then opt the subtree in, and **the generated file must be the first
statement in your main stylesheet**:

```html
<!-- 1. the @import, above every other statement -->
@import "./cm-prose.css";

@tailwind base;      <!-- 2. your own reset, after it -->
```

```jsx
// the library's own documented scoped hook: this subtree only
<div className="cm-prose article-content" data-cm-theme="dark"
     data-cm-table-labels>
```

Two things here fail *silently*, so both are worth stating:

- **`@import` after any other statement is dropped by PostCSS** with a
  warning. The build stays green and your CSS holds none of the library.
  Measured: `grep -c 'cm-prose-table' dist/assets/*.css` returned **0**.
  A comment above the `@import` still counts as a statement.
- **The generated file must not be hand-edited.** Re-run it; `--check`
  fails when it has drifted, which is what keeps a rebrand from silently
  missing the consumer:

```bash
node scripts/make-scoped-entry.mjs --check <your-project>/src/cm-prose.css \
  --components ../cli-mono/components.css
```

#### A scoped adoption brings no PAGE SURFACE, and that is the sharpest edge

This is the one thing the scoped entry cannot give you, and getting it wrong
renders an app **black text on a white page** while every token resolves
correctly — the tokens are present, nothing is painting them.

`base.css` is where the surface lives, and a scoped adoption cannot
import it — it is the bare `body` rule that sets
`background-color: var(--bg); color: var(--ink)`, plus 51 sibling element
defaults. (An earlier version of this section credited the paint to a
`cm-theme` class. **There is no such class.** `cm-theme` is the theme
*storage key* the runtime writes to `localStorage` — a string, not a
selector — and following that line sent the reader looking for a rule that
does not exist.) The `.cm-*` component classes are padding and colour
*within* a surface; none of them paints the page. **MEASURED** in WebKit at
1280×900 on spacetime-memory's web app after adopting `.cm-header-block` and
dropping the old `bg-neutral-950 text-neutral-100` from `<body>`: `html` and
`body` both computed `rgba(0,0,0,0)`, while `--bg: #0a0a0a` resolved
correctly inside the adopted subtree.

Use `.cm-surface`, which is that paint as a class:

```jsx
<div data-cm-theme="dark" className="cm-surface">
```

It carries the same declarations `base.css` puts on `body` — background,
vignette, ink, body font — so a scoped adoption and a full one paint the
same product, and there is a contract test holding the two in agreement.
It resolves only tokens the scoped entry already emits (`--bg`, `--ink`,
`--vignette`, `--font-body`, `--text`). Put it on the element that carries
`data-cm-theme`, so the paint and the tokens cannot drift apart.

**MEASURED** in WebKit on the showcase, both themes: with `.cm-surface` the
dark island computes `#e8e8e8` ink on `#0a0a0a` (**16.16:1**), the light
island `#111` on `#fafafa` (**18.09:1**). With the class stripped from the
same element in the live page, the island computes
`background-color: rgba(0, 0, 0, 0)` and the same `#e8e8e8` ink falls
through to the page behind it — **1.23:1** on a browser-white page. The
class is load-bearing, not decorative.

Use `.cm-surface--flat` if your app already paints its own fixed chrome, so
the library does not composite a second vignette over it.

#### A SPA no longer needs to call `init()` by hand

The runtime used to require it, and the README said so. As of the
`DOMContentLoaded` re-run fix it arms a bounded `MutationObserver` itself: a
document that already has library markup arms nothing, and the observer
disconnects once `init` has bound, so a static page pays no cost and a SPA
gets bound on its own commit. `cliMono.init(document)` is still safe to call
— `init()` is idempotent, every binder guards on a dataset flag — it is just
no longer required.

**MEASURED** in WebKit at 390×844, before and after: the burger went from
**0×0 and unclickable** to **44×44**, and the drawer from not opening to
781px tall with all 6 links on 6 distinct rows.

### Not available yet

- `curl https://raw.githubusercontent.com/...` returns **404** — a private
  repo is not readable anonymously. The README used to document this; it was
  wrong and the install silently produced nothing.
- `npm i oem-ui` returns **404** — never published. Publishing would also
  make the repo public, which is a deliberate choice, not an oversight.

Both become live the day this repo goes public, with no code change.

### Wire it up

```html
<html data-cm-theme-key="my-site-theme">
<head>
  <!-- 1. FOUC guard FIRST, inline, before any stylesheet.
          Without it a light-theme user sees a black flash.

          Read the key from <html> instead of typing it here. The guard
          runs BEFORE the runtime bundle exists, so it cannot ask the
          runtime which keys to use -- and a hand-typed list drifts the
          moment a project renames its key. Reading the same attribute
          the runtime reads makes that impossible. -->
  <script>
    (function () {
      try {
        var d = document.documentElement;
        var g = function (a) { try { return d.getAttribute(a); } catch (e) { return null; } };
        var k = (g('data-cm-theme-key') || 'cm-theme').split(',')
          .concat((g('data-cm-theme-legacy') || '').split(','));
        for (var i = 0; i < k.length; i++) {
          var s = localStorage.getItem(k[i].trim());
          if (s === 'light' || s === 'dark') {
            if (s === 'light') d.setAttribute('data-theme', 'light');
            return;
          }
        }
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

**Two rules the guard lives or dies by**, both of which have bitten a real
oem project:

- **It must be in `<head>`, in the component that owns `<head>`.** dev-blog's
  guard sat in `Header.astro`, which renders inside `<body>` — so it ran
  *after* the stylesheets had painted and the flash still happened. The
  guard is the only theme code that runs before the runtime exists, and it
  is useless anywhere else.
- **It must read `<html>`, not a literal.** A project that renamed its
  storage key declares `data-cm-theme-key` plus
  `data-cm-theme-legacy="old-key"`. A guard with one hardcoded key cannot
  see a theme saved under the old one, and that returning visitor is the
  exact person the guard exists to protect.

`<Head>` emits the same attribute-driven guard, so an Astro consumer does
not hand-write it.

### The guard is a FILE, because <head> cannot use the runtime

`cli-mono.js` exposes `themeInitScript()`, but you cannot use it to build
the guard: the guard runs *before* the runtime bundle exists, so anything
it read from the module would be empty at that moment. That is the
original bug — a guard that bakes its key list in at build time cannot see
a legacy value — and it is why every project that owned its own `<head>`
kept re-implementing the guard by hand.

So the guard ships as its own file, `cli-mono-theme-guard.js`, which
`install.sh` copies and `check-design-sync.sh` compares. One copy, so a
fix reaches every consumer.

**Astro consumer with its own `<head>`:**

```astro
---
import themeGuard from '../js/cli-mono-theme-guard.js?raw';
---
<head>
  <script is:inline set:html={themeGuard} />   <!-- before <meta charset> -->
```

**Plain HTML (`--flat` install):** reference it with a plain script tag
*before* every stylesheet. A blocking external script only beats the
stylesheet if it is placed first.

> **Do not put a script-closing tag or an HTML comment opener anywhere in
> that file, including in a comment.** It is inlined into `<head>`, and the
> HTML parser ends a script element at the first closing tag it sees
> *whether or not it is inside a JavaScript comment*. The first version of
> this file documented its own usage by writing the tag literally: the
> build went green, all contract tests went green, and every visitor got a
> page with **no guard at all**, because the parser cut the file at the
> comment. The suite now asserts on the built page, and
> `tests/verify-guard-webkit.py` seeds a legacy-key theme and measures the
> paint.

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
| `cli-mono-theme-guard.js` | the flash-of-wrong-theme guard, inlined into `<head>` | rarely |

Load in that order. Each layer assumes the one above it.

### Element defaults, not classes

Some things are **elements**, not components, so they are declared in
`base.css` and a bare tag with no class on it is already correct:

| element | what it gets | why not a class |
|---|---|---|
| `<input>`, `<textarea>`, `<select>` | mono field on a panel, 44px, 16px type | 59 files across the fleet use a text field and none of them had a class to put on it |
| `<strong>`, `<b>` | `--ink` at weight 700 | the browser default carries no colour step at all, so against `--ink-dim` prose there is nothing but weight to read — and every consumer re-declared it |
| `<label>` | the tap target for a drawn checkbox | the mark is ~17px; the row is the 44px target |

If a bare tag is already right, adding a class to get it right is the bug.
Classes are for the **arrangement around** an element, which is the actual
design decision.

## Components

### Buttons

```html
<a class="cm-btn">Default</a>
<a class="cm-btn cm-btn--primary">Primary</a>
<a class="cm-btn cm-btn--ghost">Ghost</a>
<a class="cm-btn cm-btn--outline">Outline</a>
<a class="cm-btn cm-btn--sm">Small</a>
<a class="cm-btn cm-btn--block">Block</a>
<div class="cm-btn-group">…</div>
```

Square corners, 1px borders, 0.12s transitions. The border carries the
weight, not a fill. Ghost is text-only and underlines on hover so it still
reads as a control.
`cm-btn--outline` is shadcn's outline variant: the border *is* the body,
and hover fills it with ink and inverts the text. The base button is
already transparent on a hairline, so the variant only owns that
inversion — class-name parity with shadcn markup, not a second button.


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

Add `.cm-rows--inline` for the compact variant, where the title and the
excerpt are FIXED columns so every excerpt starts at the same offset
instead of wherever the previous title happened to end. The two measures
are tokens — `--measure-title` and `--measure-narrow` — so retuning the
column is a token change, not a search for a `ch` literal.

Both columns have to be readable at once, and there are two widths where
they are not: at **844px and below** there is no rail and the row body
runs out, and in the **1000-1055px rail band** `--rail-w` takes 232px out
of the content column. Below either edge the excerpt is *hidden*, not
squeezed. That distinction is the whole point: a fixed basis with
`flex-shrink: 0` means the excerpt is the only child that can absorb a
deficit, so it collapses to a 5px sliver — present, non-zero, and
unreadable, which reads as "fine" to any check that only asks whether the
column collapsed.

**The truncation rule:** the title is the primary label and never
ellipsizes — it pushes the description instead. Only pathologically long
titles (over 70% of the row) truncate. Do not "fix" this by truncating the
title; a reader scanning for a title must never lose it. This is also why
the inline title keeps `flex-shrink: 0`: it carries `overflow: hidden`,
which zeroes its automatic minimum, so any shrink factor lets it
ellipsize.

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

### Breadcrumb

The trail above a detail page. It is here because two consumers each
hand-rolled one and got it wrong in three measurable ways.

```html
<nav class="cm-crumbs" aria-label="Breadcrumb">
  <a class="cm-crumbs__link" href="/">plugins<span class="cm-crumbs__sep" aria-hidden="true">&rsaquo;</span></a>
  <a class="cm-crumbs__link" href="/?q=terminal">terminal<span class="cm-crumbs__sep" aria-hidden="true">&rsaquo;</span></a>
  <span class="cm-crumbs__here" aria-current="page">cli-mono</span>
</nav>
```

- **Every crumb is a `--tap` target.** Measured at 393x852 in WebKit on a
  coarse pointer: 44.00px. The hand-rolled version this replaces was bare
  text at `0.78rem`, i.e. 12.48px — a 31.5px shortfall on the first row a
  thumb touches.
- **The separator goes INSIDE its link.** It is its own flex child when it
  is a sibling, so `flex-wrap` can strand a lone `›` at a line start. As a
  child of the link, link+separator cannot be broken apart.
- **`aria-hidden="true"` on the separator is required, and a `::after`
  would NOT work.** Measured over CDP with `Accessibility.getFullAXTree`:
  a `::after` separator makes the link's accessible name `store›` — it is
  *spoken*, because generated content is part of name-from-content. The
  `aria-hidden` element reads `store`. Compare the shapes with
  `tests/measure-crumb-separator-ax.py`.
- **The current crumb is `aria-current="page"`**, the same attribute
  `.cm-header__link` uses. It is a `<span>`, never an `<a>`: the one crumb
  on the page that goes nowhere should not be a link.
- The trail **wraps, never scrolls** — a deep trail overflows a phone
  column, and the first crumb is the guaranteed way out.

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
- `.cm-select` is that arrow **as a class**, and a **scoped** adoption needs
  it: a `make-scoped-entry.mjs` consumer gets `components.css` and cannot
  import `base.css` at all, so an element default never reaches it. Use
  `.cm-select--multi` on a list box — it drops the chevron (a `multiple`
  select opens no popup, so the arrow is a control that does nothing) and
  scrolls its own overflow.

```html
<select class="cm-select">…</select>
<select class="cm-select cm-select--multi" multiple size="4">…</select>
```

> **The arrow is a `background-image`, and a `background` SHORTHAND resets
> it.** This is not hypothetical: the library itself shipped
> `background: var(--bg-2)` on the shared field block for months, which
> silently reset the arrow to `none`, and the arrow rule was a bare `select`
> at (0,0,1) against the block's (0,1,1) — so source order could never have
> saved it. *MEASURED in WebKit at 390x844 and 1280x900, before the fix:
> `appearance: none` with `background-image: none`* — a control with no
> affordance in every consumer. If you restyle a select, use
> `background-color`, never the shorthand.

> **Specificity trap.** The base rule is
> `input:not([type=checkbox]):not([type=radio]):not([type=range])`, and
> `:not()` counts its argument — that is (0,3,1). A plain
> `input[aria-invalid='true']` is (0,1,1) and **loses silently**. Match the
> base selector when you add a state; a test asserts the counts.

### Range slider — `input.cm-slider`

```html
<label class="cm-field__label" for="f-vol">retention days <output for="f-vol">30</output></label>
<input id="f-vol" class="cm-slider" type="range" min="1" max="90" value="30" />
```

A native `input[type=range]` wearing house chrome — native keyboard, native
drag, native form value, no reimplementation. The rail is **framed** for the
same reason the progress track is: a bare `--bg-3` rail measures about 1.04:1
against its own panel. The fill reads `--cm-slider`, which the runtime mirrors
from `.value` at boot and on every `input` event, and it writes the value back
into a sibling `<output>` if the field has one. Without JS the slider still
works and simply shows an empty rail — the honest degradation rather than a
fill that lies about the value. The thumb is a square: every corner here is
sharp on purpose.

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

### Stat tiles and timeline

A metric is not a key/value row and a work history is not a link list, so
both got their own component. Both are pure CSS: no runtime, no script.

**`.cm-stats`** is the grid, **`.cm-stat`** the tile. The column count is
`auto-fit` because the tile count is data — a fixed `repeat(3, …)` strands
a half-row at four tiles and an empty column at two.

```html
<ul class="cm-stats">
  <li class="cm-stat">
    <span class="cm-stat__val">5,000+</span>
    <span class="cm-stat__label">users and devices</span>
    <span class="cm-stat__note">global estate</span>
  </li>
</ul>
```

| Class | Role |
|---|---|
| `.cm-stats` | the list / grid container |
| `.cm-stat` | one tile; `height:100%` so a row matches |
| `.cm-stat__val` | the figure. 1.35rem, **capped below the section h2** so a tile is never the loudest thing in its own section |
| `.cm-stat__label` | what the number counts |
| `.cm-stat__note` | optional qualifier. The thing that makes the number honest |

**`.cm-timeline`** is a dated record with a rail. The rail and the dot are
drawn on the **item**, never on the list, so the line stops at the last
record through `:last-child` alone — no script, and no JS pass to trim it
when the data changes.

```html
<ul class="cm-timeline">
  <li class="cm-timeline__item cm-timeline__item--now">
    <span class="cm-timeline__period">Feb 2022 – present</span>
    <span class="cm-timeline__role">L2 Tech Analyst</span>
    <span class="cm-timeline__org">Richemont</span>
    <span class="cm-timeline__meta">Coral Gables, FL</span>
    <div class="cm-timeline__body">…</div>
  </li>
</ul>
```

| Class | Role |
|---|---|
| `.cm-timeline` | the list; draws nothing itself |
| `.cm-timeline__item` | one record. Owns `position:relative`, the rail and the dot |
| `.cm-timeline__item--now` | the record you are in now. **Fills** the dot with `--ink`, because the palette is greyscale and a second hue would be the only colour on the page |
| `.cm-timeline__period` | when, set in the `cm-term` uppercase micro-label style |
| `.cm-timeline__role` | the heading: the role, title or record name |
| `.cm-timeline__org` | the organisation, project or owner |
| `.cm-timeline__meta` | a sub-line for location or record type. Allowed to wrap |
| `.cm-timeline__body` | optional prose. Includes a rule that stops a wrapped line snapping back under the rail |

The dot is a square, for the same reason the checkbox is: a drawn mark
reads as drawn, and it is centred on the rail by a negative half-width so
the two can never drift apart.

### Cards and meters

A card is a unit of content with a title, so it needs more room than a
`.cm-kv` row and less ceremony than a whole page. `.cm-meter` is a number
that happens to be drawn.

**`.cm-cards`** is the grid, **`.cm-card`** one card. Pure CSS, no runtime.

```html
<ul class="cm-cards">
  <li class="cm-card cm-card--accent">
    <div class="cm-card__head">
      <h3 class="cm-card__title">A+ 220-1101</h3>
      <p class="cm-card__sub">taken 2022 · lapsed 2025</p>
    </div>
    <div class="cm-card__body">
      <p class="cm-card__text">What the exam asked, in prose.</p>
      <div class="cm-meters">
        <div class="cm-meter">
          <div class="cm-meter__top">
            <span class="cm-meter__label">Networking</span>
            <span class="cm-meter__val">23%</span>
          </div>
          <div class="cm-meter__track" aria-hidden="true">
            <span class="cm-meter__fill" style="--cm-meter-fill: 23%"></span>
          </div>
        </div>
      </div>
    </div>
    <div class="cm-card__foot">
      <a class="cm-card__link" href="…">exam objectives →</a>
    </div>
  </li>
</ul>
```

| Class | Role |
|---|---|
| `.cm-cards` | the grid. `auto-fit` + a `min()` floor, so any card count works and a long title cannot force overflow |
| `.cm-card` | one card. Owns `position:relative`, `height:100%` so a row matches, and `overflow:hidden` so `--accent` cannot escape the radius |
| `.cm-card--accent` | a 2px rule down the left edge. Marks the one card to read first — a **border**, not a hue, because the palette is greyscale |
| `.cm-card__head` | title block, separated by a `--line-soft` rule |
| `.cm-card__title` | the subject. An `<h3>` so a page of cards has a real outline |
| `.cm-card__sub` | optional second line: issuer, period, status |
| `.cm-card__body` | the content. `flex:1 1 auto` so a footer sits at the card bottom |
| `.cm-card__text` | optional prose paragraph |
| `.cm-card__foot` | optional action row on `--bg-2`. Pairs with the whole-card link |
| `.cm-card__link` | a link whose `::after` stretches to the whole card. On the **anchor**, not the card, so text stays selectable |

A whole card that is one link needs the `::after` stretch, or the target
is ~20px of footer text. The stretch lives on the anchor because an
overlay pseudo-element on the card itself would sit on top of the text.

**`.cm-meter`** is a labelled proportion bar. The Astro component takes
`pct` and throws at build time on anything outside `0-100`, so a bad
weighting fails the build instead of shipping a bar that quietly lies.

| Class | Role |
|---|---|
| `.cm-meters` | the stack of meters |
| `.cm-meter` | one meter |
| `.cm-meter__top` | label and value on one baseline, `space-between` |
| `.cm-meter__label` | what the proportion measures |
| `.cm-meter__val` | the number, as **text**, `tabular-nums` |
| `.cm-meter__track` | the empty bar. `aria-hidden`, because the value is already text beside it |
| `.cm-meter__fill` | the filled part. Width is `var(--cm-meter-fill, 0%)` — the caller sets it from the same number it printed |
| `.cm-meter--accent` | the dominant value, in `--accent` |
| `.cm-meter--faint` | the least interesting value, in `--line` |

The bar is a picture of a number, so the number has to exist as text and
the picture has to come from it. A `--cm-meter-fill` set independently of
the printed value is a chart that disagrees with its own caption.

### Code blocks and copy

A `<pre>` is an element default, so it is on-brand before you add a class.
`.cm-codebar` is the wrapper that gives it a label row and a place to put a
copy button, and `.cm-copy` is the button.

```html
<div class="cm-codebar">
  <div class="cm-codebar__bar">
    <span class="cm-codebar__lang"><span>bash</span></span>
    <button class="cm-btn cm-btn--sm cm-copy" type="button"
            data-cm-copy="#install" aria-label="Copy install command">
      <span class="cm-copy__state" aria-hidden="true"></span>
      <span data-cm-copy-label>copy</span>
    </button>
  </div>
  <pre id="install" tabindex="0"><code>curl -fsSL https://example.com/install.sh | sh</code></pre>
</div>
```

The runtime binds `[data-cm-copy]`; the value is the `id` of the block to
copy. Or use the component, which throws at build time if you forget the
`id` rather than shipping a button that copies nothing:

```astro
<CodeBlock id="install" lang="bash" code={`curl -fsSL https://example.com/install.sh | sh`} />
```

| class | for |
|---|---|
| `.cm-codebar` | the wrapper. Owns the radius, so the `<pre>` inside drops its own |
| `.cm-codebar__bar` | the label row |
| `.cm-codebar__lang` | the language name. Truncates with an ellipsis so a long one cannot push the button off the row |
| `.cm-copy` | the button. Composed from `.cm-btn .cm-btn--sm`, so it inherits the tap floor |
| `.cm-copy__state` | the glyph slot. `min-width` is reserved, so the label does not shift when the state changes |
| `.is-copied` | set by the runtime on success |
| `.is-error` | set by the runtime when the clipboard refused |

Three decisions that are not obvious from the CSS:

- **The button composes `.cm-btn`; it does not re-implement one.** A
  parallel skin would be a second button implementation, and the tap-floor
  bug `.cm-btn` already had would simply recur there.
- **The label lives in a `[data-cm-copy-label]` slot, not in the button's
  own text.** The runtime rewrites the label; writing `textContent` would
  replace the button's children and destroy the glyph slot on the first
  copy. Omit the slot and the runtime falls back to `textContent`, which is
  fine for a button that has no glyph.
- **A `<pre>` inside a bar is flattened.** `pre` is an element default with
  its own border, left accent rule and radius; inside `.cm-codebar` those
  are the panel's chrome, so `.cm-codebar > pre` turns them off. Without
  that the bar draws two borders.

The success state is a **non-hue cue on purpose**: this system has no
chroma, so `--ink` on `--bg-3` has to carry it, and it has to read in
greyscale.

### Auth surfaces

A sign-in screen is not its own design language. It is the card, the
field, the alert and the button above, arranged for credentials — so
only four classes are new here.

```html
<div class="cm-auth">
  <div class="cm-card cm-card--auth">
    <div class="cm-card__head">
      <h1 class="cm-card__title">sign in</h1>
      <p class="cm-card__sub">use your oem account.</p>
    </div>
    <div class="cm-card__body">
      <form class="cm-form">
        <div class="cm-field">
          <label class="cm-field__label" for="email">email</label>
          <input id="email" type="email" autocomplete="username" />
        </div>
        <div class="cm-alert cm-alert--err">
          <span class="cm-alert__mark"></span>
          <div class="cm-alert__body">
            <p class="cm-alert__text">that password was not recognised.</p>
          </div>
        </div>
        <div class="cm-field">
          <label class="cm-field__label" for="code">authenticator code</label>
          <input id="code" class="cm-code-input" type="text"
                 inputmode="numeric" maxlength="6"
                 autocomplete="one-time-code" />
        </div>
        <div class="cm-divider">or continue with</div>
        <button class="cm-btn cm-btn--block">passkey</button>
        <button class="cm-btn cm-btn--primary cm-btn--block">sign in</button>
      </form>
    </div>
  </div>
</div>
```

| class | what it is |
|---|---|
| `.cm-auth` | the full-viewport centred frame — the consumer writes no CSS |
| `.cm-auth--wide` | the same frame at a larger measure (register, providers) |
| `.cm-card--auth` | card padding, and a head that is not separated by a rule |
| `.cm-code-input` | a one-time code: centred and tracked out |
| `.cm-divider` | a horizontal rule with a word in the middle |

Four decisions that are easy to get wrong:

- **The measure is on the child, not on the frame.** `max-width` on a
  box that also has padding and `width: 100%` overflows by exactly the
  difference; on the child, the frame can only ever hand out a card
  that fits inside it.
- **`100dvh`, not `100vh`.** A mobile URL bar cuts the bottom of a
  `100vh` page, and on a sign-in screen that is the submit button.
- **`.cm-code-input` declares three properties and no more.** The base
  input rule is `input:not([type=checkbox]):not([type=radio]):not([type=range])`,
  which is (0,3,1) because `:not()` counts its argument — so a (0,1,0)
  class rule **loses** on every property it restates. Measured in WebKit
  at 390px: deleting all ten restated properties leaves every computed
  value byte-identical and the box still 201.63×44. Restating them was
  ten declarations that could only ever drift from the thing they copy.
- **`text-indent` cancels `letter-spacing`.** Tracking pushes a centred
  string visibly left of centre, because the trailing gap after the last
  glyph has no counterpart at the start. Measured: 6.4px each way.

### Article body — the three element defaults a reset erases

An article body is the one place the library's markup is **not written by
hand**: it comes out of a markdown renderer, so it arrives as bare `<ul>`,
`<ol>` and `<th>` with not one class on it. Three properties those elements
need are UA defaults, and every CSS reset in existence declares them to
nothing:

```css
ul, ol { list-style-type: disc; }
ol { list-style-type: decimal; }
th { font-weight: 700; }
```

MEASURED in WebKit at 390 and 375, this library's `base.css` with a Tailwind
v3 preflight loaded ahead of it:

| | library alone | behind a reset |
|---|---|---|
| `ul { list-style-type }` | `disc` | **`none`** |
| `ol { list-style-type }` | `decimal` | **`none`** |
| `th { font-weight }` | `700` | **`400`** |
| `td { font-weight }` | `400` | `400` |

Both failures are silent. The bullet list keeps its `padding-left: 1.4em`, so
it still reads as a deliberate indent with nothing in it; the header cell
keeps its background and its colour, so it still reads as a header while
every cell in the table weighs the same. Across hermes-articles' real corpus
that is 1,772 bullet items and 818 numbered ones in 35 articles.

What is *not* affected, checked rather than assumed:

- `.cm-rows`, `.cm-cards`, `.cm-stats`, `.cm-meters`, `.cm-swatch`,
  `.cm-projects` and `.cm-timeline` are `list-style: none` at (0,1,0) and stay
  markerless — measured `none` at every width, library-only and behind a reset.
  (the chips list class was listed here and no longer exists; the audit's
  stale-doc check is what caught it, which is why it is no longer named.)
- `.cm-table th` keeps its deliberate `400` and `.cm-prose-table th` its
  `600`; both outrank this (0,0,1) element rule.
- `li { margin-bottom }` and `li::marker` are untouched.

`revert` is deliberately not used: it resolves per-property against the
cascaded origin, so on a reset-based stack it hands the bullet back to
nothing. A declared value is what survives a reset.

**And a declared value is not automatically a surviving value.** `ul, ol` is
(0,0,1) and Tailwind v3 preflight's `ol,ul,menu{list-style:none}` is *also*
(0,0,1), so in a build that inlines the reset and the library into one
stylesheet the winner is decided by **source order**. Measured in WebKit at
390px: preflight-first → `disc`, preflight-after → `none`. Which file is
imported first, i.e. nothing the library controls.

`.cm-prose ul:not([class])` is (0,2,1) and closes that hole — it wins in
either order, and `:not([class])` is what keeps it from reaching a list that
carries a class. The obvious flat `.cm-prose ul` (0,1,1) also wins the reset
but **also beats every (0,1,0) markerless component**, measured: a `.cm-rows`
inside `.cm-prose` goes `none` → `disc`. Classed markup belongs to whoever
gave it the class, which is why the discriminator is the absence of one.

So the full picture for an article body on a reset-based stack:

| | bare rule | + `.cm-prose` | + `.cm-prose ul:not([class])` |
|---|---|---|---|
| reset loads first | `disc` | `disc` | `disc` |
| reset loads after | **`none`** | `disc` | `disc` |
| `.cm-rows` in prose | `none` | **`disc`** | `none` |

Verified three ways, each answering a different question:

- `tests/verify-article-defaults-webkit.py` — the **declaration** survives a
  reset (18 measurements, 390/375).
- `tests/measure-article-body-webkit.py` — the **section renders**, at the
  live LAN preview (54 measurements, 390/375/430). Its marker assertion is
  a differential (`list-style-position: inside` minus `outside`) rather than
  a computed keyword, because `outside` hangs the marker in the ul's padding
  where it shifts nothing: measured `markerDelta: 15` with the bullet, `0`
  without.
- `tests/measure-prose-list-webkit.py` — the **both orderings** claim, against
  a real preflight, with `.cm-rows` and Tailwind's `.list-none` as the
  counter-examples that a value-shaped test cannot see.
- `tests/verify-prose-list-webkit.py` — the same two halves on the **served
  page** at 375/390/402/1024, with `localStorage` cleared before each load.

### Prose tables — `.cm-prose-table` vs `.cm-table`

Two different tables, and picking the wrong one is a real defect in each
direction:

| | `.cm-table` | `.cm-prose-table` |
|---|---|---|
| for | a log you scan **across** | a comparison **inside** a paragraph |
| cells | `white-space: nowrap` | wrap |
| header | `position: sticky` | not sticky |
| height cap | `30rem` scrollport | none — the page scrolls |
| below 760px | scrolls sideways | rows **stack** into labelled blocks |

```html
<table class="cm-prose-table">
  <caption>Benchmarks on the same host.</caption>
  <thead>
    <tr><th scope="col">Engine</th><th scope="col">Feasibility</th></tr>
  </thead>
  <tbody>
    <tr>
      <td data-label="Engine">Signal generation</td>
      <td data-label="Feasibility">Hard but achievable.</td>
    </tr>
  </tbody>
</table>
```

**`data-label` on every body cell is required, not optional.** Below
760px each row becomes a block and each cell prints its column name from
`content: attr(data-label)`, so a consumer cannot switch the layout on
without the text being there. The `thead` is **clipped**, not
`display: none`d, so it stays in the accessibility tree — which is
exactly why the labels have to exist.

#### Generated tables — `[data-cm-table-labels]`

A table a person hand-wrote carries `data-label` in the markup, as above.
A table a **program** wrote cannot: a markdown converter emits the header
row and the body rows and has nowhere to put a label it did not compute.
That is not a hypothetical gap — the consumer that motivated
`.cm-prose-table` (hermes-articles) renders **397 markdown pipe-tables
across 34 articles**, and every one of them would have stacked on a phone
into a list of values with no column names.

The header row is already in the markup, and it is the only source of
truth there is, so the runtime copies its text onto the body cells **by
index**:

```html
<section data-cm-table-labels>
  <table class="cm-prose-table">
    <thead><tr><th scope="col">Engine</th><th scope="col">Cold start</th></tr></thead>
    <tbody><tr><td>vLLM</td><td>~400ms</td></tr></tbody>
  </table>
</section>
```

Below 760px the `td`s print "Engine" and "Cold start" with no
`data-label` anywhere in the source. Three properties worth knowing:

- **It is opt-in.** `[data-cm-table-labels]` scopes the derivation,
  because rewriting cells in a document behind someone's back is not
  something to do to a table a person wrote.
- **It never overwrites.** An author's own `data-label` wins over
  anything derived, so a mixed table is fine.
- **Index, not position-matching.** A markdown row with an empty cell
  (`| a |  | c |`) still renders three `<td>`s, and a short row renders
  fewer than the header has columns. Walking the header in step with the
  row shifts every later label one column left — `c` renders under
  "Output". Indexing cannot.

Zero bytes of CSS: this is the runtime doing the only thing CSS cannot
(copy a sibling's text onto an attribute), and it runs from `init()`, so a
client-side route change re-labels.

```css
/* What you want for the size, not just the look */
.cm-prose-table { table-layout: fixed; }  /* width:100% is advisory without it */
```

Three things that are measured, not chosen:

- **`table-layout: fixed` is load-bearing.** `width: 100%` on a table is
  advisory against the cells' intrinsic min-content width. With
  `auto`, a six-column sentence table lays out at 1074px inside a 739px
  column — 335px past the edge, invisible in a screenshot of a narrow
  table.
- **`overflow-wrap: break-word`, never `word-break: break-word`.** The
  latter breaks *eagerly* at every character: measured rows of **44
  lines**, one word per line. The suite bans the `anywhere` value of
  `overflow-wrap` file-wide for the same class of reason (it splits
  identifiers mid-token), so the layout property does the sizing job.
- **The 760px stack breakpoint came from geometry.** Overflow is *not*
  the trigger — the table has 0px of overflow of its column at every
  width. It is legibility: at 700px six columns share 96px each, and a
  sentence in a 96px column is one unreadable line.

Verified in WebKit at 393 / 375 / 320 / 900px: 0px overflow of the
section's own column at every width, all cells labelled, and a long URL
broken inside its row rather than dragging the page wide.

### Page shapes

```html
<p class="cm-lede">The opening sentence under a page head.</p>

<div class="cm-split">
  <div>the main block</div>
  <aside class="cm-split__aside">
    <dl class="cm-kv"><dt>role</dt><dd>engineer</dd></dl>
    <a class="cm-back" href="/"><span class="cm-back__arrow" aria-hidden="true">&larr;</span><span>back</span></a>
  </aside>
</div>
```

A key/value row that is **one big link** — `.cm-kv--link`. Link only the
`<dt>` and the target is the term: measured **14px tall** in WebKit at an
iPhone viewport, because `<dt>` is inline and `min-height` is ignored on an
inline box. So the `<a>` wraps the row and owns the two columns, and the
pair wrapper above it stays a plain `<div>`.

```html
<dl class="cm-kv cm-kv--link">
  <div><a href="/work"><dt>role</dt><dd>engineer</dd></a></div>
  <div><a href="/work"><dt>since</dt><dd>2014</dd></a></div>
</dl>
```

The padding is cancelled with an equal negative margin, so the 44px target
grows without pushing the text away from the row above it. Stacks to one
column below 520px, the same breakpoint as the base `.cm-kv`.

`.cm-lede` is wider and dimmer than body text, and `.cm-split` puts a
metadata column beside a content block. Two decisions are baked in
rather than left to the consumer:

- **The split stacks below 700px.** Two columns of text on a phone is
  two unreadable columns, so the single-column rule is the default and
  the two-column rule lives inside a `min-width` query.
- **The columns are `1.6fr / 1fr`, not `2fr / 1fr`.** The aside holds a
  label and a value, and at `1fr` the aside starts wrapping its own
  values.

Both take their width from the measure scale rather than a number:

| token | value | for |
|---|---|---|
| `--measure` | `68ch` | a reading column — prose, and the lede |
| `--measure-narrow` | `34ch` | one compact block that must not re-wrap |

A measure is a property of the type, not of a component, so it is
declared once in `:root` and is the same in both themes. Writing
`max-width: 68ch` in a rule instead is the bug this replaces: a
consumer that invents its own measure is a second implementation no
library fix can reach.

### Prose beside an aside — `.cm-prose-measure` and `.cm-inline-link`

Two classes for prose that has company, both moved into the library from
oem-portfolio this cycle.

```html
<div class="cm-split">
  <div class="cm-prose cm-prose-measure">
    <p>A link inside a sentence <a href="/x/" class="cm-inline-link">stays tappable</a>
       and the line rhythm does not move.</p>
  </div>
  <aside class="cm-split__aside">…</aside>
</div>
```

`.cm-prose-measure` bounds the reading column to `--measure`. Without it,
prose in a `.cm-split` inherits `--maxw` — sized for a full-width column —
so the line length is set by the **page** rather than by the reader's
column. That is the case the measure token could not express on its own,
and it is why a consumer was found hardcoding `68ch`.

`.cm-inline-link` is a link that runs inside a sentence, and it exists
because of a measured bug rather than a style. `base.css` puts
`min-height: var(--tap)` on bare `a` — and **min-height does nothing on
an inline box**, so every link inside running prose escaped the tap
floor. Measured in WebKit at an iPhone viewport: **34px**.

```css
.cm-inline-link {
  display: inline-block;   /* the only display that honours the height */
  min-height: var(--tap);
  padding: var(--space-3) 0;
  margin: calc(var(--space-3) * -1) 0;  /* cancel it out of the line box */
  text-decoration: underline;
  text-decoration-color: var(--ink-faint);
}
```

Two things here are easy to get wrong, and both are invisible to a
value-shaped test:

- **The negative margin is load-bearing.** Measured on the showcase at
  390px, paragraph height ÷ line-height is `10.9988` with the margin and
  `11.8321` without — 4.83px of padding pushed past the last line. Both
  builds wrap to eleven lines, so a line-count assertion passes the
  broken one.
- **The underline is the affordance.** `a` is `--ink-dim` and `.cm-prose`
  is `--ink`, so the link measured **2.24:1 against its own paragraph**
  (2.13:1 in light) while clearing AA against the *page* at 7.21:1. Only
  the first number describes whether a reader sees the link, and an
  AA-against-the-background check cannot see this at all.

### Small native components: keys, pages, people, disclosure

```html
<span class="cm-kbd-group"><kbd class="cm-kbd">Ctrl</kbd>+<kbd class="cm-kbd">K</kbd></span>

<nav class="cm-pager" aria-label="Pagination">
  <ul class="cm-pager__list">
    <li><span class="cm-pager__link cm-pager__link--off" aria-disabled="true">Previous</span></li>
    <li><a class="cm-pager__link" href="?page=1" aria-current="page">1</a></li>
    <li><a class="cm-pager__link" href="?page=2">2</a></li>
    <li><span class="cm-pager__gap" aria-hidden="true">…</span></li>
    <li><a class="cm-pager__link" href="?page=12">12</a></li>
  </ul>
</nav>

<span class="cm-avatar" role="img" aria-label="Omar Minaya">om</span>
<span class="cm-avatar-group" role="group" aria-label="Collaborators">
  <span class="cm-avatar" role="img" aria-label="Omar">om</span>
  <span class="cm-avatar" role="img" aria-label="Ciel">ci</span>
</span>

<div class="cm-accordion">
  <details class="cm-disclosure" name="faq">
    <summary class="cm-disclosure__summary">A question</summary>
    <div class="cm-disclosure__body">An answer.</div>
  </details>
  <details class="cm-disclosure" name="faq">
    <summary class="cm-disclosure__summary">Another question</summary>
    <div class="cm-disclosure__body">Another answer.</div>
  </details>
</div>

<div class="cm-ratio" style="--cm-ratio: 4 / 3"><img src="image.jpg" alt="Description" /></div>
```

The pager uses real links; the disabled edge is a span, not a dead link.
The current page uses `aria-current="page"`; the inset underline does not
change its dimensions. The avatar is square, with initials as its fallback;
put an `<img>` inside it to cover the initials when a photo is available.
`cm-avatar--sm` and `cm-avatar--lg` change its size. For an exclusive
accordion, give every `<details>` in one group the same `name`; native
browser behaviour closes the other panels, with no JavaScript. Use a
*different* name for each independent group. `cm-ratio--square` is the
1:1 shortcut; the default is 16:9. All borders keep the house's sharp
corners.

### Hover card and input group

```html
<span class="cm-hovercard">
  <a class="cm-inline-link" href="#">omiinaya</a>
  <span class="cm-card cm-hovercard__panel" role="tooltip">…</span>
</span>

<span class="cm-input-group cm-input-group--framed">
  <span class="cm-input-group__addon">https://</span>
  <input type="text" placeholder="ui.mrx.sh" />
</span>
```

The hover card's panel is `visibility: hidden` at rest, not merely
`opacity: 0` — an invisible-but-hittable panel is a trap for a stray
touch — and it opens on `:hover` **and** on `:focus-within`, which is the
half a hover-only implementation always drops. The input group joins an
addon to a field with one collapsed hairline: the collapse lives on the
addon, because the base input rule is `(0,3,1)` and a group selector at
`(0,1,0)` would lose that cascade silently. Negative margins are out
anyway — the suite forbids raw spacing values, and it is right to.

### OTP input and command palette

```html
<div class="cm-otp" role="group" aria-label="verification code">
  <input class="cm-otp__cell" maxlength="1" inputmode="numeric"
         autocomplete="one-time-code" aria-label="digit 1" />
  <!-- one more per digit -->
</div>

<button class="cm-btn" data-cm-open="cmd-demo">command palette <kbd class="cm-kbd">&#8984;K</kbd></button>
<dialog class="cm-dialog cm-command" id="cmd-demo"> … </dialog>
```

The OTP cells are ordinary inputs, so the form value, the caret and the
platform's autofill are untouched; script only moves focus. A digit
**replaces** the cell it lands in rather than appending, because
`maxlength=1` makes the native insert a no-op on a cell that is already
filled - and because `preventDefault()` there means no `input` event
follows, the advance has to happen in `keydown` too, not in the input
handler that never fires. Backspace clears a filled cell before it ever
retreats. A paste of six digits fills the whole group.

The palette is a `<dialog>`: open, focus trap, Escape, the top layer and
an inert page behind it are the platform's. Script owns exactly two
things - which rows match, and which row Enter would take - and mirrors
the active row to `aria-activedescendant`. Two traps worth naming: an
author `display: flex` outranks the UA's `[hidden] { display: none }`,
so a filtered row keeps its box until you say `display: none` yourself;
and a *prefix* match turns "inst" into "no matches" for *copy install
command*.

### Carousel and stepper

```html
<!-- the track is the scrollport: snap lands a slide whole, and the
     marks are tap-sized even though the painted square is 8px -->
<div class="cm-carousel" data-cm-carousel>
  <div class="cm-carousel__track">
    <div class="cm-carousel__slide">...</div>
    <div class="cm-carousel__slide">...</div>
  </div>
  <div class="cm-carousel__bar">
    <button type="button" class="cm-btn cm-btn--sm" data-cm-carousel-prev>prev</button>
    <div class="cm-carousel__pages" aria-label="slides">
      <button type="button" class="cm-carousel__page" aria-label="slide 1" aria-current="true"></button>
      <button type="button" class="cm-carousel__page" aria-label="slide 2"></button>
    </div>
    <button type="button" class="cm-btn cm-btn--sm" data-cm-carousel-next>next</button>
  </div>
</div>

<!-- opt-in: clicking a step moves aria-current and marks the rest done -->
<ol class="cm-stepper" data-cm-stepper>
  <li><button type="button" class="cm-step is-done"><span class="cm-step__marker" aria-hidden="true">&#10003;</span><span class="cm-step__label">plan</span></button></li>
  <li><button type="button" class="cm-step is-current" aria-current="step"><span class="cm-step__marker" aria-hidden="true">2</span><span class="cm-step__label">build</span></button></li>
</ol>
```

The carousel scrolls with the finger and the buttons only move that scroll
position - nothing is transformed, so a half-scrolled row never renders at
half scale. The track owns its arrow keys: a focused scroll container is
line-scrolled by the UA, not slide-scrolled, and one slide per press is the
promise. The stepper's connector hangs off the `<li>`, because each
`.cm-step` is the only child of its own `<li>` and `:not(:last-child)` on
the button can never match.

### Interactive primitives

The runtime opts into managed segmented controls only when requested:

```html
<div class="cm-seg" role="group" aria-label="Directive" data-cm-seg="single">
  <button type="button" class="cm-seg__opt" aria-pressed="true">allow</button>
  <button type="button" class="cm-seg__opt" aria-pressed="false">deny</button>
</div>
<div class="cm-seg" role="group" aria-label="Methods" data-cm-seg="multi">
  <button type="button" class="cm-seg__opt" aria-pressed="true">get</button>
  <button type="button" class="cm-seg__opt" aria-pressed="false">post</button>
</div>
```

`single` keeps one pressed; `multi` toggles each. Either mode dispatches a
bubbling `cm-seg-change` event on the group with `event.detail.values`
(an array of pressed `data-value` strings, falling back to button text).
A group without `data-cm-seg` is **not managed**; consumer state remains
authoritative. The popover dropdown focuses its first enabled menu item
when opened, and handles Up/Down/Home/End, skipping disabled items.
Escape and light-dismiss remain the browser's job. A `.cm-search__clear`
button now empties its sibling `.cm-search__input`, dispatches a bubbling
`input` event (so a listener can update its model), and returns focus to
that input.

### Sortable columns

```html
<table class="cm-table" data-cm-sort>
  <thead>
    <tr>
      <th scope="col" aria-sort="ascending">
        <button type="button" class="cm-table__sort">Time</button>
      </th>
      <th scope="col" aria-sort="none">
        <button type="button" class="cm-table__sort">Host</button>
      </th>
      <th scope="col">Status</th>
    </tr>
  </thead>
  <tbody>…</tbody>
</table>
```

Sorting is **opt-in per table** (`data-cm-sort`): a table whose framework
already sorts its rows must not have the runtime re-ordering them behind
its back. The button inside the `th` is the control — a `<th onclick>`
cannot be focused and Enter does nothing to it. A click sorts that
column ascending, the next click reverses, and the state moves on the
`th` where the accessibility tree reads it (`aria-sort`), with every
other sorted column going back to `none`. The triangle the stylesheet
paints reads the same attribute, so the mark and the announced state
cannot drift apart.

A column that **declares** `ascending` or `descending` on load is sorted
into that order at load: a declared state that is not true on screen is a
lie the glyph keeps repeating. Values come from `data-cm-sort-value` when
the cell carries one, otherwise from its text; a cell that reads as one
number sorts as one (`7 < 99 < 1,024`), and everything else is compared
with numeric collation, so `2s ago` precedes `10s ago`. Rows are moved,
never rebuilt, and each `tbody` sorts independently.

### Everything else

```html
<button class="cm-btn cm-btn--danger">Delete</button>   <!-- cross + heavier rule; never a hue -->
<span class="cm-btn-group cm-btn-group--joined" role="group" aria-label="View">
  <button class="cm-btn">Day</button><button class="cm-btn">Week</button>
</span>
<dialog class="cm-dialog cm-dialog--sheet cm-dialog--sheet-left">…</dialog>   <!-- also -top, -bottom; plain --sheet is right -->
```

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

### Every class is rendered, and every rendered class is styled

Both directions are contract-tested against the **built** page
(`dist/index.html`), not the source:

- a class defined in the stylesheet and rendered nowhere is a failure. A
  class nothing renders is a promise nobody can check.
- a class rendered on the page and styled by no rule is a failure. This is
  the renamed-without-selector bug: the markup moves to a new name, the
  rule keeps the old one, and the element renders unstyled behind a green
  build.

Reading the built page is the whole point. Grepping the showcase source is
wrong twice over: `class:list` in an Astro component never puts the string
in `index.astro`, and a class named in a comment reads as alive. Every new
component ships with a specimen in the showcase for exactly this reason.

`.cm-tag` carries `max-width: 100%`, `min-width: 0` and
`overflow-wrap: break-word` so a long single word in a narrow column wraps
instead of pushing 26px past its row. It is `break-word` and not
`anywhere`: `anywhere` also shrinks min-content sizing and splits `.cm-*`
identifiers mid-token.

## State chips

`.cm-tag` is a chip with no state. When a chip has to *report* state — a
table cell that says scored, warming, failed, or "this value was set" —
use `.cm-chip` and one modifier.

```html
<span class="cm-chip">cold</span>
<span class="cm-chip cm-chip--ok">scored</span>
<span class="cm-chip cm-chip--warn">warming</span>
<span class="cm-chip cm-chip--err">error</span>
<span class="cm-chip cm-chip--set">set</span>
<button class="cm-chip cm-chip--err cm-chip--action">retry</button>
```

The palette is greyscale, so **a modifier may never be the only thing
carrying the state**. Each one adds a non-hue cue on top of the contrast
step: `--ok` / `--warn` / `--err` hang a `::before` glyph (●, ▲, ✕) the
way `.cm-status` and `.cm-toast` already do, and `--set` goes dashed for
"this is not the default", which the value itself cannot say. A contract
test fails the build if two states share a glyph, so the shapes cannot
collapse into each other.

**The base is a mark, not a target, and it does not reach `--tap`.** A chip
sits inline in a run of non-target text inside a table cell, which is the
case WCAG 2.5.8 exempts ("size is otherwise constrained by the
line-height of non-target text"). Measured in WebKit at 390px, forcing the
floor on the base inflates the row from **39.6px to 60.5px** to make
something that is not a control look tappable. When the chip *is* the
target, use `.cm-chip--action`, which carries `min-height: var(--tap)` from
the token.

## Icon buttons

`.cm-icon-btn` is a square button that holds one glyph. On a phone it is
`--tap` on **both** axes, from the token.

```html
<!-- its own frame says "press me" -->
<button class="cm-icon-btn" type="button" aria-label="Filter">
  <span aria-hidden="true">&#9673;</span>
</button>

<!-- a bare glyph, sharing a surface with other glyphs -->
<button class="cm-icon-btn cm-icon-btn--bare" type="button"
        data-cm-theme-toggle aria-label="Toggle theme">
  <span data-cm-theme-icon aria-hidden="true">&#9728;</span>
</button>
```

Use `--bare` when the button sits on a surface that already carries other
glyphs — a header row, a toolbar. An outlined button next to an unoutlined
icon reads as a mistake rather than a control. The variant drops the border
and the radius and nothing else; the box, the floor and the hover state are
the base component's.

`data-cm-theme-toggle` is the runtime's hook: it syncs the glyph between
☾ and ☀, keeps `aria-pressed` and the label honest, and persists the
choice. Without the attribute the button renders but does nothing, so ship
the attribute with the class.

**Do not hand-roll the box.** The tap floor has to reach *both* dimensions.
Measured in WebKit at an iPhone viewport, two live sites (oem-log,
oem-links) each carried their own 32×32 theme toggle; the coarse-pointer
floor in `base.css` gives `button` a `min-height`, so the glyph box's
explicit width won on one axis and the result measured **32×44** — tall
enough to pass a height-only check, still 12px too narrow to hit. The
class already pins both, so naming it is the whole fix.

## The desktop nav rail

A reference document with twenty sections in its nav is not a website menu,
it is an index. At 1280px the horizontal bar wrapped into **seven rows**, and
six of those rows were a continuation of the same line of links. So the
header becomes a **rail**: a fixed column down the leading edge, above
`1000px`.

The rail is **opt-in**, and deliberately so. `links`, `oem-portfolio` and
`dev-blog` all consume `cm-header` and none of them asked for a rail — a
default change would break all three on deploy.

```astro
---
import { Header } from 'oem-ui/astro';
import SITE from 'oem-ui/config';
---
<Header brand={SITE.title} homeHref="/" links={links} rail />
<main class="cm-shell cm-shell--rail">
  ...
</main>
```

`rail` adds exactly one class, `cm-header--rail`. Nothing else is implied.
Pair it with `cm-shell--rail` around the content, or set the class yourself.

Three things this cost to get right, each of them measured:

- **`main` kept `margin: 0 auto` and slid under the rail.** Centring on the
  VIEWPORT is wrong once a rail owns the left edge: the first section
  overlapped it by 58px at 1440. The offset is `padding-left` on a
  full-width box, and the `--maxw` measure is re-imposed on the inner
  children so the column centres in the space the reader actually has
  (104px left / 84px right of air at 1280).
- **`>` in the link rule is load-bearing.** `.cm-header__link` also appears
  in the showcase as a *specimen*. A descendant selector restyled those
  seven demo links as rail rows, which is how the last link measured at
  `y=3640` inside a 900px rail.
- **The active tick drew at `x=0`** and the viewport edge shaved it, so the
  current section was invisible. The row is now inset by `--space-2`.

The rail is bounded (`height: 100vh`, `overflow: hidden`) and the link list
scrolls (`overflow-y: auto`, `min-height: 0`). Twenty links at the 44px tap
floor is 880px, which does not fit a 900px rail once the brand is in it, so
the list scrolls rather than painting outside the column.

Below `1000px` nothing changes: the burger and its drawer are exactly as
they were, and the burger is hidden in rail mode because the links it opens
are already permanently on screen.

The contract is pinned by `tests/mutate-rail.py` (17 mutations, 0
survived).

## Verifying the published site

`tests/verify-live-deploy.py` fetches the real URL and asserts the page is
the build rather than the repository. It exists because a green workflow
is not evidence that anything was published: Pages was configured to serve
the repo root, so `README.md` was rendered as the homepage and every deploy
reported success for three days. The interesting detail is that the stale
page still contained the string `cm-header__links` -- inside a `<code>`
documentation specimen -- so counting occurrences reported a header where
there was none. The check counts an ELEMENT, not a substring.

Run it directly, or point it anywhere with `BASE_URL`:

```
python tests/verify-live-deploy.py
BASE_URL=http://192.168.1.68:4401/ python tests/verify-live-deploy.py
```

## The bar between the drawer and the rail

Between the phone drawer (640px) and the rail (1000px) the header is still a
horizontal bar, but it has more links than the width can hold in one row. The
row does not wrap: a wrapped row would render below the bar's fixed height and
over the page, because the bar and the list are `overflow: visible`. Instead the
row scrolls sideways with the scrollbar suppressed, and the brand and theme
toggle are pinned so the row is what gives way. Every link stays reachable.

Above 1000px the rail takes over. `tests/verify-bar-containment.py` checks all
three bands by hit-testing the region under the header.

## Mobile nav

Under 640px the header nav collapses behind a burger. Nothing to wire up:
`<Header>` renders the toggle whenever it has links to disclose, and the
runtime binds it on load.

    <Header links={links} />

**It is progressive, not JS-dependent.** The panel only collapses once the
runtime has set `.cm-js` on `<html>`, which happens only after it has found
both the toggle and its panel. A reader with JavaScript disabled, or on a
runtime that failed to load, gets every link inline in a wrapping row. A
JavaScript toggle that hides content and then fails is a dead site.

**What the runtime handles:** `aria-expanded` and `aria-controls` stay in sync,
tapping a link closes the panel (or it covers the section you just asked for),
Escape closes it and returns focus to the button, a click outside the header
closes it, and rotating back to a desktop width clears the state so a stale
`data-open` cannot leak into the next phone-width view.

**If you write your own toggle**, copy the class contract rather than the
markup: `.cm-nav-toggle` (hidden by default, revealed under 640px only under
`.cm-js`), `.cm-nav-toggle__bars` with two `aria-hidden` edge bars, one real
`.cm-nav-toggle__bar` child, and `.cm-header__links[data-open]` on the panel.

One trap worth naming: **the middle bar is the only real child of
`.cm-nav-toggle__bars`**, because `::before` and `::after` are pseudo-elements
and do not count toward `:nth-child()`. A `:nth-child(2)` selector for it
matches nothing, the bar falls back to `top: 0` and lands on top of the
`::before` bar, and the burger draws two lines - which reads as an arrow.

**The drawer cannot live under a filtered ancestor.** The panel is
`position: fixed`, and any ancestor with `backdrop-filter`, `filter`,
`transform`, `perspective`, `contain` or `will-change` becomes the
containing block for fixed descendants. `top: 0` and `bottom: 0` then
resolve against that ancestor instead of the viewport and the panel
collapses to 0px tall - the scrim appears, the button becomes an X, and
the menu is simply not there. `.cm-header` and `.cm-header__nav` (the
panel's own parent) are both asserted clean of those properties, and
`--header-bg` is solid in both themes because the header has no blur to
frost it. A rule-level test cannot see this: the panel's CSS is identical
whether or not an ancestor traps it. `tests/verify-burger-webkit.py`
measures the live panel's height and offsetTop.

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
| `SectionHead.astro` | the heading that opens a section, at the second scale step. `sub` and `action` are slots |
| `PostHead.astro` | article head with byline |
| `PostRow.astro` | one list row |
| `StatusStrip.astro` | label / value status line |
| `Stat.astro` | one metric tile inside a `.cm-stats` list |
| `TimelineItem.astro` | one dated record, with the `now` variant |
| `Card.astro` | one card inside a `.cm-cards` grid. Slots for head, body and foot |
| `Meter.astro` | one labelled proportion bar. Throws on a `pct` outside 0-100 |
| `CodeBlock.astro` | a `<pre>` with a language label and a copy button. Throws on a missing `id` |

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
