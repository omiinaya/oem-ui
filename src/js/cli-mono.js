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
				var current =
					tabs.filter(function (t) {
						return t.getAttribute('aria-selected') === 'true';
					})[0] || tabs[0];
				selectTab(tabs, panels, current);

				group.addEventListener('keydown', function (e) {
					if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft'
						&& e.key !== 'Home' && e.key !== 'End') return;
					var i = tabs.indexOf(document.activeElement);
					if (i === -1) return;
					e.preventDefault();
					var next = i;
					if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
					if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
					if (e.key === 'Home') next = 0;
					if (e.key === 'End') next = tabs.length - 1;
					selectTab(tabs, panels, tabs[next]);
					if (typeof tabs[next].focus === 'function') tabs[next].focus();
				});

				group.addEventListener('click', function (e) {
					var t = e.target && e.target.closest
						? e.target.closest(TAB_SEL)
						: null;
					if (t && tabs.indexOf(t) !== -1) selectTab(tabs, panels, t);
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
			if (e.target && e.target.closest
				&& e.target.closest('[data-cm-toast-close]')) {
				dismiss(el);
			}
		});
	}

	/* `opts.duration` overrides the 6s default. A lag warning is an FYI, not
	   a decision the user has to read, so it should not hold the region for
	   as long as an error would. null/0/undefined all mean "keep the
	   default" - 0 meaning "never expires" is sonner's rule and would make
	   the region grow without bound. */
	function toast(msg, severity, opts) {
		var life = (opts && typeof opts.duration === 'number' && opts.duration > 0)
			? opts.duration
			: TOAST_MS;
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
				: null;
			if (sev) {
				var box = document.createElement('div');
				box.className = 'cm-toast cm-alert--' + sev;
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
		if (typeof setTimeout === 'function') {
			setTimeout(function () {
				dismiss(node);
			}, life);
		}
		return node;
	}

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
	var popPin = null;
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
		if (!trigger && !at) return;
		var t = trigger ? trigger.getBoundingClientRect() : null;
		menu.style.position = 'fixed';
		menu.style.inset = 'auto';
		var w = menu.offsetWidth;
		var h = menu.offsetHeight;
		var pad = 8;
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
				menu.classList.contains('cm-menubar__menu'));
		var x = start ? t.left : t.right - w;
		if (x < pad) x = pad;
		else if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
		var y = t.bottom + 4;                     // `calc(100% + var(--space-1))`, translated
		if (y + h > window.innerHeight - pad && t.top - h - 4 >= pad) y = t.top - h - 4;
		if (y < pad) y = pad;
		// Written only when they move: the pin re-anchors every frame while
		// the card is open, and an unconditional style write at 60fps is a
		// layout invalidation nobody asked for.
		var left = Math.round(x) + 'px', top = Math.round(y) + 'px';
		if (menu.style.left !== left) menu.style.left = left;
		if (menu.style.top !== top) menu.style.top = top;
	}

	/* Fixed positioning does not follow the page, so while a menu is open
	   the trigger moves under it on every scroll. Pin, then unpin on close
	   - one pair of listeners, not one per menu. */
	function unpinPopover() {
		if (!popPin) return;
		window.removeEventListener('scroll', popPin);
		window.removeEventListener('scrollend', popPin);
		window.removeEventListener('resize', popPin);
		popPin = null;
	}

	/* Anchoring on the scroll event itself measures MID-jump. A programmatic
	   scrollTo(0, 240) from the middle of a 53,000px showcase left the card
	   275px off its trigger: the last scroll event ran while the viewport was
	   still somewhere in between, and nothing re-ran at the final position.
	   Deferring to the next frame measures where the page actually ended up,
	   and `scrollend` covers engines that coalesce the whole jump into one
	   event. */
	function pinPopover(menu) {
		unpinPopover();
		// The event path anchors immediately; the frame loop below is what
		// guarantees the FINAL position. They must not share popRaf - the
		// old debounced handler cancelled the loop's pending frame and then
		// never rescheduled it, so the first scroll event killed the loop.
		popPin = function () { anchorPopover(menu); };
		window.addEventListener('scroll', popPin, { passive: true });
		window.addEventListener('scrollend', popPin);
		window.addEventListener('resize', popPin);
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
			menu.querySelectorAll('[role="menuitem"], .cm-dropdown__item'),
			function (el) {
				return el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
			}
		);
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
				popPin = function () { if (typeof menu.hidePopover === 'function') menu.hidePopover(); };
				window.addEventListener('scroll', popPin, { passive: true });
				window.addEventListener('resize', popPin);
				// ...and it still has to be PUT there: pinPopover() is what
				// anchored every other panel, and this branch replaces it.
				anchorPopover(menu);
			} else pinPopover(menu);
			// The menu-button pattern: opening moves focus INTO the menu, so
			// the arrow keys have somewhere to start. Closing returns focus to
			// the trigger - the popover API already does that half.
			var first = menuItems(menu)[0] ||
				menu.querySelector('button, a[href], input, [tabindex]:not([tabindex="-1"])');
			if (first && typeof first.focus === 'function') first.focus();
		} else {
			if (menu.__cmCtx && ctxMenu === menu) {
				var back = menu.__cmReturn;
				var inside = document.activeElement &&
					typeof menu.contains === 'function' &&
					menu.contains(document.activeElement);
				if (inside && back && typeof back.focus === 'function') back.focus();
				menu.__cmReturn = null;
				ctxMenu = null;
			}
			unpinPopover();
		}
	}

	/* Arrow keys inside an open menu: Down/Up step and wrap, Home/End jump.
	   Escape is the platform's (light dismiss), so it is not handled here. */
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
		if (!next) return;
		e.preventDefault();
		next.focus();
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
		return Array.prototype.filter.call(
			bar.querySelectorAll('.cm-menubar__trigger'),
			function (b) { return b.offsetParent !== null; }
		);
	}

	function onMenubarKey(e) {
		var bar = e.target && e.target.closest && e.target.closest('[data-cm-menubar]');
		if (!bar) return;
		var trg = e.target.closest('.cm-menubar__trigger');
		// Enter/Space already activate the button (and with it
		// [popovertarget]); ArrowDown is the key the platform does NOT map
		// to "open", and it is the one readers reach for.
		if (trg && e.key === 'ArrowDown') {
			var oid = trg.getAttribute('popovertarget');
			var om = oid && document.getElementById(oid);
			if (om && typeof om.showPopover === 'function' && !om.matches(':popover-open')) om.showPopover();
			e.preventDefault();
			return;
		}
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
		var list = menubarTriggers(bar);
		if (!list.length) return;
		var open = e.target.closest('.cm-menubar__menu');
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
		if (open && typeof open.hidePopover === 'function') open.hidePopover();
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
		initDialogs(root);
		initToasts(root);
		initTooltipClamp(root);
		initYears();
		initMeasureReadout();
		initTableLabels(root);
		cmInitResize(root);
		cmInitCal(root);
		cmClampHovercards(root);
		cmInitSort(root);
		cmInitSliders(root);
		cmInitComboboxes(root);
		cmInitCarousels(root);
		cmInitSteppers(root);
		cmInitOtp(root);
		cmInitCommand(root);
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
			'[data-cm-tabs], [data-cm-toast], .cm-prose-table'
		);
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
		// Capture, at the root, registered once: see onPopoverToggle.
		document.addEventListener('toggle', onPopoverToggle, true);
		// Delegated at the root for the same reason: re-rendered markup
		// keeps working without a re-bind.
		document.addEventListener('keydown', onMenuKey);
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
	}
})();
