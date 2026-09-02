# write

A Tiptap-based writing app for [stevehoang.com](https://stevehoang.com): drafts
live in the browser and posts are published to the Jekyll blog repository.
Published posts can be read back out of the repository and edited here, so the
app has to be able to write a post it did not create without changing it.

The blog is reached through this app's own Worker, which holds two secrets: one
fine-grained GitHub token (Contents: read and write) and a `WRITE_PASSWORD`. No
GitHub credential ever reaches the browser. What the browser sends is that
password, as `x-write-password` on every `/api` call — typed once on a device
and remembered, so publishing is one button rather than a password prompt per
post.

Reading and writing are not the same privilege, so they are not asked for the
same way. A published post opens without the password: `_posts` is on the blog
already, and the *Edit this post* link should land you in the editor rather than
at a prompt. Drafts do not — they are the writing nobody has seen — and neither
does publishing. So the password appears in one place, the publish dialog.

The Worker fails closed: with no `WRITE_PASSWORD` set it refuses to publish at
all, because it would otherwise be an open endpoint holding a write token.

`401` is reserved for that password and nothing else — it is the app's cue to
forget what it stored and ask again, so GitHub's own 401 and 403 are reported
as `502` instead. A bad deployment token must never look like a bad password.
Everything to do with media — WebP, placeholders, sizes — belongs to the blog's
own build, not here.

This repository began as a fork of BlockNote. That tree is preserved on the
`blocknote-upstream` branch — `main` is this app, at the repository root, with
its own npm lockfile.

## Commands

- `npm run dev` — Vite on :5173. The editor only; `/api` is not there, so
  publishing and `?edit=` need `wrangler dev` (which serves `dist`, so build
  first) with a `.dev.vars` holding `GITHUB_TOKEN` and `WRITE_PASSWORD`.
- `npm run typecheck` — `tsc -b` across the app, `worker/` and `shared/`.
- `npm run build` — emits `dist`, flat. Wrangler bundles `worker/` itself, so
  there is no Cloudflare plugin in the Vite build and nothing nested under
  `dist`.
- `npm run deploy` — builds, then `wrangler deploy`. The custom domain lives on
  this Worker; deploying anywhere else leaves the old app on it.

## Layout

- `src/` — the editor. `src/editor/extensions/` holds the custom Tiptap nodes:
  collapsible sections, blog callouts (`{: .note-* }`, `{: .author }`),
  IndexedDB-backed images, `{% include embed/… %}` players, mermaid/chart/TeX
  previews, and the attribute lists the blog lays posts out with.
- `src/lib/` holds storage, export and publishing logic. `markdown.ts` writes a
  post; `import.ts` reads one back and is the inverse of it. `viewport.ts`
  measures the part of the window a phone keyboard leaves on screen; the shell
  is pinned to it and every pop-up is placed against it, not `innerHeight`.
- `worker/index.ts` — the only thing holding a credential. The blog endpoints
  (`/api/config`, `/api/source`, `/api/publish`), the share endpoints
  (`/api/share`, `/api/share/<token>`), a constant-time check on the
  password, and path validation against the configured directories so a leaked
  password cannot rewrite workflows. `worker/share.ts` is the `ShareRoom`
  Durable Object behind sharing: a y-websocket server, one room per token.
- `shared/` — GitHub calls, base64 and the post types. No DOM in it, so it is
  read by both the app and the Worker; `lib/api.ts` is the browser's only door
  to the network, and it only ever calls `/api`.

## Publishing format

The blog's build runs `update-lqip.js`, which re-serialises post front matter
with js-yaml. `buildFrontMatter` in `src/lib/markdown.ts` is written to be a
fixed point of that pass: block sequences, js-yaml's plain-scalar quoting rules,
and no empty keys (a bare `description:` would come back as the string `null`).
Change it only alongside a round-trip check against those exact options.

Body output follows the blog too: headings start at H2, images go under
`assets/img/post`, and blockquotes can carry the site's `{: .note-* }` callout
classes.

Images are published in the format they arrived in, named from it. The blog's
build converts them — `convert-images.js` runs ahead of the LQIP pass, writes
WebP and repoints the post that referenced them — because that is the one end
with a real encoder: WebKit has none behind its canvas, so converting here
never worked from an iPhone, which is where most of these photos come from.

Nothing is written back to the repository afterwards, so a published post keeps
pointing at the file it was published with while the site serves the WebP made
from it. The image node tries the WebP when the original 404s, which is what a
photo published as a JPEG does once the site has been built.

## Round-tripping published posts

`import.ts` parses a post into the editor's schema and `markdown.ts` writes it
back. Editing a published post must not change what the blog renders, so the two
are checked against the real corpus rather than by eye: parse every post in
`../stevehoang.com/_posts`, re-serialise it, render both versions with kramdown
and compare the HTML. Use the options the site actually builds with —
`input: GFM` and **`hard_wrap: true`** (`_config.yml`). This note used to say
`hard_wrap: false`, which is a different renderer: under it a lone newline is a
wrap, under the real one it is a `<br>`. Every line break in the corpus was
being scored against the wrong answer.

At the time of writing **57 of 63 posts render identically** once whitespace
runs are collapsed, and 26 byte for byte — the others differ only in whitespace
kramdown copies through from stray trailing spaces in the source. The 6 that
really differ are older posts with unbalanced `*` and the like, which kramdown
and this parser recover from differently. Treat a drop in 57 as a regression.

Things that took a bug to learn, and that a change here can quietly undo:

- A blockquote runs to the next blank line: headings, lists and fences written
  under it without a `>` belong to it.
- A list marker indented four spaces or more is not a list — it continues the
  block above. Tabs indent by columns, not by one character.
- An image and the line under it are one paragraph, and the blog styles that
  line as a caption; a row of images is one paragraph too. `joinPrevious` keeps
  those together on the way out, and the row's `{: .d-flex .c-center }` belongs
  on the last image of the run — Kramdown reads the list under the last line as
  the whole paragraph's. That is what the row tool and a multi-photo insert
  build, and `rowAttributes` in `import.ts` is what puts it back there.
- A Kramdown attribute list attaches to whichever neighbour is not separated
  from it by a blank line, and it is parsed with quoted values taken whole —
  the base64 inside `lqip="…"` contains things that look like classes and
  widths.
- `w=` and `h=` in an attribute list are the image's natural dimensions, written
  by the blog's build. Display width is a class (`.w-50`, `.w-75`).
- Code spans are literal: escaping them writes the backslashes into the code.
  A link wraps its emphasis, not the other way round.
- Footnote references are syntax, not text to escape.
- Enter writes a line break; Enter again on the line it just made starts a
  paragraph. A phone keyboard has no Shift+Enter, so that was the only way to
  say `<br>` and every line of a poem became its own paragraph — a `>` gap
  between each one, and an attribution several gaps below the quote it belonged
  to. `lineBreak.ts`, and only where a paragraph flows: a list item, a table
  cell and a section summary keep their own Enter.
- Every newline inside a paragraph is a `<br>`: the site sets `hard_wrap: true`.
  Reading one as a wrap and joining the lines with a space took a break out of
  every post opened here, and writing a break as two trailing spaces left the
  spaces sitting in front of the `<br />` kramdown made of them. A bare newline
  each way is the break and the whole of it.
- A caption written beside its image and one written under it are the same
  paragraph but not the same rendering — the second has a `<br>` before it. Which
  side it was on rides on the block as `sameLine`, and like every block
  attribute it must be declared in `BlockAttributes` — the schema strips what
  it does not know the first time a document passes through the editor, which
  is a silent way to lose exactly this kind of fact.
- The break that ends the line an image sits on is layout, not text. Left in the
  run it becomes a paragraph between two images, which is a blank line on the way
  out, and a blank line is the end of the row.
- A photo in a row carries `{: .normal .gap }`. `.gap` is `margin-right: 0.25rem`
  in the blog's stylesheet, so the spacing between photos is the site's to set;
  the editor reads the same class rather than inventing a margin of its own.
- Front matter the app has no field for survives anyway. `image.lqip` and
  `redirect_from` are the two the blog actually uses, and both are written by
  something other than this app — losing them on an edit would blank a
  placeholder or break every old URL into a post. Unknown top-level keys are
  kept as their raw lines and written back at the end.
- `image:` is written `path, alt, lqip`, because `update-lqip.js` does
  `frontMatter.image.lqip = …` and a new key in JavaScript lands last. That is
  the order a post published from here comes back in, so re-publishing moves
  nothing.
- A bare `null` in front matter is YAML's null, not the word: reading it as
  text put "null" in the description of every post that had none, and writing
  it back quoted made it permanent. Quoted `"null"` is still text.
- The five switches are coerced with `Boolean()` before interpolation. A draft
  saved before one of them existed writes `undefined` otherwise, which YAML
  reads back as a string — and a string is true.

In an `.author` quote the site styles the last paragraph as the attribution —
right-aligned, italic, the dash added by CSS — and the editor now shows the
same, so where the name goes is visible while writing rather than a convention
to remember. The stanza flow inside a quote: Enter is a line break, Enter twice
is a `>` gap (a new paragraph, still in the quote), and Enter on that empty
paragraph is the way out of it.

The publish password lives in session storage (`src/lib/password.ts`), never in
Settings: one prompt per sitting, and closing the tab — or the app going away
on a phone — is what forgets it.

## Sharing a draft

The Share tab holds one switch and a name — no password. The password guards
the blog, and a share room holds no credential: the draft is copied into a
`ShareRoom` Durable Object and the app hands back `?share=<token>`, and that
token is the whole credential, for joining and for ending alike — the link
opens the same live document for anyone holding it, the same trade `?edit=`
makes. What an open create endpoint gives away is bounded instead of gated: a
seed is capped at ~4 MB, and a room deletes itself after 14 idle days through
a Durable Object alarm (open sockets and fresh edits push the expiry out, and
the alarm re-arms itself), so neither an abandoned link nor a stranger
POSTing rooms at `/api/share` grows storage forever. Turning the switch off
(or deleting the draft — that always ends its room now) deletes the room and
closes every connection with code 4404, which each participant's app reads as
the cue to drop the token and carry on with its local copy — autosave ran the
whole time, so nothing typed together is lost. A room that ended while every
tab was closed never got to send 4404, so joining a stored token also asks
the room whether it is still live and drops the token only on a definite
"ended" — an unreachable network must not be read as one, or going through a
tunnel would detach every phone from a live room. While a draft carries a
`shareToken` the editor runs on Yjs (`src/lib/share.ts` client-side): its own
undo is off, content comes from the room rather than `setContent`, and carets
show who is where. The name above the switch is how a caret is labelled: kept
per device, prefilled with a random two-word name so nobody has to invent
one, and applied live through awareness when edited mid-session — not the
author setting, which defaults the same on every device and once filled a
room with carets all reading "steve". Turning the switch on keeps the seed
update it sent to create the room and applies it to the local doc on join, so
the sharer's own text stays on screen instead of blanking until the first sync
returns; the switch itself shows the state it is heading to while the request
runs rather than snapping back until the token lands. Only the body is
shared; title and front matter stay per-device. Trying it locally means
`wrangler dev` — the room is a Durable Object, and Vite serves no `/api`. In
wrangler's local runtime a binary WebSocket message arrives as a Blob, not the
ArrayBuffer production hands over, so the room reads both.

## Editing a published post

`?edit=<repo path>` — what the blog's own edit button links to — reads the post
through `/api/source`, which asks no password for anything under `_posts`, and
opens it as a draft whose `publishedPath` is that file, so re-publishing lands on the same path rather than making a copy. Images
already on the blog are left alone: not re-encoded, re-uploaded or renamed, and
a newly added image is numbered past every name the post already uses.
