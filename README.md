# write

A quiet, Tiptap-based writing app for [stevehoang.com](https://stevehoang.com):
draft in the browser, fold sections away while you work, export to Markdown or
Word, and publish straight to the blog repository — text and images in a single
commit. Posts already on the blog can be opened here and edited in place.

It runs entirely on Cloudflare: the SPA is served from Workers static assets and
a small Worker handles publishing.

```
.
├── src/          the editor app (React + Tiptap 3)
├── worker/       the Cloudflare Worker: /api/config, /api/publish, /api/posts, /api/source
├── shared/       code both sides use (GitHub commit flow, types, base64)
└── wrangler.jsonc
```

> This repository began as a fork of [BlockNote](https://github.com/TypeCellOS/BlockNote).
> That tree now lives on the `blocknote-upstream` branch; `main` is this app.

## What it does

- **Collapsible sections.** Type `>>> ` (or `::: `) at the start of a line, or
  press `⌘⇧D`. Each section folds with the caret in the margin, and the toolbar
  has *Collapse all* / *Expand all*. They export as
  `<details markdown="1">…</details>`, which Jekyll renders as a real disclosure
  widget.
- **Drafts.** Everything is stored locally in IndexedDB and autosaves ~600 ms
  after you stop typing. Images are kept as blobs so drafts stay small and
  survive reloads. The open draft renames in place on a double-click and carries
  the delete button.
- **Front matter.** Title, description, slug, date, author, categories, tags,
  cover image, and the `pin` / `toc` / `math` / `mermaid` / `chart` switches the blog
  already uses. It is written the way the blog's own `update-lqip.js` would
  write it — block sequences, no unnecessary quoting, empty fields omitted — so
  a site build never rewrites a published post's front matter.
- **Callouts.** Quotes can carry the blog's five note styles, exported as
  `{: .note-info }` and friends, plus its centred `{: .author }` attribution.
  Body headings start at H2, since the title lives in front matter.
- **The blog's own formats.** `{: .filepath}` code, centred image rows
  (`{: .d-flex .c-center }`) and `{% include embed/… %}` players are first-class
  here — paste a YouTube, X, Spotify, Bilibili or Twitch link and the right
  include is written for you. Any other attribute list a post carries is kept
  exactly as written, so editing a post does not rewrite lines you did not touch.
- **Seeing what the blog will render.** Mermaid diagrams, Chart.js charts and
  `$$ … $$` maths are drawn live above their source; embedded videos play in
  place. The libraries load only when a post actually uses them.
- **Markdown when you want it.** The **MD** button in the dock swaps the page
  view for the raw Markdown — exactly what gets published — and back.
- **Editing published posts.** The blog's *Edit this post* button opens the post
  here (`?edit=_posts/…`). Its images are left alone — not re-encoded, renamed
  or re-uploaded — and re-publishing commits back to the file it came from.
- **Export.** Markdown (with front matter), Word `.docx` (images embedded), a
  self-contained HTML file, or Markdown straight to the clipboard.
- **Publish.** Commits `_posts/YYYY-MM-DD-slug.md` — or `_drafts/…` — plus every
  image, in one commit. Images are re-encoded to WebP and renamed to the blog's
  flat convention (`assets/img/post/<slug>.webp`, `<slug>-1.webp`, …), and the
  Markdown is rewritten to point at those paths. Optionally opens a pull request
  on a `post/<slug>` branch instead of committing to `main`.

Drafts sit as vertical tabs along the left edge, Obsidian-style: the draft you
are editing spells out its title, and the rest tuck behind each other like
sheets in a deck, showing only their edges. Reaching for a deck fans it back out
to full size — the drafts above the open one and those below it fan separately.
The formatting toolbar is docked inside the bottom of the editor frame, and the
menu at its right end holds front matter, settings, export and publish — so
nothing sits above the page.

Shortcuts: `⌘S` save now · `⌘⇧N` new draft · `⌘\` open/close the menu ·
`⌘⇧C` copy Markdown · plus the usual Markdown input rules (`#`, `-`, `1.`, `>`,
` ``` `, `---`).

## Local development

```bash
npm install
npm run dev          # http://localhost:5173 — Vite plus the Worker in workerd
```

To exercise server-side publishing locally, copy `.dev.vars.example` to
`.dev.vars` and fill it in. `.dev.vars` is git-ignored.

```bash
npm run typecheck    # tsc across app, worker and shared
npm run build        # dist/client (SPA) + dist/write (Worker)
```

## Deploying to Cloudflare

```bash
npx wrangler login
npm run deploy       # builds, then uploads the Worker and the static assets
```

`wrangler.jsonc` already claims `write.stevehoang.com` as a custom domain, which
needs that zone on the same Cloudflare account. Drop the `routes` entry to
publish to `https://write.<your-subdomain>.workers.dev` instead — but the blog's
*Edit this post* button links to the custom name, so keep the two in step.

### Choose how the GitHub token is held

**Server-side (recommended).** The token lives as a Worker secret and never
reaches the browser; the app just sends a password.

```bash
npx wrangler secret put GITHUB_TOKEN     # fine-grained PAT, see below
npx wrangler secret put WRITE_PASSWORD   # asked for when you publish
```

Both are required together: with a token but no password, the Worker refuses to
publish rather than leave an open write endpoint on the internet, and says so in
the app. The password is typed at the moment you publish and never stored, so
writing and previewing need nothing at all.

Paste the token at the prompt rather than piping it in — a trailing newline
makes GitHub treat the request as anonymous, and a private repo answers that
with a flat *not found*. If a post will not open, the app says whether the token
was rejected outright or simply was never granted the repository.

**Browser-side.** Deploy with no secrets at all and paste a fine-grained token
into Settings; it is kept in that browser's local storage and talks to
`api.github.com` directly. Fine for a private machine, and it is also what makes
the app work on any static host (including Cloudflare Pages via
`npx wrangler pages deploy dist/client`).

The token needs **Contents: Read & write** on `lotusk08/stevehoang.com` only.

### Continuous deploys

Connect the repository in the Cloudflare dashboard under Workers → Builds. The
defaults are right for this repo — root directory `/`, build command
`npm run build`, deploy command `npx wrangler deploy` — because the app sits at
the repository root with its own npm lockfile. Node comes from `.node-version`.

### Configuration

Non-secret settings live in `wrangler.jsonc` under `vars`, and the app reads
them from `/api/config` at boot:

| Var | Default |
| --- | --- |
| `BLOG_REPO` | `lotusk08/stevehoang.com` |
| `BLOG_BRANCH` | `blog` — the branch the posts are on |
| `POSTS_DIR` | `_posts` |
| `DRAFTS_DIR` | `_drafts` |
| `IMAGES_DIR` | `assets/img/post` |
| `SITE_URL` | `https://stevehoang.com` — where published images are previewed from |

The Worker will only ever write inside those three directories, and only to
`BLOG_REPO` — a request cannot point it somewhere else. `/api/source`, which
reads a post back out for editing, is limited to the same directories and sits
behind the same password, since the blog repository is private.

## Notes

- The build writes two directories: `dist/client` (the SPA) and `dist/write`
  (the Worker plus a generated `wrangler.json` pointing at those assets). The
  deploy script passes that generated config to Wrangler explicitly, so a CI
  job can build and deploy in separate steps.
- The interface is deliberately neutral — monochrome greys, hairline borders,
  one violet accent, icon-only toolbar — and rides on the system sans (SF on
  Apple devices, Inter where installed), so no web fonts are downloaded.
- Front matter and settings share one pop-up rather than a sidebar, a top bar
  and two dialogs; only publishing and opening a post are modals. Settings holds
  what is yours to set — with a Worker publishing, there is no repository, token
  or path to configure here.
- Reading a published post back is the inverse of writing one, and is checked
  against the real blog: every post is parsed, re-serialised and rendered with
  kramdown, and 60 of 62 come out byte-identical. The two that differ have
  unbalanced `*` in the source. `CLAUDE.md` lists what that exercise taught.
- Publishing through the GitHub API bypasses the blog's local pre-commit hook,
  so images are converted to WebP here instead — which also keeps them eligible
  for the LQIP pass, whose regex only matches `.webp` under `assets/img`.
  Placeholders and intrinsic sizes are still filled in by the blog's own
  `npm run build`.
- The app is a standalone npm project inside this repository; it does not join
  the BlockNote pnpm workspace and has no dependency on the packages around it.

## License

MIT © [Steve Hoang](https://stevehoang.com) — see [LICENSE](LICENSE).

The repository began as a fork of
[BlockNote](https://github.com/TypeCellOS/BlockNote) (MPL-2.0); that tree is
preserved on the `blocknote-upstream` branch under its own licence. No code
from it remains on `main`.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue
or a pull request.
