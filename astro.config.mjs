// @ts-check
import { defineConfig } from 'astro/config';

// The showcase is a plain Astro static site with NO extra integrations.
// Everything it renders comes out of ./src (the library itself), so a
// successful `npm run build` is a real compile of every component.
export default defineConfig({
	site: 'https://oem-ui.example.com',
	base: '/',
	outDir: './dist',
	build: { format: 'directory' },
	// The dev/preview servers bind 0.0.0.0 so the showcase is reachable
	// from any device on the LAN. Astro's default is 127.0.0.1, which
	// means "connection refused" from a phone or laptop. The npm scripts
	// also pass --host 0.0.0.0 for older Astro versions that ignore this.
	server: { host: true },
});
