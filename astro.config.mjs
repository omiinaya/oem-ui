// @ts-check
import { defineConfig } from 'astro/config';

// The showcase is a plain Astro static site with NO extra integrations.
// Everything it renders comes out of ./src (the library itself), so a
// successful `npm run build` is a real compile of every component.
export default defineConfig({
	site: 'https://cli-mono.example.com',
	base: '/',
	outDir: './dist',
	build: { format: 'directory' },
});
