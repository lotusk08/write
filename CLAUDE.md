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
Publishing goes to `BLOG_BRANCH` and nowhere else; the client never sends a
branch, and the field that took one let a leaked password move tags.
Request bodies are read through `readCapped`, which counts bytes as they
stream, so a chunked upload cannot be buffered whole before its size is
known. Reading a published post is public, so it is rate-limited instead
(`SOURCE_RATE`, sixty a minute per connection): each read spends the
token's GitHub quota.

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
  StrictMode runs every effect twice here, so the startup is one promise
  (`boot()` in `App.tsx`) both runs wait on: two runs against an empty store
  made two drafts.
- `npm run typecheck` — `tsc -b` across the app, `worker/` and `shared/`.
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

- `src/` — the editor. `src/editor/extensions/` holds the custom Tiptap nodes:
  collapsible sections, blog callouts (`{: .note-* }`, `{: .author }`),
  IndexedDB-backed images, `<Embed… />` players, mermaid/chart previews,
  and the attribute lists the blog lays posts out with.
- `src/lib/` holds storage, export and publishing logic. `markdown.ts` writes a
  post; `import.ts` reads one back and is the inverse of it. `viewport.ts`
  measures the part of the window a phone keyboard leaves on screen; the shell
  is pinned to it and every pop-up is placed against it, not `innerHeight`.
  The publish dialog sits inside that band too: its title and its actions
  stay put and only the middle scrolls, because the password field raises
  the keyboard the moment the dialog opens, and a dialog that scrolled as one
  piece put Commit below it. The rail is its own stacking context, so the open
  tab's z-index stops at the rail rather than drawing over the dialog's scrim,
  and toasts sit under the scrim with the rest of the app.
- `worker/index.ts` — the only thing holding a credential. The blog endpoints
  (`/api/config`, `/api/source`, `/api/publish`, `/api/topics`), the share
  endpoints (`/api/share`, `/api/share/<token>`), a constant-time check on the
  password, and path validation against the configured directories so a leaked
  password cannot rewrite workflows. `worker/share.ts` is the `ShareRoom`
  Durable Object behind sharing: a y-websocket server, one room per token.
- `shared/` — GitHub calls, base64 and the post types. No DOM in it, so it is
  read by both the app and the Worker; `lib/api.ts` is the browser's only door
  to the network, and it only ever calls `/api`.

## Publishing format

Nothing on the blog rewrites front matter any more — sizes and placeholders
are measured by its build and never written into a post — so what
`buildFrontMatter` in `src/lib/markdown.ts` writes is what stays in the
repository. It keeps the conventions the published posts already follow all
the same: block sequences, plain scalars where they are safe, and no empty
keys (a bare `description:` reads back as `null`), so a post published before
the move re-publishes without moving a line.

Body output follows the blog too: headings start at H2, images are committed
under `public/assets/img/post` and written as `/assets/img/post/…`, and
blockquotes can carry the site's `{: .note-* }` callout classes.

An embed is one of the blog's components — `<EmbedYoutube id="…" />`, and
`src=` rather than `id=` for `EmbedVideo` and `EmbedAudio`. A Liquid include is
still read, so a post written before the move opens here and is converted the
next time it is published; nothing writes one again. A component carrying more
than the one prop the editor models (`compact`, `types`, `title` …) is kept as
a raw block instead, which is written back exactly as it was found.

A gallery is the blog's ```` ```gallery <kind> ```` fence — `deck`, `fan`,
`peek` or `fold` — holding one image per line, `![alt](src "caption")`, the
title being the caption the card shows. Here it is a `gallery` node whose
children are ordinary image nodes (`src/editor/extensions/gallery.ts`), so a
local photo inside one is stored, shrunk, uploaded and repointed exactly like
any other image, and the toolbar's gallery menu turns a run of images into
one, changes its kind, or separates it again. A fence that names no kind, an
unknown one, or holds anything but image lines stays a code block and is
written back as found — the site shows it as code too. A fence's whole info
string is kept in the code block's `language`, which is how `gallery peekk`
survives a round trip.

Images are published in the format they arrived in, named from it. The blog's
build converts them — `convert-images.js` runs first, writes WebP and repoints
the post that referenced them, gallery fences included — because that is the one end
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

A publish repoints the draft. Every `local:` photo it uploaded — in the body,
in a gallery, the cover — is renamed in the draft to the address it was
published at (`plan.imageUrls`), so the next publish of the same draft uploads
nothing but the Markdown and writes it byte for byte the same. Before that, every
publish sent every photo again, and since a new image is numbered past every
name the post already uses, each one would have added another copy to the
repository and pointed the post at it. The body is repointed through the
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

## Tags and categories

The blog files a topic under its slug — lowercased, every run of anything but
a letter or digit a dash — so `Em` and `em` are one topic under two names, and
the post that brought the second spelling is the one that split it. The Tags
and Categories fields offer what the blog already has instead: the build
publishes `topics.json` (title, slug and count of every tag and category, the
title being the most-used spelling), and `GET /api/topics` passes it on from
`SITE_URL`, cached at Cloudflare for five minutes. It is public, like a
published post, so it asks no password; if the site does not answer it returns
empty lists with a 200, and the fields simply suggest nothing. The app asks
once a session, when the post panel opens (`fetchTopics` in `lib/api.ts`).

While a field has focus, a row of chips sits under it — inline rather than a
pop-up, so the sheet scrolls it into view above a phone keyboard like the rest
of the panel. An empty field shows the eight most used; typing narrows them to
the ones whose title or slug starts with it, then the ones containing it, with
diacritics folded so `tet` finds `Tết`. What the post already carries is never
offered. A chip is picked on click, with the pointer's mousedown and
pointerdown cancelled so the input keeps focus and its blur does not eat the
tap. Picking on pointerdown instead would add a tag for every scroll of the
sheet that happened to start on a chip. Arrow keys move through the row and Enter takes the one lit;
otherwise Enter and comma commit what was typed, and a name that slugifies
like an existing topic is written in the blog's spelling. A new name is still
a new name. `topicSlug` in `lib/topics.ts` is that one rule, also behind
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
  rides on the block and it is written back where it was found. A row's
  `{: .d-flex .c-center }` is a row's whichever side it sits.
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
  block attribute it must be declared in `BlockAttributes`.
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
- Emphasis closes on the first delimiter that is not inside a code span or a
  link's address, and an address balances its own parentheses. A URL carrying
  `**` or `()` used to cut the link in half on the second pass through.
  A closer pairs with the nearest opener before it, as markdown-it pairs them:
  `emphasisEnd` keeps the runs of `*` or `_` that open inside the span on a
  stack, and a closing run of the same length shuts the innermost first. Taking
  the first closer made `x *a. *b *c* d` italic from `a` to `c`, where the site
  draws two literal stars and an italic `c`, and broke `*a **b** c*` at the
  bold's first star. Strikethrough is left out of it: markdown-it does not
  nest `~~` that way, and `~~a ~~b~~ c~~` closes on the first. One closing
  run may shut the inner span and the outer one together — `*a **b c***` — so
  a run pays off the stack and closes the outer with what is left. An
  underscore between two letters or digits neither opens nor closes, and a
  letter is any script's: `/\w/` let `Hà_Nội_ và` turn italic. The scan for
  a closer starts after an escape at the front of the span, not inside it.
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
  they stand for.

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
  those together on the way out. A run is a row only where one of its photos
  says so: the row tool and a multi-photo insert both write
  `{: .d-flex .c-center }` themselves, and reading a row out of `.gap` alone
  invented one for a run of photos whose own list belonged to the quote around
  them. The marker belongs
  on the last image of the run — Kramdown reads the list under the last line as
  the whole paragraph's. That is what the row tool and a multi-photo insert
  build, and `rowAttributes` in `import.ts` is what puts it back there.
- A Kramdown attribute list attaches to whichever neighbour is not separated
  from it by a blank line, and it is parsed with quoted values taken whole —
  the base64 inside `lqip="…"` contains things that look like classes and
  widths.
- `w=`/`h=` (or `width=`/`height=`) in an attribute list size the image. The
  blog's build measures every image itself and writes nothing into a post, but
  one that carries them keeps them. Display width is a class (`.w-50`, `.w-75`).
- Code spans are literal: escaping them writes the backslashes into the code.
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
  `BlockAttributes`, `data-within` in the DOM so a paste keeps it), and
  `nesting` in `markdown.ts` puts those outside the link and everything else
  inside, whatever order the marks arrive in. A link with no `within` — every
  one made in the editor — wraps its emphasis.
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
  description, author and alt fields trim themselves and fold their line
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
- `BLOCKS` in `blogFormat.ts` must list every node type `parseBlocks` can push:
  an attribute list under a block is attached to whatever block came last, with
  no type filter. `horizontalRule` and `collapsible` were missing, so
  `{: .divider }` under a rule and `{: .collapse }` under a `<details>` were
  stripped the first time the post passed through the editor and deleted from
  the repository on re-publish. `gallery` is on the list for the same reason.
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
on a phone — is what forgets it. A `401` empties the field and puts the caret
back in it, so the wrong password is not sent again by a second tap.

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
