// @ts-check
import { defineConfig } from 'astro/config';

// The showcase is a plain Astro static site with NO extra integrations.
// Everything it renders comes out of ./src (the library itself), so a
// successful `npm run build` is a real compile of every component.
export default defineConfig({
	// The showcase is published on GitHub Pages, which serves it from
	// /oem-ui/ on the Pages fallback host, so `base` MUST match that path or
	// every asset 404s. Both values are env-driven so a future custom domain
	// is a two-value change (SITE_URL + SITE_BASE=/) and nothing else. The
	// defaults keep the local LAN preview working with no environment set.
	site: process.env.SITE_URL ?? 'http://localhost:4321',
	base: process.env.SITE_BASE ?? '/',
	outDir: './dist',
	build: { format: 'directory' },
	// The dev/preview servers bind 0.0.0.0 so the showcase is reachable
	// from any device on the LAN. Astro's default is 127.0.0.1, which
	// means "connection refused" from a phone or laptop. The npm scripts
	// also pass --host 0.0.0.0 for older Astro versions that ignore this.
	server: { host: true },
});
