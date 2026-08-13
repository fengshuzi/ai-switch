# AGENTS.md — ai-switch

Obsidian plugin that syncs and prepares AI coding tool configurations for quick model switching.

## Layout

Single-file plugin — `main.ts` is the only TypeScript source. Companion files:
- `manifest.json` / `versions.json` / `styles.css` / `esbuild.config.mjs` / `eslint.config.mjs` / `tsconfig.json`
- `deploy.mjs` / `release.mjs` — maintainer scripts

## Commands

```bash
npm run dev      # esbuild watch -> dist/main.js (inline sourcemaps)
npm run build    # lint + tsc -noEmit -skipLibCheck + esbuild production
npm run lint     # eslint "**/*.{ts,tsx}"
npm run deploy   # build + copy to author's local vaults, then delete dist/
npm run release  # gh release create from manifest.json version
```

`build` enforces lint + tsc before bundling. Lint failures block the build.

## Build

- esbuild, entry `main.ts`, format `cjs`, target `es2018`
- externals: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, Node builtins
- Copies `manifest.json`, `styles.css`, and `assets/wechat-donate.jpg` to `dist/`
- `tsconfig.json` is strict; `tsc -noEmit` runs as part of build

## Lint

`npm run lint` runs `eslint "**/*.{ts,tsx}"`. Strict typed rules enforced as errors:
- `@typescript-eslint/no-explicit-any`
- `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-argument`, `no-unsafe-return`
- `no-floating-promises`, `await-thenable`

## Versioning

Keep `package.json`, `manifest.json`, and `versions.json` versions in sync. `release.mjs` reads version from `manifest.json`.

## Marketplace / Scorecard

Marketplace, manifest, and release conventions (author fields, description punctuation, `minAppVersion`, `versions.json`, Scorecard workflow) live in the parent `obsidian-plugins-parent/AGENTS.md`. Read it before touching `manifest.json`, release flow, or marketplace-facing code.