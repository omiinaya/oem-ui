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

	// The FOUC guard. Paste this in <head>, BEFORE any stylesheet,
	// as an inline is:inline script. It runs before first paint so a
	// light-theme user never sees a black flash.
	function themeInitScript(storageKey) {
		var keys = [storageKey || 'cm-theme'].concat(LEGACY_KEYS);
		return (
			'(function(){try{var k=' +
			JSON.stringify(keys) +
			';for(var i=0;i<k.length;i++){var s=localStorage.getItem(k[i]);' +
			'if(s==="light"||s==="dark"){if(s==="light")' +
			'{document.documentElement.setAttribute("data-theme","light");}' +
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

		var mq = window.matchMedia('(max-width: 640px)');
		function setOpen(open) {
			btn.setAttribute('aria-expanded', open ? 'true' : 'false');
			if (open) panel.setAttribute('data-open', '');
			else panel.removeAttribute('data-open');
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
				btn.addEventListener('click', function () {
					var sel = btn.getAttribute('data-cm-copy');
					var src = sel ? document.querySelector(sel) : btn.previousElementSibling;
					var text = src ? (src.innerText || src.textContent) : '';
					if (!text) return;
					var original = btn.getAttribute('data-cm-label') || btn.textContent;
					copyText(String(text).trim())
						.then(function () {
							btn.textContent = 'copied';
							btn.classList.add('is-copied');
						})
						.catch(function () {
							btn.textContent = 'press ⌘c';
						})
						.then(function () {
							setTimeout(function () {
								btn.textContent = original;
								btn.classList.remove('is-copied');
							}, 1400);
						});
				});
			});
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

	function toast(msg) {
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
			var span = document.createElement('span');
			span.className = 'cm-toast';
			span.textContent = msg;
			node = span;
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
			}, TOAST_MS);
		}
		return node;
	}

	function initToasts(root) {
		(root || document)
			.querySelectorAll('[data-cm-toast]')
			.forEach(bindToastClose);
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
		initYears();
		if (!root || root === document) initExternalLinks();
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
			});
		} else {
			init(document);
		}
		// Astro view transitions / client-side nav
		document.addEventListener('astro:page-load', function () {
			init(document);
		});
	}
})();
