/**
 * oem-ui site config — the ONE place to set your identity.
 * Copy to src/config.ts in your project and edit.
 *
 * The header renders `$ <title>`, so the title is a shell prompt, not a
 * page heading: `oem/ui` prints as `$ oem/ui`, the same way the other oem
 * sites print `$ oem/links` and `$ oem/log`. It is the project's own name,
 * so a consumer that copies this file must change it.
 */

export const SITE = {
	title: 'oem/ui',
	description: 'one line about the site',
	author: '@handle',
	email: 'you@example.com',
	github: 'https://github.com/you',
	url: 'https://example.com',
} as const;
