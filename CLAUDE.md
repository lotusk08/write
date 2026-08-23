# write

A Tiptap-based writing app for [stevehoang.com](https://stevehoang.com): drafts
live in the browser, posts are published to the Jekyll blog repository, and the
whole thing is static files — there is no server side of its own. Published
posts can be read back out of the repository and edited here, so the app has to
be able to write a post it did not create without changing it.

The blog is reached straight from the browser with two fine-grained GitHub
tokens kept in Settings, split by what they can do. The read token (Contents:
read) opens a published post for editing and sits in the browser as it is. The
publish token (Contents: read and write) is locked with a passphrase — `lock.ts`,
PBKDF2 and AES-GCM — and opened at the publish step, for that one commit and
never held afterwards. Both are set under Settings → Blog → Access, which folds
away once they are in; the app calls that passphrase a password, since that is
the only part of it anyone types twice. Everything to do with media — WebP, placeholders, sizes — belongs
to the blog's own build, not here.

This repository began as a fork of BlockNote. That tree is preserved on the
`blocknote-upstream` branch — `main` is this app, at the repository root, with
its own npm lockfile.

## Commands

- `npm run dev` — Vite on :5173. Nothing else runs alongside it.
- `npm run typecheck` — `tsc -b` across the app and `shared/`.
- `npm run build` — emits `dist`.
- `npm run deploy` — builds, then uploads `dist` as a Pages project.

## Layout

- `src/` — the editor. `src/editor/extensions/` holds the custom Tiptap nodes:
  collapsible sections, blog callouts (`{: .note-* }`, `{: .author }`),
  IndexedDB-backed images, `{% include embed/… %}` players, mermaid/chart/TeX
  previews, and the attribute lists the blog lays posts out with.
- `src/lib/` holds storage, export and publishing logic. `markdown.ts` writes a
  post; `import.ts` reads one back and is the inverse of it. `viewport.ts`
  measures the part of the window a phone keyboard leaves on screen; the shell
  is pinned to it and every pop-up is placed against it, not `innerHeight`.
- `shared/` — GitHub calls, base64 and the post types. No DOM in it, so it can
  be read and tested on its own; `lib/api.ts` is the only door to the network.

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

## Editing a published post

`?edit=<repo path>` — what the blog's own edit button links to — reads the post
through `/api/source` and opens it as a draft whose `publishedPath` is that
file, so re-publishing lands on the same path rather than making a copy. Images
already on the blog are left alone: not re-encoded, re-uploaded or renamed, and
a newly added image is numbered past every name the post already uses.
