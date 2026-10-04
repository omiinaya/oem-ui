/**
 * ONE implementation of "is this link the page I am on".
 *
 * This is a module, not a copy pasted into two components, because the two
 * copies already disagreed and the disagreement was invisible: `HeaderLink`
 * matched paths itself, while `Header` - which is what a consumer actually
 * renders - read a hand-written `active` boolean off each link and matched
 * nothing. A multi-page site therefore had exactly two supported options,
 * both bad:
 *
 *   - write one `active: true` per page and keep it correct by hand (four
 *     booleans that go stale the moment a path changes), or
 *   - fork `Header`. MEASURED on dev-blog: 208 lines against the library's
 *     204, differing ONLY in the nav block, whose sole content was
 *     `matchSegment={l.label === 'notes' || l.href === base + 'blog/'}`
 *     - the library's own matcher, inlined into a private copy of the
 *     header so a consumer could reach it at all.
 *
 * So `Header` calls this and `HeaderLink` calls this, and there is no third
 * spelling.
 */

/**
 * Reduce a path or href to a comparable absolute path, or null when it
 * cannot be one.
 *
 * null means "never the current page": an external or protocol-relative
 * href, because another origin is not this page however similar its path.
 */
export const normalise = (raw: string, base: string): string | null => {
	let out = raw.split('#')[0].split('?')[0];
	if (/^[a-z][a-z0-9+.-]*:/i.test(out) || out.startsWith('//')) return null;
	if (base && out.startsWith(base)) out = out.slice(base.length);
	out = out.replace(/\/+$/, '');
	/* Both sides are compared as absolute paths, so a relative remainder has
	   to get its leading slash back. Without this, stripping `/blog/` left
	   `blog`, which never equalled `/blog` and NO link was ever current. */
	if (out === '') return '/';
	return out.startsWith('/') ? out : `/${out}`;
};

/**
 * Does `href` point at the page currently being rendered?
 *
 * `matchSegment` additionally keeps a section link lit while you read a
 * child of that section ("/docs" stays current on "/docs/install"). It is
 * opt-in because the opposite behaviour is sometimes wanted: a "/v2/"
 * version link must light only on v2, not on "/v2/api". The default is the
 * stricter exact match, so opting in is a deliberate act.
 *
 * A HASH-ONLY href is never current, and that is the fix a shared
 * implementation makes possible. `normalise` drops the fragment, so on the
 * ROOT page `#nav` reduces to `/`, which equals `/` - MEASURED: every one of
 * a `#nav`, a `#` and a `/#nav` href returned `true` for `aria-current` on
 * `/`, while `/somewhere-else/` returned false. A single-page site rendered
 * with these links therefore lit its ENTIRE nav at once. The two states are
 * different facts and the library already keeps them apart on purpose (see
 * the spy note in Header.astro): `aria-current="page"` is WHERE YOU ARE, and
 * the scroll-spy's `is-active` is WHAT YOU ARE READING. An in-page link has
 * no page to be current on, so it can only ever be the second.
 */
export const isCurrentPage = (
	href: string,
	pathname: string,
	base: string,
	matchSegment = false,
): boolean => {
	/* A fragment-only href addresses a position on THIS page, not a page.
	   Checked before normalising, because normalising is exactly what erases
	   the difference and produces the all-links-lit bug. */
	if (href.trimStart().startsWith('#')) return false;

	const there = normalise(href, base);
	const here = normalise(pathname, base);
	if (there === null || here === null) return false;

	return (
		there === here || (matchSegment && there !== '/' && here.startsWith(`${there}/`))
	);
};