# write

A Tiptap-based writing app for [stevehoang.com](https://stevehoang.com): drafts
live in the browser, posts are published to the Jekyll blog repository, and the
whole thing runs on Cloudflare Workers.

This repository began as a fork of BlockNote. That tree is preserved on the
`blocknote-upstream` branch — `main` is this app, at the repository root, with
its own npm lockfile.

## Commands

- `npm run dev` — Vite on :5173, with `worker/index.ts` running in workerd, so
  the `/api` routes behave as they do once deployed.
- `npm run typecheck` — `tsc -b` across the app, the worker and `shared/`.
- `npm run build` — emits `dist/client` (SPA) and `dist/write` (Worker).
- `npm run deploy` — builds, then deploys with the generated Worker config.

## Layout

- `src/` — the editor. `src/editor/extensions/` holds the custom Tiptap nodes:
  collapsible sections, blog callouts (`{: .note-* }`) and IndexedDB-backed
  images. `src/lib/` holds storage, export and publishing logic.
- `worker/index.ts` — `/api/config`, `/api/publish`, `/api/posts`. It only ever
  writes inside the configured post/draft/image directories, and only to
  `BLOG_REPO`.
- `shared/` — imported by both sides; keep it free of DOM APIs.

## Publishing format

The blog's build runs `update-lqip.js`, which re-serialises post front matter
with js-yaml. `buildFrontMatter` in `src/lib/markdown.ts` is written to be a
fixed point of that pass: block sequences, js-yaml's plain-scalar quoting rules,
and no empty keys (a bare `description:` would come back as the string `null`).
Change it only alongside a round-trip check against those exact options.

Body output follows the blog too: headings start at H2, images are WebP under
`assets/img/post` so the LQIP pass picks them up, and blockquotes can carry the
site's five `{: .note-* }` callout classes.
