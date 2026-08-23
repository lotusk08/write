# write

A Tiptap-based writing app for [stevehoang.com](https://stevehoang.com): drafts
live in the browser, posts are published to the Jekyll blog repository, and the
whole thing runs on Cloudflare Workers. Published posts can be read back out of
the repository and edited here, so the app has to be able to write a post it did
not create without changing it.

This repository began as a fork of BlockNote. That tree is preserved on the
`blocknote-upstream` branch — `main` is this app, at the repository root, with
its own npm lockfile.

## Commands

- `npm run dev` — Vite on :5173, with `worker/index.ts` running in workerd, so
  the `/api` routes behave as they do once deployed. Secrets come from
  `.dev.vars`; without them the app reports `publishMode: "browser"`.
- `npm run typecheck` — `tsc -b` across the app, the worker and `shared/`.
- `npm run build` — emits `dist/client` (SPA) and `dist/write` (Worker).
- `npm run deploy` — builds, then deploys with the generated Worker config.

## Layout

- `src/` — the editor. `src/editor/extensions/` holds the custom Tiptap nodes:
  collapsible sections, blog callouts (`{: .note-* }`, `{: .author }`),
  IndexedDB-backed images, `{% include embed/… %}` players, mermaid/chart/TeX
  previews, and the attribute lists the blog lays posts out with.
- `src/lib/` holds storage, export and publishing logic. `markdown.ts` writes a
  post; `import.ts` reads one back and is the inverse of it.
- `worker/index.ts` — `/api/config`, `/api/publish`, `/api/posts`,
  `/api/source`. It only ever writes inside the configured post/draft/image
  directories, and only to `BLOG_REPO`; `/api/source` reads from the same
  directories and is behind the same password, because the blog repo is private.
- `shared/` — imported by both sides; keep it free of DOM APIs.

## Publishing format

The blog's build runs `update-lqip.js`, which re-serialises post front matter
with js-yaml. `buildFrontMatter` in `src/lib/markdown.ts` is written to be a
fixed point of that pass: block sequences, js-yaml's plain-scalar quoting rules,
and no empty keys (a bare `description:` would come back as the string `null`).
Change it only alongside a round-trip check against those exact options.

Body output follows the blog too: headings start at H2, images are WebP under
`assets/img/post` so the LQIP pass picks them up, and blockquotes can carry the
site's `{: .note-* }` callout classes.

## Round-tripping published posts

`import.ts` parses a post into the editor's schema and `markdown.ts` writes it
back. Editing a published post must not change what the blog renders, so the two
are checked against the real corpus rather than by eye: parse every post in
`../stevehoang.com/_posts`, re-serialise it, render both versions with kramdown
(`input: GFM`, `hard_wrap: false`) and compare the HTML.

At the time of writing **60 of 62 posts render byte-identically**. The two that
do not have unbalanced `*` in the source, which kramdown and this parser recover
from differently. Treat a drop in that number as a regression.

Things that took a bug to learn, and that a change here can quietly undo:

- A blockquote runs to the next blank line: headings, lists and fences written
  under it without a `>` belong to it.
- A list marker indented four spaces or more is not a list — it continues the
  block above. Tabs indent by columns, not by one character.
- An image and the line under it are one paragraph, and the blog styles that
  line as a caption; a row of images is one paragraph too. `joinPrevious` keeps
  those together on the way out.
- A Kramdown attribute list attaches to whichever neighbour is not separated
  from it by a blank line, and it is parsed with quoted values taken whole —
  the base64 inside `lqip="…"` contains things that look like classes and
  widths.
- `w=` and `h=` in an attribute list are the image's natural dimensions, written
  by the blog's build. Display width is a class (`.w-50`, `.w-75`).
- Code spans are literal: escaping them writes the backslashes into the code.
  A link wraps its emphasis, not the other way round.
- Footnote references are syntax, not text to escape.

## Editing a published post

`?edit=<repo path>` — what the blog's own edit button links to — reads the post
through `/api/source` and opens it as a draft whose `publishedPath` is that
file, so re-publishing lands on the same path rather than making a copy. Images
already on the blog are left alone: not re-encoded, re-uploaded or renamed, and
a newly added image is numbered past every name the post already uses.
