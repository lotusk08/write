# write

A quiet writing app for [stevehoang.com](https://stevehoang.com):
draft in the browser, fold sections away while you work, export to Markdown or
Word, and publish straight to the blog repository — text and images in a single
commit. Posts already on the blog can be opened here and edited in place.

No token to remember. A small Worker holds the one GitHub token and makes the
commit; the browser sends a password to reach it, typed once a sitting, or
signs in with a passkey saved the first time. Opening a published post asks for nothing at all — the
password is for sending, not for reading. No GitHub credential ever touches the
browser.

```
.
├── src/          the editor app (Vue 3 + text-editor-vue)
├── worker/       the API routes, and the password and passkeys in front of them
├── shared/       the GitHub commit flow, the post types, base64
└── wrangler.jsonc
```

> This repository began as a fork of [BlockNote](https://github.com/TypeCellOS/BlockNote).
> That tree now lives on the `blocknote-upstream` branch; `main` is this app.

## What it does

- **Collapsible sections.** Type `>>> ` (or `::: `) at the start of a line, or
  press `⌘⇧D`. Each section folds with the toggle in the margin, and the toolbar
  has *Collapse all* / *Expand all*. They export as `<details>…</details>`,
  which the blog renders as a real disclosure widget with its body still read
  as Markdown.
- **Drafts.** Everything is stored locally in IndexedDB and autosaves ~600 ms
  after you stop typing, and again as the tab closes or goes to the
  background. Photos are kept as they arrived and survive reloads; the editor
  shows a lighter copy, and photos no draft uses are cleared after a day. The open draft renames in place on a double-click and carries
  the delete button.
- **Front matter.** Title, description, slug (made from the title), date,
  topics, language, cover image, the pin (off, pinned, or 2nd or 3rd on the
  home page) and the `toc` switch the blog uses. A field the app has no box
  for, such as `redirect_from` or `hidden`, is kept as it was written. It is written the
  way the published posts already are — block sequences, no unnecessary
  quoting, empty fields omitted — so re-publishing a post never moves a line
  of its front matter.
- **Quotes and callouts.** A plain quote has its own button; quotes can carry
  the blog's five note styles, exported as `{: .info}` and friends, plus
  `{: .author}` for a quote with its author, and `{: .poem}` for a poem
  without one: the same centred quote, its last stanza kept a stanza.
- **Shortcuts.** Markdown as you type (`**bold**`, `[text](url)`, `- [x] `,
  `---` …) and the ⌘ keys the old editor had; Tab nests list items.
- **Paste.** From Google Docs, Word or a web page, keeping headings, lists,
  bold and italic and dropping fonts and colours; pasted Markdown becomes
  formatting.
  Body headings start at H2, since the title lives in front matter.
- **The blog's own formats.** `{: .path}` code, the ```` ```gallery ````
  fence, made from a run of photos with one button (several photos added at
  once become one), its photos added, moved and removed in place, and
  `<EmbedYoutube id="…" />` players are first-class here — paste a YouTube or X
  link, or an audio or video file's address, and the right component is
  written for you. Any other attribute list a post carries is kept exactly as
  written, so editing a post does not rewrite lines you did not touch.
- **Seeing what the blog will render.** Diagrams (`diagram` fences in Mermaid syntax, drawn with Pele, as
  the blog does) and Chart.js charts are drawn live above their source; embedded videos play in
  place. The libraries load only when a post actually uses them.
- **Markdown when you want it.** The **MD** button in the dock swaps the page
  view for the raw Markdown — exactly what gets published — and back.
- **Editing published posts.** *Open from the site* in the menu, or a link to
  `?edit=src/posts/…`, opens a post here. Its images are not re-encoded or re-uploaded,
  and re-publishing commits back to the file it came from, refusing if the post
  changed on the site since it was opened.
- **The blog's posts and drafts.** *Open from the site*, under the menu's
  buttons, lists the posts in the blog's `src/posts` and the drafts in its
  `src/drafts`; open one, keep a draft a draft, or publish it as a post, which
  moves it out of `src/drafts` in the same commit. Above the posts stand the
  home page's first three: pin a post, put it 2nd or 3rd, or swap the two,
  and save it to the site as one commit that changes only the `pin:` lines.
- **Export.** Markdown (with front matter), Word `.docx` (images embedded), a
  self-contained HTML file, or Markdown straight to the clipboard.
- **Review, then publish.** The publish dialog shows what is about to go out
  — warnings with their fixes, where it lands, the post as readers see it,
  each photo with its final name, renames, and a diff against the site — then
  counts the photos up and links the commit and the live post. Commits `src/posts/YYYY-MM-DD-slug.md` — or `src/drafts/…` — plus
  every image, in one commit, the photos sent one per request first. Images are
  named from their alt text (`public/assets/img/post/<slug>-<alt>.jpg`,
  `<slug>-N.jpg` with none), a published photo whose name no longer follows its
  alt is renamed and its old address redirected, the Markdown is rewritten to
  point at the address they are served from, and the site's own build converts
  them to WebP. Publish as Post or Draft; either way it is one
  commit to the blog's branch.

Drafts sit as vertical tabs along the left edge, Obsidian-style: the draft you
are editing spells out its title, and the rest tuck behind each other like
sheets in a deck, showing only their edges. Reaching for a deck fans it back out
to full size — the drafts above the open one and those below it fan separately.
The formatting toolbar is docked inside the bottom of the editor frame, and the
menu at its right end holds, in one panel, the front matter, export and
sharing, with Publish, Share, Export, Copy and View along its foot — so
nothing sits above the page.

Shortcuts: `⌘S` save now · `⌘⇧N` new draft · `⌘\` open/close the menu ·
`⌘⇧C` copy Markdown · plus the usual Markdown input rules (`#`, `-`, `1.`, `>`,
` ``` `, `---`).

## Local development

```bash
npm install
npm run dev          # http://localhost:5173 — the editor, without /api
npm run typecheck    # vue-tsc across the app, worker, shared and tests
npm run lint         # ESLint
npm test             # Vitest — round-trips the blog's posts if ../stevehoang.com is there
npm run check        # all three
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
holds the route — so the deploy lands on the name an `?edit=` link points at,
with nothing to attach by hand. The Worker's code is `worker/index.ts`: it
answers `/api` and serves `dist` for everything else.

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
It is the only thing the browser is ever trusted with, and only for a sitting:
the first publish after the app opens asks for it, and it is held in session
storage until the tab closes — or the app goes away on a phone — then asked for
again. Nothing stores it. It guards sending, not reading — a post under
`src/posts` opens without it, because it is on the blog anyway; a draft does not. Until it is set the Worker refuses to
publish at all — an endpoint holding a write token with nothing in front of it
is worse than a broken one, so it fails closed and says so.

Changing the password locks every session out at once: the next publish gets a
401, drops what it held, and asks. Revoking the token on GitHub stops the
Worker itself. Those are the two independent ways back.
