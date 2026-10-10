/* ============================================================
   cli-mono — runtime
   Zero dependencies. No framework. One global, auto-init on
   DOMContentLoaded, and every function is also exported /
   exposed on window for manual control.

   Handles:
     - theme (dark default, light opt-in, FOUC-safe, persisted)
     - sticky header (scroll shadow) + optional scroll-spy
     - footer year
     - copy-to-clipboard on [data-cm-copy]
     - external links get rel hardening
     - tabs: roving tabindex + arrow/Home/End, aria-selected follows focus
     - toasts: mount into a live region and retire them on a timer

   Deliberately NOT handled, because the platform already does it and a
   hand-rolled version is a worse one:
     - the modal dialog  -> <dialog> + showModal(): top layer, focus trap, Escape
     - the menu button   -> [popover] + popovertarget: light dismiss, focus return
     - the tooltip       -> :hover / :focus-within, no script at all

   Astro/Vite note: if you import this through a bundler and
   don't want auto-init, delete the block at the bottom.
   ============================================================ */

(function () {
	'use strict';

	/* Per-project storage key. A site that already persisted its theme
	   under its own key (oem-links uses 'oem-links-theme', the blog
	   'oem-log-theme') must keep that value, so it can declare its key
	   on <html data-cm-theme-key="..."> and get migration for free. */
	var STORE_KEY = 'cm-theme';
	var LEGACY_KEYS = [];

	function storeKey() {
		var el = document.documentElement;
		var key = el.getAttribute('data-cm-theme-key');
		return key || STORE_KEY;
	}

	/* A project declares its own key once, on <html>, and lists any key it
	   used BEFORE the library owned the theme:
	     <html data-cm-theme-key="oem-links-theme"
	           data-cm-theme-legacy="cm-theme,oem-log-theme">
	   The legacy list is read lazily so a script in <head> can set it before
	   the first paint, and so a host page can change it at runtime. */
	function readLegacyKeys() {
		var el = document.documentElement;
		var raw = el.getAttribute('data-cm-theme-legacy');
		if (!raw) return LEGACY_KEYS;
		return raw.split(',').map(function (k) {
			return k.trim();
		}).filter(Boolean);
	}

	/* Read a theme from any known key, newest first. This is what keeps a
	   returning visitor's saved theme through a key rename. */
	function readStored() {
		var keys = [storeKey()].concat(readLegacyKeys());
		for (var i = 0; i < keys.length; i++) {
			try {
				var v = localStorage.getItem(keys[i]);
				if (v === 'light' || v === 'dark') return v;
			} catch (e) {}
		}
		return null;
	}

	/* Fold any legacy value into the current key, then drop it. Called
	   once on init so a rename is a one-time migration, not a per-read
	   lookup forever. */
	function migrateStored() {
		var current = storeKey();
		var found = readStored();
		if (!found || !readLegacyKeys().length) return found;
		try {
			if (!localStorage.getItem(current)) localStorage.setItem(current, found);
		} catch (e) {}
		return found;
	}

	/* ---------- theme ---------- */
	// Dark is the default with NO stored preference. Light is always
	// an explicit choice. This is the fix for the flash-of-wrong-theme
	// bug: the inline <head> snippet (see themeInitScript) must apply
	// the saved value before first paint.
	function getTheme() {
		return migrateStored() || 'dark';
	}

	function applyTheme(theme) {
		document.documentElement.setAttribute('data-theme', theme);
		try {
			localStorage.setItem(storeKey(), theme);
		} catch (e) {}
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) {
			meta.setAttribute('content', theme === 'light' ? '#fafafa' : '#0a0a0a');
		}
		syncToggles();
	}

	/* The toggle selector covers both the library's own markup and the
	   class the oem projects already ship, so migrating a project does
	   not require rewriting its header. */
	var TOGGLE_SEL = '[data-cm-theme-toggle], .theme-toggle';

	function syncToggles() {
		var light = getTheme() === 'light';
		document.querySelectorAll(TOGGLE_SEL).forEach(function (btn) {
			var icon =
				btn.querySelector('[data-cm-theme-icon]') ||
				btn.querySelector('.icon') ||
				btn;
			icon.textContent = light ? '☾' : '☀';
			btn.setAttribute('aria-pressed', light ? 'true' : 'false');
			btn.setAttribute(
				'aria-label',
				light ? 'Switch to dark theme' : 'Switch to light theme'
			);
		});
	}

	function toggleTheme() {
		applyTheme(getTheme() === 'light' ? 'dark' : 'light');
	}

	/* The FOUC guard. Emit it in <head>, BEFORE any stylesheet, as an
	   inline is:inline script. It runs before first paint so a light-theme
	   visitor never sees a black flash.

	   The key list is read FROM THE DOM at run time, not baked in at build
	   time. The guard necessarily runs before the runtime bundle has
	   executed, so the module-level LEGACY_KEYS is still [] when this
	   string is evaluated -- reading it here produced a one-key guard that
	   could not see a theme saved under a legacy key, i.e. the exact flash
	   the guard exists to prevent. <html> already declares the keys
	   (data-cm-theme-key / data-cm-theme-legacy) and the guard runs after
	   <html> is parsed, so one declaration serves both the guard and the
	   runtime and the two cannot drift.

	   The explicit key stays as a fallback for a host page that calls this
	   before its <html> is parsed. */
	function themeInitScript(storageKey) {
		return (
			'(function(){try{var d=document.documentElement;' +
			'var g=function(a){try{return d.getAttribute(a);}catch(e){return null;}};' +
			'var k=(g("data-cm-theme-key")||' +
			JSON.stringify(storageKey || 'cm-theme') +
			').split(",").concat((g("data-cm-theme-legacy")||"").split(","));' +
			'for(var i=0;i<k.length;i++){var s=localStorage.getItem(k[i].trim());' +
			'if(s==="light"||s==="dark"){if(s==="light")' +
			'{d.setAttribute("data-theme","light");}' +
			'return;}}}catch(e){}})();'
		);
	}

	/* ---------- header scroll state ---------- */
	function initHeader(header) {
		if (!header) return;
		var ticking = false;
		function update() {
			header.classList.toggle('is-scrolled', window.scrollY > 4);
			ticking = false;
		}
		/* Publish the header's real height so CSS can reserve that space
		   for anchor jumps. The header WRAPS to two rows on a phone (165px)
		   and is 61px on a desktop, so a static token cannot be right. */
		function publishHeight() {
			var h = Math.round(header.getBoundingClientRect().height);
			if (h > 0) document.documentElement.style.setProperty('--header-h', h + 'px');
		}
		publishHeight();
		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(publishHeight).observe(header);
		} else {
			window.addEventListener('resize', publishHeight, { passive: true });
		}
		window.addEventListener(
			'scroll',
			function () {
				if (!ticking) {
					ticking = true;
					window.requestAnimationFrame(update);
				}
			},
			{ passive: true }
		);
		update();
	}

	/* ---------- mobile nav disclosure ----------
	   The burger is CSS-hidden unless <html> has `.cm-js`, so setting that
	   class is the "JS is here" signal for the whole enhanced path. It is
	   set the moment the runtime boots, so the button and the panel can
	   never appear without the behaviour that opens them. */
	function initNavToggle(root) {
		/* `document` here, not the caller's root: the burger lives in the
		   document header on every page, and a subtree root (a dialog that
		   re-inits) must still be able to close a panel it did not
		   create. Feature-detect rather than assume - a host with a
		   partial document shim should skip the nav, not throw. */
		var doc = document;
		if (!doc || typeof doc.getElementById !== 'function') return;
		var btn = doc.querySelector('[data-cm-nav-toggle]');
		var panel = doc.getElementById('cm-header-links');
		if (!btn || !panel) return;
		doc.documentElement.classList.add('cm-js');
		if (btn.dataset.cmNavBound) return;
		btn.dataset.cmNavBound = '1';

		/* The drawer covers the left edge, so it needs a scrim or the page
		   behind it still reads as live. Created by the runtime so a no-JS
		   reader never carries a permanently hidden node. */
		var mq = window.matchMedia('(max-width: 640px)');
		function setOpen(open) {
			btn.setAttribute('aria-expanded', open ? 'true' : 'false');
			if (open) {
				panel.setAttribute('data-open', '');
				doc.documentElement.setAttribute('data-cm-nav-open', '');
			} else {
				panel.removeAttribute('data-open');
				doc.documentElement.removeAttribute('data-cm-nav-open');
			}
			/* The drawer is position:fixed and the scrim beneath it is
			   position:fixed too, so the panel covers the page from the first
			   frame: opening it causes no reflow, nothing shifts sideways, and
			   there is nothing to compensate for.

			   This used to set `overflow: hidden` on <body> as a scroll lock.

			   DO NOT LOCK BY SETTING `overflow: hidden` ON THE BODY. That
			   was the shipped behaviour and it was wrong twice over:

			     1. It did not lock anything. <html> is the scrolling element
			        in this layout (body's scrollHeight equals its
			        clientHeight), so `body { overflow: hidden }` never
			        stopped the page. Measured: a wheel gesture over the scrim
			        still moved the document 500px with the drawer open.

			     2. It BROKE THE STICKY HEADER, which is the bug Omar hit.
			        A box with `overflow: hidden` becomes a scroll container,
			        so `body` became the containing block for the sticky
			        header. The header then stuck to a body that never
			        scrolls, and rode the document out of the viewport:
			        measured headerTop -1200 with the drawer open at 1200px,
			        i.e. the bar was entirely off-screen, leaving exactly the
			        "gap at the top" that was reported.

			   The layout is already stable without a lock - the drawer is
			   position:fixed over a position:fixed scrim, so it covers the
			   page from the first frame and no reflow happens on open. So
			   there is nothing to compensate for either, and the whole
			   overflow/padding dance is removed. The scrim swallows the
			   taps, and the drawer scrolls internally on its own.

			   If a lock is ever genuinely needed, it belongs on the element
			   that actually scrolls AND must preserve scroll position - not
			   on `body`, which is neither. */
			var body = doc.body;
			if (!body) return;
			if (!open) {
				// Clear anything a previous version or a consumer left behind.
				body.style.overflow = '';
				body.style.paddingRight = '';
			}
		}
		function isOpen() {
			return btn.getAttribute('aria-expanded') === 'true';
		}
		setOpen(false);

		btn.addEventListener('click', function () {
			setOpen(!isOpen());
		});

		/* Tapping a link inside a one-page menu has to close it, or the
		   reader taps "states", the page scrolls, and the menu is still
		   covering the thing they just asked for. */
		panel.addEventListener('click', function (e) {
			if (e.target && e.target.closest && e.target.closest('a')) setOpen(false);
		});

		/* Escape closes it and returns focus to the button, so keyboard
		   and screen-reader users are not stranded inside a menu that is
		   now invisible. */
		doc.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && isOpen()) {
				setOpen(false);
				btn.focus();
			}
		});

		/* A click outside the header closes it. The header, not the
		   button: the panel is inside the header, so a click on the panel
		   must not be treated as outside. */
		doc.addEventListener('click', function (e) {
			if (!isOpen()) return;
			if (e.target && e.target.closest && e.target.closest('[data-cm-header]')) return;
			setOpen(false);
		});

		var scrim = doc.querySelector('[data-cm-nav-scrim]');
		if (!scrim) {
			scrim = doc.createElement('div');
			scrim.setAttribute('data-cm-nav-scrim', '');
			scrim.setAttribute('aria-hidden', 'true');
			doc.body.appendChild(scrim);
		}
		/* The CLASS is not optional, and this is the second time this has been
		   got wrong. Every rule that styles the scrim is written
		   `.cm-js .cm-nav-scrim` - a class selector - because the rule must
		   only exist once JS has booted, or a no-JS reader gets a permanent
		   dark veil over their content. So the class is what makes the scrim
		   render at all.

		   A consumer is allowed to ship its own scrim node (it is inside the
		   React tree, after the header), and two shipped exactly that:
		   `<div data-cm-nav-scrim />`. The runtime found the node, skipped
		   the create branch, and never added the class - so the scrim stayed
		   an unstyled empty div. MEASURED in WebKit on spacetime-rpm at
		   393x852 with the drawer open: the scrim measured 353x0 (zero
		   height, so `inset: 0` never applied) with `className: ''`, and
		   `.cm-js .cm-nav-scrim` matched nothing. The visible symptom is not
		   a broken box, it is a MISSING affordance: no dark veil behind the
		   drawer and, because the scrim is what swallows the outside tap,
		   no dismiss target either. The drawer covers the full 375px width
		   on a phone, so the reader is left with no way out except Escape.

		   So the class is applied to whatever node was found, created or
		   supplied. Idempotent: `classList.add` on an already-correct class is
		   a no-op, so re-running init over a bound document is free. */
		scrim.classList.add('cm-nav-scrim');
		scrim.addEventListener('click', function () { setOpen(false); });

		
		/* Rotating back to a desktop width with the panel open would
		   otherwise leave `data-open` set on a panel CSS is no longer
		   showing, and the next phone-width view would inherit it. */
		var onChange = function () { setOpen(false); };
		if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
		else if (typeof mq.addListener === 'function') mq.addListener(onChange);
	}

	/* ---------- scroll-spy for nav links ---------- */
	// Marks the nav link whose section is currently in view.
	// Purely additive: the server-rendered active state stays intact.
	function initScrollSpy(nav) {
		if (!nav) return;
		var links = Array.prototype.slice.call(
			nav.querySelectorAll('[data-cm-spy]')
		);
		if (!links.length) return;

		var sections = links
			.map(function (a) {
				var id = a.getAttribute('data-cm-spy');
				return { link: a, el: document.getElementById(id) };
			})
			.filter(function (s) {
				return s.el;
			});
		if (!sections.length) return;

		function update() {
			/* Measured against the viewport, not `offsetTop`. `offsetTop` is
			   relative to the nearest POSITIONED ancestor, so a consumer that
			   puts a section inside any positioned wrapper (a card, a sticky
			   column, a transformed container) silently gets the wrong answer
			   and the spy highlights a section the reader is nowhere near.
			   getBoundingClientRect + scrollY is measured from the document
			   and is correct regardless of what is positioned. */
			var probe = window.scrollY + window.innerHeight * 0.3;
			var current = sections[0];
			sections.forEach(function (s) {
				var top = s.el.getBoundingClientRect
					? s.el.getBoundingClientRect().top + window.scrollY
					: s.el.offsetTop;
				if (top <= probe) current = s;
			});
			sections.forEach(function (s) {
				s.link.classList.toggle('is-active', s === current);
			});
		}
		var ticking = false;
		window.addEventListener(
			'scroll',
			function () {
				if (!ticking) {
					ticking = true;
					window.requestAnimationFrame(function () {
						update();
						ticking = false;
					});
				}
			},
			{ passive: true }
		);
		update();
	}

	/* ---------- footer year ---------- */
	function initYears() {
		var y = String(new Date().getFullYear());
		document.querySelectorAll('[data-cm-year]').forEach(function (el) {
			el.textContent = y;
		});
	}

	/* ---------- measure specimen readout ----------
	   A token specimen that reports its own live state, so the width
	   band a column is in play for is visible rather than asserted in
	   prose. It MEASURES the real row instead of restating the media
	   query breakpoints: a second copy of those numbers is exactly how
	   the showcase and the stylesheet drift apart, and a readout that
	   says "in play" while the row has handed the excerpt off is worse
	   than no readout. */
	function initMeasureReadout() {
		var spec = document.querySelector('[data-spec="measure-title"]');
		if (!spec) return;
		var list = document.querySelector('.cm-rows--inline');
		if (!list) return;
		var val = spec.querySelector('.cm-spec__val');
		if (!val) return;

		function update() {
			var desc = list.querySelector('.cm-row__desc');
			if (!desc) return;
			var live = getComputedStyle(desc).display !== 'none';
			var w = Math.round(desc.getBoundingClientRect().width);
			// init() runs again on every Astro page-load, so the node is
			// REUSED rather than appended. Appending would stack one
			// readout per navigation, and the cell would grow a line at a
			// time for a reader who never reloaded.
			var out = val.querySelector('.cm-spec__state');
			if (!out) {
				out = document.createElement('span');
				out.className = 'cm-spec__state';
				val.appendChild(out);
			}
			out.setAttribute('data-state', live ? 'live' : 'handoff');
			// The number is the live excerpt width, not the token: the
			// token is already printed above it.
			out.textContent = live
				? 'excerpt ' + w + 'px'
				: 'excerpt handed off';
		}
		update();
		var t;
		window.addEventListener('resize', function () {
			clearTimeout(t);
			t = setTimeout(update, 120);
		});
	}

	/* ---------- copy to clipboard ---------- */
	function copyText(text) {
		if (navigator.clipboard && window.isSecureContext) {
			return navigator.clipboard.writeText(text);
		}
		return new Promise(function (resolve, reject) {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy') ? resolve() : reject();
			} catch (e) {
				reject(e);
			}
			document.body.removeChild(ta);
		});
	}

	function initCopy(root) {
		(root || document)
			.querySelectorAll('[data-cm-copy]')
			.forEach(function (btn) {
				/* The bind guard every other init* here has, and the only
				   one this was missing. init() runs again on every
				   astro:page-load, and each run added a SECOND click
				   listener to the same button, so one click copied twice
				   and the label flickered through two state changes.
				   Measured in WebKit: after a re-init, one click on a
				   copy button produced 2 clipboard writes. */
				if (btn.dataset.cmCopyBound) return;
				btn.dataset.cmCopyBound = '1';
				btn.addEventListener('click', function () {
					var sel = btn.getAttribute('data-cm-copy');
					var src = sel ? document.querySelector(sel) : btn.previousElementSibling;
					var text = src ? (src.innerText || src.textContent) : '';
					if (!text) return;
					var original = btn.getAttribute('data-cm-label') || btn.textContent;
					copyText(String(text).trim())
						.then(function () {
							setCopyLabel(btn, 'copied');
							btn.classList.add('is-copied');
							btn.classList.remove('is-error');
						})
						.catch(function () {
							setCopyLabel(btn, 'press \u2318c');
							btn.classList.add('is-error');
						})
						.then(function () {
							setTimeout(function () {
								setCopyLabel(btn, original);
								btn.classList.remove('is-copied');
								btn.classList.remove('is-error');
							}, 1400);
						});
				});
			});
	}

	/* Writing btn.textContent DESTROYS the button's own children, so a
	   button carrying a reserved glyph slot lost it on the first copy and
	   could never get it back. Write into the label slot when the author
	   supplied one, and only fall back to textContent for a bare button. */
	function setCopyLabel(btn, text) {
		var slot = btn.querySelector('[data-cm-copy-label]');
		if (slot) slot.textContent = text;
		else btn.textContent = text;
	}

	/* ---------- generated table labels ----------
	   `.cm-prose-table` stacks below 760px, and a stacked cell reads its
	   column name from `data-label` via `content: attr(data-label)`. That
	   is load-bearing: without it a stacked row is a list of VALUES with
	   no column names, which is not a table at all.

	   A table a person hand-wrote carries `data-label` in the markup, and
	   the library's own showcase does. A table a program WROTE cannot.
	   The consumer that motivated this component (hermes-articles) renders
	   397 markdown pipe-tables across 34 articles from a hand-rolled
	   markdown->HTML function that emits `<thead><th scope="col">` and
	   nothing else - so every one of those tables stacked into
	   unlabelled values on a phone, and the only fix available to it was
	   for a person to hand-edit 397 tables, which is not a fix.

	   So the runtime derives it. The header row is the only source of
	   truth in the markup, and it is already there; copying its text onto
	   the body cells by INDEX is the whole job.

	   Opt-in via [data-cm-table-labels], because deriving attributes on
	   every table in a document is not something to do behind someone's
	   back: a consumer with a hand-authored table and a slightly
	   different header text may not want its attributes rewritten.

	   Index, not position-matching: a row with a MISSING cell (a `| a |  |`
	   gap in a markdown table) would shift every later label if the code
	   walked siblings in step. indexOf in the row gives the right
	   column for a cell whose own position is short of the header's,
	   because `children` contains only the cells that EXIST.

	   Never overwrite an author's own `data-label`. The attribute is the
	   documented hand-written form and wins over anything derived. */
	function labelTable(table) {
		if (!table || table.dataset.cmLabels === '1') return;
		var head = table.querySelector('thead tr');
		if (!head) return;
		var names = Array.prototype.slice.call(head.querySelectorAll('th, td'))
			.map(function (cell) {
				return (cell.textContent || '').trim();
			})
			.filter(function (t) {
				return t.length > 0;
			});
		if (!names.length) return;
		table.dataset.cmLabels = '1';
		table.querySelectorAll('tbody tr').forEach(function (row) {
			var cells = row.children;
			for (var i = 0; i < cells.length && i < names.length; i++) {
				if (cells[i].hasAttribute('data-label')) continue;
				cells[i].setAttribute('data-label', names[i]);
			}
		});
	}

	function initTableLabels(root) {
		(root || document)
			.querySelectorAll('[data-cm-table-labels] .cm-prose-table')
			.forEach(labelTable);
	}

	/* ---------- external link hardening ---------- */
	function initExternalLinks() {
		document.querySelectorAll('a[href^="http"]').forEach(function (a) {
			if (a.hostname && a.hostname !== window.location.hostname) {
				a.setAttribute('target', '_blank');
				a.setAttribute('rel', 'noopener noreferrer');
			}
		});
	}

	/* ---------- tabs ----------
	   The platform has no tab widget, so this is the one piece of the
	   new components that needs script. Everything else about a tab is
	   markup: role=tablist on the row, role=tab + aria-selected +
	   aria-controls on each button, role=tabpanel + aria-labelledby on
	   each panel. What is left is the ARIA keyboard contract, which no
	   amount of CSS delivers: ONE tab is in the tab order (roving
	   tabindex) and the arrow keys move between them. */
	var TAB_SEL = '[role="tab"]';

	function tabPanels(tabs) {
		var ids = tabs
			.map(function (t) {
				return t.getAttribute('aria-controls');
			})
			.filter(Boolean);
		return ids
			.map(function (id) {
				return document.getElementById(id);
			})
			.filter(Boolean);
	}

	function selectTab(tabs, panels, next) {
		if (!next) return;
		/* A disabled tab is never selectable. The guard lives HERE so
		   every door - click, arrows, Home/End - shares one invariant. */
		if (next.getAttribute('aria-disabled') === 'true') return;
		tabs.forEach(function (t) {
			var on = t === next;
			t.setAttribute('aria-selected', on ? 'true' : 'false');
			/* The selected tab is the only one in the tab order. Every
			   tab at tabindex=0 makes Tab walk the whole row, which is
			   what the WAI-ARIA pattern is written to prevent. */
			t.setAttribute('tabindex', on ? '0' : '-1');
		});
		panels.forEach(function (p) {
			if (p.id === next.getAttribute('aria-controls')) {
				p.removeAttribute('hidden');
			} else {
				p.setAttribute('hidden', '');
			}
		});
	}

	function initTabs(root) {
		(root || document)
			.querySelectorAll('.cm-tabs')
			.forEach(function (group) {
				if (group.dataset.cmTabsBound) return;
				group.dataset.cmTabsBound = '1';
				var tabs = Array.prototype.slice.call(
					group.querySelectorAll(TAB_SEL)
				);
				if (!tabs.length) return;
				var panels = tabPanels(tabs);

				/* Normalise on bind rather than trusting the author:
				   a markup mismatch (two selected tabs, or a tab pointing
				   at a panel that does not exist) is a silent ARIA lie,
				   and fixing it here means the component cannot ship one. */
				// A tab disabled by the author must not hold the selection
				// hostage: prefer the selected ENABLED tab, then the first
				// enabled one, and only fall back to the author's claim
				// when the whole row is disabled.
				var enabled = tabs.filter(function (t) {
					return t.getAttribute('aria-disabled') !== 'true';
				});
				var current =
					enabled.filter(function (t) {
						return t.getAttribute('aria-selected') === 'true';
					})[0] || enabled[0] ||
					tabs.filter(function (t) {
						return t.getAttribute('aria-selected') === 'true';
					})[0] || tabs[0];
				selectTab(tabs, panels, current);

				group.addEventListener('keydown', function (e) {
					// Vertical tabs take the vertical axis (Up/Down); every
					// orientation keeps Left/Right, so a screen-reader user
					// driving a vertical list with Left still moves. A key
					// outside the pattern is returned UNPREVENTED - that is
					// what keeps the page's own scrolling and shortcuts.
					var vert = group.getAttribute('data-orientation') === 'vertical';
					var axis = e.key === 'ArrowRight' || e.key === 'ArrowLeft'
						|| e.key === 'Home' || e.key === 'End'
						|| (vert && (e.key === 'ArrowUp' || e.key === 'ArrowDown'));
					if (!axis) return;
					var i = tabs.indexOf(document.activeElement);
					if (i === -1) return;
					e.preventDefault();
					// Disabled tabs are stepped OVER, not onto: the walk is
					// bounded by tabs.length so an all-disabled row lands
					// back on i and selectTab refuses the move anyway.
					var next = -1;
					var find = function (from, dir) {
						var j = from;
						for (var s = 0; s < tabs.length; s++) {
							j = (j + dir + tabs.length) % tabs.length;
							if (tabs[j].getAttribute('aria-disabled') !== 'true') return j;
						}
						return -1;
					};
					if (e.key === 'ArrowRight' || (vert && e.key === 'ArrowDown')) {
						next = find(i, 1);
					} else if (e.key === 'ArrowLeft' || (vert && e.key === 'ArrowUp')) {
						next = find(i, -1);
					} else if (e.key === 'Home') {
						for (var a = 0; a < tabs.length; a++) {
							if (tabs[a].getAttribute('aria-disabled') !== 'true') { next = a; break; }
						}
					} else if (e.key === 'End') {
						for (var b = tabs.length - 1; b >= 0; b--) {
							if (tabs[b].getAttribute('aria-disabled') !== 'true') { next = b; break; }
						}
					}
					if (next === -1 || next === i) return;
					selectTab(tabs, panels, tabs[next]);
					if (typeof tabs[next].focus === 'function') tabs[next].focus();
				});

				group.addEventListener('click', function (e) {
					var t = e.target && e.target.closest
						? e.target.closest(TAB_SEL)
						: null;
					if (t && tabs.indexOf(t) !== -1
						&& t.getAttribute('aria-disabled') !== 'true') {
						selectTab(tabs, panels, t);
					}
				});
			});
	}

	/* ---------- dialog ----------
	   <dialog>.showModal() is the whole implementation, and it is the
	   browser's: top layer, focus trap, Escape, and making the rest of
	   the document inert. A hand-rolled modal gets every one of those
	   subtly wrong. The only thing left to bind is the trigger, so a
	   consumer writes a button and an id instead of a script tag. */
	function initDialogs(root) {
		(root || document)
			.querySelectorAll('[data-cm-open]')
			.forEach(function (btn) {
				if (btn.dataset.cmDialogBound) return;
				btn.dataset.cmDialogBound = '1';
				btn.addEventListener('click', function () {
					var dlg = document.getElementById(btn.getAttribute('data-cm-open'));
					if (!dlg) return;
					/* show, not showModal, when something else already owns
					   the top layer: a nested modal call on an open dialog is a
					   no-op in every engine, so an open/close toggle on the same
					   element silently stops working. */
					if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
					else if (typeof dlg.show === 'function') dlg.show();
				});
			});
	}

	/* ---------- toasts ----------
	   Transient is the whole contract, so the retirement has to be
	   somebody's job and it is ours. The node is inert in the document
	   (invisible, tabbable, announced); it becomes live only once it
	   is in the region. */
	var TOAST_MS = 6000;

	function dismiss(toast) {
		if (!toast || toast.dataset.cmToastGone) return;
		toast.dataset.cmToastGone = '1';
		if (typeof toast.remove === 'function') toast.remove();
		else if (toast.parentNode) toast.parentNode.removeChild(toast);
	}

	/* Scheduling retirement is its own step so a toast whose lifetime is
	   decided LATER - toast.promise hands the timer to the settlement -
	   arms exactly the way a plain toast arms at creation. `life <= 0`
	   means no timer: the close control and dismissToast() still retire
	   it, so sticky is bounded by the reader's own hand. */
	function armToast(toastEl, life) {
		if (!toastEl || typeof setTimeout !== 'function' || !(life > 0)) return;
		setTimeout(function () {
			dismiss(toastEl);
		}, life);
	}

	/* The close control has to work on a toast that did not exist when
	   init() ran. Binding it once inside init() is the bug: every toast
	   the showcase creates comes from a click handler, so the listener
	   is bound before the toast exists and the close button is dead
	   until the next page load — with no error, and with a green suite.
	   So toast() binds each node it creates, and init() binds the ones
	   the author wrote by hand. Both paths guard on the same flag, so a
	   node reached twice is bound once. */
	function bindToastClose(el) {
		if (!el || el.dataset.cmToastBound) return;
		el.dataset.cmToastBound = '1';
		/* Delegated to the close control, not to the toast: the click
		   lands on the button, and a plain click anywhere else in the
		   toast must not retire it. */
		el.addEventListener('click', function (e) {
			if (!e.target || !e.target.closest) return;
			if (e.target.closest('[data-cm-toast-close]')) {
				dismiss(el);
				return;
			}
			/* The action: dispatched FIRST, while the node is still in
			   the document and the event can still bubble; the
			   consumer's callback (stashed on the node by toast()) runs
			   second; retirement last - so a callback that fires its own
			   toast never loses the announcement. A static specimen
			   speaks the same `cm:action`, which is how the showcase
			   answers its own undo button. */
			if (e.target.closest('.cm-toast__action, [data-cm-toast-action]')) {
				el.dispatchEvent(new CustomEvent('cm:action', { bubbles: true }));
				if (typeof el.__cmAction === 'function') el.__cmAction();
				dismiss(el);
			}
		});
	}

	/* `opts.duration` overrides the 6s default. A lag warning is an FYI, not
	   a decision the user has to read, so it should not hold the region for
	   as long as an error would. null/0/undefined all mean "keep the
	   default" - 0 meaning "never expires" is sonner's rule and would make
	   the region grow without bound. That rule STANDS for duration. The
	   sticky path is its own explicit opt-in (`opts.sticky`), because a
	   loading toast's lifetime belongs to the work it announces and a
	   reader who asks for that is not the accident this comment guards. */
	function toast(msg, severity, opts) {
		var life = TOAST_MS;
		if (opts && opts.sticky) life = 0;
		else if (opts && typeof opts.duration === 'number' && opts.duration > 0)
			life = opts.duration;
		var region =
			document.querySelector('[data-cm-toasts]') ||
			(function () {
				var el = document.createElement('div');
				el.className = 'cm-toast-region';
				el.setAttribute('data-cm-toasts', '');
				el.setAttribute('role', 'status');
				el.setAttribute('aria-live', 'polite');
				document.body.appendChild(el);
				return el;
			})();
		var node = null;
		if (typeof msg === 'string') {
			/* A toast carries the SAME severity vocabulary as .cm-alert -
			   ok / warn / err - because a toast IS a transient alert. Two
			   vocabularies is how an app ends up with one system's
			   border weights and another's glyphs. The mark is a text
			   node in the library's own glyphs, so it inherits the token
			   colours instead of a hard-coded green. */
			var sev = severity === 'error' ? 'err'
				: severity === 'success' ? 'ok'
				: severity === 'warning' ? 'warn'
				: severity === 'info' ? 'info'
				: severity === 'loading' ? 'loading'
				: null;
			if (sev) {
				var box = document.createElement('div');
				box.className = 'cm-toast cm-alert--' + sev;
				/* "working" is a STATE, so it is announced as one
				   (aria-busy) AND drawn by the same mechanism as every
				   other severity: a CSS-injected mark. No element goes
				   inside the mark - the showcase's own test says an
				   injected glyph plus a literal one renders twice. */
				if (sev === 'loading') box.setAttribute('aria-busy', 'true');
				var mark = document.createElement('span');
				mark.className = 'cm-toast__mark';
				var body = document.createElement('div');
				body.className = 'cm-toast__body';
				var text = document.createElement('p');
				text.className = 'cm-toast__text';
				text.style.margin = '0';
				text.textContent = msg;
				body.appendChild(text);
				box.appendChild(mark);
				box.appendChild(body);
				if (opts && opts.action && opts.action.label) {
					var act = document.createElement('button');
					act.type = 'button';
					act.className = 'cm-toast__action cm-btn cm-btn--sm';
					act.textContent = String(opts.action.label);
					box.appendChild(act);
					/* The generic binder on the node owns the CLICK (one
					   listener for close and action alike); the callback
					   travels on the node itself so the binder never
					   needs to know what `opts` was. */
					box.__cmAction = typeof opts.action.onClick === 'function'
						? opts.action.onClick
						: null;
				}
				node = box;
			} else {
				var span = document.createElement('span');
				span.className = 'cm-toast';
				span.textContent = msg;
				node = span;
			}
		} else if (msg && msg.nodeType === 1) {
			node = msg;
		} else {
			return;
		}
		region.appendChild(node);
		bindToastClose(node);
		armToast(node, life);
		return node;
	}

	/* toast.promise - the sonner/shadcn shape: ONE toast that lives
	   through the async work and reports the settlement instead of three
	   racing. Its loading is `sticky` because the promise - not a timer -
	   owns the lifetime; settling swaps the severity classes in place
	   (same node, same glyph rules, no flicker), drops `aria-busy`, and
	   hands the node back to the normal retirement. Texts may be strings
	   or plain functions of the resolution value / rejection reason. */
	function toastPromise(p, texts, opts) {
		texts = texts || {};
		if (!p || typeof p.then !== 'function') return null;
		var base = {};
		if (opts) {
			for (var key in opts) {
				if (Object.prototype.hasOwnProperty.call(opts, key)) base[key] = opts[key];
			}
		}
		base.sticky = true;
		var node = toast(texts.loading || 'working\u2026', 'loading', base);
		if (!node) return node;
		var settled = false;
		function settle(ok, msg) {
			if (settled) return;
			settled = true;
			node.className = 'cm-toast cm-alert--' + (ok ? 'ok' : 'err');
			node.removeAttribute('aria-busy');
			var textEl = node.querySelector('.cm-toast__text');
			if (textEl) {
				textEl.textContent = typeof msg === 'function'
					? String(msg())
					: String(msg);
			}
			armToast(node, TOAST_MS);
		}
		p.then(
			function (value) {
				settle(true, texts.success || value || 'done');
			},
			function (reason) {
				settle(false, texts.error || reason || 'failed');
			}
		);
		return node;
	}
	toast.promise = toastPromise;

	function initToasts(root) {
		(root || document)
			.querySelectorAll('[data-cm-toast]')
			.forEach(bindToastClose);
	}

	/* Resolve a custom property to pixels. `getPropertyValue` on :root
	   returns the declared token, which is a rem length, and `parseFloat`
	   of a rem string yields the NUMBER — so '1.25rem' read as 1.25px.
	   A detached element resolves the length against the real font size. */
	var cmProbe = null;
	function pxOf(name) {
		if (!cmProbe) {
			cmProbe = document.createElement('div');
			cmProbe.style.cssText =
				'position:absolute;visibility:hidden;pointer-events:none;top:-9999px';
		}
		if (!cmProbe.isConnected) document.body.appendChild(cmProbe);
		cmProbe.style.setProperty('width', 'var(' + name + ')');
		return parseFloat(getComputedStyle(cmProbe).width) || 0;
	}

	/* ---------- tooltip edge clamping ----------
	   CSS cannot keep a tip on screen. A tip's width is `max-content`, and
	   whether it fits depends on where its TRIGGER sits — which CSS cannot
	   read. The centred variant is fine with a `100vw` cap; the edge-
	   anchored ones are not: `--start` pins the tip's left edge to the
	   trigger, so a trigger at x=131 in a 360px window has 209px of room,
	   and a 281px tip runs to x=412 and scrolls the whole page sideways.
	   Measured: 52px of sideways scroll at 360, 92px at 320.

	   `anchor-size()` would be the honest fix and WebKit 26.6 does not
	   support it. So this clamps in script and only ever SHRINKS the tip:
	   if CSS's cap already fits, nothing is written at all and the
	   element keeps no inline style. No JS means the CSS cap, which is
	   correct at every width where the trigger is not near an edge. */
	function initTooltipClamp(root) {
		(root || document).querySelectorAll('.cm-tooltip__tip').forEach(function (tip) {
			var host = tip.closest('.cm-tooltip');
			if (!host || host.dataset.cmClamp) return;
			host.dataset.cmClamp = '1';
			var apply = function () {
				// Measure the natural tip and the room the anchor leaves.
				// `left`/`right` say which edge the variant pinned to.
				var cs = getComputedStyle(tip);
				// Which EDGE the variant pins to is a class, not a
				// computed style: `getComputedStyle().right` is resolved
				// to a used pixel value, so it is never 'auto' and
				// testing for it always failed. Read the class.
				var pinnedRight = host.classList.contains('cm-tooltip--end');
				var tr = host.getBoundingClientRect();
				var vw = document.documentElement.clientWidth;
				// A centred tip is centred on the trigger; an anchored one
				// starts at the trigger's edge and runs toward the far one.
				// `room` is how much of the VIEWPORT the tip is allowed to
				// occupy, which is NOT the same as the gap to the trigger's
				// anchor edge. An anchored tip's right edge is fixed to a
				// trigger edge, but its LEFT edge may sit anywhere left of
				// that, so the space it can grow into is the whole span
				// from the viewport's far edge to the trigger's own side.
				//
				//   --end   : right edge on the trigger's right edge, so it
				//             may occupy up to `trigger.left`.
				//   --start : left edge on the trigger's left edge, so it may
				//             occupy up to `vw - trigger.left`.
				//   centred : half its width hangs either side of the
				//             trigger, so up to twice the NARROWER side.
				//
				// The first version used `trigger.left - gutter` for --end
				// and clamped a 25-word tip to 38px, which is unreadable
				// rather than merely untidy.
				// Measured, not reasoned: for `--end` the trigger sits at
				// x=40..119 and the tip's right edge renders at exactly 119,
				// so the tip can occupy 119px, not the 40px the trigger's
				// LEFT edge suggested. `right: 0` resolves against the
				// trigger's RIGHT edge, and the tip grows leftward from
				// there across the whole space to the viewport edge.
				// Keep a tip off the viewport edge by the page's own gutter.
				// Without it a `--start` tip whose natural width happens to
				// equal the remaining space renders flush to the edge:
				// measured at 320, tip 40..320 with the viewport at 320.
				// `--gutter` is a REM length, so `parseFloat('1.25rem')`
				// returns 1.25 and the inset was 1.25px instead of 20px.
				// Reading a custom property yields its SPECIFIED value, not
				// a resolved length, so the unit has to be carried through
				// with a probe element rather than parsed off the token.
				var gutter = pxOf('--gutter');
				var left = tr.left, right = vw - tr.right;
				var room;
				if (pinnedRight) {
					room = tr.right - gutter;
				} else if (host.classList.contains('cm-tooltip--start')) {
					room = vw - tr.left - gutter;
				} else {
					// A CENTRED tip hangs half its width either side of the
					// trigger, so the room is twice the NARROWER side —
					// but never more than the viewport itself, or a
					// trigger near one edge is allowed to push the tip
					// past the other. Measured at 320: twice the narrow
					// side came to 560, which let a 280px tip end flush
					// against the viewport edge.
					room = Math.min(Math.min(left, right) * 2, vw) - gutter;
				}
				// Never grow past the CSS cap, never below a readable floor.
				var cap = Math.floor(
					Math.min(parseFloat(cs.maxWidth) || Infinity, room)
				);
				// Compare against the tip's NATURAL width, not the width
				// it currently has. Comparing to `scrollWidth` oscillates:
				// the clamp shrinks the tip, which fires the observer,
				// which re-runs, now finds scrollWidth <= cap, and REMOVES
				// the style — leaving the tip one frame too wide. The last
				// value that fits is remembered and only ever tightened.
				var natural = tip.__cmNaturalW || (tip.__cmNaturalW = tip.scrollWidth);
				if (cap > 0 && natural > cap) {
					tip.style.maxWidth = cap + 'px';
				} else {
					tip.style.removeProperty('max-width');
					// Room grew past the natural width again: forget the
					// measurement so a later shrink re-reads it.
					if (cap >= natural) tip.__cmNaturalW = 0;
				}
			};
			// Recompute on resize: the room is a function of the trigger's
			// position, which moves with the layout.
			if (typeof ResizeObserver === 'function') {
				new ResizeObserver(apply).observe(host);
			}
			window.addEventListener('resize', apply);
			apply();
		});
	}

	/* ---------- dropdown anchoring ----------
	   `.cm-dropdown__menu` is a `[popover]`, and a top-layer element's
	   containing block is the INITIAL CONTAINING BLOCK - never its
	   `.cm-dropdown` parent. The rule's own `position: absolute; right: 0;
	   top: calc(100% + 4px)` is therefore resolved against the document
	   origin, and the UA's popover default (`inset: 0; margin: auto;
	   width: fit-content`, measured in WebKit 26.6) leaves `left: 0` in
	   place, so the horizontal pair is over-constrained and `right` is the
	   half that loses.

	   MEASURED on this repo's own showcase, in WebKit, with the runtime's
	   inline styles cleared (so this is CSS alone): the "row actions"
	   trigger sat at document (40, 25576) at 390x844 and (356, 19116) at
	   1280x900, while its open menu rendered at document (0, 848) and
	   (0, 904) - the left edge of the page, one viewport height below its
	   top. `getComputedStyle(menu).top` reads exactly `848px` on an
	   844px viewport: the ICB's own height plus the 4px gap, which is how
	   you can tell the containing block is the viewport rather than
	   `.cm-dropdown`. Scrolled to the trigger - where the reader always
	   IS - the menu sits 24,286px ABOVE the viewport, i.e. not on screen
	   at all. Not near the button in ANY engine, and not a WebKit quirk:
	   CSS has no selector that knows where the trigger is, so the runtime
	   anchors it instead.

	   Two consequences that shaped the implementation:
	   - A per-element binding is wrong here. `init()` binds once, but a
	     consumer that re-renders its rows (the hearth console rewrites its
	     <tbody> every 5s) replaces the menu nodes, and a dataset flag dies
	     with them. `toggle` does not bubble but it DOES pass through the
	     capture phase, so one listener on `document` outlives every node. */
	var POP_SEL = '.cm-dropdown__menu[popover], .cm-popover[popover]';
	var popPins = [];
	/* The open POINTER menu, if any. `popover="manual"` was the only way to
	   keep it open: the platform's light dismiss treats the interaction the
	   menu was born in as an outside one, so the mouseup of the right-click
	   that opened it closed the panel 2ms later - measured, not guessed. */
	var ctxMenu = null;

	/* The trigger behind a popover, matched by comparing the ATTRIBUTE
	   VALUE rather than by building a selector: an id is data, and data
	   goes in as data, so an id nobody anticipated cannot escape into the
	   selector language and quietly match nothing. */
	function popTrigger(menu) {
		if (!menu || !menu.id) return null;
		var all = document.querySelectorAll('[popovertarget]');
		for (var i = 0; i < all.length; i++) {
			if (all[i].getAttribute('popovertarget') === menu.id) return all[i];
		}
		return null;
	}

	function anchorPopover(menu) {
		var id = menu.id || '';
		// [popovertarget] is a plain attribute selector: valid whether or
		// not the engine implements the popover API.
		var trigger = popTrigger(menu);
		// A context menu has no trigger to measure: its anchor is the
		// POINTER, stashed on the element by the contextmenu handler
		// before showPopover(). Without this branch the function returned
		// above and a right-click menu opened against a corner it was
		// never opened from.
		var at = menu.__cmCtx;
		// A submenu has no [popovertarget] - it opens from an owner ROW
		// named by aria-controls, which the platform never sees - and it
		// opens beside its HOST PANEL rather than under a chevron.
		//
		// A navmenu submenu is the other shape of the same thing: it DOES
		// carry a popovertarget (it is its own nested root's shared
		// viewport), so `trigger` is set and it used to fall through to
		// the top-level rule below and open UNDER its word - measured at
		// 402px, its own trigger sat at y=488 and the panel landed at
		// y=196, straight over the parent panel's links. A nested root's
		// panel belongs beside the panel that holds it, exactly like a
		// dropdown submenu's, so the class is what routes it - not
		// whether the markup happens to name the target.
		var host = menu.parentNode &&
			typeof menu.parentNode.closest === 'function'
				? menu.parentNode.closest('.cm-dropdown__menu') : null;
		if (!host && menu.classList &&
			menu.classList.contains('cm-navmenu__subpanel')) {
			host = menu.closest('.cm-navmenu__panel');
		}
		if (!trigger && !at && !host) return;
		var t = trigger ? trigger.getBoundingClientRect() : null;
		menu.style.position = 'fixed';
		menu.style.inset = 'auto';
		var w = menu.offsetWidth;
		var h = menu.offsetHeight;
		var pad = 8;
		if (host) {
			var hr = host.getBoundingClientRect();
			var owner = id ? document.querySelector('[aria-controls="' + id + '"]')
				: null;
			// A navmenu submenu's owner is named by the platform's own
			// popovertarget, not aria-controls - the panel is a shared
			// viewport, so the nested root's word is what opened it. Asking
			// for aria-controls alone leaves `owner` null and the submenu
			// then hangs off the panel's top corner instead of its word.
			if (!owner && menu.classList &&
				menu.classList.contains('cm-navmenu__subpanel') &&
				typeof menu.getAttribute === 'function') {
				var sid = menu.getAttribute('id');
				if (sid) owner = document.querySelector('[popovertarget="' + sid + '"]');
			}
			var ow = owner ? owner.getBoundingClientRect() : null;
			// Right of the panel when that fits, left of it when THAT
			// fits, otherwise flush inside the right edge: a 320px
			// viewport cannot hold panel and submenu side by side, and
			// running off-screen reads as broken, not as overlap.
			var x = hr.right;
			if (x + w > window.innerWidth - pad) x = hr.left - w;
			if (x < pad) x = Math.max(pad, window.innerWidth - w - pad);
			var y = ow ? ow.top : hr.top;
			if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
			if (y < pad) y = pad;
			var sl = Math.round(x) + 'px', st = Math.round(y) + 'px';
			if (menu.style.left !== sl) menu.style.left = sl;
			if (menu.style.top !== st) menu.style.top = st;
			return;
		}
		if (at) {
			// The point is where the finger was: move the PANEL to stay
			// inside the viewport, never move the point itself, so the
			// corner that was clicked stays the corner being read.
		var cx = at.x, cy = at.y;
		if (cx + w > window.innerWidth - pad) cx = window.innerWidth - w - pad;
		if (cy + h > window.innerHeight - pad) cy = window.innerHeight - h - pad;
		if (cx < pad) cx = pad;
		if (cy < pad) cy = pad;
		var cl = Math.round(cx) + 'px', ct = Math.round(cy) + 'px';
		if (menu.style.left !== cl) menu.style.left = cl;
		if (menu.style.top !== ct) menu.style.top = ct;
		return;
		}
		// A menu hangs off a chevron, so its RIGHT edge aligns with the
		// trigger; a card of prose and the panel under a menubar WORD both
		// open from the LEFT edge they belong to.
		var start = menu.classList && (menu.classList.contains('cm-popover') ||
				menu.classList.contains('cm-menubar__menu') ||
				menu.classList.contains('cm-navmenu__panel'));
		var x = start ? t.left : t.right - w;
		if (x < pad) x = pad;
		else if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
		var y = t.bottom + 4;                     // `calc(100% + var(--space-1))`, translated
		if (y + h > window.innerHeight - pad && t.top - h - 4 >= pad) y = t.top - h - 4;
		// NEITHER side fits (a capped select list against a trigger
		// near the bottom of a phone): the flip above gives up, and
		// without this the panel hangs off-screen - which reads as
		// broken, not as overlap. Pin the BOTTOM edge instead; the
		// trigger slides under it, the way every native select does.
		if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
		if (y < pad) y = pad;
		// Written only when they move: the pin re-anchors every frame while
		// the card is open, and an unconditional style write at 60fps is a
		// layout invalidation nobody asked for.
		/* alignItemWithTrigger: a select opens so the CHECKED row sits
		   over the trigger instead of row one. The adjustment lives here,
		   inside the one placer, because the pin re-runs THIS function on
		   every scroll - a parallel transform would be a second placer
		   that outlives it. Measured un-transformed (this function owns
		   left/top; nothing else shifts the panel), so every re-pin
		   recomputes from a clean box and lands on the same value.
		   Opt-in: only a wrap carrying data-cm-align-item asks for it,
		   so plain menus keep their top-anchored behaviour. */
		var top = Math.round(y) + 'px';
		// closest is guarded the way classList is at the top of this
		// function: the suite drives this path with a menu stub that
		// carries style and nothing else, and an unguarded method call
		// would turn a placement check into a TypeError. Real popovers
		// always have it; only the opt-in branch needs it.
		if (trigger && typeof menu.closest === 'function'
			&& menu.closest('[data-cm-align-item]')) {
			var chk = menu.querySelector('[aria-checked="true"]');
			if (chk) {
				var mtop = menu.getBoundingClientRect().top;
				var ctop = chk.getBoundingClientRect().top;
				// Move the BOX by what the ROW needs: on the first open
				// the inline top is not written yet, so the box - not the
				// just-computed y - is the reference that is always true.
				var ay = mtop + (t.top - ctop);
				if (ay < pad) ay = pad;
				if (ay + h > window.innerHeight - pad) {
					ay = window.innerHeight - h - pad;
				}
				top = Math.round(ay) + 'px';
			}
		}
		var left = Math.round(x) + 'px';
		if (menu.style.left !== left) menu.style.left = left;
		if (menu.style.top !== top) menu.style.top = top;
	}

	/* Fixed positioning does not follow the page, so while a menu is open
	   the trigger moves under it on every scroll. Pin, then unpin on close
	   - one pair of listeners, not one per menu. */
	function unpinPopover(menu) {
		// Two popovers can be open at once - a menu and its submenu - and
		// the old single slot meant opening the submenu EVICTED its own
		// parent's pin: the parent then sat still while the page scrolled
		// under it. Unpin one by naming it, everything by naming nothing.
		for (var i = popPins.length - 1; i >= 0; i--) {
			var p = popPins[i];
			if (menu && p.menu !== menu) continue;
			window.removeEventListener('scroll', p.fn);
			window.removeEventListener('scrollend', p.fn);
			window.removeEventListener('resize', p.fn);
			popPins.splice(i, 1);
		}
	}

	/* Anchoring on the scroll event itself measures MID-jump. A programmatic
	   scrollTo(0, 240) from the middle of a 53,000px showcase left the card
	   275px off its trigger: the last scroll event ran while the viewport was
	   still somewhere in between, and nothing re-ran at the final position.
	   Deferring to the next frame measures where the page actually ended up,
	   and `scrollend` covers engines that coalesce the whole jump into one
	   event. */
	function pinPopover(menu) {
		unpinPopover(menu);
		var fn = function () { anchorPopover(menu); };
		window.addEventListener('scroll', fn, { passive: true });
		window.addEventListener('scrollend', fn);
		window.addEventListener('resize', fn);
		popPins.push({ menu: menu, fn: fn });
		// Anchoring happens ON the event, never in a deferred callback: an
		// earlier version debounced through requestAnimationFrame, and the
		// callback that finally ran had the page's old position in it, so
		// the card stopped 276px short of its trigger for good. Measuring
		// per event was verified across a smooth 26,000px jump with no
		// trailing frame loop - which I built, mutation-tested, and then
		// deleted, because removing it never broke the check and a rAF that
		// runs for the life of an open card is a cost with no proof behind
		// it. `scrollend` rides along for engines that coalesce the jump
		// into a single scroll event.
		anchorPopover(menu);
	}

	/* An item is reachable unless it says it is not. aria-disabled items stay
	   in the DOM (so a reader hears them) but the arrow keys step over them. */
	function menuItems(menu) {
		return Array.prototype.filter.call(
			menu.querySelectorAll('[role^="menuitem"], .cm-dropdown__item'),
			function (el) {
				// A row inside a NESTED panel belongs to that panel: including
				// it here would make the parent's arrow keys walk down into
				// the submenu and never come back. One menu, one list.
				var owner = el.closest(POP_SEL);
				return owner === menu &&
					el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
			}
		);
	}

	/* A disabled disclosure must not move. <details> has no disabled
	   attribute, so the toggle is VETOED at the summary: preventDefault
	   kills the platform's activation for pointer AND for the click the
	   engine fires when keyboard users press Space or Enter - one
	   mechanism, not two. The veto is deliberately not a `toggle`
	   listener: a disabled item inside a name= group gets closed by the
	   PLATFORM when a sibling opens, and re-opening it in a toggle
	   handler would fight the same attribute and loop. */
	function onDisclosureClick(e) {
		var s = e.target && typeof e.target.closest === 'function'
			? e.target.closest('summary') : null;
		if (!s || !s.classList.contains('cm-disclosure__summary')) return;
		if (s.getAttribute('aria-disabled') !== 'true') return;
		e.preventDefault();
	}

	function onPopoverToggle(e) {
		var menu = e.target;
		if (!menu || typeof menu.matches !== 'function' || !menu.matches(POP_SEL)) return;
		// aria-expanded is not managed by the platform for [popover] the
		// way it is for <details>: this handler already runs on every open
		// and close, so it is the one place that knows, and a menubar cell
		// that never flips is a cell a screen reader describes as closed.
		var trig = popTrigger(menu);
		if (trig && typeof trig.hasAttribute === 'function' && trig.hasAttribute('aria-haspopup')) {
			trig.setAttribute('aria-expanded', menu.matches(':popover-open') ? 'true' : 'false');
		}
		if (menu.matches(':popover-open')) {
			// The shared viewport fills HERE: click (recorded by
			// onNavmenuClick), hover and the arrow walk all set
			// __cmNavTrigger first, and this is the one task they all
			// pass through. data-state is the fingerprint the panel
			// carries for anything reading the swap (and for the CSS
			// that paints the incoming list).
			if (menu.hasAttribute && menu.hasAttribute('data-cm-viewport')) {
				navViewportFill(menu);
				menu.setAttribute('data-state', 'open');
			}
			if (menu.__cmCtx) {
				ctxMenu = menu;
				// A manual popover gets no focus return of its own, so keep
				// hold of what the right-click interrupted.
				menu.__cmReturn =
					(document.activeElement && typeof document.activeElement.blur === 'function')
						? document.activeElement : null;
				// A context menu belongs to a POINT. The page moving under
				// it invalidates that anchor outright - there is no trigger
				// to re-follow - so it closes rather than drifting to a
				// place nobody clicked.
				unpinPopover();
				var closeOn = function () {
					if (typeof menu.hidePopover === 'function') menu.hidePopover();
				};
				window.addEventListener('scroll', closeOn, { passive: true });
				window.addEventListener('resize', closeOn);
				popPins.push({ menu: menu, fn: closeOn });
				// ...and it still has to be PUT there: pinPopover() is what
				// anchored every other panel, and this branch replaces it.
				anchorPopover(menu);
			} else pinPopover(menu);
			// The menu-button pattern: opening moves focus INTO the menu, so
			// the arrow keys have somewhere to start. Closing returns focus to
			// the trigger - the popover API already does that half.
			//
			// A NAVMENU panel is the exception, and it is the difference
			// between the two components: a reader walking a nav BAR has
			// their focus on the bar, and a panel that pulls focus into its
			// first link turns "walk to the next word" into "walk into the
			// panel" - measured in WebKit: Right moved focus to `reference`
			// and the panel then took it to `#table`, so the bar was
			// unreachable in one press. The panel's own links are still a
			// Tab away, in document order.
			if (!(menu.classList && menu.classList.contains('cm-navmenu__panel'))) {
				var first = menuItems(menu)[0] ||
					menu.querySelector('button, a[href], input, [tabindex]:not([tabindex="-1"])');
				if (first && typeof first.focus === 'function') first.focus();
			}
		} else {
			// A panel that closes takes its SUBMENUS with it. Nothing else
			// does: a submenu popover's top-layer position survives its
			// parent's close, and a submenu floating over the page with no
			// panel holding it is the one state that makes nested
			// navigation unreadable.
			if (menu.classList && menu.classList.contains('cm-navmenu__panel')) {
				var orphaned = 0;
				Array.prototype.forEach.call(
					menu.querySelectorAll('[popover]:popover-open'),
					function (sub) {
						orphaned = 1;
						if (typeof sub.hidePopover === 'function') sub.hidePopover();
					});
				// The submenu's own focus fixup points at ITS invoker - a
				// trigger inside this panel, which is closed now. If focus
				// fell to the page, the way back is the trigger that owned
				// this panel in the first place. ONLY when a submenu was
				// actually closed by this: focus() scrolls its target into
				// view, and a focus fired on every plain close moves the page
				// under an idle reader (measured: it shifted a scroll's
				// landing point by pinning scroll-anchoring to the trigger).
				var ae = document.activeElement;
				if (orphaned && (!ae || ae === document.body) &&
					trig && typeof trig.focus === 'function') trig.focus();
			}
			if (menu.hasAttribute && menu.hasAttribute('data-cm-viewport')) {
				menu.setAttribute('data-state', 'closed');
				// The generic aria write above ran popTrigger(), which
				// for two triggers sharing one target can only see the
				// FIRST - so a close after opening the second would
				// leave that one reading expanded. Close the bar.
				navViewportExpand(menu, null);
			}
			if (menu.__cmCtx && ctxMenu === menu) {
				var back = menu.__cmReturn;
				var inside = document.activeElement &&
					typeof menu.contains === 'function' &&
					menu.contains(document.activeElement);
				if (inside && back && typeof back.focus === 'function') back.focus();
				menu.__cmReturn = null;
				ctxMenu = null;
			}
			unpinPopover(menu);
		}
	}
	/* ---------- dropdown depth ----------
	   The item kinds shadcn documents on DropdownMenu and this menu did not
	   have. Each rule below is its own owner; none of it re-implements the
	   platform, it only fills in what [popover] leaves out. */

	/* A submenu is a popover owned by a menuitem. Right opens it (Enter does
	   too, the other half of "the row is a button"), Left closes it and puts
	   focus back on the parent row - the reader's way back is the parent, not
	   Escape guessing where they were. */
	function submenuOf(item) {
		var id = item && item.getAttribute && item.getAttribute('aria-controls');
		return id ? document.getElementById(id) : null;
	}
	function openSubmenu(item) {
		var sub = submenuOf(item);
		if (!sub || typeof sub.showPopover !== 'function') return false;
		if (!sub.matches(':popover-open')) sub.showPopover();
		// focus first (it can scroll), then anchor SYNCHRONOUSLY: the
		// toggle event that would anchor it runs as a later task, and
		// anything that paints in between shows the panel at its base
		// position (measured: subLeft 5, subTop 708, before the task).
		// One owner of placement either way - anchorPopover's submenu
		// branch, exactly what the toggle handler calls again on arrival.
		var first = menuItems(sub)[0];
		if (first && typeof first.focus === 'function') first.focus();
		anchorPopover(sub);
		return true;
	}
	function closeSubmenu(menu) {
		if (!menu) return false;
		// One level per press, wherever focus sits. Focus is often INSIDE
		// the submenu, but a mouse can leave it on a parent row with the
		// panel still open - so the DEEPEST open descendant closes first
		// (a role=group wrapper sits between owner and panel, so this
		// cannot be a direct-child walk). Only when no child is open does
		// the menu itself step out.
		var opens = menu.querySelectorAll('[popover]:popover-open');
		var open = opens[opens.length - 1];
		if (open && typeof open.hidePopover === 'function') {
			var owner = open.id &&
				document.querySelector('[aria-controls="' + open.id + '"]');
			open.hidePopover();
			if (owner && typeof owner.focus === 'function') owner.focus();
			return true;
		}
		if (!menu.matches(':popover-open')) return false;
		// Stepping out of the menu itself: the owner may be named by
		// aria-controls or, as the platform does it, by popovertarget
		// alone - the library must not depend on markup it does not own.
		var self = (menu.id && document.querySelector('[aria-controls="' + menu.id + '"]')) ||
			(menu.id && document.querySelector('[popovertarget="' + menu.id + '"]'));
		if (!self) return false;
		menu.hidePopover();
		if (typeof self.focus === 'function') self.focus();
		return true;
	}

	/* Checkbox and radio rows live in the SAME list as plain items, so
	   stepping over them must not flip them. Radio is the exception the APG
	   makes: moving the selection IS the point, which is why the arrows call
	   setRadio on arrival. */
	function toggleCheckable(item) {
		if (item.getAttribute('role') !== 'menuitemcheckbox') return false;
		var on = item.getAttribute('aria-checked') !== 'true';
		item.setAttribute('aria-checked', on ? 'true' : 'false');
		var glyph = item.querySelector('.cm-dropdown__icon');
		if (glyph) glyph.setAttribute('data-checked', on ? 'true' : 'false');
		return true;
	}
	/* One radio group at a time: the checked row wins, the others stand
	   down. Scoped to the enclosing menu, so two menus on a page never fight
	   over the same group. */
	function setRadio(item) {
		var name = item.getAttribute('data-cm-radio');
		if (!name) return;
		var scope = item.closest('[role="menu"]') || document;
		Array.prototype.forEach.call(
			scope.querySelectorAll('[data-cm-radio="' + name + '"]'),
			function (row) {
				row.setAttribute('aria-checked', row === item ? 'true' : 'false');
			}
		);
		/* The trigger SHOWS what was chosen: a select whose trigger never
		   mirrors the pick is a menu. This runs inside setRadio because
		   both doors - the click and the keyboard arrival - already
		   converge here, so a second listener is the thing that would let
		   them disagree. Structural opt-in: it writes only when the wrap's
		   trigger carries the value/placeholder pair, so every plain radio
		   menu (the toolbar's density picker) is untouched. */
		var wrap = item.closest('.cm-dropdown');
		if (!wrap) return;
		var value = wrap.querySelector('.cm-dropdown__value');
		if (!value) return;
		value.textContent = (item.textContent || '').replace(/\s+/g, ' ').trim();
		value.removeAttribute('hidden');
		wrap.setAttribute('data-cm-picked', 'true');
		var ph = wrap.querySelector('.cm-dropdown__placeholder');
		if (ph) ph.setAttribute('hidden', '');
	}

	/* Typeahead: printable characters walk to the next item whose label
	   starts with what has been typed, wrapping, like every native menu. The
	   buffer resets on any other key, so Ctrl then R is not read as a prefix,
	   and a keypress after a pause starts a fresh search. */
	var typeBuf = '';
	var typeAt = 0;
	function onMenuTypeahead(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var menu = t.closest(POP_SEL);
		if (!menu) return;
		var k = e.key;
		if (k.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
			typeBuf = '';
			return;
		}
		var items = menuItems(menu);
		if (!items.length) return;
		var now = new Date().getTime();
		if (now - typeAt > 800) typeBuf = '';
		typeAt = now;
		typeBuf += k;
		var needle = typeBuf.toLowerCase();
		var i = items.indexOf(t);
		for (var n = 1; n <= items.length; n++) {
			var cand = items[(i + n) % items.length];
			var lab = cand.querySelector('.cm-dropdown__label');
			var text = (lab ? lab.textContent : cand.textContent) || '';
			if (text.trim().toLowerCase().indexOf(needle) === 0) {
				e.preventDefault();
				cand.focus();
				return;
			}
		}
	}
	if (typeof document !== 'undefined') document.addEventListener('keydown', onMenuTypeahead);

	/* Hovering a submenu row opens it, but only while a menu is already open
	   and the pointer is not merely crossing it on the way to the panel. The
	   platform gives native <details> this for free; a popover gets nothing,
	   so it is here. */
	function onMenuHover(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var item = t.closest('[aria-haspopup="menu"]');
		if (!item || !item.closest(POP_SEL)) return;
		var sub = submenuOf(item);
		if (!sub || sub.matches(':popover-open')) return;
		var focused = document.activeElement;
		if (focused && focused !== item && typeof focused.closest === 'function' &&
			focused.closest(POP_SEL)) return;
		openSubmenu(item);
	}
	if (typeof document !== 'undefined') document.addEventListener('pointerover', onMenuHover);

	/* Arrow keys inside an open menu: Down/Up step and wrap, Home/End jump.
	   Escape is the platform's (light dismiss), so it is not handled here. */
	// One delegated listener at the document, so a consumer that re-renders its
	// menu keeps working - the handler finds the menu through the row's own
	// closest() on every keystroke. Guarded like every other binding: this
	// module is evaluated in a sandbox with no document at all.
	if (typeof document !== 'undefined') document.addEventListener('keydown', onMenuKey);
	function onMenuKey(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var menu = t.closest(POP_SEL);
		if (!menu) return;
		var items = menuItems(menu);
		if (!items.length) return;
		var i = items.indexOf(t);
		var next = null;
		if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
		else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
		else if (e.key === 'Home') next = items[0];
		else if (e.key === 'End') next = items[items.length - 1];
		// Right opens a submenu row, Enter does too (the row is a button).
		// Checked FIRST and before the item list matters: a row that owns a
		// submenu is still a row, and focusing the first item of a panel the
		// reader never opened is the bug this prevents.
		if (e.key === 'ArrowRight' ||
			(e.key === 'Enter' && t.getAttribute('aria-haspopup') === 'menu')) {
			if (openSubmenu(t)) e.preventDefault();
			return;
		}
		// Left closes the open submenu and puts focus back on its owner row.
		// It also steps out of a submenu when focus is INSIDE it, which is
		// the only way back for a reader who walked in.
		if (e.key === 'ArrowLeft') {
			if (closeSubmenu(t.closest(POP_SEL))) e.preventDefault();
			return;
		}
		// Space/Enter flip a checkbox row. Enter already activates the button;
		// Space does not, so both routes are spelled out here. The click that
		// Enter ALSO generates must not flip it back, so the flip is recorded
		// for onMenuCheckClick; and because preventDefault may suppress that
		// click entirely, a column-visibility item applies itself right here.
		if ((e.key === ' ' || e.key === 'Enter') && toggleCheckable(t)) {
			e.preventDefault();
			cmKeyFlipItem = t;
			cmKeyFlipAt = Date.now();
			cmColvisApply(t);
			return;
		}
		if (!next) return;
		// A radio row takes the selection when the arrows MOVE onto it.
		if (next.getAttribute('role') === 'menuitemradio') setRadio(next);
		e.preventDefault();
		next.focus();
	}

	/* ---------- navigation menu ----------
	   Panels, links, a drawn chevron and a bar-level indicator. The panel,
	   its dismissal and its focus return are the dropdown's - the SAME
	   [popover] element and the same anchorPopover - so this module owns
	   exactly two things the platform does not have: walking the BAR with
	   the arrows while a panel is open, and knowing which section the
	   reader is in.

	   The current trigger is derived from the page, never authored: the
	   runtime reads the section each link points AT and picks the one whose
	   top has passed --head-top - the same rule initScrollSpy uses on the
	   rail, applied to the bar that has no room for a rail. A consumer that
	   hard-codes `aria-current` on a nav link would then be describing a
	   position the page disagrees with. */
	/* The SHARED VIEWPORT model: every trigger of the bar points at ONE
	   panel and names the list it wants inside it (data-cm-navmenu-content
	   -> a <template>). The swap happens in onPopoverToggle - the single
	   task every door runs through - so content lands in the same task the
	   panel opens in, before paint, and there is no second code path that
	   can open the panel empty. aria-expanded is written across the whole
	   bar here rather than left to popTrigger(): both triggers carry the
	   same popovertarget, and popTrigger() can only ever find the first. */
	function navViewportBar(viewport) {
		var bars = document.querySelectorAll('[data-cm-navmenu-viewport]');
		for (var i = 0; i < bars.length; i++) {
			if (bars[i].getAttribute('data-cm-navmenu-viewport') === viewport.id) return bars[i];
		}
		return null;
	}
	function navViewportExpand(viewport, trigger) {
		var bar = navViewportBar(viewport);
		if (!bar) return;
		Array.prototype.forEach.call(navOwn(bar, '.cm-navmenu__trigger'), function (t) {
			t.setAttribute('aria-expanded', t === trigger ? 'true' : 'false');
		});
	}
	function navViewportFill(viewport) {
		var trigger = viewport.__cmNavTrigger || popTrigger(viewport);
		if (!trigger) return;
		viewport.__cmNavTrigger = trigger;
		var srcId = trigger.getAttribute && trigger.getAttribute('data-cm-navmenu-content');
		var src = srcId && document.querySelector(srcId);
		if (src && src.content) {
			while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
			viewport.appendChild(src.content.cloneNode(true));
		}
		navViewportExpand(viewport, trigger);
	}
	function navTriggers(bar) {
		return Array.prototype.filter.call(
			navOwn(bar, '.cm-navmenu__trigger'),
			function (b) { return b.getClientRects().length > 0; });
	}
	// The section a trigger points at. A popover trigger points at nothing
	// (it opens a panel); a plain nav link points at a URL, and `#id` is the
	// only form this bar can track.
	function navTriggerTarget(trigger) {
		var href = trigger.getAttribute && trigger.getAttribute('href');
		// A popover trigger has no href at all; anything that is not a
		// same-page fragment points at another document, which this bar
		// cannot measure and must not pretend to.
		if (!href || href.charAt(0) !== '#' || href.length < 2) return null;
		return document.getElementById(href.slice(1));
	}
	/* The measurement the indicator paints with. Written as custom
	   properties on the indicator, not as a width on the bar: the bar is a
	   flex row whose children are triggers, and absolutely positioning a
	   mark inside it would need every trigger to be its own containing
	   block - which is also what `.cm-navmenu__item { position: relative }`
	   exists for. One element, two numbers. */
	/* The marks/triggers a bar OWNS. A bar may nest inside another bar's
	   panel, and a descendant-wide query then answers with the INNER
	   bar's elements: a bar painting the sub's mark, a walk stepping
	   through the sub's words. Every walk in this file asks that question,
	   so the rule is stated once, here. */
	function navOwn(bar, selector) {
		return Array.prototype.filter.call(
			bar.querySelectorAll(selector),
			function (el) { return el.closest('[data-cm-navmenu]') === bar; });
	}
	function navPaintIndicator(bar, trigger) {
		// Its OWN mark, and the SAME rule navTriggers already applies to
		// rows: measured in WebKit, `querySelector` handed back the SUB
		// bar's mark and the outer bar's mark never painted - the harness
		// caught haveW 100 (the sub's mark) against a wanted 80.
		var ind = navOwn(bar, '.cm-navmenu__indicator')[0];
		if (!ind) return;
		if (!trigger) {
			ind.setAttribute('data-active', 'false');
			ind.style.removeProperty('--cm-navmenu-w');
			ind.style.removeProperty('--cm-navmenu-x');
			ind.style.removeProperty('--cm-navmenu-h');
			ind.style.removeProperty('--cm-navmenu-y');
			return;
		}
		// `data-active` is the FINGERPRINT of the measurement, in the same
		// state-attribute form the rest of the system uses (data-active on
		// the scroller, data-checked on the menu glyph). A mark whose custom
		// properties are right but whose state never lands is a mark nobody
		// can find by state, and a check that only asserts the numbers
		// passes on a bar that paints nothing.
		ind.setAttribute('data-active', 'true');
		var r = trigger.getBoundingClientRect();
		var b = bar.getBoundingClientRect();
		// Rounded: the knobs are read back by the harness and by any
		// consumer that measures, and a fractional transform reports a
		// position the eye cannot see but a comparison can.
		ind.style.setProperty('--cm-navmenu-w', Math.round(r.width) + 'px');
		ind.style.setProperty('--cm-navmenu-x', Math.round(r.left - b.left) + 'px');
		// The SECOND axis, for the bar declared vertical: height and top
		// off the same two rects. One painter, one measurement, both
		// orientations - a second painter for the vertical case is how
		// the two would start disagreeing about where the word is.
		ind.style.setProperty('--cm-navmenu-h', Math.round(r.height) + 'px');
		ind.style.setProperty('--cm-navmenu-y', Math.round(r.top - b.top) + 'px');
	}
	/* The scrollport is returned as an ELEMENT or as NULL, and null means
	   "the page". That distinction matters in WebKit: `document.scrollingElement`
	   can be `body` for a document whose scroller is the root, and binding
	   `scroll` to a body that never scrolls is a listener that never fires -
	   the mark then sits wherever the first pass put it, forever, which
	   looks exactly like a working bar until you scroll. One representation
	   for "the page" removes the guess. */
	function navScrollport(el) {
		var node = el.parentNode;
		while (node && node.nodeType === 1 && node !== document.body) {
			var oy = getComputedStyle(node).overflowY;
			if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	}
	function navScrollTop(root) {
		if (root) return root.scrollTop;
		if (typeof window !== 'undefined') {
			return window.pageYOffset || window.scrollY || 0;
		}
		return (document.scrollingElement || document.documentElement).scrollTop;
	}
	function navViewport(root) {
		if (root) return root.clientHeight;
		if (typeof window !== 'undefined' && window.innerHeight) return window.innerHeight;
		return document.documentElement.clientHeight;
	}
	function navSpy(bar) {
		// Re-entrancy guard. This runs on every scroll event across a
		// 50,000px showcase, and it measures a rect per link: without a
		// latch, one smooth scroll rewrites every trigger's aria-current
		// hundreds of times for the same answer. The latch is cleared
		// whether or not the pass throws, so a measurement error cannot
		// wedge the bar permanently.
		if (bar.__cmNavBusy) return null;
		bar.__cmNavBusy = true;
		try {
			return navSpyRun(bar);
		} finally {
			bar.__cmNavBusy = false;
		}
	}
	function navSpyRun(bar) {
		var triggers = navTriggers(bar);
		if (!triggers.length) return null;
		var links = triggers.filter(function (t) { return navTriggerTarget(t); });
		// A bar of pure panel triggers has no sections to track; leaving the
		// indicator cleared is the honest reading, not a mark on item one.
		if (!links.length) {
			navPaintIndicator(bar, null);
			return null;
		}
		var root = navScrollport(bar);
		var pad = 0;
		var head = document.querySelector('[data-cm-header]');
		if (head) pad = head.getBoundingClientRect().height;
		var line = navScrollTop(root) + pad;
		var current = null;
		links.forEach(function (t) {
			var section = navTriggerTarget(t);
			if (!section) return;
			// An offset added to a client rect is NOT the section's document
			// position: padding, borders and margins above it all contribute.
			// Measured in WebKit on this page, the two differ by 5px, which
			// is enough to select the wrong section at a boundary. The honest
			// position is the rect plus the scroll of the box that moved it.
			var top = section.getBoundingClientRect().top + navScrollTop(root);
			if (top <= line + 16) current = t;
		});
		if (!current) current = links[0];
		// At the very end of the page, the last tracked section wins. A
		// short final section never crosses the scroll line, so without
		// this rule the bar keeps pointing at the section before it for
		// the whole of the page bottom - measured: at max scroll the last
		// section's top sits 250px BELOW the line. The height test is
		// cheap and only true when there are no pixels left to cross.
		if (navScrollTop(root) + navViewport(root) >=
			document.documentElement.scrollHeight - 2) {
			current = links[links.length - 1];
		}
		links.forEach(function (t) {
			if (t === current) t.setAttribute('aria-current', 'true');
			else t.removeAttribute('aria-current');
		});
		navPaintIndicator(bar, current);
		return { bar: bar, fn: function () { navSpy(bar); } };
	}
	/* Every bar, at init: the trigger set and the section offsets are known
	   then. Re-measured on scroll and resize through ONE listener per bar
	   on the element that actually scrolls, so a consumer that re-renders
	   its nav keeps the same handler and a page with no navmenu pays
	   nothing. */
	var navSpies = [];
	function cmInitNavmenu(root) {
		navSpies = [];
		Array.prototype.forEach.call(root.querySelectorAll('[data-cm-navmenu]'), function (bar) {
			var spy = navSpy(bar);
			if (!spy) return;
			var owner = navScrollport(bar);
			var view = (typeof window !== 'undefined') ? window : null;
			var target = (owner || view);
			if (target) target.addEventListener('scroll', spy.fn, { passive: true });
			if (view) view.addEventListener('resize', spy.fn);
			navSpies.push(spy);
		});
	}
	/* ---------- navigation menu: the submenu path ----------
	   Radix documents NavigationMenu.Sub as a part - "use it in place of
	   the root part when nested to create a submenu" - and shadcn links
	   Radix as its navigation-menu variant, so the nested root and its
	   keyboard routing are documented surface, not an extra.

	   The routing is two doors and they are not the same door:
	   - INTO a submenu: the submenu's rows live in a panel that exists
	     only while its parent word is open, so the parent's word opens
	     that panel and the existing bar walk lands on the submenu's own
	     trigger. One walk, one owner - the walk already routes every
	     trigger, nested or not.
	   - OUT of a submenu: ArrowLeft on a submenu trigger closes the
	     submenu and returns focus to the parent word. The reader's way
	     back is the parent, and ArrowLeft is the key that opened it -
	     the same pairing every native menu uses.

	   Placement still routes through anchorPopover: a nested panel is a
	   panel, and "one owner of each mechanism" does not stop at the top
	   level. */
	function navSubPanel(bar, trigger) {
		var id = trigger && trigger.getAttribute &&
			trigger.getAttribute('popovertarget');
		return id ? document.getElementById(id) : null;
	}
	function navSubIn(trigger) {
		// ArrowRight on a nested word steps INTO its panel - the mirror of
		// ArrowLeft out. Only on a nested word: on the outer bar, Right is
		// the rove to the next section and must stay that. Only when the
		// submenu is already open, for the same reason ArrowDown is gated
		// on aria-expanded - with nothing open the key belongs to the bar.
		var nested = trigger.closest('[data-cm-navmenu-sub]');
		if (!nested) return false;
		// `:popover-open` is the PLATFORM's own answer and it is the only
		// gate this needs: a shut submenu fails it whatever its word's
		// aria-expanded says. The aria-expanded check that used to sit here
		// was an equivalent mutant - mutation-proved, both forms leave
		// focus exactly where it was - so it is cut rather than claimed as
		// a kill. One owner of the question.
		var panel = navSubPanel(nested, trigger);
		if (!panel || !panel.matches(':popover-open')) return false;
		var items = menuItems(panel);
		if (!items.length) return false;
		items[0].focus();
		return true;
	}
	function onNavmenuSubKey(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('.cm-navmenu__trigger');
		if (!trigger) return;
		// IN only. OUT is the dropdown's: its menu keydown already closes an
		// open submenu and returns focus to the owning row, which is the same
		// rule and the same owner - a second implementation here would be a
		// second thing to disagree with, and measured in WebKit it changed
		// nothing a reader could see. So the sub root owns the one direction
		// the dropdown's walk cannot reach: ArrowRight steps INTO an open
		// nested panel, because on a nav bar Right is the rove between
		// sections and would otherwise carry focus past the submenu.
		if (e.key === 'ArrowRight' && navSubIn(trigger)) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
	if (typeof document !== 'undefined') {
		document.addEventListener('keydown', onNavmenuSubKey, true);
	}

	// The bar walks with the arrows while a panel is OPEN, and only then:
	// Left/Right moves between WORDS, and lands on the neighbouring word
	// with its panel open - the behaviour that makes this a bar rather than
	// four dropdowns in a row. Down/Up stay the item walk inside the panel.
	// Guarded on document like every other binding in this file: the module
	// is evaluated in a sandbox with no DOM at all.
	function onNavmenuKey(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('.cm-navmenu__trigger');
		if (!trigger) return;
		var bar = trigger.closest('[data-cm-navmenu]');
		if (!bar) return;
		var triggers = navTriggers(bar);
		if (!triggers.length) return;
		var i = triggers.indexOf(trigger);
		var next = null;
		var into = null;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			// Radix's row: ArrowDown on an OPEN trigger moves focus INTO
			// its content. Otherwise the vertical keys rove between
			// triggers - the same set as Left/Right, gated the same way:
			// with no panel open they stay the page's keys, because an
			// idle bar is not a menu bar.
			if (e.key === 'ArrowDown' && trigger.getAttribute('aria-expanded') === 'true') {
				var ownId = trigger.getAttribute('popovertarget');
				var ownPanel = ownId ? document.getElementById(ownId) : null;
				var ownItems = ownPanel ? menuItems(ownPanel) : [];
				into = ownItems[0] || null;
			} else if (e.key === 'ArrowDown') {
				next = triggers[(i + 1) % triggers.length];
			} else {
				next = triggers[(i - 1 + triggers.length) % triggers.length];
			}
		} else if (e.key === 'ArrowRight') next = triggers[(i + 1) % triggers.length];
		else if (e.key === 'ArrowLeft') next = triggers[(i - 1 + triggers.length) % triggers.length];
		else if (e.key === 'Home') next = triggers[0];
		else if (e.key === 'End') next = triggers[triggers.length - 1];
		if (!next) return;
		// `aria-expanded` is the honest test for "a panel is open": the
		// platform does not manage it in either direction, and
		// onPopoverToggle keeps it in step with :popover-open for any
		// trigger carrying aria-haspopup - so this reads the ONE place that
		// already knows. A plain nav link never carries it, and a link with
		// aria-expanded="false" is correctly read as closed.
		// OWN bar, own rows: a nested submenu's trigger can read
		// expanded="true" while this bar's own panels are all closed, and
		// a descendant-wide query would let that steer the idle gate.
		var wasOpen = Array.prototype.some.call(
			bar.querySelectorAll('.cm-navmenu__trigger[aria-expanded="true"]'),
			function (x) { return !x.closest || x.closest('[data-cm-navmenu]') === bar; });
		// A nav is NOT a menu bar. With no panel open the arrows belong to
		// the PAGE - a reader scrolling, a caret in a field, a range input -
		// and walking words on an idle bar would hijack keys this component
		// has no business owning. That is the whole difference between
		// .cm-navmenu and .cm-menubar, and it is why the decision is made
		// before focus moves: an idle bar must be untouched, not walked and
		// then apologised for.
		if (!wasOpen) return;
		// INTO the content is the first door: the gate above already
		// proved a panel is open, and this branch only ever set when
		// THIS trigger is the open one - so the pin ordering holds
		// (gate, then the key is taken) and Radix's row reads straight.
		if (into) {
			e.preventDefault();
			into.focus();
			return;
		}
		e.preventDefault();
		// Focus moves to the next WORD, so a reader walking the bar while a
		// panel is open never loses the bar.
		next.focus();
		var id = next.getAttribute && next.getAttribute('popovertarget');
		if (!id) return;
		// The swap is DEFERRED, and that is not a flourish. `showPopover()`
		// fires `toggle` as a task, and onPopoverToggle is what writes
		// aria-expanded and what anchors the panel - so a synchronous open
		// here leaves the new panel with NO aria-expanded and NO placement
		// until that task runs, which is a WebKit read caught: after Right,
		// `refOpen: false, refExpanded: 'false'` on the word the bar had
		// just walked to. Deferring one task lets the toggle path do both.
		//
		// There is deliberately NO `anchorPopover(menu)` here. It was
		// written as belt-and-braces for a consumer element with no bound
		// handler, and MEASURED against a mutant that removed it, the swap
		// still landed 4px under its trigger with the left edge resolved -
		// the toggle path was sufficient on its own. Unproven redundancy is
		// what the scroll-pin's requestAnimationFrame was, and it was
		// deleted for the same reason: it is untestable, so nothing can tell
		// you the day it starts doing damage.
		// A SHARED VIEWPORT bar swaps CONTENT and keeps the panel: no
		// toggle event will fire, so the fill, the aria move and the
		// re-anchor all happen right here. Synchronously, because an
		// unanchored swap is a panel sitting at the last trigger's
		// coordinates - the one thing this file never does.
		var shared = document.getElementById(id);
		if (shared && shared.hasAttribute('data-cm-viewport')) {
			shared.__cmNavTrigger = next;
			navViewportFill(shared);
			anchorPopover(shared);
			return;
		}
		if (typeof setTimeout !== 'function') return;
		setTimeout(function () {
			var menu = document.getElementById(id);
			if (!menu || typeof menu.showPopover !== 'function') return;
			if (!menu.matches(':popover-open')) menu.showPopover();
		}, 0);
	}
	if (typeof document !== 'undefined') document.addEventListener('keydown', onNavmenuKey);

	/* ---------- navigation menu: delayed hover ----------
	   The bar the pointer can DRIVE: hover for 200ms and the panel opens;
	   inside an open bar the move to the next word is immediate (the delay
	   is for GETTING in, not for walking); leaving the bar gives the
	   reader 300ms of grace and then closes a panel the HOVER opened -
	   a panel opened by click or Enter is sticky and stays, which is the
	   difference between a hover affordance and a light-dismiss one.

	   The gate is read at EVENT time, never bound at init: a media query
	   is state (an OS setting, an emulation, a rotated device), and a
	   gate captured at bind time is a lie the first time that state
	   changes. Touch never enters this module - navFine() is false. */
	var NAV_HOVER_OPEN_MS = 200;
	var NAV_HOVER_LEAVE_MS = 300;
	function navFine() {
		return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
			window.matchMedia('(hover: hover) and (pointer: fine)').matches;
	}
	function navHoverPanel(bar, trigger) {
		var id = trigger.getAttribute && trigger.getAttribute('popovertarget');
		return id ? document.getElementById(id) : null;
	}
	function navHoverOpen(bar, trigger) {
		var menu = navHoverPanel(bar, trigger);
		if (!menu || typeof menu.showPopover !== 'function') return;
		// Guarded: showPopover() on an open popover THROWS, and the
		// 200ms timer can outlive a click that opened the same panel.
		// Ownership is claimed INSIDE the branch: the hover may only
		// close what the hover opened. A panel another door already had
		// open keeps ITS owner - the reader clicked it, so it sticks
		// until they dismiss it, however far the pointer then wanders.
		if (menu.matches(':popover-open')) return;
		if (menu.hasAttribute('data-cm-viewport')) menu.__cmNavTrigger = trigger;
		// Owned by the HOVER: this is the panel the leave-grace may
		// close (onNavmenuClick turns the owner off for a click).
		bar.__cmNavHoverOwned = 1;
		menu.showPopover();
	}
	function navHoverSwap(bar, trigger) {
		var menu = navHoverPanel(bar, trigger);
		if (!menu) return;
		if (menu.hasAttribute('data-cm-viewport')) {
			if (!menu.matches(':popover-open')) { navHoverOpen(bar, trigger); return; }
			// Same panel, next word: fill + re-anchor in place. This is
			// the immediate branch - no second delay inside an open bar.
			menu.__cmNavTrigger = trigger;
			navViewportFill(menu);
			anchorPopover(menu);
			return;
		}
		// Per-trigger model: opening the next panel closes the old one
		// (both are popover=auto, so the platform does the closing).
		if (!menu.matches(':popover-open') && typeof menu.showPopover === 'function') {
			menu.showPopover();
		}
	}
	function navHoverClose(bar) {
		Array.prototype.forEach.call(
			navOwn(bar, '.cm-navmenu__trigger'),
			function (t) {
				var m = navHoverPanel(bar, t);
				if (m && m.matches(':popover-open') && typeof m.hidePopover === 'function') {
					m.hidePopover();
				}
			}
		);
	}
	function onNavmenuOver(e) {
		if (!navFine()) return;
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('.cm-navmenu__trigger');
		if (!trigger) return;
		var bar = trigger.closest('[data-cm-navmenu]');
		if (!bar) return;
		if (e.relatedTarget && typeof e.relatedTarget.closest === 'function' &&
			trigger.contains(e.relatedTarget)) return;
		// The record is verified against the PLATFORM before it is
		// trusted, and this is the second place that matters. The early
		// return below exists to swallow the `pointerover` storm the
		// engine fires while the pointer crosses one trigger to the
		// next - but the record is only cleared by a `pointerout` whose
		// target is ITSELF a trigger, so a pointer that leaves for the
		// sticky header (or leaves the window, or is teleported by a
		// harness) leaves the record naming a word nobody is over. The
		// result is measured in WebKit: hovering that word again does
		// nothing, forever, until a DIFFERENT word is hovered first.
		// `:hover` is the platform's own answer to the only question
		// that matters - is the pointer actually on it right now - so
		// the memory is trusted only while the platform agrees.
		// The engine fires a `pointerover` STORM while the pointer crosses
		// one trigger to the next, so a word already being handled must
		// not re-arm. "Already handled" is a question about what this
		// hover has DONE, not about a record: a timer already running, or
		// this word's panel already open. A record alone is the wrong
		// test - it is only CLEARED by a `pointerout` whose target is
		// itself a trigger, and a pointer that leaves for the sticky
		// header, or leaves the window, or is teleported, never produces
		// one. Measured in WebKit: with the record alone as the test, a
		// word whose panel had been closed by click could never be
		// hovered open again for the rest of the session until some OTHER
		// word was hovered first.
		if (bar.__cmNavHoverLast === trigger &&
			(bar.__cmNavHoverT || navHoverPanel(bar, trigger) &&
				navHoverPanel(bar, trigger).matches(':popover-open'))) return;
		// Entering the bar cancels the leave grace - that is what the
		// grace is for: the 4px between trigger and panel is a gap the
		// pointer has to cross without the panel vanishing under it.
		if (bar.__cmNavLeaveT) {
			clearTimeout(bar.__cmNavLeaveT);
			bar.__cmNavLeaveT = 0;
		}
		// Written, never trusted as a REASON to skip on its own. The guard
		// above already asked the only question that matters - is this
		// hover already ACTED on - and answering it again with the bare
		// record made the word permanently dead to the pointer: a click
		// closes the panel without a pointerout, so the record survives and
		// every later hover returned before the timer could re-arm. The one
		// thing that DOES justify swallowing a hover is a click, because the
		// 200ms timer it arms fires after the click and would steal the
		// panel back.
		// A click only holds the word for as long as its PANEL is open -
		// that is the whole content of "the reader asked for it to stay".
		// Left standing, it is the same permanent-death bug the record
		// caused: the click's own panel closed, so nothing would clear it.
		if (bar.__cmNavHoverLast === trigger &&
			bar.__cmNavClickOwned &&
			navHoverPanel(bar, trigger) &&
			navHoverPanel(bar, trigger).matches(':popover-open')) return;
		bar.__cmNavClickOwned = 0;
		bar.__cmNavHoverLast = trigger;
		if (bar.__cmNavHoverT) {
			clearTimeout(bar.__cmNavHoverT);
			bar.__cmNavHoverT = 0;
		}
		// Own rows only, same reason as the walk's gate: the sub's state
		// never decides whether THIS bar swaps immediately.
		var anyOpen = Array.prototype.some.call(
			bar.querySelectorAll('.cm-navmenu__trigger[aria-expanded="true"]'),
			function (x) { return !x.closest || x.closest('[data-cm-navmenu]') === bar; });
		if (anyOpen) { navHoverSwap(bar, trigger); return; }
		if (typeof setTimeout !== 'function') return;
		bar.__cmNavHoverT = setTimeout(function () {
			bar.__cmNavHoverT = 0;
			// The pointer may have moved on during the delay; the LAST
			// hovered word must still be this one, and still fine. `:hover`
			// rather than the record, because the record is only cleared by
			// a `pointerout` from a trigger - and a pointer that left for
			// the sticky header leaves it stale, which made this timer
			// refuse forever on a word whose panel a reader had closed by
			// click. The platform's own answer to "is the pointer on it"
			// is the one that cannot go stale.
			if (bar.__cmNavHoverLast !== trigger || !navFine() ||
				!trigger.matches(':hover')) {
				bar.__cmNavHoverLast = null;
				return;
			}
			navHoverOpen(bar, trigger);
		}, NAV_HOVER_OPEN_MS);
	}
	function onNavmenuOut(e) {
		if (!navFine()) return;
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('.cm-navmenu__trigger');
		if (!trigger) return;
		var bar = trigger.closest('[data-cm-navmenu]');
		if (!bar) return;
		var to = e.relatedTarget;
		// Still inside this bar's TREE? Containment, not identity: a
		// submenu root nested in this bar's panel is its own
		// [data-cm-navmenu], so closest() would call the walk into the
		// submenu "out of the bar" and start the leave grace on a reader
		// who never left.
		if (to && typeof to.closest === 'function' && to.closest('[data-cm-navmenu]') === bar) return;
		// Out of the bar entirely: a pending open dies now (the pointer
		// did not stay for the 200), and a hover-owned panel gets the
		// grace window before it closes.
		if (bar.__cmNavHoverT) {
			clearTimeout(bar.__cmNavHoverT);
			bar.__cmNavHoverT = 0;
		}
		bar.__cmNavHoverLast = null;
		if (!bar.__cmNavHoverOwned || typeof setTimeout !== 'function') return;
		if (bar.__cmNavLeaveT) clearTimeout(bar.__cmNavLeaveT);
		bar.__cmNavLeaveT = setTimeout(function () {
			bar.__cmNavLeaveT = 0;
			if (!navFine()) return;
			if (bar.__cmNavHoverOwned) navHoverClose(bar);
			bar.__cmNavHoverOwned = 0;
		}, NAV_HOVER_LEAVE_MS);
	}
	/* The click door records WHICH word opened the shared viewport
	   before the platform's default action runs - both triggers carry
	   the same popovertarget, so without this the fill can only ever
	   guess the first. A click also STICKS the panel: hover-owned goes
	   off, because the reader asked for it to stay. */
	function onNavmenuClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('.cm-navmenu__trigger');
		if (!trigger) return;
		var bar = trigger.closest('[data-cm-navmenu]');
		if (!bar) return;
		bar.__cmNavHoverOwned = 0;
		// The click claims the word: the 200ms hover timer armed by the
		// pointer arriving on this trigger fires AFTER the click, so the
		// over-handler has to know a click - not a hover - is what owns
		// this word. Read by onNavmenuOver, which is the only place that
		// decides whether a hover may re-arm.
		bar.__cmNavClickOwned = 1;
		var vid = bar.getAttribute('data-cm-navmenu-viewport');
		if (!vid) return;
		var viewport = document.getElementById(vid);
		if (!viewport) return;
		// Two triggers, ONE popovertarget: the platform's own invocation
		// is a TOGGLE, so while the viewport is open, clicking the next
		// word would close the whole thing - every native shared menu
		// swaps instead. The click listener runs before the activation
		// behavior, so preventDefault() cancels the platform's toggle and
		// this branch does the swap synchronously: fill, aria, re-anchor,
		// same task, same panel. Clicking the CURRENT word still toggles
		// closed - that is the reader asking for it to go.
		if (viewport.matches(':popover-open') && viewport.__cmNavTrigger !== trigger) {
			e.preventDefault();
			viewport.__cmNavTrigger = trigger;
			navViewportFill(viewport);
			anchorPopover(viewport);
			return;
		}
		viewport.__cmNavTrigger = trigger;
	}
	if (typeof document !== 'undefined') {
		document.addEventListener('pointerover', onNavmenuOver);
		document.addEventListener('pointerout', onNavmenuOut);
		document.addEventListener('click', onNavmenuClick);
	}

	/* ---------- context menu ----------
	   One listener at the root, like the toggle handler above: a consumer
	   that re-renders its rows keeps working, because the listener is
	   bound once and finds the menu through the row's data-cm-ctx id. */
	function onContextMenu(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trg = t.closest('[data-cm-ctx]');
		if (!trg) return;
		var id = trg.getAttribute('data-cm-ctx');
		var menu = id && document.getElementById(id);
		if (!menu || typeof menu.showPopover !== 'function' || !menu.matches(POP_SEL)) return;
		// The OS menu is the thing being replaced. Without this the panel
		// opens underneath the browser's own, which nobody can see.
		e.preventDefault();
		// The context-menu KEY (and Shift+F10) fires this event with no
		// pointer at all: 0,0 is a coordinate, not a click. Anchor the panel
		// to the element that was focused instead of to the top-left corner.
		var x = e.clientX, y = e.clientY;
		if (!x && !y && typeof trg.getBoundingClientRect === 'function') {
			var r = trg.getBoundingClientRect();
			x = r.left;
			y = r.bottom + 4;
		}
		menu.__cmCtx = { x: x, y: y };
		// showPopover() on an already-open popover THROWS, so a second
		// right-click closes first: the net effect is a menu that MOVES to
		// the new point instead of a second panel in the top layer.
		if (menu.matches(':popover-open') && typeof menu.hidePopover === 'function') menu.hidePopover();
		menu.showPopover();
	}

	/* ---------- menubar ----------
	   The menu-bar pattern: Left/Right walk the WORDS when nothing is
	   open, and walk to the NEIGHBOURING MENU while one is open. That
	   second half is the whole difference between a menubar and four
	   dropdowns in a row, and it is why the handler looks at the menu you
	   are in before it looks at the trigger you are on. */
	function menubarTriggers(bar) {
		// The WALK list: words that can take focus at all. A disabled word
		// is filtered HERE and not in each door, so every door - arrows,
		// Home/End, the roving stop - inherits one invariant, exactly as
		// selectTab() does for the tabs.
		return Array.prototype.filter.call(
			bar.querySelectorAll('.cm-menubar__trigger'),
			function (b) {
				return b.offsetParent !== null &&
					b.getAttribute('aria-disabled') !== 'true';
			}
		);
	}

	/* ONE tab stop. The bar ENTERS the page as a single stop and the arrows
	   walk the words from there - the .cm-tabs rule, applied to the other
	   component that needs it. Every trigger at tabindex=0 makes Tab walk
	   file/edit/view before it reaches anything else, which is exactly the
	   thing the pattern exists to prevent. The stop is WRITTEN, never read
	   from the author: whoever authored tabindex on three buttons gets one
	   tabbable word and two arrow targets. */
	function menubarRove(bar, cur) {
		Array.prototype.forEach.call(
			bar.querySelectorAll('.cm-menubar__trigger'),
			function (t) {
				t.setAttribute('tabindex', t === cur ? '0' : '-1');
			}
		);
	}
	/* Which word holds the stop: the one focus is already on, else the first
	   one a reader can reach. */
	function menubarTabStop(bar) {
		var list = menubarTriggers(bar);
		if (!list.length) return;
		var focused = document.activeElement;
		menubarRove(bar, list.indexOf(focused) !== -1 ? focused : list[0]);
	}
	function initMenubar(root) {
		(root || document).querySelectorAll('[data-cm-menubar]').forEach(function (bar) {
			if (bar.dataset.cmMenubarBound) return;
			bar.dataset.cmMenubarBound = '1';
			menubarTabStop(bar);
			// Clicking (or Tabbing ONTO) a word moves the stop with it: a
			// stop left behind on the first word means the NEXT Tab leaves
			// the bar at a word the reader is no longer looking at.
			bar.addEventListener('focusin', function (ev) {
				var t = ev.target;
				var trg = t && typeof t.closest === 'function'
					? t.closest('.cm-menubar__trigger') : null;
				if (trg) menubarRove(bar, trg);
			});
			/* The disabled word's two other doors. popovertarget is a
			   PLATFORM attribute with no idea what aria-disabled means, so
			   Enter and Space arrive here as a click and would open the
			   panel - and the mousedown veto is what keeps focus from
			   landing on a word the arrows can never come back to (a
			   native [disabled] button does not take focus either). */
			var vetoDisabled = function (ev) {
				var t = ev.target;
				var d = t && typeof t.closest === 'function'
					? t.closest('.cm-menubar__trigger[aria-disabled="true"]') : null;
				if (!d) return;
				ev.preventDefault();
			};
			bar.addEventListener('mousedown', vetoDisabled);
			bar.addEventListener('click', vetoDisabled);
		});
	}

	function onMenubarKey(e) {
		var bar = e.target && e.target.closest && e.target.closest('[data-cm-menubar]');
		if (!bar) return;
		var trg = e.target.closest('.cm-menubar__trigger');
		// Enter/Space already activate the button (and with it
		// [popovertarget]); ArrowDown is the key the platform does NOT map
		// to "open", and it is the one readers reach for.
		if (trg && e.key === 'ArrowDown') {
			e.preventDefault();
			// A disabled word never opens. aria-disabled is not [disabled]:
			// the row stays in the accessibility tree so a reader knows help
			// is there, which means the attribute - not markup - has to be
			// what refuses. Enter/Space arrive as a click instead, and that
			// door is the veto bound in initMenubar().
			if (trg.getAttribute('aria-disabled') === 'true') return;
			var oid = trg.getAttribute('popovertarget');
			var om = oid && document.getElementById(oid);
			if (om && typeof om.showPopover === 'function' && !om.matches(':popover-open')) om.showPopover();
			return;
		}
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
		var list = menubarTriggers(bar);
		if (!list.length) return;
		var open = e.target.closest('.cm-menubar__menu');
		/* A key inside a NESTED panel belongs to that panel, not to the bar:
		   Left closes the submenu (closeSubmenu() has already handled it
		   and preventDefault'd), and Right walks the submenu's own rows.
		   Without this the bar would step to the next word with a panel
		   still open underneath - one press, two moves, and the submenu it
		   never looked at left hanging in the top layer. */
		var nested = e.target.closest('[popover]');
		if (nested && nested !== open) return;
		var cur = open
			? popTrigger(open) || trg
			: trg;
		var i = list.indexOf(cur);
		if (i === -1) return;
		var next;
		if (e.key === 'Home') next = list[0];
		else if (e.key === 'End') next = list[list.length - 1];
		else next = list[(i + (e.key === 'ArrowLeft' ? -1 : 1) + list.length) % list.length];
		if (!next || next === cur) return;
		e.preventDefault();
		/* The panel walks away and takes its SUBMENUS with it: a nested
		   popover is its own top-layer box, so hiding the host leaves it
		   open over a menu that is gone. Deepest first, the order
		   closeSubmenu() steps out in - and before the host, so focus
		   unwinds to the owner row while that row still has a panel. */
		if (open) {
			Array.prototype.forEach.call(
				open.querySelectorAll('[popover]:popover-open'),
				function (s) { if (typeof s.hidePopover === 'function') s.hidePopover(); }
			);
			if (typeof open.hidePopover === 'function') open.hidePopover();
		}
		// The stop MOVES with the focus, or the next Tab leaves the bar at
		// the word the reader just walked away from.
		menubarRove(bar, next);
		// Focus BEFORE opening: the toggle handler moves focus into the
		// panel, and doing it in the other order would leave the new
		// trigger focused while the panel's own focus steal is still to
		// come.
		next.focus();
		var nid = next.getAttribute('popovertarget');
		var nm = nid && document.getElementById(nid);
		if (open && nm && typeof nm.showPopover === 'function' && !nm.matches(':popover-open')) nm.showPopover();
	}

	/* A manual popover has no light dismiss and no Escape - those are the
	   two halves the platform would otherwise own, so they are HERE. An
	   outside POINTERDOWN is the only "outside" that cannot be the gesture
	   that opened the menu: that one already ended. */
	function onCtxOutside(e) {
		if (!ctxMenu || typeof ctxMenu.hidePopover !== 'function') return;
		if (e.target && typeof ctxMenu.contains === 'function' &&
			ctxMenu.contains(e.target)) return;
		ctxMenu.hidePopover();
	}

	function onCtxEscape(e) {
		if (!ctxMenu || e.key !== 'Escape' || typeof ctxMenu.hidePopover !== 'function') return;
		ctxMenu.hidePopover();
	}

	/* ---------- hover-card clamp ----------
	   The hover card SHOWS itself in pure CSS - hover and focus-within,
	   no runtime - but pure CSS cannot CLAMP. It sits at left: 0 of a
	   wrapper it did not choose, so a wrapper near the right edge hangs
	   an 18rem panel over the edge: measured on the showcase at 320px,
	   document.scrollWidth 328 with the panel's right edge at 328. Menus
	   already clamp in anchorPopover; this is that same rule for a panel
	   that never opens through JS. The clamp runs at init and on resize
	   (scroll is irrelevant - the panel moves WITH its wrapper), and a
	   consumer with no JS keeps the CSS-only behaviour it always had. */
	function cmClampHovercards(root) {
		if (typeof window === 'undefined') return;
		var run = function () {
			Array.prototype.forEach.call(root.querySelectorAll('.cm-hovercard__panel'), function (panel) {
				var wrap = panel.parentElement;
				if (!wrap) return;
				panel.style.left = '';        // back to the CSS position
				panel.style.maxWidth = '';    // ...and to the CSS width
				var gutter = 8;
				var avail = window.innerWidth - gutter * 2;
				if (avail > 0 && panel.offsetWidth > avail) panel.style.maxWidth = avail + 'px';
				var pr = panel.getBoundingClientRect();
				var wr = wrap.getBoundingClientRect();
				var left = pr.left;
				if (pr.right > window.innerWidth - gutter) left -= pr.right - (window.innerWidth - gutter);
				if (left < gutter) left = gutter;
				panel.style.left = (left - wr.left) + 'px';
			});
		};
		run();
		if (!window.__cmHoverResize) {
			window.__cmHoverResize = true;
			window.addEventListener('resize', run);
		}
	}

	/* ---------- calendar ----------
	   OPT-IN via [data-cm-cal]. All date math runs in UTC on purpose: a
	   month view is calendar arithmetic, and local-time Date objects shift
	   a day at the wrong hour in half the world's time zones. The grid is
	   rebuilt wholesale on every change, so every listener is DELEGATED on
	   the container - a per-day listener would die with the first render. */
	function calParse(iso) {
		var p = iso.split('-');
		return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
	}
	function calIso(d) { return d.toISOString().slice(0, 10); }
	function calToday() {
		var n = new Date();
		return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
	}
	function calShift(iso, days) {
		return calIso(new Date(calParse(iso).getTime() + days * 86400000));
	}
	function calMonthShift(iso, months) {
		var d = calParse(iso);
		var target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
		// clamp: Feb 31 is not a day, and a moved focus must not become NaN
		var last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
		return calIso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(),
			Math.min(d.getUTCDate(), last))));
	}
	function calDays(month) {
		var y = +month.slice(0, 4), m = +month.slice(5, 7);
		var first = new Date(Date.UTC(y, m - 1, 1));
		var last = new Date(Date.UTC(y, m, 0));
		var start = new Date(first.getTime() - first.getUTCDay() * 86400000);
		var end = new Date(last.getTime() + (6 - last.getUTCDay()) * 86400000);
		var out = [];
		for (var t = start.getTime(); t <= end.getTime(); t += 86400000) {
			out.push(calIso(new Date(t)));
		}
		return out;
	}
	function calLabel(month) {
		var names = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
			'august', 'september', 'october', 'november', 'december'];
		return names[+month.slice(5, 7) - 1] + ' ' + month.slice(0, 4);
	}
	function calDisabled(cal) {
		return (cal.getAttribute('data-cm-cal-disabled') || '')
			.split(' ').filter(Boolean);
	}
	function calMode(cal) { return cal.getAttribute('data-cm-cal-mode') || 'single'; }

	function calRender(cal, focusIso) {
		var month = cal.getAttribute('data-cm-cal-month');
		if (!month) return;
		var mode = calMode(cal);
		var sel = cal.getAttribute('data-cm-cal-selected');
		var start = cal.getAttribute('data-cm-cal-start');
		var end = cal.getAttribute('data-cm-cal-end');
		var today = calIso(calToday());
		var off = calDisabled(cal);
		var active = focusIso || sel || start || today;
		if (active.slice(0, 7) !== month) active = month + '-01';
		// Cells first, rows second: a </tr> opened inside a running
		// string and stripped again with a regex is a shape nobody can
		// proof-read - seven cells a row, built from an array, is well
		// formed by construction.
		var cells = [];
		calDays(month).forEach(function (day) {
			var attrs = ' data-cm-day="' + day + '"';
			if (day.slice(0, 7) !== month) attrs += ' data-outside';
			if (off.indexOf(day) !== -1) attrs += ' aria-disabled="true"';
			if (day === today) attrs += ' aria-current="date"';
			var isSel = mode === 'single'
				? day === sel
				: (day === start || day === end);
			if (isSel) attrs += ' aria-selected="true"';
			if (start && end && start < day && day < end) attrs += ' data-in-range="true"';
			cells.push('<td role="gridcell"><button type="button" class="cm-cal__day"' +
				attrs + ' tabindex="' + (day === active ? 0 : -1) + '">' +
				+day.slice(8) + '</button></td>');
		});
		var html = '';
		for (var r = 0; r < cells.length; r += 7) {
			html += '<tr role="row">' + cells.slice(r, r + 7).join('') + '</tr>';
		}
		var body = cal.querySelector('tbody');
		body.innerHTML = html;
		var title = cal.querySelector('[data-cm-cal-title]');
		if (title) title.textContent = calLabel(month);
		var grid = cal.querySelector('.cm-cal__grid');
		if (grid) grid.setAttribute('aria-label', calLabel(month));
	}

	function calFocus(cal, iso) {
		var day = cal.querySelector('.cm-cal__day[data-cm-day="' + iso + '"]');
		if (day) day.focus();
	}

	function calPick(cal, iso) {
		var day = cal.querySelector('.cm-cal__day[data-cm-day="' + iso + '"]');
		if (day && day.getAttribute('aria-disabled') === 'true') return;
		if (calMode(cal) === 'single') {
			// clicking the selected day unselects it: a toggle, like every
			// other single-choice control in the system
			if (cal.getAttribute('data-cm-cal-selected') === iso) {
				cal.removeAttribute('data-cm-cal-selected');
			} else {
				cal.setAttribute('data-cm-cal-selected', iso);
			}
		} else {
			var start = cal.getAttribute('data-cm-cal-start');
			var end = cal.getAttribute('data-cm-cal-end');
			if (!start || end) {
				cal.setAttribute('data-cm-cal-start', iso);
				cal.removeAttribute('data-cm-cal-end');
			} else if (iso < start) {
				// clicked BEFORE the start: re-anchor instead of demanding the
				// reader picks left to right
				cal.setAttribute('data-cm-cal-start', iso);
				cal.setAttribute('data-cm-cal-end', start);
			} else {
				cal.setAttribute('data-cm-cal-end', iso);
			}
		}
		calRender(cal, iso);
		// The picked button just got REPLACED by the re-render, so without
		// this the click leaves focus on <body> and the next arrow key
		// lands nowhere. Focus follows the pick.
		calFocus(cal, iso);
		// The composition's glue (a datepicker wraps this calendar): neither
		// half knows about the other. A pick is written into the field's
		// input - read back AFTER the pick, so clicking the selected day
		// again (deselect) clears it - and a completed pick closes the panel.
		// Month navigation never reaches this branch, so paging the calendar
		// keeps the panel open. Range mode is left alone: it has no single
		// selected day to write.
		var dp = cal.closest('.cm-datepicker');
		if (dp && cal.getAttribute('data-cm-cal-mode') !== 'range') {
			var dpInput = dp.querySelector('input');
			if (dpInput) dpInput.value = cal.getAttribute('data-cm-cal-selected') || '';
			var dpPanel = dp.querySelector('[popover]');
			if (dpPanel && dpPanel.matches(':popover-open') &&
				typeof dpPanel.hidePopover === 'function') dpPanel.hidePopover();
		}
	}

	function onCalClick(e) {
		var cal = e.target.closest && e.target.closest('[data-cm-cal]');
		if (!cal) return;
		var nav = e.target.closest('[data-cm-cal-prev], [data-cm-cal-next]');
		if (nav) {
			var delta = nav.hasAttribute('data-cm-cal-next') ? 1 : -1;
			var month = calMonthShift(cal.getAttribute('data-cm-cal-month') + '-01', delta);
			cal.setAttribute('data-cm-cal-month', month.slice(0, 7));
			// focus stays on the nav button: it was not rebuilt
			calRender(cal);
			return;
		}
		var day = e.target.closest('.cm-cal__day');
		if (!day) return;
		calPick(cal, day.getAttribute('data-cm-day'));
	}

	function onCalKey(e) {
		var day = e.target.closest && e.target.closest('.cm-cal__day');
		if (!day) return;
		var cal = day.closest('[data-cm-cal]');
		if (!cal) return;
		var iso = day.getAttribute('data-cm-day');
		var next = null;
		// Enter/Space are deliberately ABSENT: a <button> already clicks on
		// both, and a second implementation is a second chance to disagree.
		if (e.key === 'ArrowLeft') next = calShift(iso, -1);
		else if (e.key === 'ArrowRight') next = calShift(iso, 1);
		else if (e.key === 'ArrowUp') next = calShift(iso, -7);
		else if (e.key === 'ArrowDown') next = calShift(iso, 7);
		else if (e.key === 'PageUp') next = calMonthShift(iso, e.shiftKey ? -12 : -1);
		else if (e.key === 'PageDown') next = calMonthShift(iso, e.shiftKey ? 12 : 1);
		else if (e.key === 'Home') next = calShift(iso, -calParse(iso).getUTCDay());
		else if (e.key === 'End') next = calShift(iso, 6 - calParse(iso).getUTCDay());
		else if (e.key === 'Escape') {
			e.preventDefault();
			if (calMode(cal) === 'single') cal.removeAttribute('data-cm-cal-selected');
			else {
				cal.removeAttribute('data-cm-cal-start');
				cal.removeAttribute('data-cm-cal-end');
			}
			calRender(cal, iso);
			calFocus(cal, iso);
			return;
		} else return;
		e.preventDefault();
		if (next.slice(0, 7) !== cal.getAttribute('data-cm-cal-month')) {
			cal.setAttribute('data-cm-cal-month', next.slice(0, 7));
		}
		calRender(cal, next);
		calFocus(cal, next);
	}

	/* Range preview: with a start chosen and no end, hovering draws the
	   tentative range. It is a decoration on top of state that already
	   exists, so it is set as an ATTRIBUTE and never as a style - and it
	   dies on pointerout, never lingering after the pointer leaves. */
	function calClearPreview(cal) {
		Array.prototype.forEach.call(
			cal.querySelectorAll('.cm-cal__day[data-preview]'),
			function (b) { b.removeAttribute('data-preview'); });
	}
	function onCalOver(e) {
		var cal = e.target.closest && e.target.closest('[data-cm-cal]');
		if (!cal) return;
		var day = e.target.closest && e.target.closest('.cm-cal__day');
		calClearPreview(cal);
		if (!day || calMode(cal) === 'single') return;
		var start = cal.getAttribute('data-cm-cal-start');
		if (!start || cal.getAttribute('data-cm-cal-end')) return;
		var iso = day.getAttribute('data-cm-day');
		var lo = iso < start ? iso : start;
		var hi = iso < start ? start : iso;
		Array.prototype.forEach.call(cal.querySelectorAll('.cm-cal__day'), function (b) {
			var d = b.getAttribute('data-cm-day');
			if (d > lo && d < hi) b.setAttribute('data-preview', 'true');
		});
	}
	function onCalOut(e) {
		var cal = e.target.closest && e.target.closest('[data-cm-cal]');
		if (!cal) return;
		if (e.relatedTarget && cal.contains(e.relatedTarget)) return;
		calClearPreview(cal);
	}

	function cmInitCal(root) {
		Array.prototype.forEach.call(root.querySelectorAll('[data-cm-cal]'), function (cal) {
			if (cal.__cmCal) return;
			cal.__cmCal = true;
			if (!cal.getAttribute('data-cm-cal-month')) {
				cal.setAttribute('data-cm-cal-month', calIso(calToday()).slice(0, 7));
			}
			calRender(cal);
		});
	}

	/* ---------- tree ----------
	   The platform owns expansion; this owns the ARROWS, because a tree
	   without keyboard movement is a tree only a mouse can read. Rows are
	   visible or they are not - a branch inside a closed <details> is
	   display:none, so "visible" needs no bookkeeping of our own. */
	function treeRows(tree) {
		return Array.prototype.filter.call(
			tree.querySelectorAll('.cm-tree__row'),
			function (row) {
				// checkVisibility(), not getClientRects(): WebKit LAYS OUT the
				// children of a closed <details> (every row reported a rect
				// while the hit test said nothing was there), so rects walk
				// the arrow keys into rows nobody can see. elementFromPoint
				// would also work but only for what is on screen, and the
				// tree is taller than the viewport.
				if (row.checkVisibility) return row.checkVisibility();
				return row.getClientRects().length > 0;
			}
		);
	}

	function treeRove(row) {
		var tree = row.closest('[data-cm-tree]');
		if (!tree) return;
		treeRows(tree).forEach(function (r) { r.tabIndex = r === row ? 0 : -1; });
	}

	function treeParentRow(row) {
		var li = row.closest('li');
		var up = li && li.parentElement && li.parentElement.closest('li');
		if (!up) return null;
		return up.querySelector('summary, a');
	}

	function onTreeFocus(e) {
		var row = e.target && e.target.closest && e.target.closest('.cm-tree__row');
		if (row) treeRove(row);
	}

	function onTreeKey(e) {
		var row = e.target && e.target.closest && e.target.closest('.cm-tree__row');
		if (!row) return;
		var tree = row.closest('[data-cm-tree]');
		if (!tree) return;
		var rows = treeRows(tree);
		if (!rows.length) return;
		var i = rows.indexOf(row);
		var next = null;
		var branch = row.tagName === 'SUMMARY' ? row.parentElement : null;
		if (e.key === 'ArrowDown') next = rows[Math.min(i + 1, rows.length - 1)];
		else if (e.key === 'ArrowUp') next = rows[Math.max(i - 1, 0)];
		else if (e.key === 'Home') next = rows[0];
		else if (e.key === 'End') next = rows[rows.length - 1];
		else if (e.key === 'ArrowRight') {
			// closed branch: open it. open branch: step inside. leaf: pass.
			if (branch && !branch.open) {
				// .click() on a summary is how a PERSON opens it: the state
				// still changes through the platform's path, so a consumer
				// listening for the click hears the keyboard too.
				row.click();
				next = rows[rows.indexOf(row) + 1] || row;
			} else if (branch) {
				next = rows[i + 1] || row;
			}
		} else if (e.key === 'ArrowLeft') {
			if (branch && branch.open) row.click();
			else if (branch || (i > 0)) next = treeParentRow(row) || rows[Math.max(i - 1, 0)];
		}
		if (!next || next === row) return;
		e.preventDefault();
		next.focus();
	}

	/* ---------- resizable ----------
	   OPT-IN via [data-cm-resize]. The handle drags with pointer capture
	   (one code path for mouse, pen and touch), reads the axis from the
	   group's own flex-direction so the stacked phone layout needs no
	   second implementation, and reports itself in aria-valuenow as the
	   same percentage the CSS consumes. */
	function cmInitResize(root) {
		Array.prototype.forEach.call(root.querySelectorAll('[data-cm-resize]'), function (g) {
			if (g.__cmResize) return;
			g.__cmResize = true;
			var handle = g.querySelector('.cm-resize__handle');
			if (!handle) return;
			var stacked = function () {
				return getComputedStyle(g).flexDirection.indexOf('column') === 0;
			};
			// The separator is vertical in a row layout and horizontal once the
			// group stacks - a reader that hears the wrong one has been told
			// the wrong axis to push in. Re-read on resize: the media query
			// flips the layout, not the markup.
			var syncAxis = function () {
				handle.setAttribute('aria-orientation', stacked() ? 'horizontal' : 'vertical');
			};
			syncAxis();
			window.addEventListener('resize', syncAxis);
			var clamp = function (pct) {
				var min = parseFloat(handle.getAttribute('aria-valuemin'));
				var max = parseFloat(handle.getAttribute('aria-valuemax'));
				if (isNaN(min)) min = 15;
				if (isNaN(max)) max = 85;
				return Math.min(max, Math.max(min, pct));
			};
			function set(pct) {
				pct = clamp(pct);
				g.style.setProperty('--cm-resize', pct + '%');
				handle.setAttribute('aria-valuenow', String(Math.round(pct)));
			}
			function fromPointer(e) {
				var r = g.getBoundingClientRect();
				var base = stacked() ? r.height : r.width;
				var at = stacked() ? (e.clientY - r.top) : (e.clientX - r.left);
				return base ? (at / base) * 100 : 50;
			}
			handle.addEventListener('pointerdown', function (e) {
				if (e.button && e.button !== 0) return;
				if (typeof handle.setPointerCapture === 'function') handle.setPointerCapture(e.pointerId);
				handle.focus();
			});
			handle.addEventListener('pointermove', function (e) {
				if (typeof handle.hasPointerCapture !== 'function' ||
					!handle.hasPointerCapture(e.pointerId)) return;
				set(fromPointer(e));
			});
			var release = function (e) {
				if (typeof handle.releasePointerCapture !== 'function') return;
				if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) {
					handle.releasePointerCapture(e.pointerId);
				}
			};
			handle.addEventListener('pointerup', release);
			handle.addEventListener('pointercancel', release);
			handle.addEventListener('keydown', function (e) {
				var now = parseFloat(handle.getAttribute('aria-valuenow'));
				if (isNaN(now)) now = 50;
				var box = g.getBoundingClientRect();
				var base = stacked() ? box.height : box.width;
				// A step is a PIXEL, not a percentage: 10% of a 300px panel is
				// a nudge on one screen and a leap on another.
				var step = base ? (16 / base) * 100 : 4;
				var mult = (e.key === 'PageUp' || e.key === 'PageDown') ? 4 : 1;
				var next = null;
				if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = now - step * mult;
				else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = now + step * mult;
				else if (e.key === 'Home') next = parseFloat(handle.getAttribute('aria-valuemin')) || 15;
				else if (e.key === 'End') next = parseFloat(handle.getAttribute('aria-valuemax')) || 85;
				if (next === null) return;
				e.preventDefault();
				set(next);
			});
		});
	}

	/* ---------- toggle group ----------
	   OPT-IN via [data-cm-seg], because a consumer that already owns
	   aria-pressed in its framework state must not have the runtime
	   writing the same attribute behind it.
	     data-cm-seg="single"  one option pressed at a time (pressing the
	                           pressed one keeps it - a radio, not a toggle)
	     data-cm-seg="multi"   each option toggles itself
	   Emits `cm-seg-change` on the group with the pressed labels. */
	function onSegClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var opt = t.closest('.cm-seg__opt');
		if (!opt) return;
		var group = opt.closest('[data-cm-seg]');
		if (!group) return;
		if (opt.disabled || opt.getAttribute('aria-disabled') === 'true') return;
		var mode = group.getAttribute('data-cm-seg');
		var opts = group.querySelectorAll('.cm-seg__opt');
		if (mode === 'multi') {
			opt.setAttribute('aria-pressed', opt.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
		} else if (mode === 'single') {
			Array.prototype.forEach.call(opts, function (o) {
				o.setAttribute('aria-pressed', o === opt ? 'true' : 'false');
			});
		} else return;
		var values = Array.prototype.filter.call(opts, function (o) {
			return o.getAttribute('aria-pressed') === 'true';
		}).map(function (o) {
			return o.getAttribute('data-value') || o.textContent.trim();
		});
		if (typeof CustomEvent === 'function') {
			group.dispatchEvent(new CustomEvent('cm-seg-change', { bubbles: true, detail: { values: values } }));
		}
	}

	/* ---------- search clear ----------
	   Empties the field through the NATIVE value setter, then fires a
	   bubbling `input`. A plain `input.value = ''` is invisible to React,
	   which tracks the value on its own wrapper; going through the
	   prototype setter is what makes a controlled input notice. */
	function onSearchClear(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var btn = t.closest('.cm-search__clear');
		if (!btn) return;
		var box = btn.closest('.cm-search');
		var input = box && box.querySelector('.cm-search__input');
		if (!input) return;
		var proto = Object.getPrototypeOf(input);
		var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
		if (desc && desc.set) desc.set.call(input, '');
		else input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		if (typeof input.focus === 'function') input.focus();
	}

	/* ---------- table sort ----------
	   OPT-IN via `table[data-cm-sort]`: a consumer whose framework already
	   sorts its rows must not have the runtime re-sorting them behind its
	   back, and `button.cm-table__sort` on its own is styling, not consent.

	   aria-sort lives on the TH - that is what the attribute is FOR and it
	   is where the accessibility tree reads it - so the state moves there,
	   the other sorted columns go back to `none`, and the triangle the
	   stylesheet draws reads the same attribute the screen reader announces.
	   The click is delegated: a table whose rows are rewritten every few
	   seconds (the hearth console rewrites its tbody) keeps sorting.

	   Values: `data-cm-sort-value` when the cell carries one, else its
	   text. A cell that reads as a number sorts as one, with or without
	   thousands separators, and `Intl.Collator` with numeric collation
	   handles `2s ago` against `10s ago` - which plain text comparison
	   reverses. */
	var CM_COLLATOR = (typeof Intl !== 'undefined' && Intl.Collator)
		? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
		: null;

	function cmSortValue(cell) {
		if (!cell) return '';
		var raw = cell.getAttribute && cell.getAttribute('data-cm-sort-value');
		if (raw !== null && raw !== undefined) return raw;
		return (cell.textContent || '').trim();
	}

	function cmSortNumber(v) {
		// Only when the WHOLE cell reads as one quantity: '1,024', ' 99 ',
		// '-3', '42%'. 'GET 200' must stay text.
		if (!/^[+-]?[\d\u00a0,\s]+%?$/.test(v)) return null;
		var n = Number(v.replace(/[\u00a0,\s%]/g, ''));
		return isFinite(n) ? n : null;
	}

	function cmSortCompare(a, b) {
		var na = cmSortNumber(a), nb = cmSortNumber(b);
		if (na !== null && nb !== null) return na - nb;
		// Numbers order before text either way, so a mixed column has one
		// defensible order instead of an engine-dependent one.
		if (na !== null) return -1;
		if (nb !== null) return 1;
		if (CM_COLLATOR) return CM_COLLATOR.compare(a, b);
		return a < b ? -1 : a > b ? 1 : 0;
	}

	function cmApplySort(table, th, dir) {
		var idx = th.cellIndex;
		var sign = dir === 'descending' ? -1 : 1;
		// Each tbody sorts INDEPENDENTLY: rows from two sections must never
		// be interleaved, and appending a sorted list across sections would
		// do exactly that.
		Array.prototype.forEach.call(table.tBodies, function (body) {
			var rows = Array.prototype.slice.call(body.rows);
			var keyed = rows.map(function (r) {
				return { row: r, key: cmSortValue(r.cells[idx]) };
			});
			keyed.sort(function (x, y) {
				return sign * cmSortCompare(x.key, y.key);
			});
			// appendChild MOVES a live node, so no row is recreated and
			// per-row listeners and state survive.
			keyed.forEach(function (k) { body.appendChild(k.row); });
		});
		// Only th elements that carry the attribute: a plain header has no
		// sort state to reset.
		Array.prototype.forEach.call(table.querySelectorAll('th[aria-sort]'), function (other) {
			other.setAttribute('aria-sort', other === th ? dir : 'none');
		});
	}

	function onTableSort(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var btn = t.closest('.cm-table__sort');
		if (!btn) return;
		var th = btn.closest('th');
		var table = btn.closest('table[data-cm-sort]');
		if (!th || !table) return;
		var next = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
		cmApplySort(table, th, next);
		// Rows moved, so the page slice and the count line are stale by
		// definition: one refresh keeps every readout on the same truth.
		cmTableRefresh(cmTableScope(btn));
	}

	/* A column the markup DECLARES sorted must already be in that order:
	   the showcase ships Method=descending and Client=ascending, and a
	   declared state that is not true on screen is a lie the glyph keeps
	   repeating. Applying it at load is what makes the initial page honest;
	   an all-`none` table is left in the data's own order. */
	function cmInitSort(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('table[data-cm-sort]'), function (table) {
			/* Once per table: init() runs again on astro:page-load and from
			   the late-markup observer, and re-applying the declared order
			   would undo a reader who has just sorted the table by hand. */
			if (table.dataset && table.dataset.cmSortInit) return;
			if (table.dataset) table.dataset.cmSortInit = '1';
			var th = table.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]');
			if (th) cmApplySort(table, th, th.getAttribute('aria-sort'));
		});
	}

	/* A range input's own value is the truth; the fill is a painting of it.
	   Writing the percentage to `--cm-slider` keeps CSS out of arithmetic and
	   means a consumer who never loads this script still gets a working
	   slider - just an empty rail instead of a filled one, which is the
	   honest degradation rather than a fill that lies about the value. */
	function cmPaintSlider(el) {
		if (!el || !el.getBoundingClientRect) return;
		var min = parseFloat(el.min || '0');
		var max = parseFloat(el.max || '100');
		var span = max - min;
		var pct = span ? ((parseFloat(el.value) - min) / span) * 100 : 0;
		el.style.setProperty('--cm-slider', pct + '%');
		var field = el.closest ? el.closest('.cm-field') : null;
		var out = field && field.querySelector('output');
		if (out) out.textContent = el.value;
	}

	function cmInitSliders(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('input.cm-slider'), cmPaintSlider);
	}

	function onSliderInput(e) {
		var el = e && e.target;
		if (el && el.classList && el.classList.contains('cm-slider')) cmPaintSlider(el);
	}

	/* ---------- OTP ----------
	   Six boxes, one value. The cells are ordinary inputs, so the form
	   still submits and the platform still owns the caret; script only
	   moves focus. Digits type forward, Backspace clears first and
	   retreats only from an empty cell (a fat-fingered backspace should
	   not cost a digit you already got right), and a paste of "481902"
	   fills all six - which is what everyone actually does with a code
	   that arrived by mail. */
	function cmInitOtp(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('.cm-otp'), function (group) {
			if (group.dataset.cmOtpBound) return;
			group.dataset.cmOtpBound = '1';

			function cells() {
				return Array.prototype.slice.call(group.querySelectorAll('.cm-otp__cell'));
			}
			function focusAt(i) {
				var all = cells();
				if (all[i]) all[i].focus();
			}
			function index(el) { return cells().indexOf(el); }

			group.addEventListener('keydown', function (e) {
				var el = e.target;
				if (!el.classList || !el.classList.contains('cm-otp__cell')) return;
				var i = index(el);
				var all = cells();
				if (e.key === 'Backspace') {
					if (el.value) el.value = '';
					else if (i > 0) { all[i - 1].value = ''; focusAt(i - 1); }
					e.preventDefault();
				} else if (e.key === 'ArrowLeft') {
					focusAt(Math.max(0, i - 1));
					e.preventDefault();
				} else if (e.key === 'ArrowRight') {
					focusAt(Math.min(all.length - 1, i + 1));
					e.preventDefault();
				} else if (/^[0-9]$/.test(e.key)) {
					// Replacing the cell instead of appending is why this
					// is keydown: maxlength=1 makes the native insert a
					// no-op on a cell that is already filled. And because
					// preventDefault() below stops the native insert, no
					// input event fires either - so the advance has to
					// happen right here, not in the input handler.
					el.value = e.key;
					focusAt(i + 1);
					e.preventDefault();
				}
			});

			group.addEventListener('input', function (e) {
				var el = e.target;
				if (!el.classList || !el.classList.contains('cm-otp__cell')) return;
				el.value = el.value.replace(/[^0-9]/g, '').slice(0, 1);
				if (el.value) focusAt(index(el) + 1);
			});

			group.addEventListener('paste', function (e) {
				var data = (e.clipboardData || window.clipboardData);
				var digits = ((data && data.getData('text')) || '').replace(/[^0-9]/g, '').split('');
				if (!digits.length) return;
				e.preventDefault();
				var all = cells();
				all.forEach(function (cell, n) { cell.value = digits[n] || ''; });
				focusAt(Math.min(digits.length, all.length - 1));
			});
		});
	}

	/* ---------- command palette ----------
	   Everything structural is the <dialog> already: open, focus trap,
	   Escape, the top layer and an inert page behind it. Script owns the
	   two things CSS cannot - which rows match the query, and which row
	   Enter would take - and nothing else. The active row is tracked in
	   .is-active and mirrored to aria-activedescendant, because a
	   highlight nobody can query is not an accessibility tree. */
	function cmInitCommand(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('.cm-command'), function (dlg) {
			if (dlg.dataset.cmCmdBound) return;
			dlg.dataset.cmCmdBound = '1';
			var input = dlg.querySelector('.cm-command__input');
			var empty = dlg.querySelector('.cm-command__empty');
			if (!input) return;

			function items() {
				return Array.prototype.slice.call(dlg.querySelectorAll('.cm-command__item'));
			}
			function visible() {
				return items().filter(function (it) { return !it.hidden; });
			}
			function setActive(el) {
				items().forEach(function (it) {
					var on = it === el;
					it.classList.toggle('is-active', on);
					it.setAttribute('aria-selected', on ? 'true' : 'false');
				});
				if (el && el.id) {
					input.setAttribute('aria-activedescendant', el.id);
					el.scrollIntoView({ block: 'nearest' });
				} else {
					input.removeAttribute('aria-activedescendant');
				}
			}
			function filter() {
				var q = input.value.trim().toLowerCase();
				var shown = 0;
				items().forEach(function (it) {
					var hit = !q || it.textContent.toLowerCase().indexOf(q) !== -1;
					it.hidden = !hit;
					if (hit) shown++;
				});
				Array.prototype.forEach.call(dlg.querySelectorAll('.cm-command__group'), function (g) {
					g.hidden = !g.querySelector('.cm-command__item:not([hidden])');
				});
				if (empty) empty.hidden = shown > 0;
				var vis = visible();
				setActive(vis.length ? vis[0] : null);
			}

			input.addEventListener('input', filter);

			dlg.addEventListener('keydown', function (e) {
				if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
				// Enter inside a text input submits - here it means "run
				// the highlighted row", so the platform's default has to
				// go even when the list is empty.
				e.preventDefault();
				var vis = visible();
				if (!vis.length) return;
				if (e.key === 'Enter') {
					var cur = dlg.querySelector('.cm-command__item.is-active');
					if (cur) cur.click();
					return;
				}
				var i = vis.indexOf(dlg.querySelector('.cm-command__item.is-active'));
				var step = e.key === 'ArrowDown' ? 1 : -1;
				setActive(vis[(i + step + vis.length) % vis.length]);
			});

			// Selecting a row runs it and dismisses the palette; that is
			// the whole point of the component, and the dialog's own
			// close() is what restores focus to the trigger.
			items().forEach(function (it) {
				it.addEventListener('click', function () {
					if (dlg.open && typeof dlg.close === 'function') dlg.close();
				});
			});

			// Reopening starts clean: a palette that remembers last
			// night's query opens on a stale, half-empty list.
			dlg.addEventListener('close', function () {
				input.value = '';
				filter();
			});

			filter();
		});
	}

		/* ---------- carousel ----------
	   The track is the source of truth: it is already scrolled by the
	   finger, so the script only READS its offset to light the right page
	   mark, and only WRITES it when a button is pressed. Two facts here
	   are why this survives a resize: the active slide is found by
	   nearest offsetLeft (not `scrollLeft / width`, which the gap breaks),
	   and the write is `scrollTo` with the slide's own offsetLeft, so it
	   lands where snap would have landed it anyway. */
	function cmInitCarousels(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('.cm-carousel'), function (car) {
			if (car.dataset.cmCarouselBound) return;
			car.dataset.cmCarouselBound = '1';
			var track = car.querySelector('.cm-carousel__track');
			var slides = track ? Array.prototype.slice.call(track.children) : [];
			var pages = Array.prototype.slice.call(car.querySelectorAll('.cm-carousel__page'));
			var prev = car.querySelector('[data-cm-carousel-prev]');
			var next = car.querySelector('[data-cm-carousel-next]');
			if (!track || !slides.length) return;

			/* Every coordinate here is the track's, not the page's.
			   `slide.offsetLeft` is measured against the nearest POSITIONED
			   ancestor, which is not the track: at 402px it ran 40px larger
			   than the slide's real scroll offset. It still "worked" because
			   scroll-snap pulled the wrong landing back onto the right one,
			   so the error stayed invisible until a test compared the two.
			   Measuring from the rects is right with or without snap. */
			function slideOffset(i) {
				var t = track.getBoundingClientRect();
				var r = slides[i].getBoundingClientRect();
				return track.scrollLeft + (r.left - t.left);
			}
			function activeIndex() {
				var x = track.scrollLeft, best = 0, dist = Infinity;
				slides.forEach(function (s, i) {
					var d = Math.abs(slideOffset(i) - x);
					if (d < dist) { dist = d; best = i; }
				});
				return best;
			}
			function paint() {
				var i = activeIndex();
				pages.forEach(function (p, n) {
					if (n === i) p.setAttribute('aria-current', 'true');
					else p.removeAttribute('aria-current');
				});
				if (prev) prev.disabled = i <= 0;
				if (next) next.disabled = i >= slides.length - 1;
			}
			function go(i) {
				var s = slides[Math.max(0, Math.min(slides.length - 1, i))];
				if (!s) return;
				var reduce = window.matchMedia &&
					window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				track.scrollTo({ left: slideOffset(i), behavior: reduce ? 'auto' : 'smooth' });
			}

			// A plain listener on a scroll that fires in bursts: paint on the
			// next frame instead of per event, or a fast swipe does layout
			// work on every tick of a gesture that is already over.
			var raf = 0;
			track.addEventListener('scroll', function () {
				if (raf) return;
				raf = window.requestAnimationFrame(function () { raf = 0; paint(); });
			}, { passive: true });
			// The UA does not scroll a focused scroll container from the
			// arrow keys in every engine we care about (measured: WebKit
			// ignored ArrowRight on the focused track), so the track owns
			// its own keys. Without this the slides are reachable by Tab
			// and then stuck.
			track.addEventListener('keydown', function (e) {
				var i = activeIndex();
				if (e.key === 'ArrowRight') { go(i + 1); e.preventDefault(); }
				else if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); }
				else if (e.key === 'Home') { go(0); e.preventDefault(); }
				else if (e.key === 'End') { go(slides.length - 1); e.preventDefault(); }
			});
			if (prev) prev.addEventListener('click', function () { go(activeIndex() - 1); });
			if (next) next.addEventListener('click', function () { go(activeIndex() + 1); });
			pages.forEach(function (p, n) { p.addEventListener('click', function () { go(n); }); });
			window.addEventListener('resize', paint, { passive: true });
			paint();
		});
	}

	/* ---------- stepper ----------
	   A click rewrites three states at once - the step you land on is
	   current, everything before it is done, everything after is neither -
	   because a stepper where "done" and "current" can disagree is a
	   stepper that lies about where the user is. `aria-current="step"`
	   moves with the class; a screen reader must not be told one thing and
	   shown another. */
	function cmInitSteppers(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('[data-cm-stepper]'), function (list) {
			if (list.dataset.cmStepperBound) return;
			list.dataset.cmStepperBound = '1';
			var steps = Array.prototype.slice.call(list.querySelectorAll('.cm-step'));
			list.addEventListener('click', function (e) {
				var btn = steps.filter(function (s) { return s === e.target || s.contains(e.target); })[0];
				if (!btn) return;
				var i = steps.indexOf(btn);
				steps.forEach(function (s, n) {
					s.classList.toggle('is-current', n === i);
					s.classList.toggle('is-done', n < i);
					if (n === i) s.setAttribute('aria-current', 'step');
					else s.removeAttribute('aria-current');
				});
			});
		});
	}

	/* ---------- combobox ----------
	   An input and a listbox that agree about which row is live. The
	   platform gives us none of this, so it is all here: which rows
	   match the query, which row Enter would take, and closing when the
	   click lands outside. Selection is opt-out - choosing a row writes
	   the input's value and fires `cm:change` on the wrapper, and a
	   consumer that owns its own value can ignore both and listen for
	   nothing. */
	function cmInitComboboxes(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('.cm-combobox'), function (wrap) {
			if (wrap.dataset.cmCbBound) return;
			wrap.dataset.cmCbBound = '1';
			var input = wrap.querySelector('.cm-combobox__input');
			var list = wrap.querySelector('.cm-combobox__list');
			if (!input || !list) return;
			var options = function () {
				return Array.prototype.slice.call(list.querySelectorAll('[role="option"]'));
			};
			var visible = function () {
				return options().filter(function (o) { return !o.hidden; });
			};
			function setOpen(v) {
				list.hidden = !v;
				input.setAttribute('aria-expanded', v ? 'true' : 'false');
				if (!v) setActive(null);
			}
			function setActive(el) {
				options().forEach(function (o) {
					var on = o === el;
					o.classList.toggle('is-active', on);
					o.setAttribute('aria-selected', on ? 'true' : 'false');
				});
				if (el && el.id) input.setAttribute('aria-activedescendant', el.id);
				else input.removeAttribute('aria-activedescendant');
			}
			function filter() {
				var q = input.value.trim().toLowerCase();
				var shown = 0;
				options().forEach(function (o) {
					var hit = !q || o.textContent.toLowerCase().indexOf(q) !== -1;
					o.hidden = !hit;
					if (hit) shown++;
				});
				if (!shown) { setOpen(false); return; }
				setOpen(true);
				setActive(visible()[0]);
			}
			/* The option carries a label AND a hint (`.cm-combobox__hint`).
			   textContent of the whole row put "deno 2secure" in the field -
			   the value is the label, not the row. */
			function optionLabel(o) {
				var label = o.querySelector('span:not(.cm-combobox__hint)');
				return (label ? label.textContent : o.textContent).trim();
			}
			// Focus reopens the list on purpose (clicking the field brings
			// the filtered rows back), but choosing a row focuses the field
			// TOO - without this flag that focus reopens what the choice
			// just closed.
			var choosing = false;
			function choose(o) {
				choosing = true;
				input.value = optionLabel(o);
				wrap.dataset.value = o.getAttribute('data-value') || '';
				setOpen(false);
				input.focus();
				choosing = false;
				if (typeof CustomEvent === 'function') {
					wrap.dispatchEvent(new CustomEvent('cm:change', { bubbles: true, detail: { value: wrap.dataset.value } }));
				}
			}
			input.addEventListener('input', filter);
			input.addEventListener('focus', function () { if (!choosing) filter(); });
			// WebKit does not blur a focused field when you click elsewhere on
			// the page, so a click that re-focuses nothing fires no event and
			// the list stays shut. Clicking the field is the request.
			input.addEventListener('click', function () { if (!choosing && list.hidden) filter(); });
			wrap.addEventListener('keydown', function (e) {
				var vis = visible();
				if (e.key === 'Escape') { setOpen(false); return; }
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					if (list.hidden) filter();
					vis = visible();
					if (!vis.length) return;
					var cur = vis.filter(function (o) { return o.classList.contains('is-active'); })[0];
					var i = vis.indexOf(cur);
					var next = e.key === 'ArrowDown'
						? vis[(i + 1) % vis.length]
						: vis[(i - 1 + vis.length) % vis.length];
					setActive(next);
					e.preventDefault();
					return;
				}
				if (e.key === 'Enter') {
					if (list.hidden) return;
					var active = visible().filter(function (o) { return o.classList.contains('is-active'); })[0];
					if (active) { choose(active); e.preventDefault(); }
				}
			});
			wrap.addEventListener('click', function (e) {
				var t = e.target;
				if (!t || typeof t.closest !== 'function') return;
				var o = t.closest('[role="option"]');
				if (o && wrap.contains(o)) choose(o);
			});
			// Clicking anywhere else closes it - the listbox's own half of
			// the contract, and the part every hand-rolled version forgets.
			document.addEventListener('click', function (e) {
				if (!wrap.contains(e.target)) setOpen(false);
			});
			setOpen(false);
		});
	}

	/* ---------- drawer: the bottom sheet you can PULL DOWN ----------
	   Everything structural belongs to the sheet below it - showModal()
	   gives the trap, Escape, the top layer and focus restore, so this
	   adds exactly two things: a handle, and a gesture.
	   The drag transforms the dialog against the pointer's own Y (no
	   easing: it must sit exactly under the finger, and the house
	   reduced-motion guard would flatten an eased one anyway). The
	   RELEASE is the decision: past the threshold the dialog closes for
	   real, below it the sheet snaps home - a half-pull is a no-op, not
	   a stuck drawer. Only the HANDLE drags; a gesture that began in the
	   body would fight the content's own scrolling, so the body gets no
	   pointer handlers at all. */
	function cmInitDrawer(root) {
		(root || document).querySelectorAll('.cm-drawer').forEach(function (dlg) {
			if (dlg.dataset.cmDragBound) return;
			dlg.dataset.cmDragBound = '1';
			var handle = dlg.querySelector('.cm-drawer__handle');
			if (!handle) return;
			var startY = 0;
			var dy = 0;
			var dragging = false;
			handle.addEventListener('pointerdown', function (e) {
				if (typeof dlg.showModal !== 'function' || !dlg.open) return;
				dragging = true;
				startY = e.clientY;
				dy = 0;
				dlg.classList.add('cm-drawer--dragging');
				try { handle.setPointerCapture(e.pointerId); } catch (err) {}
			});
			handle.addEventListener('pointermove', function (e) {
				if (!dragging) return;
				dy = Math.max(0, e.clientY - startY); /* never pull UP */
				dlg.style.transform = 'translateY(' + dy + 'px)';
			});
			var release = function () {
				if (!dragging) return;
				dragging = false;
				dlg.classList.remove('cm-drawer--dragging');
				dlg.style.transform = '';
				var tall = dlg.getBoundingClientRect().height;
				if (dy >= 96 || dy >= tall * 0.4) {
					if (typeof dlg.close === 'function') dlg.close();
				}
			};
			handle.addEventListener('pointerup', release);
			handle.addEventListener('pointercancel', release);
			/* Escape (or a programmatic close) mid-drag would otherwise
			   leave an inline transform behind for the next open */
			dlg.addEventListener('close', function () {
				dragging = false;
				dlg.classList.remove('cm-drawer--dragging');
				dlg.style.transform = '';
			});
		});
	}

	/* ---------- field: the wiring the markup should not repeat ----------
	   label->control, help->control and error->control are relations a
	   screen reader can only act on when they are IDS in the DOM, and
	   hand-writing them is exactly the copy-paste a fourth field gets
	   wrong. Ids are generated only when MISSING - a consumer's own ids
	   win - and aria-describedby MERGES with whatever is already there
	   instead of overwriting it, because the same control may already
	   point at a hint of its own. */
	function cmInitFields(root) {
		var n = 0;
		(root || document).querySelectorAll('.cm-field').forEach(function (field) {
			var control = field.querySelector(
				'.cm-field__control > input, .cm-field__control > textarea, .cm-field__control > select'
			) || field.querySelector('input, textarea, select');
			var label = field.querySelector('label');
			if (!control || !label) return;
			if (!control.id) control.id = 'cm-field-' + (++n);
			if (!label.htmlFor) label.htmlFor = control.id;
			var generated = [];
			[['.cm-field__help', '-help'], ['.cm-field__error', '-error']].forEach(function (pair) {
				var node = field.querySelector(pair[0]);
				if (!node) return;
				if (!node.id) node.id = control.id + pair[1];
				generated.push(node.id);
			});
			if (generated.length) {
				var keep = (control.getAttribute('aria-describedby') || '')
					.split(/\s+/)
					.filter(function (id) { return id && generated.indexOf(id) === -1; });
				control.setAttribute('aria-describedby', keep.concat(generated).join(' '));
			}
			if (field.querySelector('.cm-field__req') && !control.hasAttribute('required'))
				control.setAttribute('aria-required', 'true');
		});
	}

	/* ---------- datepicker: the field is a tap target too ----------
	   `popovertarget` is declarative and the CARET honors it, but a UA only
	   INVOKES a popover from an element with an activation behavior -
	   MEASURED in WebKit: clicking the readonly input with `popovertarget`
	   set opens nothing while the caret button opens the same panel. The
	   field is the bigger target, so it gets the same open on click. The
	   guard keeps the binding a no-op if an engine ever does honor the
	   attribute there, and `click` fires AFTER the pointerdown a light
	   dismiss judges, so the opening press cannot dismiss what it opened. */
	function cmInitDatepickers(root) {
		var scope = root && root.querySelectorAll ? root : document;
		Array.prototype.forEach.call(scope.querySelectorAll('.cm-datepicker'), function (wrap) {
			if (wrap.dataset.cmDpBound) return;
			wrap.dataset.cmDpBound = '1';
			var input = wrap.querySelector('input[popovertarget]');
			var panel = wrap.querySelector('[popover]');
			if (!input || !panel) return;
			input.addEventListener('click', function () {
				if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open'))
					panel.showPopover();
			});
		});
	}

	/* ---------- shortcuts ----------
	   The palette's trigger draws ⌘K; a glyph with no handler is a
	   promise the page cannot keep (the parity audit grepped for
	   metaKey and got NOTHING back). Toggle semantics: closed ->
	   showModal() runs exactly the path the button runs (focus trap,
	   inert page, top layer, and the palette's own "reopening starts
	   clean" reset on `close`); open -> the native close. ctrlKey
	   covers every non-mac keyboard, because the world has Windows. */
	function cmInitShortcuts() {
		if (typeof document === 'undefined' || !document.addEventListener) return;
		if (document.__cmShortcuts) return;
		document.__cmShortcuts = '1';
		document.addEventListener('keydown', function (e) {
			if (!e || !(e.metaKey || e.ctrlKey)) return;
			if ((e.key || '').toLowerCase() !== 'k') return;
			var dlg = document.querySelector('.cm-command');
			if (!dlg) return;
			/* the browser's own Ctrl+K (search bar / quick find) is
			   not part of this promise. */
			e.preventDefault();
			if (dlg.open && typeof dlg.close === 'function') dlg.close();
			else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
			else if (typeof dlg.show === 'function' && !dlg.open) dlg.show();
		});
	}


	/* ---------- validating forms: the browser IS the validator ----------
	   shadcn's forms guide documents behaviours, not a component:
	   data-invalid on the wrapper, aria-invalid on the control, the
	   message beside the field, focus on the first offender. Vanilla
	   equivalent: checkValidity() over the constraints the author
	   already wrote - the platform ships the email format, so nothing
	   here re-implements a regex. The message lands in the
	   .cm-field__error span that already exists (cmInitFields has
	   already merged its id into aria-describedby, so unfocusing a
	   broken field announces exactly what is wrong). Default mode is
	   submit; blur/input map to their onBlur/onChange. */
	/* Questionnaire - the one-question-at-a-time wizard. Bound by
	   [data-cm-quiz]; native radios/checkboxes keep their keyboard, the
	   freeform input rides alongside, and submit validates every required
	   item (jumping to the first offender) before toasting and resetting
	   the WHOLE form - answers included. Shortcuts: a data-shortcut letter
	   or number on a choice selects it while the quiz has focus. */
	/* Message Scroller - the transcript frame. Bound by [data-cm-scroller];
	   mirrors scroll state to data-scrollable / data-following /
	   data-current-anchor exactly where their docs say styling should read
	   it, drives inert buttons, exposes the commands as frame.__scroller
	   (scrollToMessage / scrollToStart / scrollToEnd), pins the live edge
	   while following, and tracks visible rows only when the outline asks
	   (data-track-visible). */
	function cmInitScroller(root) {
		var frames = root.querySelectorAll('[data-cm-scroller]');
		for (var i = 0; i < frames.length; i++) {
			(function (frame) {
				if (frame.__cmScrollerBound) return;
				frame.__cmScrollerBound = true;
				var vp = frame.querySelector('.cm-scroller__viewport');
				if (!vp) return;
				var content = frame.querySelector('.cm-scroller__content');
				var btnStart = frame.querySelector('[data-scroller-start]');
				var btnEnd = frame.querySelector('[data-scroller-end]');
				var pill = frame.querySelector('[data-scroller-pill]');
				var status = frame.querySelector('[data-scroller-status]');

				function atStart() { return vp.scrollTop <= 1; }
				function atEnd() {
					return vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 1;
				}
				function markAnchor() {
					if (!content) return;
					var anchors = content.querySelectorAll('[data-scroll-anchor]');
					var vr = vp.getBoundingClientRect();
					var current = anchors.length
						? anchors[0].getAttribute('data-message-id') : '';
					for (var a = 0; a < anchors.length; a++) {
						if (anchors[a].getBoundingClientRect().top <= vr.top + 32) {
							current = anchors[a].getAttribute('data-message-id');
						}
					}
					frame.setAttribute('data-current-anchor', current);
					var marks = frame.querySelectorAll('[data-jump-to]');
					for (var m = 0; m < marks.length; m++) {
						if (marks[m].getAttribute('data-jump-to') === current) {
							marks[m].setAttribute('aria-current', 'true');
						} else {
							marks[m].removeAttribute('aria-current');
						}
					}
				}
				function paint() {
					var s = !atStart(), e = !atEnd();
					var bits = [];
					if (s) bits.push('start');
					if (e) bits.push('end');
					vp.setAttribute('data-scrollable', bits.join(' '));
					if (btnStart) {
						btnStart.inert = !s;
						btnStart.tabIndex = s ? 0 : -1;
						btnStart.setAttribute('data-active', s ? 'true' : 'false');
					}
					if (btnEnd) {
						btnEnd.inert = !e;
						btnEnd.tabIndex = e ? 0 : -1;
						btnEnd.setAttribute('data-active', e ? 'true' : 'false');
					}
					if (pill) pill.hidden = !e;  // pill = jump to latest: shows while NOT at the end
					frame.setAttribute('data-following', e ? 'false' : 'true');
					if (status) {
						status.textContent = s && e ? 'both ways scrollable'
							: s ? 'up only - at the latest message'
							: e ? 'down only - at the first message'
							: 'all messages in view';
					}
					markAnchor();
				}
				function scrollToStart(smooth) {
					vp.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
				}
				function scrollToEnd(smooth) {
					vp.scrollTo({ top: vp.scrollHeight,
						behavior: smooth ? 'smooth' : 'auto' });
				}
				function scrollToMessage(id) {
					var row = content
						? content.querySelector('[data-message-id="' + id + '"]')
						: null;
					if (!row) return false;
					// park near the top with a peek of the previous turn
					var vr = vp.getBoundingClientRect();
					var rr = row.getBoundingClientRect();
					vp.scrollTop += rr.top - vr.top - 24;
					return true;
				}
				frame.__scroller = {
					scrollToMessage: scrollToMessage,
					scrollToStart: function () { scrollToStart(true); },
					scrollToEnd: function () { scrollToEnd(true); },
					atStart: atStart,
					atEnd: atEnd
				};
				vp.addEventListener('scroll', paint, { passive: true });
				if (btnStart) btnStart.addEventListener('click', function () {
					scrollToStart(true);
				});
				if (btnEnd) btnEnd.addEventListener('click', function () {
					scrollToEnd(true);
				});
				if (pill) pill.addEventListener('click', function () {
					scrollToEnd(true);
				});
				frame.addEventListener('click', function (e) {
					var jump = e.target.closest ? e.target.closest('[data-jump-to]') : null;
					if (jump && frame.contains(jump)) {
						e.preventDefault();
						scrollToMessage(jump.getAttribute('data-jump-to'));
					}
				});
				// the live edge: growing content pins only while following
				if (content && 'ResizeObserver' in window) {
					new ResizeObserver(function () {
						if (frame.getAttribute('data-following') === 'true') {
							vp.scrollTop = vp.scrollHeight;
							paint();
						}
					}).observe(content);
				}
				// visible rows, only while the outline subscribes
				if (frame.hasAttribute('data-track-visible')
						&& 'IntersectionObserver' in window && content) {
					var seen = [];
					var io = new IntersectionObserver(function (entries) {
						for (var k = 0; k < entries.length; k++) {
							var id = entries[k].target.getAttribute('data-message-id');
							var at = seen.indexOf(id);
							if (entries[k].isIntersecting && at < 0) seen.push(id);
							if (!entries[k].isIntersecting && at >= 0) seen.splice(at, 1);
						}
						var links = frame.querySelectorAll('[data-jump-to]');
						for (var L = 0; L < links.length; L++) {
							if (seen.indexOf(links[L].getAttribute('data-jump-to')) >= 0) {
								links[L].setAttribute('data-visible', 'true');
							} else {
								links[L].removeAttribute('data-visible');
							}
						}
					}, { root: vp });
					var rows = content.querySelectorAll('[data-message-id]');
					for (var r = 0; r < rows.length; r++) io.observe(rows[r]);
				}
				// no flash on load: open at the live edge when asked
				if (frame.hasAttribute('data-start-at-end')) {
					vp.scrollTop = vp.scrollHeight;
					// content-visibility rows keep resizing their intrinsic size
					// for a few frames after bind, which would strand the
					// position mid-log. Re-pin every frame for a bounded
					// window; any scroll we did not ask for is the reader,
					// and the loop stands down for them.
					var pinFrames = 0;
					var asked = vp.scrollTop;
					var readerMoved = false;
					var pinEdge = function () {
						if (readerMoved) return;
						vp.scrollTop = vp.scrollHeight;
						asked = vp.scrollTop;
						if (++pinFrames < 120) requestAnimationFrame(pinEdge);
					};
					vp.addEventListener('scroll', function () {
						if (Math.abs(vp.scrollTop - asked) > 2) readerMoved = true;
					}, { passive: true });
					requestAnimationFrame(pinEdge);
				}
				paint();
			})(frames[i]);
		}
	}

	function cmInitQuiz(root) {
		var forms = root.querySelectorAll('[data-cm-quiz]');
		for (var q = 0; q < forms.length; q++) {
			(function (form) {
				if (form.__cmQuiz) return;
				form.__cmQuiz = true;
				var items = Array.prototype.slice.call(
					form.querySelectorAll('.cm-quiz__item')
				);
				if (!items.length) return;
				var progress = form.querySelector('.cm-quiz__progress');
				var bar = form.querySelector('.cm-quiz__bar');
				var label = form.querySelector('.cm-quiz__label');
				var prev = form.querySelector('[data-quiz-prev]');
				var next = form.querySelector('[data-quiz-next]');
				var skip = form.querySelector('[data-quiz-skip]');
				var submit = form.querySelector('[data-quiz-submit]');
				var active = 0;

				function required(item) { return item.hasAttribute('data-required'); }
				function controls(item) {
					return Array.prototype.slice.call(
						item.querySelectorAll(
							'input[type=radio], input[type=checkbox], .cm-quiz__input'
						)
					);
				}
				function answered(item) {
					var boxes = item.querySelectorAll(
						'input[type=radio], input[type=checkbox]'
					);
					for (var i = 0; i < boxes.length; i++) {
						if (boxes[i].checked) return true;
					}
					var typed = item.querySelector('.cm-quiz__input');
					return !!typed && typed.value.trim() !== '';
				}
				function mark(item, bad) {
					var err = item.querySelector('.cm-quiz__error');
					if (err) err.hidden = !bad;
					var cs = controls(item);
					for (var i = 0; i < cs.length; i++) {
						if (bad) cs[i].setAttribute('aria-invalid', 'true');
						else cs[i].removeAttribute('aria-invalid');
					}
					if (bad) item.setAttribute('data-invalid', '');
					else item.removeAttribute('data-invalid');
				}
				function render(focus) {
					for (var i = 0; i < items.length; i++) {
						items[i].hidden = i !== active;
					}
					var total = items.length;
					var cur = active + 1;
					if (progress) {
						progress.setAttribute('aria-valuenow', String(cur));
						progress.setAttribute('aria-valuemin', '1');
						progress.setAttribute('aria-valuemax', String(total));
					}
					if (label) label.textContent = cur + ' / ' + total;
					if (bar) bar.style.width = Math.round((cur / total) * 100) + '%';
					if (prev) prev.hidden = active === 0;
					if (next) next.hidden = active === total - 1;
					if (submit) submit.hidden = active !== total - 1;
					if (skip) skip.hidden = required(items[active]);
					if (focus) {
						var legend = items[active].querySelector('.cm-quiz__title');
						if (legend) legend.focus();
					}
				}
				function advance() {
					var item = items[active];
					if (required(item) && !answered(item)) {
						mark(item, true);
						var first = controls(item)[0];
						if (first) first.focus();
						return false;
					}
					mark(item, false);
					return true;
				}
				function step(to) {
					active = to;
					render(true);
				}
				if (next) {
					next.addEventListener('click', function () {
						if (advance() && active < items.length - 1) step(active + 1);
					});
				}
				if (prev) {
					prev.addEventListener('click', function () {
						if (active > 0) step(active - 1);
					});
				}
				if (skip) {
					skip.addEventListener('click', function () {
						mark(items[active], false);
						if (active < items.length - 1) step(active + 1);
					});
				}
				form.addEventListener('submit', function (e) {
					e.preventDefault();
					for (var i = 0; i < items.length; i++) {
						if (required(items[i]) && !answered(items[i])) {
							active = i;
							render(false);
							mark(items[i], true);
							var first = controls(items[i])[0];
							if (first) first.focus();
							return;
						}
					}
					var answers = 0;
					for (var j = 0; j < items.length; j++) {
						if (answered(items[j])) answers++;
					}
					toast('questionnaire submitted - ' + answers + ' answers', 'ok');
					form.reset();
					for (var k = 0; k < items.length; k++) mark(items[k], false);
					active = 0;
					render(true);
				});
				form.addEventListener('keydown', function (e) {
					if (e.metaKey || e.ctrlKey || e.altKey) return;
					if (!e.key || e.key.length !== 1) return;
					var choice = items[active].querySelector(
						'.cm-quiz__choice[data-shortcut="' + e.key.toLowerCase() + '"] input'
					);
					if (choice) {
						choice.checked = true;
						mark(items[active], false);
					}
				});
				render(false);
			})(forms[q]);
		}
	}

	function cmInitForms(root) {
		var forms = root.querySelectorAll('form[data-cm-validate]');
		for (var i = 0; i < forms.length; i++) {
			(function (form) {
				if (form.__cmValid) return;
				form.__cmValid = '1';
				var mode = form.getAttribute('data-cm-validate-mode') || 'submit';
				var live = document.createElement('p');
				live.className = 'cm-sr-only';
				live.setAttribute('role', 'status');
				live.setAttribute('aria-live', 'polite');
				form.appendChild(live);

				function fieldOf(el) { return el.closest ? el.closest('.cm-field') : null; }

				function controls() {
					var out = [];
					var els = form.querySelectorAll('input, textarea, select');
					for (var j = 0; j < els.length; j++) {
						var el = els[j];
						if (el.disabled || el.type === 'submit' || el.type === 'button' || el.type === 'reset') continue;
						out.push(el);
					}
					return out;
				}

				function clear(el) {
					el.removeAttribute('aria-invalid');
					var f = fieldOf(el);
					if (!f) return;
					f.removeAttribute('data-invalid');
					var err = f.querySelector('.cm-field__error');
					if (!err || err.__cmOrig == null) return;
					err.textContent = err.__cmOrig;
					err.hidden = true;
				}

				function invalidate(el) {
					el.setAttribute('aria-invalid', 'true');
					var f = fieldOf(el);
					if (!f) return;
					f.setAttribute('data-invalid', '');
					var err = f.querySelector('.cm-field__error');
					if (!err) return;
					if (err.__cmOrig == null) err.__cmOrig = err.textContent;
					err.textContent = el.validationMessage || err.__cmOrig;
					err.hidden = false;
				}

				function validate(show) {
					var list = controls(), first = null, bad = 0;
					for (var j = 0; j < list.length; j++) {
						var el = list[j];
						if (el.checkValidity()) clear(el);
						else { bad++; if (!first) first = el; if (show) invalidate(el); }
					}
					if (show) {
						live.textContent = bad === 0 ? '' :
							(bad === 1 ? '1 field needs attention' : bad + ' fields need attention');
						if (first) first.focus();
					}
					return bad === 0;
				}

				form.addEventListener('submit', function (e) {
					e.preventDefault();
					if (validate(true)) {
						toast(form.getAttribute('data-cm-validate-toast') || 'saved', 'ok');
					}
				});
				form.addEventListener('reset', function () {
					setTimeout(function () {
						var list = controls();
						for (var j = 0; j < list.length; j++) clear(list[j]);
						live.textContent = '';
					}, 0);
				});
				if (mode === 'blur') {
					form.addEventListener('blur', function (e) {
						var el = e.target;
						if (!el || el.form !== form || !el.checkValidity) return;
						if (el.checkValidity()) clear(el); else invalidate(el);
					}, true);
				} else if (mode === 'input') {
					form.addEventListener('input', function (e) {
						var el = e.target;
						if (!el || !el.checkValidity) return;
						if (el.checkValidity()) clear(el); else invalidate(el);
					});
				}
			})(forms[i]);
		}
	}

	/* ---------- init ---------- */
	function init(root) {
		(root || document)
			.querySelectorAll(TOGGLE_SEL)
			.forEach(function (btn) {
				if (btn.dataset.cmBound) return;
				btn.dataset.cmBound = '1';
				btn.addEventListener('click', toggleTheme);
			});
		syncToggles();
		initHeader(document.querySelector('[data-cm-header]'));
		initNavToggle(root);
		initScrollSpy(document.querySelector('[data-cm-nav]'));
		initCopy(root);
		initTabs(root);
		initMenubar(root);
		initDialogs(root);
		initToasts(root);
		initTooltipClamp(root);
		initYears();
		initMeasureReadout();
		initTableLabels(root);
		cmInitResize(root);
		cmInitCal(root);
		cmClampHovercards(root);
		cmInitDrawer(root);
		cmInitFields(root);
		cmInitForms(root);
		cmInitQuiz(root);
		cmInitScroller(root);
		cmInitDatepickers(root);
		cmInitSort(root);
		cmInitTables(root);
		cmInitSidebars(root);
		cmInitShortcuts();
		cmInitSliders(root);
		cmInitComboboxes(root);
		cmInitCarousels(root);
		cmInitSteppers(root);
		cmInitOtp(root);
		cmInitCommand(root);
		cmInitNavmenu(root);
		if (!root || root === document) initExternalLinks();
	}

	/* ---------- late-arriving markup ----------
	   `init()` binds to what exists at the moment it runs, and it is called
	   once on DOMContentLoaded. In a static page that is the whole document,
	   so it is correct. In a SPA it is nothing: the framework commits its
	   tree AFTER this module evaluates, so every querySelector in init()
	   above returns null and - crucially - nothing ever retries. The result
	   is not a crash, it is a page that LOOKS wired up and is not:
	   `.cm-js` is never set, so the header's burger stays display:none, the
	   sticky header never gets its scrolled shadow, and `initHeader` never
	   publishes `--header-h` so anchor jumps land under the bar.

	   MEASURED on spacetime-memory's web app (React 19, Vite) in WebKit at
	   390x844: with auto-init alone the burger measured 0x0 and was not
	   clickable, and calling `cliMono.init(document)` once after the commit
	   set `.cm-js`, gave the burger 44x44, and opened the drawer with all 6
	   links at 781px. So the runtime was always correct and the ORDER was
	   not - which is why this is a re-run rather than a new feature.

	   A MutationObserver on the subtree re-runs init when `.cm-*` markup
	   actually appears. Bounded on purpose: a document that already has
	   library markup arms nothing at all, and an observer disconnects as
	   soon as one full pass binds, so nothing runs for the life of the page.
	   `init()` is itself idempotent - every binder guards on a dataset flag -
	   so a re-run over already-bound nodes is free and cannot double-bind a
	   click handler. */
	function watchForLateMarkup() {
		if (typeof MutationObserver !== 'function') return;
		if (!document.body) return;

		/* Cheap check first: if the library's own anchors are already in the
		   DOM there is nothing to wait for, so never attach at all. This is
		   the static-page path and it stays exactly as fast as before. */
		if (hasLibraryMarkup()) return;

		var observer = new MutationObserver(function () {
			if (!hasLibraryMarkup()) return;
			observer.disconnect();
			init(document);
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	/* Does this document contain any of the hooks `init` binds to? Kept as a
	   list rather than a single selector so the observer stops on the first
	   real surface instead of waiting forever for one specific element. */
	function hasLibraryMarkup() {
		return !!document.querySelector(
			'[data-cm-header], [data-cm-nav-toggle], [data-cm-copy], ' +
			'[data-cm-tabs], [data-cm-toast], [data-cm-quiz], [data-cm-scroller], ' +
			'[data-cm-navmenu], .cm-prose-table'
		);
	}

	/* ---------- data table: filter, paginate, columns, selection ----------
	   Every feature is OPT-IN and every listener is DELEGATED - the four
	   documented shadcn behaviors composed onto the table we already ship,
	   not a second table implementation.

	   The scope is `[data-cm-datatable]`: a wrapper around toolbar + table
	   + footer, so a page can hold several tables and each control finds
	   its own. WHY ONE REFRESH: filter, page, sort and selection all
	   decide the same two things - which rows show, what the footer says.
	   Four handlers each redrawing their own half is how the halves start
	   disagreeing (a count line claiming "5 of 23" while page 3 shows rows
	   the filter removed). cmTableRefresh owns the whole answer, and every
	   path ends there.

	   State lives in the DOM, never in a map: the filter IS the input's
	   value, the page and size ARE attributes on the table, selection IS
	   `aria-selected` on the row. A consumer whose framework re-renders
	   tbody keeps nothing stale, because nothing was mirrored. */

	function cmTableScope(el) {
		return el && el.closest ? el.closest('[data-cm-datatable]') : null;
	}

	function cmTableRows(table) {
		var rows = [];
		Array.prototype.forEach.call(table.tBodies, function (body) {
			Array.prototype.forEach.call(body.rows, function (row) {
				if (row.hasAttribute('data-cm-empty')) return;
				rows.push(row);
			});
		});
		return rows;
	}

	function cmCellMatch(row, q, col) {
		var cells = row.cells;
		var i, text;
		// A column filter names its column via `data-col`; the global
		// filter searches every cell. Substring, case-insensitive, which
		// is what `filterFn_includesString` does on the other side.
		if (col) {
			for (i = 0; i < cells.length; i++) {
				if (cells[i].getAttribute('data-col') === col) {
					text = (cells[i].textContent || '').toLowerCase();
					return text.indexOf(q) >= 0;
				}
			}
			return false;
		}
		for (i = 0; i < cells.length; i++) {
			text = (cells[i].textContent || '').toLowerCase();
			if (text.indexOf(q) >= 0) return true;
		}
		return false;
	}

	function cmRowSelected(row) {
		return row.getAttribute('aria-selected') === 'true';
	}

	function cmTableRefresh(scope, op) {
		if (!scope) return;
		var table = scope.querySelector('table');
		if (!table) return;
		var rows = cmTableRows(table);

		// -- filter: a row must satisfy EVERY active filter in the scope.
		// `data-cm-filter` with no value is the global search box; with a
		// column id it filters that column only.
		var filters = [];
		Array.prototype.forEach.call(
			scope.querySelectorAll('[data-cm-filter]'),
			function (input) {
				var q = (input.value || '').trim().toLowerCase();
				if (!q) return;
				filters.push({ q: q, col: input.getAttribute('data-cm-filter') || '' });
			}
		);
		var matched = rows.filter(function (row) {
			for (var i = 0; i < filters.length; i++) {
				if (!cmCellMatch(row, filters[i].q, filters[i].col)) return false;
			}
			return true;
		});

		// -- pagination, clamped: a filter that shrinks the result must
		// land on a REAL page, never on the empty tail of the old one.
		var size = parseInt(table.getAttribute('data-cm-size') || '', 10);
		if (!(size > 0)) size = 10;
		var pages = Math.max(1, Math.ceil(matched.length / size));
		var page = parseInt(table.getAttribute('data-cm-page') || '', 10);
		if (!(page >= 0)) page = 0;
		if (page > pages - 1) page = pages - 1;
		if (op === 'first') page = 0;
		else if (op === 'prev') page = Math.max(0, page - 1);
		else if (op === 'next') page = Math.min(pages - 1, page + 1);
		else if (op === 'last') page = pages - 1;
		table.setAttribute('data-cm-page', String(page));

		var inPage = matched.slice(page * size, page * size + size);

		// -- visibility: INLINE display, because `hidden` loses to any
		// author rule that sets `display` on a row, and a consumer's
		// stylesheet is not ours to outrank by specificity.
		rows.forEach(function (row) {
			row.style.display = inPage.indexOf(row) >= 0 ? '' : 'none';
		});

		// -- the "no results" row, full width, exactly where shadcn
		// renders its empty TableRow.
		var empty = table.querySelector('[data-cm-empty]');
		if (empty) empty.style.display = matched.length ? 'none' : '';

		// -- page controls: disabled at both ends, honestly.
		Array.prototype.forEach.call(
			scope.querySelectorAll('button[data-cm-page]'),
			function (btn) {
				var kind = btn.getAttribute('data-cm-page');
				btn.disabled = kind === 'first' || kind === 'prev'
					? page === 0
					: page >= pages - 1;
			}
		);
		var info = scope.querySelector('[data-cm-pageinfo]');
		if (info) info.textContent = 'page ' + (page + 1) + ' of ' + pages;

		// -- selection. The header box covers the PAGE rows
		// (getIsAllPageRowsSelected); the count line counts the
		// SELECTED rows among the FILTERED ones - the same two models
		// shadcn prints.
		var selected = rows.filter(cmRowSelected);
		var onPageSelected = inPage.filter(cmRowSelected);
		var allBox = scope.querySelector('[data-cm-selectall]');
		if (allBox) {
			var all = inPage.length > 0 && onPageSelected.length === inPage.length;
			allBox.checked = all;
			allBox.indeterminate = onPageSelected.length > 0 && !all;
		}
		var count = scope.querySelector('[data-cm-selcount]');
		if (count) {
			var selFiltered = selected.filter(function (row) {
				return matched.indexOf(row) >= 0;
			}).length;
			count.textContent = selFiltered + ' of ' + matched.length
				+ ' rows selected';
		}
	}

	function cmInitTables(root) {
		(root || document)
			.querySelectorAll('[data-cm-datatable]')
			.forEach(function (scope) { cmTableRefresh(scope); });
	}

	/* ---- sidebar --------------------------------------------------
	   Every knob shadcn carries as a prop or context value (side,
	   variant, collapsible, open, openMobile) is an attribute on the
	   scope, so this file never stores a single sidebar fact: it READS
	   attributes and WRITES attributes, and the CSS derives the look.
	   aria-expanded mirrors EFFECTIVE visibility, which differs by
	   viewport - the phone's sheet is closed while the desktop's panel
	   is open, and useSidebar's state union is what keeps those two
	   honest. */
	function sidebarIsPhone() {
		return !!(window.matchMedia &&
			window.matchMedia('(max-width: 767px)').matches);
	}
	function sidebarOpen(scope) {
		if (!scope) return false;
		return sidebarIsPhone()
			? scope.getAttribute('data-mobile-open') === 'true'
			: scope.getAttribute('data-state') === 'expanded';
	}
	function sidebarSyncTriggers(scope) {
		var panel = scope && scope.querySelector('.cm-sidebar__panel');
		if (!panel || !panel.id) return;
		var open = sidebarOpen(scope);
		var triggers = document.querySelectorAll(
			'[data-cm-sidebar-trigger][aria-controls="' + panel.id + '"]');
		Array.prototype.forEach.call(triggers, function (btn) {
			btn.setAttribute('aria-expanded', open ? 'true' : 'false');
		});
	}
	/* The trigger finds its panel through aria-controls - markup the
	   component already owes its assistive tech - so there is no id
	   registry to keep in step. */
	function sidebarTriggerScope(btn) {
		var id = btn && btn.getAttribute('aria-controls');
		var panel = id ? document.getElementById(id) : null;
		return panel ? panel.closest('[data-cm-sidebar]') : null;
	}
	function sidebarToggle(scope) {
		if (!scope) return;
		if (sidebarIsPhone()) {
			scope.setAttribute('data-mobile-open',
				sidebarOpen(scope) ? 'false' : 'true');
		} else {
			scope.setAttribute('data-state',
				sidebarOpen(scope) ? 'collapsed' : 'expanded');
		}
		sidebarSyncTriggers(scope);
	}
	/* Groups and submenus are disclosures: aria-expanded and hidden move
	   together, and CSS owns nothing about visibility - one mechanism,
	   and the markup's own initial state is honest with no JS. */
	function sidebarDisclosure(btn) {
		var id = btn.getAttribute('aria-controls');
		var panel = id ? document.getElementById(id) : null;
		if (!panel) return;
		var open = btn.getAttribute('aria-expanded') === 'true';
		btn.setAttribute('aria-expanded', open ? 'false' : 'true');
		if (open) panel.setAttribute('hidden', '');
		else panel.removeAttribute('hidden');
	}
	function onSidebarClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var trigger = t.closest('[data-cm-sidebar-trigger]');
		if (trigger) {
			sidebarToggle(sidebarTriggerScope(trigger));
			return;
		}
		var group = t.closest('[data-cm-sidebar-group]');
		if (group) { sidebarDisclosure(group); return; }
		var sub = t.closest('[data-cm-sidebar-sub]');
		if (sub) { sidebarDisclosure(sub); return; }
		var scrim = t.closest('[data-cm-sidebar-scrim]');
		if (scrim) {
			var scope = scrim.closest('[data-cm-sidebar]');
			if (scope) {
				scope.setAttribute('data-mobile-open', 'false');
				sidebarSyncTriggers(scope);
			}
		}
	}
	function sidebarEditable(el) {
		if (!el || !el.tagName) return false;
		return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' || el.isContentEditable === true;
	}
	function onSidebarKeydown(e) {
		if (e.defaultPrevented) return;
		// Escape leaves the SHEET, on the phone, and gives focus back
		// to the control that opened it. It must not touch the desktop
		// panel: there Escape belongs to whatever transient is open.
		if (e.key === 'Escape') {
			if (!sidebarIsPhone()) return;
			var scope = document.querySelector(
				'[data-cm-sidebar][data-mobile-open="true"]');
			if (!scope) return;
			scope.setAttribute('data-mobile-open', 'false');
			sidebarSyncTriggers(scope);
			var panel = scope.querySelector('.cm-sidebar__panel');
			var trig = panel && panel.id && document.querySelector(
				'[data-cm-sidebar-trigger][aria-controls="' + panel.id + '"]');
			if (trig) trig.focus();
			return;
		}
		// CMD/CTRL-B: the documented trigger. The browser only reserves
		// this chord inside editors, which is the guard above.
		if ((e.key === 'b' || e.key === 'B') &&
			(e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
			if (sidebarEditable(e.target)) return;
			var first = document.querySelector('[data-cm-sidebar]');
			if (!first) return;
			sidebarToggle(first);
			e.preventDefault();
		}
	}
	/* The rail is one pointer session: drag resizes, and a press that
	   never moved IS the click that toggles. The threshold is what stops
	   a wobbling click from nudging the width token, and the width is
	   written where every other fact lives - an inline attribute on the
	   scope, which is still the DOM. */
	var railDrag = null;
	function onSidebarPointerDown(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var rail = t.closest('[data-cm-sidebar-rail]');
		if (!rail) return;
		var scope = rail.closest('[data-cm-sidebar]');
		if (!scope || scope.getAttribute('data-collapsible') === 'none') return;
		if (sidebarIsPhone()) return;
		var panel = scope.querySelector('.cm-sidebar__panel');
		if (!panel) return;
		railDrag = {
			rail: rail, scope: scope,
			startX: e.clientX,
			startW: panel.getBoundingClientRect().width,
			moved: false,
		};
		rail.setAttribute('data-dragging', '');
	}
	function onSidebarPointerMove(e) {
		if (!railDrag) return;
		var dx = e.clientX - railDrag.startX;
		if (Math.abs(dx) < 3) return;
		railDrag.moved = true;
		// side=left: the rail IS the right edge, so +x grows it.
		// side=right: the rail is the left edge, so +x shrinks it.
		var sign = railDrag.scope.getAttribute('data-side') === 'right' ? -1 : 1;
		var w = railDrag.startW + sign * dx;
		var min = 12 * 16, max = 32 * 16; // 12rem..32rem, in px
		if (w < min) w = min;
		if (w > max) w = max;
		railDrag.scope.style.setProperty('--sidebar-width', w + 'px');
	}
	function onSidebarPointerUp() {
		if (!railDrag) return;
		var drag = railDrag;
		railDrag = null;
		drag.rail.removeAttribute('data-dragging');
		if (!drag.moved) sidebarToggle(drag.scope);
	}
	/* A gesture that began on the rail must not turn into the browser's
	   native link-drag when the pointer drifts over a menu item while
	   the button is still down - the panel is GROWING under the cursor,
	   so crossing an <a> is not an edge case, it is every drag. WebKit
	   kills the pointer stream the moment its drag session starts (no
	   pointerup, no pointercancel - the events just stop), which froze
	   the resize mid-gesture at whatever width the last delivered move
	   computed. Scoped to the gesture: a drag that starts any other way
	   is none of our business. */
	function onSidebarDragStart(e) {
		if (railDrag) e.preventDefault();
	}
	function cmInitSidebars(root) {
		(root || document)
			.querySelectorAll('[data-cm-sidebar]')
			.forEach(sidebarSyncTriggers);
	}

	function onTableFilter(e) {
		var t = e.target;
		if (!t || !t.matches || !t.matches('[data-cm-filter]')) return;
		// Live, no debounce: the controlled input on the other side of this
		// parity is live too, and a stale frame between keystroke and row
		// is a lie the count line would repeat.
		cmTableRefresh(cmTableScope(t));
	}

	function onTablePageClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		// `button` is LOAD-BEARING: the refresh writes the page INDEX back
		// as `data-cm-page` on the TABLE, so a bare closest() matched the
		// table from every click inside it - a stray refresh fired between
		// a checkbox's native toggle and its change event and unchecked it
		// again, which is why "select all" appeared to do nothing.
		var btn = t.closest('button[data-cm-page]');
		if (!btn) return;
		cmTableRefresh(cmTableScope(btn), btn.getAttribute('data-cm-page'));
	}

	function onTableSizeChange(e) {
		var t = e.target;
		if (!t || !t.matches || !t.matches('[data-cm-pagesize]')) return;
		var scope = cmTableScope(t);
		var table = scope && scope.querySelector('table');
		if (!table) return;
		table.setAttribute('data-cm-size', t.value);
		// Page position is KEPT, then clamped by the refresh: a bigger page
		// must not throw the reader back to page one under them.
		cmTableRefresh(scope);
	}

	function onTableSelectChange(e) {
		var t = e.target;
		if (!t || !t.matches) return;
		if (!t.matches('[data-cm-select]') && !t.matches('[data-cm-selectall]')) return;
		var scope = cmTableScope(t);
		if (!scope) return;
		var table = scope.querySelector('table');
		if (!table) return;
		if (t.matches('[data-cm-selectall]')) {
			// Page rows are the rows that SHOW: after the last refresh the
			// slice is exactly the non-inline-hidden set.
			cmTableRows(table).forEach(function (row) {
				if (row.style.display === 'none') return;
				row.setAttribute('aria-selected', t.checked ? 'true' : 'false');
				var box = row.querySelector('[data-cm-select]');
				if (box) box.checked = t.checked;
			});
		} else {
			var row = t.closest('tr');
			if (row) row.setAttribute('aria-selected', t.checked ? 'true' : 'false');
		}
		cmTableRefresh(scope);
	}

	/* Column visibility: the menu item's aria-checked is the STATE, and
	   this function only ever READS it - never toggles. That is what makes
	   it safe to call from both arrival paths: the mouse click (after
	   onMenuCheckClick flipped it) and the keyboard flip inside onMenuKey,
	   where preventDefault may have suppressed the click that would have
	   applied it. Applying twice changes nothing; toggling twice undoes it. */
	function cmColvisApply(item) {
		if (!item || !item.getAttribute) return;
		var col = item.getAttribute('data-cm-col');
		if (!col) return;
		var scope = cmTableScope(item);
		if (!scope) return;
		var show = item.getAttribute('aria-checked') === 'true';
		// Filtered by getAttribute, not by a selector built from the value:
		// a column id with a quote in it must not break the query.
		Array.prototype.forEach.call(scope.querySelectorAll('[data-col]'), function (cell) {
			if (cell.getAttribute('data-col') !== col) return;
			cell.style.display = show ? '' : 'none';
		});
	}

	function onColvisClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var item = t.closest('[data-cm-col]');
		if (!item) return;
		cmColvisApply(item);
	}

	var cmKeyFlipItem = null;
	var cmKeyFlipAt = 0;

	function onMenuCheckClick(e) {
		var t = e.target;
		if (!t || typeof t.closest !== 'function') return;
		var item = t.closest('[role="menuitemcheckbox"], [role="menuitemradio"]');
		if (!item) return;
		/* A radio row is a one-shot CHOICE: pick it and the menu
		   retires, the way every native radio menu does - and a select
		   that stays open is half a select. Both activation doors land
		   HERE: the pointer click, and the real click the engine fires
		   on Enter. The detail-0 guard below only skips the FLIP (the
		   keydown already made it), so the close is placed before it -
		   one decision for both doors. Arrow ARRIVAL calls setRadio
		   directly and never reaches this handler, so browsing while
		   open - the APG pattern - is untouched. */
		if (item.getAttribute('role') === 'menuitemradio') {
			var rm = item.closest('[role="menu"]');
			if (rm && typeof rm.hidePopover === 'function') rm.hidePopover();
		}
		// The keydown handler already flipped it and Enter's native click
		// arrives with detail 0; flipping again puts the state back where
		// it started - the double-flip that reads as "keyboard does
		// nothing". detail 0 + same item + just now = that click.
		if (e.detail === 0 && item === cmKeyFlipItem
			&& Date.now() - cmKeyFlipAt < 1000) return;
		if (item.getAttribute('role') === 'menuitemcheckbox') toggleCheckable(item);
		else setRadio(item);
		cmColvisApply(item);
	}

	var api = {
		init: init,
		applyTheme: applyTheme,
		getTheme: getTheme,
		toggleTheme: toggleTheme,
		themeInitScript: themeInitScript,
		storeKey: storeKey,
		setLegacyKeys: function (keys) {
			LEGACY_KEYS = keys || [];
		},
		copyText: copyText,
		toast: toast,
		dismissToast: dismiss
	};

	// Global handle for any project, plus module export for bundlers.
	if (typeof window !== 'undefined') window.cliMono = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	if (typeof globalThis !== 'undefined') globalThis.cliMono = api;

	if (typeof document !== 'undefined') {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', function () {
				init(document);
				watchForLateMarkup();
			});
		} else {
			init(document);
			watchForLateMarkup();
		}
		// Astro view transitions / client-side nav
		document.addEventListener('astro:page-load', function () {
			init(document);
		});
		// One re-measure after the page has finished loading. The first pass
		// runs on DOMContentLoaded, which is BEFORE web fonts swap and
		// before every image has a box - both of which move every section
		// down, so the indicator would otherwise stay where the fallback
		// metrics put it. Measured on this showcase: the sections a navmenu
		// points at are below 20,000px of specimens.
		// Guarded on `window` as well as `document`: the suite evaluates
		// this module in a context that has a document stub and no window
		// at all, and an unguarded reference here is a load-time throw in
		// every one of those sandboxes.
		if (typeof window !== 'undefined') {
			window.addEventListener('load', function () {
				navSpies.forEach(function (s) { s.fn(); });
			});
		}
		// Capture, at the root, registered once: see onPopoverToggle.
		document.addEventListener('toggle', onPopoverToggle, true);
		document.addEventListener('click', onDisclosureClick, true);
		// Delegated at the root for the same reason: re-rendered markup
		// keeps working without a re-bind.

		document.addEventListener('keydown', onMenubarKey);
		// Capture: the browser's own context menu is suppressed by this
		// handler, and capture runs before a consumer's row handler.
		document.addEventListener('contextmenu', onContextMenu, true);
		// Delegated on document: the grid is rebuilt wholesale, so a
		// listener bound per day would die with the first render.
		document.addEventListener('click', onCalClick);
		document.addEventListener('keydown', onCalKey);
		document.addEventListener('pointerover', onCalOver);
		document.addEventListener('pointerout', onCalOut);
		// A tree row keeps itself the tab stop while it has focus; arrows
		// move focus without re-binding anything per node.
		document.addEventListener('focusin', onTreeFocus);
		document.addEventListener('keydown', onTreeKey);
		// The context menu's dismissal lives at the root too: an outside
		// press must close it even when it lands on another component's node.
		document.addEventListener('pointerdown', onCtxOutside, true);
		document.addEventListener('keydown', onCtxEscape, true);
		document.addEventListener('click', onSegClick);
		document.addEventListener('click', onSearchClear);
		document.addEventListener('click', onTableSort);
		document.addEventListener('input', onSliderInput);
		// Data table: the flip must register BEFORE colvis reads the state -
		// same target, so dispatch order is registration order.
		document.addEventListener('click', onMenuCheckClick);
		document.addEventListener('click', onColvisClick);
		document.addEventListener('click', onTablePageClick);
		document.addEventListener('change', onTableSizeChange);
		document.addEventListener('change', onTableSelectChange);
		document.addEventListener('input', onTableFilter);
		// Sidebar: one click router for trigger/groups/subs/scrim, one
		// keydown for CMD-B and Escape, and a pointer session for the rail
		// (drag resizes, an unmoved press toggles) - all at the root, so a
		// panel a consumer re-renders keeps every control.
		document.addEventListener('click', onSidebarClick);
		document.addEventListener('keydown', onSidebarKeydown);
		document.addEventListener('pointerdown', onSidebarPointerDown);
		document.addEventListener('pointermove', onSidebarPointerMove);
		document.addEventListener('pointerup', onSidebarPointerUp);
		// ...and the same rail gesture vetoes the native link-drag it
		// would otherwise trip over as the panel grows under the cursor.
		document.addEventListener('dragstart', onSidebarDragStart);
		document.addEventListener('pointercancel', onSidebarPointerUp);
	}
})();
