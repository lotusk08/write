# write

A quiet, Tiptap-based writing app for [stevehoang.com](https://stevehoang.com):
draft in the browser, fold sections away while you work, export to Markdown or
Word, and publish straight to the blog repository — text and images in a single
commit. Posts already on the blog can be opened here and edited in place.

No token to remember. A small Worker holds the one GitHub token and makes the
commit; the browser sends a password to reach it, typed once on a device and
remembered after that. No GitHub credential ever touches the browser.

```
.
├── src/          the editor app (React + Tiptap 3)
├── worker/       the three API routes, and the password in front of them
├── shared/       the GitHub commit flow, the post types, base64
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
npm run dev          # http://localhost:5173 — the editor, without /api
npm run typecheck    # tsc across the app, worker and shared
npm run build        # dist
npx wrangler dev     # the whole thing, /api included (serves dist — build first)
```

`wrangler dev` reads `.dev.vars` for `GITHUB_TOKEN` and `WRITE_PASSWORD`. Leave
`WRITE_PASSWORD` out and publishing stays disabled locally, which is usually
what you want.

## Deploying

Any static host will do. On Cloudflare:

```bash
npx wrangler login
npm run deploy       # builds, then uploads dist to the `write` Worker
```

`write.stevehoang.com` is a custom domain on that Worker, and `wrangler.jsonc`
holds the route — so the deploy lands on the name the blog's *Edit this post*
button links to, with nothing to attach by hand. The Worker has no `main`: it
serves `dist` and runs no code of its own.

Deploy anywhere else — a Pages project of the same name included — and the
domain stays on the Worker, serving whatever was last pushed to it. That is the
one way this can look like it worked and change nothing.

### The token, and the password in front of it

Two secrets on the Worker, and nothing anywhere else:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WRITE_PASSWORD
```

`GITHUB_TOKEN` is one fine-grained token on `lotusk08/stevehoang.com` and
nothing else, *Contents: Read & write*. Paste it at the prompt rather than
piping it — a trailing newline makes GitHub treat the request as anonymous,
which a private repo answers with a flat "not found".

`WRITE_PASSWORD` is the whole of what stands in front of it, so make it long.
It is the only thing the browser is trusted with: the app asks for it the first
time you publish on a device, keeps it once it works, and never asks again
until the Worker's answer changes. Until it is set the Worker refuses to
publish at all — an endpoint holding a write token with nothing in front of it
is worse than a broken one, so it fails closed and says so.

Changing the password locks every browser out at once: the next publish gets a
401, forgets what it had, and asks. Revoking the token on GitHub stops the
Worker itself. Those are the two independent ways back.
