# write

A Tiptap-based writing app for [stevehoang.com](https://stevehoang.com): drafts
live in the browser and posts are published to the blog repository. Published
posts can be read back out of the repository and edited here, so the app has to
be able to write a post it did not create without changing it.

The blog is a Vue/Vite site built with `vite-ssg`, not Jekyll. Posts live in
`src/posts`, drafts in `src/drafts`, and images in `public/assets/img/post` —
which is served at `/assets/img/post`, so where an image is committed and the
address a post points at it by are two different strings. Markdown is rendered
by markdown-it with the blog's own plugins (`scripts/markdown/`), which keep
kramdown's attribute lists, footnotes and `hard_wrap`. Liquid is gone: a
`{% include embed/… %}` renders as its own literal text now, and an embed is a
Vue component (`<EmbedYoutube id="…" />`) instead.

The blog is reached through this app's own Worker, which holds two secrets: one
fine-grained GitHub token (Contents: read and write) and a `WRITE_PASSWORD`. No
GitHub credential ever reaches the browser. What the browser sends is that
password, as `x-write-password` on every `/api` call — typed once on a device
and remembered, so publishing is one button rather than a password prompt per
post.

Reading and writing are not the same privilege, so they are not asked for the
same way. A published post opens without the password: `src/posts` is on the
blog already, and the *Edit this post* link should land you in the editor rather
than at a prompt. Drafts do not — they are the writing nobody has seen — and neither
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
  IndexedDB-backed images, `<Embed… />` players, mermaid/chart/TeX previews,
  and the attribute lists the blog lays posts out with.
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

Body output follows the blog too: headings start at H2, images are committed
under `public/assets/img/post` and written as `/assets/img/post/…`, and
blockquotes can carry the site's `{: .note-* }` callout classes.

An embed is one of the blog's components — `<EmbedYoutube id="…" />`, and
`src=` rather than `id=` for `EmbedVideo` and `EmbedAudio`. A Liquid include is
still read, so a post written before the move opens here and is converted the
next time it is published; nothing writes one again. A component carrying more
than the one prop the editor models (`compact`, `types`, `title` …) is kept as
a raw block instead, which is written back exactly as it was found.

Images are published in the format they arrived in, named from it. The blog's
build converts them — `convert-images.js` runs ahead of the LQIP pass, writes
WebP and repoints the post that referenced them — because that is the one end
with a real encoder: WebKit has none behind its canvas, so converting here
never worked from an iPhone, which is where most of these photos come from.

Size is the one thing handled before the push: an image wider than 1760px is
redrawn to 1760 (`shrinkImage` in `src/lib/images.ts`) when it is stored, and
again at publish for drafts that still hold originals. 1760 is `MAX_WIDTH` in
the blog's `convert-images.js` — the width the build would cut it to anyway,
so nothing a reader would see is lost, and a post of phone photos stays inside
the Worker's 20 MB cap. JPEG stays JPEG and PNG stays PNG, which is what keeps
alpha; other formats, and anything that fails to re-encode or comes back
bigger, pass through whole. Downscaling works on an iPhone — it was only a
WebP encoder WebKit lacked, and this writes JPEG and PNG.

The repository does not stay as it was pushed: the assets workflow runs that
build on `blog`, and `convert-images.js` writes the WebP, deletes the file it
was made from and repoints the post, which the run commits back. The draft
here is never told, so it goes on pointing at a JPEG that is no longer there.
The image node tries the WebP when the original 404s, which is what a photo
published as a JPEG does once the site has been built.

## Round-tripping published posts

`import.ts` parses a post into the editor's schema and `markdown.ts` writes it
back. Editing a published post must not change what the blog renders, so the two
are checked against the real corpus rather than by eye: parse every post in
`../stevehoang.com/src/posts`, re-serialise it, render both versions with the
blog's own markdown-it pipeline (`scripts/markdown/index.js` — the renderer the
site ships, so there is nothing to configure to match it) and compare the HTML.
The corpus that matters is the published one, which is on the `blog` branch.

**All 75 render byte for byte**, and each settles after one pass — write a post
back twice and the second is the first. So does every draft and page beside
them, 87 files in all. Treat any of that as a regression. The ones that used to
differ were each a place where this parser had been written against kramdown,
which the site no longer runs, and they are worth knowing because markdown-it
draws every one of these lines differently:

- A blockquote is carried on past the `>` only while its last line held an open
  paragraph, and only as far as the next block. An empty `>` line closes the
  paragraph, so what follows is no longer part of the quote; a list, heading,
  fence or rule under it ends the quote outright, where kramdown swallowed
  them.
- An attribute list is one only at the head of its line and only at the end of
  its paragraph. Indented a space it is text; with another line of the
  paragraph under it, it is text there too — and the classes in it never reach
  the blog, so writing them somewhere they would apply changes the post.
- A list marker indented less than the item above it starts the next item of
  that list, however little it is indented; only one indented as far as that
  item's own text opens a list inside it.
- What separates two blocks written on one line is theirs to carry: the space
  between an image and the caption beside it is kept in the caption, so a
  photo with text hard against it comes back hard against it. The caption tool
  writes that space itself.
- Trailing spaces on the last line of a block are kept. markdown-it trims a
  paragraph of its own, so they change nothing there — but lifting an
  attribute list off the end of one leaves the space under it showing.
- Emphasis closes on the first delimiter that is not inside a code span or a
  link's address, and an address balances its own parentheses. A URL carrying
  `**` or `()` used to cut the link in half on the second pass through.
- A fence closes on a run of backticks at least as long as the one that opened
  it, and a block is written with one longer than anything inside it, so a
  ```` ```` ```` block can hold a ``` ``` ``` one. A code span is fenced the
  same way.
- A backslash escapes ASCII punctuation and nothing else, both ways. `\ne` is a
  backslash the reader is meant to see, and writing it `\\ne` puts a line break
  in the middle of an equation.
- `<https://…>` is a link whose text is its own address, and it is written back
  that way — recognised on the way out by the href matching the text, so no
  attribute has to ride along, and left unescaped, because the underscores in a
  URL are part of it.

Things that took a bug to learn, and that a change here can quietly undo:

- `<details>` is written without kramdown's `markdown="1"`, which markdown-it
  has no use for: an HTML block ends at the blank line after the `<summary>`,
  so the body is read as Markdown either way. It is read back as raw blocks
  rather than a collapsible node, which is why a section a post already carries
  is written out exactly as it was found, `markdown="1"` and all.
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
  A link wraps its emphasis, not the other way round — and because the editor
  stores marks per text node, `[a *b* c](url)` is three nodes sharing one link:
  serialised one node at a time it came out as three adjacent links, so
  `inline` in `markdown.ts` groups a run of text nodes carrying the same link
  and writes the link once, around it.
- Footnotes are nodes: `[^id]` is a `footnoteRef` and `[^id]: …` a
  `footnoteDef` whose body is the text after the colon plus lines indented
  four spaces. Kramdown does not lazily continue a definition onto an
  unindented line — it starts a new paragraph — so the parser must not
  either. A `[^id]` left as plain text still passes `escapeText` unescaped,
  which is what keeps drafts written before the node existed publishing.
- Enter writes a line break; Enter again on the line it just made starts a
  paragraph. A phone keyboard has no Shift+Enter, so that was the only way to
  say `<br>` and every line of a poem became its own paragraph — a `>` gap
  between each one, and an attribution several gaps below the quote it belonged
  to. `lineBreak.ts`, and only where a paragraph flows: a list item, a table
  cell and a section summary keep their own Enter.
- Every newline inside a paragraph is a `<br>`: the site sets `breaks: true`,
  as kramdown's `hard_wrap` did. Reading one as a wrap and joining the lines
  with a space took a break out of every post opened here, and writing a break
  as two trailing spaces left the spaces sitting in front of the `<br />` made
  of them. A bare newline each way is the break and the whole of it.
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
- `pin` and `toc` are coerced with `Boolean()` before interpolation. A draft
  saved before one of them existed writes `undefined` otherwise, which YAML
  reads back as a string — and a string is true.
- `math`, `mermaid`, `chart` and `render_with_liquid` are read and dropped, not
  kept as unknown keys: the site loads MathJax for every post and turns a
  `mermaid` or `chart` fence into its component wherever it finds one, and there
  is no Liquid left to switch off. Anything genuinely unknown is still kept.
- `BLOCKS` in `blogFormat.ts` must list every node type `parseBlocks` can push:
  an attribute list under a block is attached to whatever block came last, with
  no type filter. `horizontalRule` and `collapsible` were missing, so
  `{: .divider }` under a rule and `{: .collapse }` under a `<details>` were
  stripped the first time the post passed through the editor and deleted from
  the repository on re-publish.
- A command may run inside `can()`, which hands it the live transaction with
  `dispatch` off — whatever it does to `tr` there is dispatched anyway.
  `setCollapsible` probes the fit on a throwaway `Transform` and touches `tr`
  only when it will dispatch; doing the replace first and returning early on
  `!dispatch` inserted the section twice from the `>>>` input rule.
- Storing an image is async (the 1760px redraw takes a moment on a phone), and
  the insert that follows lands in whatever the editor holds by then. The
  local-image plugin counts document swaps — a step replacing the whole doc,
  which is what `setContent` does on a draft switch, but not y-tiptap's remote
  updates, which replace the whole doc on every keystroke and carry
  `ySyncPluginKey` meta — and an insert that started before a swap is dropped,
  its blobs removed, rather than landing in the other draft.

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
POSTing rooms at `/api/share` grows storage forever. The name plays no part
in any of this — nothing checks it, it exists so carets can be told apart;
what stands between the endpoint and bots is the rest: share creation
refuses cross-site calls (a page's script cannot forge its own `Origin`
header, which stops other sites conscripting their visitors' browsers), a
per-IP rate limit — six new rooms a minute, Cloudflare's `ratelimit`
binding, checked before the body is read — keeps a bot from minting rooms
by the thousand, and crawlers are told to stay out entirely
(`public/robots.txt` disallows the whole app, every response carries
`X-Robots-Tag: noindex`, so a share link posted somewhere public does not
end up rendered into a search index). The limiter is best-effort and
per-colo — a brake, not a wall; Bot Fight Mode in the Cloudflare dashboard
sits in front of all of it if one is ever needed. Turning the switch off
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
room with carets all reading "steve". Clearing the field keeps the last name
rather than rerolling a random one mid-edit, and blur puts it back. Who is in
the room is read out of awareness into the Share tab, and while a session
runs the dock shows your own name and caret colour — tapping it opens the
Share tab, because your own caret label is the one thing you never see.

The switch does not mean the same thing on every device. The draft that
turned sharing on carries `shareOwner`, and only there does switching off
end the room; on a copy joined through the link it just leaves — the token
dropped, the local copy kept, the room still live for the others — and
deleting a draft follows the same rule, so a guest tidying their rail cannot
take the room down with them.

The last synced room state is stored on the draft (`shareSeed`, refreshed by
every autosave while the session runs) and applied to the fresh Y.Doc on
join, so the text is on screen before the first sync returns — including on
a phone reopening a shared draft offline, which used to get an empty editor.
That works only because those bytes carry the room's own struct IDs: an
update rebuilt from the draft's JSON would mint new IDs and duplicate every
node on merge, which is why the JSON copy must never be used to seed. The
switch itself shows the state it is heading to while the request runs rather
than snapping back until the token lands. Only the body is
shared; title and front matter stay per-device. Trying it locally means
`wrangler dev` — the room is a Durable Object, and Vite serves no `/api`. In
wrangler's local runtime a binary WebSocket message arrives as a Blob, not the
ArrayBuffer production hands over, so the room reads both.

## Contents column

`src/components/Toc.tsx` follows the blog's tocbot layout: from 1200px a
sticky column in the right margin — the card stays exactly where it sits
without one — and below that a bar naming the current section that opens a
popup list. It shows while the post's `toc` switch is on. Text is
transparent until the list is hovered, so at rest it is a row of status
lines, and the first heading is marked before any is scrolled past, as
tocbot does; a list with nothing lit reads as broken. The tracker listens
for scroll in the capture phase on `document`, because a phone was found
scrolling something other than the container it first listened to. A jump
is a fixed 320ms ease-out: Chrome's own smooth scroll inside an overflow
container scales with distance and took a second and a half across a long
post, where the blog's document scroll feels instant. The active entry is
held during the jump so it does not flicker through every heading passed.

## Editing a published post

`?edit=<repo path>` — what the blog's own edit button links to — reads the post
through `/api/source`, which asks no password for anything under `src/posts`, and
opens it as a draft whose `publishedPath` is that file, so re-publishing lands on the same path rather than making a copy. Images
already on the blog are left alone: not re-encoded, re-uploaded or renamed, and
a newly added image is numbered past every name the post already uses.
