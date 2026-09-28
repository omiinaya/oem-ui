/* ============================================================
   cli-mono — FOUC guard
   The single canonical copy of the flash-of-wrong-theme guard.

   Emit it as the FIRST node in <head>, before even the charset
   declaration and before any stylesheet, or a light-theme visitor
   sees a dark flash. Nothing else may run before it, because the
   whole job is to run before first paint.

   DO NOT PUT A SCRIPT-CLOSING TAG SEQUENCE, NOR AN HTML
   COMMENT OPENER, ANYWHERE IN THIS FILE - INCLUDING IN A
   COMMENT.

   This file is inlined verbatim into the HTML head by Astro's
   ?raw import. The HTML parser ends a script element at the
   first closing tag sequence it sees, WHETHER OR NOT IT IS INSIDE
   A JAVASCRIPT COMMENT. An earlier version of this header
   documented the usage by writing the closing tag literally, the
   build succeeded, both the contract tests passed, and every
   visitor got NO GUARD AT ALL: the parser cut the file at the
   comment, so the shipped script was a truncated comment with
   the entire body missing. It is the one failure in this repo
   that every green signal failed to catch, which is why the test
   suite now asserts on the BUILT page rather than the source.

   So describe the tags, never spell them.

   WHY THIS IS A FILE AND NOT A FUNCTION IN cli-mono.js:

   The runtime cannot be used to emit this. The guard runs in
   <head> BEFORE the runtime bundle exists, so a guard that asked
   the runtime for its key list would read module state that is
   still empty - which is the original bug, fixed once and then
   reintroduced by every project that hand-rolled the guard
   (oem-links, oem-ngo-brand and oem-portfolio all did exactly
   that, in the build-time-baked form that cannot see a legacy
   key).

   Keeping it here means a project that owns its own head can
   adopt the fixed version instead of reimplementing it, and
   scripts/check-design-sync.sh keeps the copy byte-identical, so
   a fix here cannot land in the library and be missing from a
   consumer.

   WHY IT READS THE ROOT ELEMENT INSTEAD OF A LITERAL:

   A project declares its storage key ONCE, on the root element,
   as data-cm-theme-key, plus data-cm-theme-legacy for the keys
   it used earlier. One declaration then serves the guard AND
   the runtime (cli-mono.js reads the same two attributes), so
   the two cannot drift. A guard that bakes in one key cannot see
   a theme saved under an old one, and that returning visitor -
   the exact person this guard exists to protect - gets a black
   flash instead.

   Dark is the default and is applied by CSS, so this only ever
   WRITES data-theme, and only for "light". It must never write to
   storage: that is the runtime's job, on init, after the paint.

   HOW TO USE IT

   Astro: import the file with a ?raw suffix, then inline it with
   an is:inline script carrying set:html. An oem-ui Head
   component already does this for you.

   Plain HTML, flat install: reference this file with a plain
   script src in the head, ahead of every stylesheet. A blocking
   external script runs before the stylesheet only if it is
   placed before it; that ordering is the whole requirement.
   ============================================================ */

(function () {
	try {
		var d = document.documentElement;
		var g = function (a) {
			try {
				return d.getAttribute(a);
			} catch (e) {
				return null;
			}
		};
		var k = (g('data-cm-theme-key') || 'cm-theme')
			.split(',')
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
