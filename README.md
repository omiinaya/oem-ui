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
- copy four files, no package manager
- works in Astro, React, Svelte, Hugo, Django, or a plain HTML file

## Install

The repo is **private** and **not published to npm**, so the two paths below
are the only ones that work today. Everything on this fleet is local, so the
installer is the default.

### Option A — the installer (recommended)

```bash
./scripts/install.sh <your-project-dir>
```

Copies the four files into `<your-project-dir>` in one fixed layout, so every
project on the fleet ends up with identical paths. Idempotent — re-run it any
time to pull the current library.

```bash
# for a project that serves static files from a flat dir
./scripts/install.sh <your-project-dir> --flat
```

### Option B — copy the files by hand

```bash
cp -r src/styles <your-project>/src/
cp src/js/cli-mono.js <your-project>/src/js/
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

`<Head>` takes `themeKey` / `legacyKey` props and emits the same
attribute-driven guard, so an Astro consumer does not hand-write it.

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
