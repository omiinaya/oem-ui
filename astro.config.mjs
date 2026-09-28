// @ts-check
import { defineConfig } from 'astro/config';

// The showcase is a plain Astro static site with NO extra integrations.
// Everything it renders comes out of ./src (the library itself), so a
// successful `npm run build` is a real compile of every component.
export default defineConfig({
	// TWO hosts serve this build, and they need DIFFERENT bases:
	//
	//   https://omiinaya.github.io/oem-ui/  ->  base /oem-ui/
	//   https://ui.mrx.sh/                  ->  base /
	//
	// A custom domain is served from its own root, so the prefix that is
	// mandatory on the Pages fallback URL is exactly wrong there: with
	// base=/oem-ui/ the custom domain requests /oem-ui/_astro/*.css, which
	// 404s, and the page renders completely unstyled. The domain build is
	// the canonical one; the fallback gets a separate job below.
	site: process.env.SITE_URL ?? 'https://ui.mrx.sh',
	base: process.env.SITE_BASE ?? '/',
	outDir: './dist',
	build: { format: 'directory' },
	// The dev/preview servers bind 0.0.0.0 so the showcase is reachable
	// from any device on the LAN. Astro's default is 127.0.0.1, which
	// means "connection refused" from a phone or laptop. The npm scripts
	// also pass --host 0.0.0.0 for older Astro versions that ignore this.
	server: { host: true },
});
