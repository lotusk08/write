# write

A quiet, Tiptap-based writing app for [stevehoang.com](https://stevehoang.com):
draft in the browser, fold sections away while you work, export to Markdown or
Word, and publish straight to the blog repository — text and images in a single
commit. Posts already on the blog can be opened here and edited in place.

It is static files and nothing else — no server, no API of its own, nothing to
pay for. Publishing is a GitHub call from the browser, with fine-grained tokens
you keep in Settings: one that can only read, and one that can write, kept
locked until the moment you publish.

```
.
├── src/          the editor app (React + Tiptap 3)
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
npm run dev          # http://localhost:5173
npm run typecheck    # tsc across the app and shared
npm run build        # dist
```

## Deploying

Any static host will do. On Cloudflare:

```bash
npx wrangler login
npm run deploy       # builds, then uploads dist as a Pages project
```

Attach `write.stevehoang.com` to that project in the dashboard — the blog's
*Edit this post* button links to that name, so keep the two in step. For
deploys on push, connect the repository under Workers & Pages → Builds: root
directory `/`, build command `npm run build`, output directory `dist`. Node
comes from `.node-version`.

### The two tokens

Reading the blog and writing to it are different privileges, so they are
different fine-grained tokens on `lotusk08/stevehoang.com` and nothing else.

Both are pasted once, under Settings → Blog → **Access**, which folds itself
away as soon as they are in: the only part of this you meet again is the
password at the publish step.

**Read token** — *Contents: Read*. Opens a published post for editing. It stays
in that browser as it is, because what it can reach is on the blog anyway.

**Publish token** — *Contents: Read & write*. Paste it with a password and it is
locked there (PBKDF2 + AES-GCM, in WebCrypto); the token itself is never stored.
Every publish asks for the password and opens the token for that one commit.

So a phone left unlocked reads; it does not write. Forgetting the password costs
you a token, not the blog — issue another and lock it again. Either token can be
revoked on GitHub in a minute, which is the recovery plan for both.

### Where posts go

Repository, branch and the three directories are all in Settings, and they are
the app's own — nothing hands them to it:

| Setting | Default |
| --- | --- |
| Repository | `lotusk08/stevehoang.com` |
| Branch | `blog` — the branch the posts are on |
| Posts | `_posts` |
| Drafts | `_drafts` |
| Images | `assets/img/post` |
| Site URL | `https://stevehoang.com` — where published images are previewed from |

## Notes

- The interface is deliberately neutral — monochrome greys, hairline borders,
  one violet accent, icon-only toolbar — and rides on the system sans (SF on
  Apple devices, Inter where installed), so no web fonts are downloaded.
- Front matter and settings share one pop-up rather than a sidebar, a top bar
  and two dialogs; only publishing and opening a post are modals. Settings holds
  what is yours to set: the repository, the two tokens, the paths and the post
  defaults.
- Reading a published post back is the inverse of writing one, and is checked
  against the real blog: every post is parsed, re-serialised and rendered with
  kramdown, and 60 of 62 come out byte-identical. The two that differ have
  unbalanced `*` in the source. `CLAUDE.md` lists what that exercise taught.
- Images go up in the format they arrived in. Converting them here meant
  carrying a WebP encoder in the page, because WebKit has none behind its
  canvas — and the blog's own build is better placed to do it: `npm run build`
  there converts every post image to WebP and fills in the placeholders and
  intrinsic sizes, on the way to the site and without writing back.
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
