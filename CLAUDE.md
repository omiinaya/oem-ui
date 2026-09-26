# CLAUDE.md

See [AGENTS.md](AGENTS.md) — it is the canonical guide for agents in this
repo. This file exists because tooling looks for it.

Short version: `tokens.css` is the contract, every value lives there, the
runtime needs a real `<script src>` tag (Astro tree-shakes the import), and
`npm test && npm run build` must both be green before you push.
