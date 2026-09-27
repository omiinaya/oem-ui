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
		initScrollSpy(document.querySelector('[data-cm-nav]'));
		initCopy(root);
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
		copyText: copyText
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
