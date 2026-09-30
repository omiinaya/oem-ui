/**
 * oem-ui site config — the ONE place to set your identity.
 * Copy to src/config.ts in your project and edit.
 *
 * The header renders `$ <title>`, so the title is a shell prompt, not a
 * page heading: `oem/ui` prints as `$ oem/ui`, the same way the other oem
 * sites print `$ oem/links` and `$ oem/log`. It is the project's own name,
 * so a consumer that copies this file must change it.
 */

// The reference implementation's OWN values. A consumer copies this file and
// edits every line - each of these is a placeholder that must be replaced, and
// the copy step is the whole point of the file.
//
// `github` is load-bearing, not decoration: Header.astro turns it into the
// header's GitHub mark, and the showcase reads it from HERE. When this file
// still said `https://github.com/you` while the showcase hardcoded the real
// URL beside it, the file that advertised itself as the single source of
// truth was the one thing the page did not read.
export const SITE = {
	title: 'oem/ui',
	description: 'zero-dependency mono design system: css, js and astro components.',
	author: '@omiinaya',
	email: 'omar@mrx.sh',
	github: 'https://github.com/omiinaya/oem-ui',
	url: 'https://ui.mrx.sh',
} as const;
