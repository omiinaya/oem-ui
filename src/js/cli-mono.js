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
	var POP_SEL = '.cm-dropdown__menu[popover]';
	var popPin = null;

	function anchorPopover(menu) {
		var id = menu.id || '';
		// [popovertarget] is a plain attribute selector: valid whether or
		// not the engine implements the popover API.
		var trigger = id ? document.querySelector('[popovertarget="' + id.replace(/["\\]/g, '\\$&') + '"]') : null;
		if (!trigger) return;
		var t = trigger.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.inset = 'auto';
		var w = menu.offsetWidth;
		var h = menu.offsetHeight;
		var pad = 8;
		var x = t.right - w;                      // right edges align, as the CSS wanted
		if (x < pad) x = pad;
		else if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
		var y = t.bottom + 4;                     // `calc(100% + var(--space-1))`, translated
		if (y + h > window.innerHeight - pad && t.top - h - 4 >= pad) y = t.top - h - 4;
		if (y < pad) y = pad;
		menu.style.left = Math.round(x) + 'px';
		menu.style.top = Math.round(y) + 'px';
	}

	/* Fixed positioning does not follow the page, so while a menu is open
	   the trigger moves under it on every scroll. Pin, then unpin on close
	   - one pair of listeners, not one per menu. */
	function unpinPopover() {
		if (!popPin) return;
		window.removeEventListener('scroll', popPin);
		window.removeEventListener('resize', popPin);
		popPin = null;
	}

	function pinPopover(menu) {
		unpinPopover();
		popPin = function () { anchorPopover(menu); };
		window.addEventListener('scroll', popPin, { passive: true });
		window.addEventListener('resize', popPin);
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
		if (menu.matches(':popover-open')) {
			pinPopover(menu);
			// The menu-button pattern: opening moves focus INTO the menu, so
			// the arrow keys have somewhere to start. Closing returns focus to
			// the trigger - the popover API already does that half.
			var first = menuItems(menu)[0];
			if (first && typeof first.focus === 'function') first.focus();
		} else unpinPopover();
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
		document.addEventListener('click', onSegClick);
		document.addEventListener('click', onSearchClear);
	}
})();
