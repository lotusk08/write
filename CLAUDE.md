# write

A writing app for [stevehoang.com](https://stevehoang.com), built on Vue 3 and
[text-editor-vue](https://github.com/eramitgupta/text-editor-vue): drafts
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
post — or, signed in with a passkey, a session (`x-write-session`) in its
place.

Reading and writing are not the same privilege, so they are not asked for the
same way. A published post opens without the password: `src/posts` is on the
blog already, and the *Edit this post* link should land you in the editor rather
than at a prompt. Drafts do not — they are the writing nobody has seen — and neither
does publishing. So the password appears in two places, the publish dialog
and the list of the blog's drafts, and they are one component (`SignIn.vue`,
its state in `useSignIn.ts`): the same field, the same Passkey button, the
same sizes, and signing in at either one stops the other asking. The drafts
list once had its own row, a different height, and asked again after a
sign-in had worked.

The Worker fails closed: with no `WRITE_PASSWORD` set it refuses to publish at
all, because it would otherwise be an open endpoint holding a write token. A
password of nothing but whitespace counts as unset, and it is compared as two
SHA-256 digests, so the comparison takes the same time whatever its length.

A repository path is checked as segments and sent as segments: `repoPath`
refuses `%`, `?`, `#`, a backslash, control characters and any empty, `.` or
`..` segment, and `readTextFile` encodes each segment into the URL. Checking
for a literal `..` and then pasting the path into the URL let
`src/posts/%252e%252e/drafts/x.md` through — the query decoded it to `%2e%2e`,
GitHub's URL parser to `..` — which read drafts without the password, and with
`?ref=` or more levels up, any file or repository the token could see.
Publishing goes to `BLOG_BRANCH` and nowhere else: the Worker takes no branch
from the request, since a free branch field let a leaked password move tags or
commit to `main`. Pull requests are gone; Publish as Post or Draft is the only
choice of where a post goes.
Request bodies are read through `readCapped`, which counts bytes as they
stream, so a chunked upload cannot be buffered whole before its size is
known. Reading a published post is public, so it is rate-limited instead
(`SOURCE_RATE`, sixty a minute per connection): each read spends the
token's GitHub quota. The password is limited too: ten wrong ones from a
connection block it for fifteen minutes, the right password included, while
other connections are untouched. The count lives in the `Passkeys` Durable
Object (`attempt`), so it needs no binding of its own; an empty password is
not counted, and a passkey session skips it. Before, every authorized route
compared the password without limit.

Every response, page and API alike, carries a content security policy
(scripts only from the app, `frame-ancestors 'none'`, photos and media from
any https address, `frame-src` only YouTube's no-cookie host; inline styles
allowed because mermaid writes them, and `connect-src https:` so the Word
export can fetch photos from other sites), plus `Referrer-Policy`,
`nosniff`, `X-Frame-Options: DENY` and `noindex` (`secured` in
`worker/index.ts`). A WebSocket upgrade is passed through untouched.

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
  The startup is one promise (`boot()` in `App.vue`) however often it is
  asked for: two runs against an empty store once made two drafts.
- `npm run typecheck` — `vue-tsc -b` across the app (`.vue` files included),
  `worker/`, `shared/` and the tests. `typescript` is aliased to
  `@typescript/typescript6`: vue-tsc and typescript-eslint need TypeScript's
  JS API, which the native TypeScript 7 package does not ship.
- `npx knip` — unused files, exports and dependencies; `knip.json` ignores
  `cloudflare:workers`, a Workers runtime module rather than a package.
- `npm run lint` — ESLint (`eslint.config.js`: typescript-eslint and
  eslint-plugin-vue). `npm test` — Vitest; `npm run check` runs all three.
- `npm run build` — emits `dist`, flat. Wrangler bundles `worker/` itself, so
  there is no Cloudflare plugin in the Vite build and nothing nested under
  `dist`.
- `npm run deploy` — builds, then `wrangler deploy`. The custom domain lives on
  this Worker; deploying anywhere else leaves the old app on it. Built by
  Cloudflare from git, the build command is `npm run build`. Node 24
  (`.node-version`), as the blog: pinned to 22, the build image carried no
  pnpm for it, and a `pnpm run build` command failed every build from
  20 September.

## Layout

- `src/` — the editor, a Vue 3 app. `App.vue` holds the drafts and the save
  loop; `components/PostEditor.vue` wraps text-editor-vue. `src/editor/` is
  everything between that editor and a draft — see *The editor* below.
- `src/lib/` holds storage, export and publishing logic. `markdown.ts` writes a
  post; `import.ts` reads one back and is the inverse of it; `inline.ts` is the
  site's inline parser, ported, which both of them consult. `viewport.ts`
  measures the part of the window a phone keyboard leaves on screen; the shell
  is pinned to it and every pop-up is placed against it, not `innerHeight`.
  The publish dialog sits inside that band too: its title and its actions
  stay put and only the middle scrolls, because the password field raises
  the keyboard the moment the dialog opens, and a dialog that scrolled as one
  piece put the main button below it. `Dialog.vue` is a native `<dialog>`
  opened with `showModal()`, so the focus stays inside it, the page behind is
  inert, Escape closes it and focus goes back where it was; it sits in the top
  layer, above the selection bubble that used to draw over it. Its `locked`
  prop ignores Escape while a publish is sending.
- `worker/index.ts` — the only thing holding a credential. The blog endpoints
  (`/api/config`, `/api/source`, `/api/publish`, `/api/publish/photo`,
  `/api/images`, `/api/drafts`, `/api/topics`), the share
  endpoints (`/api/share`, `/api/share/<token>`), a constant-time check on the
  password, and path validation against the configured directories so a leaked
  password cannot rewrite workflows. `worker/share.ts` is the `ShareRoom`
  Durable Object behind sharing: a y-websocket server, one room per token.
  `worker/passkeys.ts` is the `Passkeys` Durable Object (`/api/passkey/*`): the
  registered passkeys and the challenges handed out, with the WebAuthn checks
  and the session tokens.
- `shared/` — GitHub calls, base64 and the post types. No DOM in it, so it is
  read by both the app and the Worker; `lib/api.ts` is the browser's only door
  to the network, and it only ever calls `/api`.

## The editor

The editor is text-editor-vue (`@erag/text-editor-vue`), a `contenteditable`
editor that keeps its content as an HTML string and does its formatting with
the browser's own commands. Drafts are still the JSON tree the app stored under
Tiptap, so drafts saved before the change open unchanged and `import.ts` and
`markdown.ts` did not move a line. `src/editor/` is the layer between:

- `doc.ts` — the draft's JSON type. `blog.ts` — the blog's vocabulary
  (callouts, embed components), pure functions.
- `bridge.ts` — `docToHtml` and `htmlToDoc`. Every attribute the writer reads
  rides on the element as a `data-*` attribute, under the names the Tiptap
  schema rendered, so the stylesheet's selectors held. A block's last `<br>`
  is the browser's placeholder, so a break that really ends a line is written
  as two; an empty block holds a lone `<br>`. What the browser types itself —
  `<b>`, `<i>`, `<div>` lines, a photo dropped into a paragraph — is read too.
- `config.ts` — the editor's settings and the sanitizer's allowlist. The
  editor sanitizes every value and every paste, so anything `bridge.ts`
  writes that is not on the list is gone after one pass. `style` is allowed
  only on `span`, `td` and `th`: allowed everywhere, a pasted web page kept
  its fonts and colours on screen though the Markdown dropped them.
- `paste.ts` — every paste (`pasteClipboard`, from `PostEditor`'s
  `onPaste`). Pasted HTML is turned into the editor's own HTML
  (`pastedHtml`): Google Docs' `<b style="font-weight:normal">` wrapper is not
  bold and the blocks inside it stay blocks, a span both bold and italic
  keeps both, `font-weight: 600` is not bold, Word's list paragraphs become
  lists without their `·` and `1.` markers (nested ones flattened to one
  level), styles, scripts and `javascript:` links are dropped, a figcaption
  becomes the alt. Plain text that is clearly Markdown is read through
  `import.ts` into formatting; a code editor's copy, styled spans only,
  counts as plain text. CRLF is folded. A paste into a heading, mid-line or
  into a list item keeps its structure, and one into a code block goes in as
  text, newlines included (WebKit's `insertText` split the block at each).
  One YouTube, X or Spotify link (or an audio or video file address) pasted
  alone, as a full `http(s)` address with nothing selected, becomes its
  embed; a bare word never does, since `embedFromUrl` reads any eleven
  characters as a YouTube id. A single line, inline HTML and code go in
  through the browser's own commands, so undo takes them back; a paste of
  several blocks is inserted by hand and ends with `notify`, and cannot be
  undone: Chrome's `insertHTML` wrapped merged blocks in styled spans.
- `commands.ts` — every toolbar action, edited straight on the DOM: the
  browser's own commands for headings, marks, lists and links, and the
  blog's blocks — callouts, sections, footnotes, photos, galleries,
  players, tables. Each ends with `notify`, an `input` event that is
  how the editor learns its content changed under it. Any DOM change made
  while a key or a paste is handled must call it too: missed, the editor
  wrote back its stale copy and the caret jumped to the top, which is what
  Enter in a ticked task did. Highlight and inline code take off only the
  part of a mark selected, apply to the word at a collapsed caret, and format
  each block of a selection that crosses several. A link with nothing
  selected inserts the address as its own link; the bubble's link button
  starts from the current address, and an empty answer removes the link. The
  footnote button puts its marker after the selection rather than over it.
  Switching a list's kind converts the whole list, turning one off leaves
  paragraphs, and the code block button turns a block back into one
  paragraph. An embed link the blog cannot draw says what it can; a bare
  YouTube id must be eleven characters, and an audio or video file address
  makes `EmbedAudio` or `EmbedVideo`. The editor's own
  toolbar, menubar and status bar are off: the app draws its toolbar in the
  dock as it always did (`Toolbar.vue`, teleported from `PostEditor`), the
  bubble over selected text (`SelectionBubble.vue`), and the alt-text and
  caption buttons under each photo. `tools.ts` reads what they light up.
  Moving a node collapses any selection inside it, since Ranges are live, so
  `liftLists` puts the caret back from plain offsets.
- `keys.ts` — Enter, the Markdown shortcuts at the start of a line, and a new
  block shedding the old one's layout attributes. A `<br>` is placed by hand:
  WebKit's `insertLineBreak` writes a bare newline into a `pre-wrap` block.
  The paragraph separator is set to `<p>`, or WebKit opens a `<div>` after a
  heading. It also holds what the Tiptap editor did and the Vue one first
  lost: `[ ]` for a task list (in a bullet item too) and `---` for a divider,
  `**bold**`, `*italic*`/`_italic_`, `~~strike~~`, `==highlight==` and
  `` `code` `` turned into the mark as the closing character is typed (never
  inside code, never mid-word: a word is `\p{L}\p{N}`, so `Hồ_Chí_` and
  `ồ*b*` stay plain where an ASCII `\w` made them italic). Bold, italic,
  strike and links go through the browser's own commands, so ⌘Z undoes each
  one step at a time; code and highlight have no command, so the text typed
  straight after one is moved out of the mark, where Chrome kept typing
  inside it. `[t](url)` becomes a link (an image `![a](b)` is left alone),
  `- [x] ` a ticked task, `3. ` a list starting at 3, `` `x`{: .filepath} `` a
  file path. Tab and Shift+Tab nest and lift list items and Tab indents in a
  code block; Enter on an empty last line leaves a code block or a section,
  and a typed fence leaves a paragraph after the block. And the ⌘ keys beyond the editor's own
  ⌘B, ⌘I, ⌘⇧X, ⌘K and undo: ⌘E code, ⌘⇧H highlight, ⌘. and ⌘, super- and
  subscript, ⌘⇧7/8/9 lists, ⌘⇧B quote, ⌘⇧D section, ⌥⌘C code block, ⌥⌘0
  paragraph, ⌥⌘1–4 headings (1 is H2, as the blog has no H1). Keys are read
  by `event.code`, since ⌥ and ⇧ change the character on a Mac. The plain
  quote has its own toolbar button; the callout menu beside it holds only
  callouts.
- `decorate.ts` — what is shown but not kept: players, section toggles,
  gallery labels, photo tools, mermaid and chart previews, local photos
  resolved to blob URLs — a 1600px display copy (`resolveDisplaySrc` in
  `db.ts`), never the original, see *Publishing format*. The photo tools
  are told apart by `data-step` (`-1`, `0`, `1`), not their glyphs; read by
  text, any new button there removed the photo. Chart colours are read from
  the CSS tokens (`render.ts`). A photo's attribute list is previewed only for
  `.light` and `.dark`, which the blog still draws; `.left`, `.right`,
  `.shadow`, `.w-*`, `.rounded-*` and `w=`/`h=` are kept in the markdown but
  no longer shown, since the blog's renderer drops them. Those elements carry `data-transient`, which
  `htmlToDoc` skips. It runs after every load and edit and only touches what
  changed.

Nothing of the editor's own naming is used outside `PostEditor.vue`'s import:
the stylesheet reaches the editor's shell structurally (`.editor-host > div …`)
to make it invisible, and a task list is the app's own markup
(`ul[data-task-list]`, `li[data-checked]`, the box drawn by CSS and ticked by
a click in the item's margin) rather than the editor's checklist with its
`<input>`.

`bridge.test.ts` renders, sanitizes (with the editor's own `sanitizeHtml`) and
reads back every post, draft and page in `../stevehoang.com` (or `BLOG_DIR`),
and checks the Markdown written from the result is the Markdown written from
the parse. All 89 pass; treat a failure as a regression. Without the blog
checked out beside this repository that half of the suite is skipped.

Not carried over from Tiptap: remote carets in a shared draft, and Tiptap's
typography input rules (the site's own
typographer handles quotes and dashes). The editor's undo is the browser's,
so what the blog's tools change on the DOM by hand — lists, quotes,
sections, galleries, photos, code and highlight, a paste of several blocks —
is outside it; `insertHTML` would put them in, but Chrome rewrote `<code>`
as a styled span.

The editor library is patched (`patches/@erag+text-editor-vue+1.3.0.patch`,
reapplied by `postinstall: patch-package`): its hidden preview no longer
sanitizes the whole post on every render, four times a keystroke, and its
own format-state polling runs only when its own toolbar or menubar is shown,
which they are not. The app reads its tools at most once a frame, from
`selectionchange`. A keystroke in a 5,200-word post with 80 photos went from
72–93ms of main-thread work to 21–23ms, and from about 380ms to 120ms at 4×
CPU.

## Publishing format

Nothing on the blog rewrites front matter any more — sizes and placeholders
are measured by its build and never written into a post — so what
`buildFrontMatter` in `src/lib/markdown.ts` writes is what stays in the
repository: `title`, `description` when there is one, `date`, `lang`, `tags`,
`pin`, `toc` and `image`, in the order the published posts carry them. There
is no `author` and no `categories`. The blog never read `author`, and
categories became topics and a language; both are dropped when a post is read,
as `math` and `mermaid` are. A new post is dated in the blog's zone, +0700,
whatever the device's, and starts with its table of contents off; a post read
without a `toc` line keeps it on, as the blog draws it.

The slug follows the title — letters and digits, every run of anything else
one dash, so `Chuyện cà phê, sáng nay?` is `chuyen-ca-phe-sang-nay` — until it
is edited by hand. A post opened from the blog keeps its own whatever its
title becomes, since its slug is its address. The slug field keeps a
separator typed at the end until the next letter arrives: cleaned on every
keystroke, it swallowed the dash, and `my-post` could not be typed. It keeps the conventions the published posts already follow all
the same: block sequences, plain scalars where they are safe, and no empty
keys (a bare `description:` reads back as `null`), so a post published before
the move re-publishes without moving a line.

Body output follows the blog too: headings start at H2, images are committed
under `public/assets/img/post` and written as `/assets/img/post/…`, and
blockquotes can carry the site's `{: .note-* }` callout classes, written
`{: .note-info}` with no space inside, as 128 of the blog's 136 are.

Plain text is written so the site reads it as text (`escapePlain` in
`markdown.ts`). At the start of a line `# `, `##### `, `- `, `+ `, `1. `,
`2020. `, `>`, `{:` and `---` are escaped, and so is a line of `===` or
`---` under one, which the site reads as a heading; `|` is escaped
everywhere, since the blog's `content.js` makes any line with a pipe a table
row; `&` only before what would be an entity, and entities are decoded when a
post is read, as markdown-it does. A paragraph saying `a | b`, `1. not a
list` or `&copy;` used to be a table, a list or a © on the site while the
editor showed the text. A link address with an unbalanced `)` is written
`[x](<…>)`. A section's summary is written as escaped plain text, which is
what the site shows.

An embed is one of the blog's components — `<EmbedYoutube id="…" />`, and
`src=` rather than `id=` for `EmbedVideo` and `EmbedAudio`. A Liquid include is
still read, so a post written before the move opens here and is converted the
next time it is published; nothing writes one again. A component carrying more
than the one prop the editor models (`compact`, `types`, `title` …) is kept as
a raw block instead, which is written back exactly as it was found. The
embeds are the blog's five — YouTube, X, Spotify, audio and video; Bilibili
and Twitch are gone from the blog, so no link makes one, and a post that
still has one keeps it as a raw block.

A gallery is the blog's ```` ```gallery ```` fence, holding one image per line,
`![alt](src "caption")`. The caption the card shows is the title, else the
alt (`caption` in the blog's `src/logics/gallery.js`), and every gallery
photo in the posts is written with alt alone, so the editor shows that as the
caption and editing it writes the alt and drops the title. A title is written
in double quotes; `escapeChars` in `src/lib/inline.ts`, the one escaper for
image and link text, escapes a `"` in it, and in alt the brackets, a
backtick, `*`, `_`, `<`, `~`, and a backslash wherever markdown would
swallow it, and the importer undoes every escape, as the blog's markdown-it
does. A caption with a quote in it used to turn the whole gallery into a code
block the next time it opened, a backtick in alt and caption made a code
span of the line, and a trailing backslash broke it. A blank line inside the
fence leaves it a gallery, as on the blog. The blog
draws every gallery as one carousel and ignores a word after `gallery` (the
kinds there were until October 2026, `deck`, `fan`, `peek` and `fold`, are
gone), so a fence that still names one opens as a gallery here and is written
back as plain `gallery` the next time it is published. Here it is a `gallery`
node whose children are ordinary image nodes (`src/editor/bridge.ts`), so
a local photo inside one is stored, shrunk, uploaded and repointed exactly
like any other image, and the toolbar's gallery button turns a run of images
into one or separates it again. Several photos inserted at once outside a
gallery become one: the blog retired photo rows (`{: .normal .gap }` under
`{: .d-flex .c-center }`; every row became a gallery), so the editor has no
row or centre button. A legacy row still reads and writes back as found, is
still shown side by side so it reads as one, and making it a gallery strips
its row classes. A fence that holds anything but image lines
stays a code block and is written back as found, its whole info string kept in
the code block's `language`.

Images are published in the format they arrived in, named from it. The blog's
build converts them — `convert-images.js` runs first, writes WebP and repoints
the post that referenced them, gallery fences included — because that is the one end
with a real encoder: WebKit has none behind its canvas, so converting here
never worked from an iPhone, which is where most of these photos come from.

This is an editor, so a photo is kept exactly as it arrived: the draft stores
the original file, untouched, and shows it from there. Size is the one thing
handled, and only at the push (`shrinkImage` in `src/lib/images.ts`): a photo
wider than 3840px (4K) or heavier than 4 MB is reduced until it is neither;
one within both is uploaded byte for byte. 3840 is `MAX_WIDTH` in the blog's
`convert-images.js`, the width the build would cut it to anyway, and the
repository keeps a photo as large as the site may ever show (it was 1920, and
the photos cut to 1760 before it had to be dug out of git history). A JPEG is
drawn at 3840 or its own width, whichever is less, at quality 0.95, then 0.9
and down by 0.05 to 0.7, the floor, and then drawn 15% narrower each time
until it fits; a PNG has no quality to give, so only its width steps down.
If nothing fits within the tries, the smallest copy drawn is uploaded rather
than failing the publish, and a photo that came back no smaller than an
original already within 3840 is sent as it was. JPEG stays JPEG and PNG stays
PNG, which is what keeps alpha; any other format is uploaded whole. The
drawn area is capped at 16,777,216 pixels, Safari's canvas limit: a 48 MP
portrait at 3840 wide (3840×5120) is past it, and the original was sent.

A JPEG is drawn once per width and only encoded again for each quality
step. Base64 is the browser's `Uint8Array.prototype.toBase64` where there is
one, `btoa` in chunks otherwise (`shared/base64.ts`): the hand-written loop
took 0.8–2s and 159 MB of heap for a 4 MB photo.

The draft keeps the original, but the editor shows a 1600px display copy,
made once on first show and stored beside it (`display`, `resolveDisplaySrc`
in `db.ts`); a 48 MP photo decoded is about 186 MB, and 80 originals in a
gallery decoded to 3.7 GB against 586 MB for the copies — enough to crash a
phone's tab. The first show makes the copies one at a time (about 9s for 80
12 MP photos on a laptop), after that they are instant. The copies' object
URLs are released when the editor unmounts. Deleting a draft removes the
photos only it used, and photos no draft uses are swept about 5s after the
app opens once they are a day old (`sweepImages`), so another open tab can
still undo a deletion; before, the store only grew. Every IndexedDB
transaction is committed eagerly (`transaction.commit()` in `tx()`) and the
pending save is written on `pagehide` and when the page is hidden: the last
three quarters of a second typed before a reload, a closed tab or an iPhone
switching apps used to be lost.

Photos go up one per request: `POST /api/publish/photo` takes one photo as
base64 text (8 MB cap) and returns its git blob sha, and `/api/publish` then
commits the markdown with every photo as `{path, sha}` in one commit, so a
publish holds as many photos as the 50-file limit allows and makes about
eight GitHub calls however many there are. Each photo is shrunk only then,
sent one at a time, retried once after a network failure or a 5xx (a 400 is
not sent again), and the dialog counts them ("Photo 2 of 7 · name"); Cancel
aborts the uploads (`uploadPhoto` takes a signal) until the commit starts. A
photo over 8 MB in a format that is not reduced (GIF, WebP, HEIC) is caught
before anything is sent and named in the review. A publish used to carry every photo in one body under the Worker's
20 MB cap, three or four full-size photos at once, and its advice to publish
fewer meant taking photos out of a post being edited.
Downscaling works on an iPhone — it was only a WebP encoder WebKit lacked,
and this writes JPEG and PNG. Photos used to be redrawn when they were stored,
at quality 0.85, so the draft never held the original.

A publish repoints the draft. Every `local:` photo it uploaded — in the body,
in a gallery, the cover — is renamed in the draft to the address it was
published at (`plan.imageUrls`), so the next publish of the same draft uploads
nothing but the Markdown and writes it byte for byte the same. Before that, every
publish sent every photo again, each one adding another copy to the
repository and pointing the post at it.

A photo is named from its alt: `<slug>-<alt>`, the alt folded to ASCII
(`slugify`: Vietnamese marks off, đ to d) and cut to 50 characters on a word
boundary; `<slug>-N` with no alt, and a new cover from its alt or
`<slug>-cover`. A name is never one any file in `public/assets/img/post`
already has, extension aside, nor a source in `src/redirects.txt`:
`/api/images` lists the folder (name and sha per file, through GraphQL,
which has no cap where the contents API stopped at 1,000 files — past them a
clash would have gone unseen; the commit-time check reads it the same way)
and, given the post's own files (`?own=`), says of each photo
only whether another file uses it (`shared`). It needs no password, so it
never names posts or drafts; it used to list every path using each photo. A
clash takes `-2`, `-3` …, and the worker checks again against the
commit it builds on and refuses a name already there. Names used to be
numbered past only what the post's own text used, so a removed photo's name
came back: the new `slug-3.jpg` either sat beside the old `slug-3.webp`,
which `convert-images.js` takes as already converted, so readers got the 4K
JPEG, or replaced the old file at an address the site caches for 30 days.

A published photo whose name no longer follows its alt is renamed in the
same commit, as a tree entry pointing at the blob it already has, so nothing
is downloaded or sent again; the file renamed is the one the repository
has, so a `.jpg` the post names whose file is `.webp` renames the `.webp`.
The old file is removed unless another post, draft or page still uses it,
and the post and the draft are repointed; the post's own files are only
the one being written and the draft file a publish removes, so an older copy
left by a changed date or slug still counts as using its photos. The dialog lists each rename as
`old → new`. A photo already named `<slug>-<alt>` or `<slug>-<alt>-N` is
left alone, so it never takes `-2` against itself, and one with no alt keeps
its name; changing a caption renames it again at the next publish. Once the
rename whose old file is removed adds `old new` to the blog's
`src/redirects.txt` in the same commit (`mergeRedirects` in
`shared/redirects.ts`): both addresses as the site serves them — the
`.webp` name for a `.jpg` or `.png` the build converts (`servedName` in
`shared/paths.ts`), as are the names a commit creates — percent-encoded, a line that pointed at `old` repointed to `new`, a line
whose source this commit creates dropped, the file kept sorted and unique.
A file kept for another post gets no line. The blog's `scripts/redirects.js`
turns each line into a 301 in `_redirects`, the narrower copies included,
and follows a chain to its last name, so once the site deploys the old
address reaches the photo; `vite preview` reads no `_redirects`, so there it
does not. Every redirected source counts as a taken name, so a redirected
address is never given out again. The body is repointed through the
editor, outside its history, so a shared room carries it to everyone in it and
undo does not bring the `local:` address back; in the Markdown source view it
is the text that is repointed.

The site does not serve what was pushed: the host builds `blog` itself, and
`convert-images.js` writes the WebP, deletes the file it was made from and
repoints the post in that build's checkout. The repository keeps the photo as
published, and the draft here, once published, points at a JPEG the site does
not serve. The image node tries the WebP when the original 404s, which is what
a photo published as a JPEG does once the site has been built. Until then
nothing is there at all, so the tab that published keeps showing its own copy
of each photo (`showPublishedAs` in `lib/site.ts`) until it is reloaded; the
mindmap is handed the site's address (`siteSrc`), never that copy.

A post opened from the blog names its photos as they were committed, so a
phone's JPEG is still `29-thang-9.jpg` in the repository while the site,
whose build converted it and dropped the original, serves only
`29-thang-9.webp`. The post is left saying `.jpg` — the repository has no
`.webp` to point at, and the next build converts it again. What changes is
what is shown. A photo already on the site is shown from its 960px copy
(`previewSrc`, `/assets/img/resized/960/….webp`, the WebP name for a `.jpg`
under `post/`), so a 4K gallery does not download every original; a photo
too narrow to have one falls back to the original (`fullSrc`), and an image
tries the name as written and, failing that, the
WebP the build made of it (`convertedSrc`: a JPEG, PNG or TIFF under
`/assets/img/post/`, the only photos the build converts). The editor's
images did this already; the cover in the post panel did not, and showed a
broken image. The mindmap, which cannot try twice, is handed the WebP's
address outright.

## The publish dialog

Publishing is a review before it is a send (`PublishDialog.vue`, the plan
from `buildPublishPlan`). Review shows, in order: warnings, each with the
button that fixes it — a photo with no caption (it would be named
`<slug>-N`) selects the photo, no description opens the post panel, a photo
over 8 MB that will not be reduced blocks the publish and names the file, a
copy with no sha offers *Open the site version*, a photo missing from this
browser's storage; then Post or Draft with the repo path and the live link;
a card of the post as readers see it (cover, title, date, description,
topics); the photos with their final names, sizes and a *reduced* badge
(decided from size and width, without shrinking at review time, since a
48 MP photo takes seconds), shown from their display copies; the renames
`old → new`; a collapsed line diff against the site's file (`src/lib/diff.ts`,
the file fetched once); the commit message, collapsed; and the sign-in. The
main button names what it does — *Publish post*, *Save draft*, *Update post*
— and when it is disabled the reason is beside it. It used to say Commit for
both, show the repo paths and the first 4,000 characters of raw markdown, and
none of the names, renames or redirects the plan already held.

Post or Draft follows where the draft came from (`publishedPath` under
`src/drafts` is Draft, anything else Post) each time the dialog opens; it was
one setting for every draft, so a post opened after a site draft was
published as a new draft file. Sending keeps the dialog's size, makes the
body inert, and turns the footer into a progress row with Cancel; Escape is
ignored. Done shows what went up with *View commit* and *Open post*, Done
focused, in place of the toast. An error comes back as the first warning with
its way out: a changed post offers the site version (keeping this draft as a
copy), a post already at the address opens the post panel to change the title
or date, a race, a name clash or a network failure offer *Try again*, which
rebuilds the plan first, and a 401 focuses the sign-in. On a phone the dialog
is a bottom sheet with a sticky footer.

## Styles

Sizes come from tokens on `:root` in `src/styles.css`. One control height,
`--control-h`, 34px with a mouse and 44px under `pointer: coarse`, is used by
`.btn`, `.btn.icon`, `.input`, `.tool`, the toggles, menu tabs and header
buttons, the rail's delete and checkbox rows; with none, buttons were 32px,
inputs 34 (38 on touch) and tools 36, so a button beside an input never lined
up and touch targets fell short of 44 — the password field and the Passkey
button were two heights. A small type scale and radius tokens replace stray
px values; the 30px title and the 16px inputs that keep iOS from zooming stay
as they are. `--faint` is `#6e6e73` light and `#8e8e93` dark, at least 4.5:1
on every surface (it was 3.44:1 and 4.02:1). With a mouse the toolbar wraps
onto a second row, where eight tools hid behind a sideways scroll; on a phone
it stays a strip that snaps per tool behind the edge fade. A selected
gallery photo shows its caption full width, then ←, → and Remove as tools.
The gallery strip snaps to each photo. A menu that is only items is
`role="menu"` with focus moved in and ↑ ↓ Home End moving through it
(`useFloatingMenu.ts`); one that holds a form is a dialog.

## Topics and language

The blog files its posts under one list of topics — categories are gone —
each a slug with a title, and a post names its topics under `tags:` by slug.
A topic is its slug — lowercased, every run of anything but a letter or
digit a dash — so `Em` and `em` are one topic under two names, and the post
that brought the second spelling is the one that split it. The Topics field
offers what the blog already has instead: the build publishes `topics.json`
(title, slug and count of every topic, under `tags`), and `GET /api/topics`
passes it on from `SITE_URL`, cached at Cloudflare for five minutes. It is public, like a
published post, so it asks no password; if the site does not answer it returns
empty lists with a 200, and the fields simply suggest nothing. The app asks
once a session, when the post panel opens (`fetchTopics` in `lib/api.ts`).

While a field has focus, a row of chips sits under it — inline rather than a
pop-up, so the sheet scrolls it into view above a phone keyboard like the rest
of the panel. An empty field shows the eight most used; typing narrows them to
the ones whose title or slug starts with it, then the ones containing it, with
diacritics folded so `tet` finds `Tết` (`fold` in `src/lib/text.ts`, the one
folding `slugify` uses too). What the post already carries is never
offered. A chip is picked on click, with the pointer's mousedown and
pointerdown cancelled so the input keeps focus and its blur does not eat the
tap. Picking on pointerdown instead would add a tag for every scroll of the
sheet that happened to start on a chip. Arrow keys move through the row and Enter takes the one lit;
otherwise Enter and comma commit what was typed, and a name that slugifies
like an existing topic is written as that topic. A new name is still a new
name. `topicSlug` in `lib/topics.ts` is that one rule, also behind
`uniqueNames` when the front matter is written; it composes the text first
(NFC), since a decomposed `Tết` slugged to `te-t`. Enter is ignored while an
input method is composing — Vietnamese Telex holds the word open, and Enter
then committed half of it — and a typed comma commits as well as the key,
because Gboard reports every key as 229 and the comma key never arrives as
one. The list compares contents, not lengths: a post holding `Em` and `em`
dropped every tag added after them. An empty answer from `/api/topics` is not
kept for the session, so one failed fetch is retried on the next open.
A typed field is tidied on blur only if it was edited while focused, so
looking at a multi-line description read from a post leaves its lines alone.
The row is scrolled into view again whenever the panel it scrolls in changes
size, a frame later, rather than on the viewport's resize event: that event
arrives before the sheet has shrunk to the keyboard, and the chips were
measured against the old height and left under the sheet's footer.

A topic the blog has is stored as its slug and shown as its title, picked or
typed: `looking back` and `Tet & holidays` go into the post as `looking-back`
and `tet`, as every published post carries them (`knownTopic` in
`lib/topics.ts`). A name the blog does not have keeps its spelling and its
chip is outlined, since publishing it starts a topic of its own. A post takes
eight topics at most.

The language is a toggle, Tiếng Việt or English, written as `lang: vi` or
`lang: en`; the blog reads it for the page's language and `og:locale`. A new
post starts in Vietnamese, as most are. A post or local draft that still
carries a `Vietnamese` or `English` category is read as that language and the
category is dropped (`languageOf`, `currentMeta`); one with neither keeps no
`lang`, which the blog draws in English, rather than taking the new-post
default. The editor carries the post's language as its own `lang`, so the
browser spellchecks a Vietnamese post as Vietnamese.

`Toggle` (`src/components/Toggle.vue`) is the two-way switch behind both this
and Publish as, which sits in the publish dialog. Its halves are equal grid
columns as wide as the longer label, and the knob covers one of them: as flex
items the halves split the switch's width while `Tiếng Việt` needed more than
half, so the label broke over two lines and then ran out from under the knob.

## Round-tripping published posts

`import.ts` parses a post into the editor's schema and `markdown.ts` writes it
back. Editing a published post must not change what the blog renders, so the two
are checked against the real corpus rather than by eye: parse every post in
`../stevehoang.com/src/posts`, re-serialise it, render both versions with the
blog's own markdown-it pipeline (`scripts/markdown/index.js` — the renderer the
site ships, so there is nothing to configure to match it) and compare the HTML.
The corpus that matters is the published one, which is on the `blog` branch.

**All 77 render byte for byte**, and each settles after one pass — write a post
back twice and the second is the first. So does every draft and page beside
them, 89 files in all. Treat any of that as a regression. The ones that used to
differ were each a place where this parser had been written against kramdown,
which the site no longer runs, and they are worth knowing because markdown-it
draws every one of these lines differently:

- A quote runs on into every line that follows it, marker or no marker, as far
  as the next blank one. markdown-it carries only an open paragraph that way,
  so the site marks the rest of them itself before parsing — which is
  kramdown's rule, and this parser's. It is one run, not two: a line carrying
  `>` again after an unmarked one is the same quote, and reading the marked
  lines first and the lazy ones after made the second `>` a quote inside the
  quote. A fence is where it stops — the site closes the quote at a line
  opening one rather than reading the code as more of it — and so is an
  attribute list, which names the quote instead.
- An attribute list closes the block it names whatever follows it, and may be
  written under three spaces of indent. Which side of the block it was written
  on is a fact about the post, not a formatting choice: one above leaves a
  paragraph of its own in the HTML where one below does not, so `ialAbove`
  rides on the block and it is written back where it was found. A legacy
  row's `{: .d-flex .c-center }` is a row's whichever side it sits.
- A list marker indented less than the item above it starts the next item of
  that list, however little it is indented; only one indented as far as that
  item's own text opens a list inside it.
- A list is a task list when any item carries `[ ]` or `[x]`, not only when
  the first one does: the site marks each item on its own and leaves the rest
  plain, so an unmarked item stays a plain item inside a task list and a
  numbered list keeps its numbers rather than turning into bullets. Reading
  the kind off the first item put a checkbox on every item of one list and
  deleted the markers from another.
- A table runs on the same way: markdown-it reads every line under it as a row
  until a blank one or a line that opens a block of its own, so a sentence
  written hard against a table is a row of it on the site and has to be one
  here — a footnote definition included, which is why `isBlockStart` takes
  what may not open where it is asked. A row short of the header's columns is
  filled out to it, which is what markdown-it draws anyway.
- What may open a block depends on where the line sits. A table cannot open
  inside a list item or a footnote definition on a line less indented than
  their own content, so a table written hard under a list is a run of pipes in
  the last item on the site, not a table after it. A line that arrives that
  way is carried into the block as lazy and written back flush against the
  margin: indenting it to the item's column is what would turn it into the
  table it was not. `lazy` rides on the block like `sameLine`, and like every
  block attribute it must be carried by `bridge.ts` (`BLOCK_ATTRS`) and allowed
  in `config.ts`.
- A component or a Liquid tag is a block of its own only where it stands
  alone. With a line hard against it, the two are one HTML block on the site,
  so they are kept as one raw block rather than parted by a blank line that
  would change what the page draws.
- A heading may be written under its text (`---` or `===`). It is read as a
  heading, and written back that way whenever it carries a line break, since
  `##` has nowhere to put one; the site drew such a post as a paragraph and a
  rule before the parser knew the form.
- An attribute list with nothing after it is kept as a raw block rather than
  dropped. Parted from a list by a blank line it still names the list on the
  site — markdown-it hands the list the blank line — and a line the editor
  cannot place is a line it must not delete.
- What separates two blocks written on one line is theirs to carry: the space
  between an image and the caption beside it is kept in the caption, so a
  photo with text hard against it comes back hard against it. The caption tool
  writes that space itself.
- Trailing spaces on the last line of a block are kept. markdown-it trims a
  paragraph of its own, so they change nothing there — but lifting an
  attribute list off the end of one leaves the space under it showing.
- Inline text is read the way the site reads it, not by searching forward for
  a closer. `src/lib/inline.ts` is a port of the inline parser the site runs —
  markdown-exit, which is markdown-it's rules in markdown-it's order: text,
  linkify, newline, escape, backticks, strikethrough, emphasis, link, image,
  the footnote plugin's two, autolink, and `html_inline` as the Vue component
  plugin rewrites it. A run of `*` or `_` is measured for flanking against
  Unicode whitespace and punctuation (an emoji or `。` is punctuation, `đ` is a
  letter), `_` neither opens nor closes inside a word, closers are paired left
  to right with the nearest opener the rule of three allows, one run is split
  between the spans it serves, `~~` is paired in the same pass, and the site's
  `***` swap runs after. Each shortcut tried before — the first closer, then
  a stack — got one of `**5* hotel**`, `*a.*b*`, `***a* b** c` or
  `*a **b* c**` wrong. What the parse draws becomes marks; what marks cannot
  hold is kept as written under a `rawInline` mark, which the writer puts back
  verbatim: an emphasis inside one of its own kind (`*a *b* c*` is an `<em>`
  in an `<em>`), two spans that cross (`*a<u>b*</u>c*`, or `~~` and `*`
  closing out of order), two of one kind side by side (`*a*_b_`,
  `[a](u)[a](u)`, which the editor would merge), an emphasis around a photo
  (a photo is a block here) — each written as its own tag, `<em>…</em>`,
  which draws the same HTML — and every HTML tag but a well-nested `<u>`,
  `<mark>`, `<sup>` or `<sub>`. Escaped, a `<br>` became text on the page.
- A line break carries the marks around it, so `*a\nb*` is one span through
  the editor and is written back as one; split at the break it drew two. A
  `*`, `**` or `~~` run never starts or ends on a break, where its delimiter
  could not close. Nor on a space: a word picked by a double tap carries the
  space after it, and `**instructions **hiện tại` printed its asterisks on
  the site. `delimit` puts the spaces outside the delimiters.
- A bare address is linked by the site while the line is read, before any
  emphasis — `https://x.com/_b_c` has no italic in it — and again afterwards
  wherever text is preceded by punctuation. The writer leaves such an address
  unescaped, and the `*` run or bracket right after it: a backslash there is
  read as part of the address.
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
- Only a `<` that could open a tag or an address is held back, and a `>` only
  where a line begins, which is the one place it would be a quote. The site
  runs markdown-it's typographer, narrowed to what kramdown wrote: escaping
  either bracket put `<<` and `>>` into the post instead of the guillemets
  they stand for. The line-start, `|` and `&` escapes under *Publishing
  format* are the only others.

All 89 files also render on the site exactly as their source does since the
plain-text escaping (87 before: two quote lines had lost a `\|`).

Things that took a bug to learn, and that a change here can quietly undo:

- A line opening with an inline tag — `<em>`, `<u>`, `<br>`, `<span>` — does
  not interrupt a paragraph; only a block tag or a component does, as the
  site's component plugin reads it. Treating every tag as a block split the
  paragraph there, and the writer put a blank line in.
- A photo in a heading, a table cell or a section summary is kept raw: the
  schema has no inline image, and one left there threw the editor out.
- `<details>` is written without kramdown's `markdown="1"`, which markdown-it
  has no use for: an HTML block ends at the blank line after the `<summary>`,
  so the body is read as Markdown either way. It is read back as a
  collapsible node, the `<details>` check made before the raw-HTML one, so a
  section survives the Markdown source view instead of coming back as raw
  HTML.
- A table whose every line is a row of pipes, with no header line — how the
  blog's `content.js` draws one — opens as a table and is written back as it
  was.
- A list marker indented four spaces or more is not a list — it continues the
  block above. Tabs indent by columns, not by one character.
- An image and the line under it are one paragraph, and the blog styles that
  line as a caption; a row of images is one paragraph too. `joinPrevious` keeps
  those together on the way out. A run is a row only where one of its photos
  says so — `{: .d-flex .c-center }`, which nothing writes any more — and
  reading a row out of `.gap` alone
  invented one for a run of photos whose own list belonged to the quote around
  them. The marker belongs
  on the last image of the run — Kramdown reads the list under the last line as
  the whole paragraph's, and `rowAttributes` in `import.ts` is what puts it
  back there.
- A Kramdown attribute list attaches to whichever neighbour is not separated
  from it by a blank line, and it is parsed with quoted values taken whole —
  the base64 inside `lqip="…"` contains things that look like classes and
  widths.
- `w=`/`h=` (or `width=`/`height=`) in an attribute list size the image. The
  blog's build measures every image itself and writes nothing into a post, but
  one that carries them keeps them. Display width is a class (`.w-50`, `.w-75`).
- Code spans are literal: escaping them writes the backslashes into the code.
  The site strips one space from each end of a span that has one at both, so
  a span whose text does is written padded.
  What is written around one stays around it: the span is built first and every
  mark the text carries is wrapped over it in the order they sit, so a bolded
  code span keeps its bold and a linked one inside bold keeps both. Writing the
  span and stopping there dropped every mark but the link.
  A link wraps its emphasis, not the other way round — and because the editor
  stores marks per text node, `[a *b* c](url)` is three nodes sharing one link:
  serialised one node at a time it came out as three adjacent links, so
  `inline` in `markdown.ts` groups a run of text nodes carrying the same link
  and writes the link once, around it.
- Where emphasis and a link cover exactly the same words, which one is outside
  is the post's to say, and the posts say both: `*[Title](url)*` in reference
  lists and captions, `[*Title*](url)` in quotes. The parser hands marks over
  outermost first, but ProseMirror re-sorts every mark by schema rank, link
  first, so through the editor the first form came back as the second — an
  `<em>` inside the link instead of around it. Reach cannot settle it when the
  spans are equal, so the link carries it: a `within` attribute naming the
  marks written around it over the same span (declared on `link` in
  `bridge.ts`, `data-within` in the DOM so a paste keeps it), and
  `nesting` in `markdown.ts` puts those outside the link and everything else
  inside, whatever order the marks arrive in. A link with no `within` — every
  one made in the editor — wraps its emphasis. Every other mark carries
  `within` the same way, because `*__a__*` and `***a***` differ only in which
  is outside: italic around bold is written `*__…__*`, since the site turns
  `***…***` into bold around italic.
- Footnotes are nodes: `[^id]` is a `footnoteRef` and `[^id]: …` a
  `footnoteDef` whose body is the text after the colon plus lines indented
  four spaces — and the unindented line under it, which markdown-it reads as
  more of the note where kramdown started a paragraph. It runs on only while
  the note is still one paragraph and only over a line that opens no block of
  its own. A `[^id]` left as plain text still passes `escapeText` unescaped,
  which is what keeps drafts written before the node existed publishing.
- Enter writes a line break; Enter again on the line it just made starts a
  paragraph. A phone keyboard has no Shift+Enter, so that was the only way to
  say `<br>` and every line of a poem became its own paragraph — a `>` gap
  between each one, and an attribution several gaps below the quote it belonged
  to. `keys.ts`, and only where a paragraph flows: a list item and a
  section summary keep their own Enter, and a table cell has the one below.
- A table cell is one line. `markdown.ts` writes each row on one line of
  pipes, so a second paragraph or a break typed into a cell showed as two
  lines here and published as one, joined by a space. Enter in a cell moves to
  the cell below, and out of the table under the last row, as Tab moves
  across; Shift+Enter there does nothing.
- A line that is nothing but a fence opener — ```` ```mermaid ````, ```` ``` ````,
  `~~~py` — becomes a code block on Enter, with the rest of the line as its
  language. The line-break flow must look for it first: under Tiptap it took
  Enter before the fence rule, the line got a `<br>` after it and the whole
  thing published as a paragraph. markdown-it opens a fence even straight after
  other text, so a fence line under a break parts the paragraph there.
- Every newline inside a paragraph is a `<br>`: the site sets `breaks: true`,
  as kramdown's `hard_wrap` did. Reading one as a wrap and joining the lines
  with a space took a break out of every post opened here, and writing a break
  as two trailing spaces left the spaces sitting in front of the `<br />` made
  of them. A bare newline each way is the break and the whole of it.
- A caption written beside its image and one written under it are the same
  paragraph but not the same rendering — the second has a `<br>` before it. Which
  side it was on rides on the block as `sameLine`, and like every block
  attribute it must be written by `bridge.ts` and allowed in `config.ts` — the
  editor's sanitizer strips what it does not know the first time a document
  passes through it, which is a silent way to lose exactly this kind of fact.
- The break that ends the line an image sits on is layout, not text. Left in the
  run it becomes a paragraph between two images, which is a blank line on the way
  out, and a blank line is the end of the row.
- A photo in a legacy row carries `{: .normal .gap }`, written back as found;
  the blog draws neither class now, and the editor no longer previews `.gap`.
- Front matter the app has no field for survives anyway. `redirect_from` is
  one the blog actually uses, and an `image.lqip` a post still carries wins
  over the placeholder the build measures — losing either on an edit would
  break every old URL into a post or swap a placeholder. Unknown top-level
  keys are kept as their raw lines and written back at the end.
- `image:` is written `path, alt, lqip`, the order every published post
  already has, so re-publishing moves nothing.
- A bare `null` in front matter is YAML's null, not the word: reading it as
  text put "null" in the description of every post that had none, and writing
  it back quoted made it permanent. Quoted `"null"` is still text.
- Front matter is read to the value js-yaml's core schema gives — what the
  blog's `matter.js` reads — not to the line it sits on. A field may run on
  over indented lines: a block scalar (`|`, `>`, with `+`/`-` and an
  indentation digit, folded and chomped as YAML does), a quoted string folded
  across lines, a plain one wrapped, a flow list across lines. Reading
  the first line alone made `description: >-` the description, and the
  next publish wrote `">-"` over the text below it. Those lines belong to
  their key for an unknown key too, kept raw with it. On the way out a value is
  written exactly — a newline as `\n` inside double quotes, never folded into a
  space or trimmed — so the file reads differently but js-yaml reads the
  same string back. Tidying belongs to typing, not writing: the title,
  description and alt fields trim themselves and fold their line
  breaks into spaces on blur (`tidyField`), which is what the writer used to
  do to every value. Left to the writer, a phone keyboard's trailing space
  published `"Title "`; done in the writer, it changed values read from a
  post that meant their spaces. `pin` and `toc` are read as the site reads them, not as
  YAML 1.1 did: `pin` is on only for `true` (or `"true"`), `toc` off only for
  `false`, so `pin: yes` and `toc: no` stay what the site already draws.
- `pin` and `toc` are coerced with `Boolean()` before interpolation. A draft
  saved before one of them existed writes `undefined` otherwise, which YAML
  reads back as a string — and a string is true.
- `math`, `mermaid`, `chart` and `render_with_liquid` are read and dropped, not
  kept as unknown keys: the site renders no maths at all now, turns a
  `mermaid` or `chart` fence into its component wherever it finds one, and there
  is no Liquid left to switch off. Anything genuinely unknown is still kept.
- `bridge.ts` must carry every node type `parseBlocks` can push, with every
  attribute on it: an attribute list under a block is attached to whatever
  block came last, with no type filter. Under Tiptap `horizontalRule` and
  `collapsible` were missing from the list that declared them, so
  `{: .divider }` under a rule and `{: .collapse }` under a `<details>` were
  stripped the first time the post passed through the editor. The corpus test
  in `bridge.test.ts` is what catches this now.
- Storing an image is async (it is written to IndexedDB first), and
  the insert that follows lands in whatever the editor holds by then.
  `PostEditor` counts content swaps (`setDoc`: a repoint, a change from the
  shared room; a draft switch remounts the editor outright), and an insert
  that started before one is dropped, its blobs removed, rather than landing
  in another draft.
- An insert hands the cursor on. Left on a photo or a player it has just
  placed, the next key typed replaced it — two embeds in a row left one.
  `insertBlocks` in `commands.ts` puts the cursor in the
  paragraph after what it inserted, making one when none follows, and the
  divider, a new gallery and a separated one do the same. Over a selected
  block the insert lands after it and after whatever joins it — its caption,
  the rest of its row — so neither is cut in two. Photos added while a
  gallery photo is selected — picked, pasted, or dropped onto it — go in
  right after it, and the last of them becomes the selected one, so the next
  batch follows in order. A drop on the gallery's frame goes after its last
  photo, and a drop anywhere else clears the selection first, so an old one
  cannot pull it into a gallery. The selected gallery photo takes the focus
  (`tabIndex = -1`), so its keys are its own: a character or Enter goes on
  in the paragraph after the gallery (`leaveGallery`), shortcuts still reach
  the editor, Delete or Backspace removes it, ⌥← and ⌥→ move it, and the
  same three appear as 44px buttons under it, for a phone. A gallery left
  with one photo becomes a plain image, and one left with none an empty
  paragraph. A photo outside a gallery behaves the same way when tapped: it
  takes the focus, Backspace removes it with its caption line, and typing
  goes on in a new paragraph after it. On Android, whose keyboards report
  `Unidentified`, and under an input method composing Vietnamese, leaving a
  selected photo happens on `beforeinput` and `compositionstart`, and the
  browser inserts the text itself (written for, not tried on, a device). A
  caption edit redraws the photo tools on the next frame, after the editor has
  read it; redrawn at once they were drawn twice. Backspace at the start of
  the line under a photo removes only the photo. A table keeps the cursor
  in its first cell, with a paragraph made under it to leave by.
- `#` types an H2, as `##` does: the title is the page's only H1 and the
  contents start at H2. A post that has an H1 (or an H5) opens with it and
  writes it back.
- A `local:` address never reaches an `<img src>`: the browser fetches an image
  the moment one is made, even off the page, and the scheme fails once per
  photo. `docToHtml` writes it as `data-local-src` beside a blank GIF, the
  decorator swaps in a blob URL, it is read back from `data-local-src`, and
  the HTML export inlines it from there. A published photo is shown from the
  site (`data-src` keeps the address as written).
- The file-path button takes `code.filepath` off on its second press; it used
  to flip the attribute and leave plain `code` behind.

In an `.author` quote the site styles the last paragraph as the attribution —
right-aligned, italic, the dash added by CSS — and the editor now shows the
same, so where the name goes is visible while writing rather than a convention
to remember. The stanza flow inside a quote: Enter is a line break, Enter twice
is a `>` gap (a new paragraph, still in the quote), and Enter on that empty
paragraph is the way out of it.

The publish password lives in session storage (`src/lib/password.ts`), never in
Settings: one prompt per sitting, and closing the tab — or the app going away
on a phone — is what forgets it. A `401` empties the field, forgets any
session and puts the caret back in it, so the wrong password is not sent again
by a second tap.

A passkey stands in for the password. With the password typed, *Save a passkey
on this device* registers one (`src/lib/passkey.ts`); *Passkey* beside the field
signs in with it. Registering asks the password itself, never a session, so a
session that leaked cannot add a passkey of its own. The Worker hands out a
single-use challenge, five minutes long, and checks every response the way
WebAuthn says: the ceremony, the origin and the site are its own, the user was
present and verified on the device, the signature holds for the stored key
(ES256 or RS256), and the counter moved unless the passkey always reports 0.
What it answers with is a session, a timestamp signed with a key derived from
`WRITE_PASSWORD`, good for twelve hours and kept in session storage like the
password; changing the password ends every session. The site is the Worker's
own host — under `wrangler dev` that is the route's, `http://write.stevehoang.com`,
so a browser on `localhost` cannot sign in there, though a scripted response can.

## Drafts rail and menu

The drafts rail is a deck: every draft but the open one is a sheet stacked
under its neighbour, fanned out by hover. A phone has no hover, and ten drafts
were ten strips a few pixels high with no title on any of them. On a coarse
pointer a deck of more than one sheet is a single target that opens a list of
every draft by title, each row 44px, scrolling inside the visible band; a deck
of one still opens its draft directly. The open tab's delete button is 44px
there, and only shows on hover with a mouse.

The menu sheet covers the ⌘ button that opened it, so on a phone it carries
its own close button, and closing it from inside — that button or Escape —
hands focus back to ⌘.

## Sharing a draft

The Share tab holds one switch and a name — no password. The password guards
the blog, and a share room holds no credential: the draft is copied into a
`ShareRoom` Durable Object and the app hands back `?share=<token>`, and that
token is the whole credential for joining — the link opens the same live
document for anyone holding it, the same trade `?edit=` makes. Ending is
not: creating a room returns an owner key too, which the draft keeps, and
only that key can delete the room (a room made before the key existed can
still be ended as it was). A message over 1 MB closes its connection, and a
room past 8 MB stops saving, disconnects everyone and goes back to its last
saved state. `share.ts` and Yjs are loaded only when a share starts or a share
link opens (the names, colours and link the app needs at once are in
`participants.ts`), which took 22 kB gzipped off every load. What an open create endpoint gives away is bounded instead of gated: a
seed is capped at ~4 MB, and a room deletes itself after 14 idle days through
a Durable Object alarm (open sockets and fresh edits push the expiry out, and
the alarm re-arms itself), so neither an abandoned link nor a stranger
POSTing rooms at `/api/share` grows storage forever. The name plays no part
in any of this — nothing checks it, it exists so people can be told apart;
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
`shareToken` the body syncs through Yjs (`src/lib/share.ts` client-side): one
`Y.Text` holding the draft as canonical HTML — `docToHtml` with every address
as written, so no device's blob URLs or site prefix travel — which each local
edit changes by the smallest splice between the old text and the new, so two
people typing in different places merge. A remote change is read back to a
draft and handed to the editor, which keeps the caret where it was. There are
no remote carets: text-editor-vue has no collaboration layer to draw them, so
who is here is the Share tab's list. A room created before the editor changed
held a ProseMirror fragment instead; joining one finds the text empty and
writes the local draft into it. The name above the switch is how you are listed: kept
per device, prefilled with a random two-word name so nobody has to invent
one, and applied live through awareness when edited mid-session — not the
old author setting, which defaulted the same on every device and once filled
a room with names all reading "steve". Clearing the field keeps the last name
rather than rerolling a random one mid-edit, and blur puts it back. Who is in
the room is read out of awareness into the Share tab, and while a session
runs the dock shows your own name and colour — tapping it opens the
Share tab.

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
than snapping back until the token lands. A room keeps its document in
1 MB pieces (`chunks` and `doc:0`, `doc:1`, …), because a SQLite-backed
Durable Object limits the size of a single stored value — 2 MB, as far as
could be told, where a seed may be twice that — and wrangler's local runtime
does not enforce it; a room saved as one `doc` value before is read and rewritten in pieces.
A seed is tried on a throwaway Y.Doc first, so one that is not an update is a
400 rather than an uncaught error. Only the body is
shared; title and front matter stay per-device. Trying it locally means
`wrangler dev` — the room is a Durable Object, and Vite serves no `/api`. In
wrangler's local runtime a binary WebSocket message arrives as a Blob, not the
ArrayBuffer production hands over, so the room reads both.

## Contents column

`src/components/useOutline.ts` (with `TocBar.vue` and `TocAside.vue`) follows the blog's tocbot layout: from 1200px a
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
already on the blog are not re-encoded or re-uploaded; they are renamed only
to follow their alt, and a new one is named from its alt, never taking a name
already in the folder (see *Publishing format*).

A draft remembers the post's blob sha when it is opened or published
(`publishedSha`, with `publishedPrint`, a SHA-256 of the markdown it would
write), and the worker checks it against the commit it builds on: a publish
over a post that changed since is refused with a 409 ("This post changed on
the site since you opened it"). Opening a post a local draft already holds
asks the site first: unchanged, or the draft would write exactly the site's
markdown, the draft opens; changed with no unpublished edits, the new
version replaces it; changed with edits, the draft is kept and a toast says
so; unreachable, the draft opens. A draft from before this, with no sha,
opens as it did and takes the site's sha only when its markdown matches. It
used to open the local draft without
asking, and the publish overwrote whatever had changed on the site since. A
draft never published from here sends `expect {path, sha: ""}`, and the
worker refuses to write over a post already at that path ("The site already
has a post at … Change its title or date, then publish."). `expect` is a
list, so a publish that moves a post — a new slug or date, or a draft
promoted to `src/posts` — guards its new address with `sha: ""` as well as
the old one; moved, it used to overwrite whatever post sat there. The
commit's reads that depend only on the head — the stale checks, the folder
listing, the commit, `redirects.txt` — run together. A push landing at the same moment is "Someone published at
the same moment. Publish again." rather than GitHub's 422.

The blog's own drafts open from the rail's download button, beside the
"+": a list of every file in `src/drafts` (`GET /api/drafts`, password or
session, one GraphQL read like `/api/images`: the title from front matter,
the date from the file name, newest first; titles read as YAML strings,
`yamlScalar`, so an escaped quote does not show its backslash), each row
44px. The list is a dialog rather than a menu, since it holds the sign-in,
and opening it focuses the password field. Opening one is
`importPost`, as `?edit=` is, so the stale guard, the sha, the alt renames
and the round trip all apply. Published as
Draft it is written back to its own file. Published as Post, or under a new
slug, it is written to its new path and the old draft file removed in the
same commit (`leavesDraft` in `publish.ts`), the stale check made against
the draft file, and the dialog says the draft is moved. A draft without a
`date:` takes its file name's date, so a publish does not move it to
today.
