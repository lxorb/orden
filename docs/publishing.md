# Publishing

A published page is the note. Same renderer, same stylesheet, same colours in a
code fence. If it reads one way in the app it reads that way on somebody's blog,
and anything that cannot be that way is written down at the bottom of this page.

## Who renders what

| Where | Renderer | Stylesheet |
| --- | --- | --- |
| Reading view | `packages/markdown` through `apps/desktop/src/lib/reading/render.ts` | tokens.css, base.css, document.css, loaded by the app |
| Exported HTML | `packages/markdown` through `apps/desktop/src/lib/export.ts` | the same three, baked in, plus export.css |
| Published page | `packages/markdown` through `services/sync/src/blog.ts` | the same three, served from the Worker, plus the blog's own page.css |

One renderer, one set of sheets, three surfaces. The note body goes inside
`#write`, which is Typora's name for a rendered note and the id the writing
surface, the reading view and an exported document all carry, so every rule in
the theme lands on all of them at once.

## What was wrong before

Measured on 11.09.2026 against a fixture with every construct in it
(`services/sync/test/everything.md`), rendered three ways and diffed:

- No syntax highlighting at all. The Worker passed no `code` option, so every
  fence came out as plain grey text while the app coloured it.
- The page carried a hand-written stylesheet of about a hundred lines, which was
  a second design that looked a bit like the first. Fifteen callout colours were
  restated in it by hand, and these had no rules in it at all: `figure.code` and
  the caption over a fence, `.footnotes` and `.footnote-ref`, `.task-list-item`
  and its checkbox, `.toc`, `.math-block` and `.math-inline`, `.diagram`,
  `.properties`, `dl`/`dt`/`dd`, `abbr`, `h5`, `h6`, and every `hl-` class.
- `[toc]` was printed as the four characters `[toc]`. No heading had an id, so
  `[[note#heading]]` from another page landed at the top of it.
- The fonts, the sizes, the measure and the spacing were their own numbers rather
  than the theme's tokens, so the page was close to the app but never it.

Everything else already matched: the callouts, the folded one, the footnotes, the
tables, the task lists, the charts, the embedded notes, the media players, the
PDF and canvas cards, the web cards, the definition lists and the maths all came
out of the same renderer and were already the same markup.

## What it is now

- **One renderer.** `serveBlog` asks for what the reading view asks for:
  `footnotes`, `toc`, `escapeHtml`, a `code` fence renderer, and resolvers for
  links and embeds. The structural difference between the two is zero; see below.
- **One stylesheet for a page.** `scripts/blog-css.ts` builds it from
  `packages/themes/src/{tokens,base,document}.css` plus
  `services/sync/src/blog/page.css`, strips the comments, and writes
  `services/sync/src/blog/style.ts`. Run `pnpm blog:css` after changing any of
  those sheets; a test in `services/sync` fails if you forget. The Worker serves
  it at a path that is its own hash, cached forever, so a reader fetches 34kB
  once for a whole blog and every page after that carries no CSS at all. The
  same script writes a second sheet beside it from
  `packages/themes/src/slides.css`, another 3.5kB, which only a deck asks for.
- **Light or dark from the reader.** The app is dark until you say otherwise and
  says so with `data-theme`; a page has nobody to ask and no script to ask with.
  So the light tokens are the default, the dark ones are restated under
  `prefers-color-scheme: dark`, and print is light again because paper is.
- **Coloured fences, server side.** `services/sync/src/blog/code.ts` carries
  thirteen Lezer grammars - the very parsers the editor loads through
  `@codemirror/lang-*` - and colours a fence with `@nib/markdown/highlight`, the
  module the export uses too. Same `hl-` classes, same tree, character for
  character. The colours are in document.css now, written with `:where(#write)`
  so a reader's chosen palette still wins in the app.
- **No script on a page.** The CSP says `script-src 'none'`. Highlighting is
  done before the bytes leave the Worker; nothing is coloured in the browser.
  One page is not a page: a note published as a deck carries a `Present` link,
  and following it serves `deckPage`, which is the same few lines that turn the
  pages in the app under a nonce the CSP names. See `docs/slides.md`.
- **Nothing from anybody else.** KaTeX's stylesheet and the faces it names used to
  come from jsdelivr, so every reader of a page with an equation on it pinged a CDN
  that had no business knowing who was reading what, and the maths came out in the
  reader's serif offline or behind a blocker. The same generator now writes
  `services/sync/src/blog/math.ts` from the `katex` package the editor renders
  with: the sheet, and its twenty faces as base64. woff2 only - the woff and the
  ttf would treble what the Worker carries for browsers nobody reads a blog in -
  and each face is served at a path that is its own hash, cached forever, so a
  browser fetches the two or three faces a page actually sets its equations in. A
  page with no maths in it links neither the sheet nor a face. The page's own type
  was always local: the token stacks name Geist and iA Writer and fall back to
  `ui-sans-serif` and `ui-monospace`, so a reader with neither installed gets their
  system's faces rather than a download. So the policy is now `style-src 'self'
  'unsafe-inline'` and `font-src 'self'`, and a page fetches from its own domain or
  not at all.

## What still differs, and why

- **The front matter.** The reading view draws it as rows because reading a note
  is being in the app looking at it. A page is a page: its metadata became the
  title, the byline and the `<meta>` tags, so it is not also a table at the top.
  Same as an exported document.
- **A mermaid diagram.** Mermaid needs a DOM to measure text in, and a Worker has
  none, so a `mermaid`, `flow` or `sequence` fence stays a code block on the page
  while the app draws it. No Worker-compatible renderer for it exists today.
  Charts are fine: a ` ```chart ` fence is string-built SVG and always was.
- **A web card.** `![](https://youtube.com/watch?v=…)` is the same card in both,
  but in the app pressing it swaps in the frame and on a page it is a link out.
  Nothing a note carries may run on a published page, and that is the point of
  it: the deck's own page turner is the Worker's script and not the note's.

  An `<iframe src="https://…">` a note wrote by hand is that same card, on both
  surfaces, and this is the one thing raw HTML does that escaping does not stop:
  the card is markup `web-embed.ts` wrote out of an address it checked, so it is
  as safe to serve as a link is. Which means a page needs no `frame-src` and
  never grew one - what the reader gets is the link, and what the app gets on a
  press is the page in a frame sandboxed without `allow-same-origin`. An address
  one of the providers answers for gets that row's card instead, with the
  narrower sandbox and the permissions its player needs; anything else gets
  scripts and nothing more, and says its domain rather than a name it would have
  had to ask somebody for. The card or nothing, and never the tag: a frame at
  `javascript:`, at a page of the app's own, or at plain http is one a note may
  not have, and both halves of such a tag are dropped rather than escaped into
  four characters of text.
- **Raw HTML.** A note of your own is markup in the app, as Typora does it. A
  published note is authored content served to strangers from a domain shared
  with every other blog, so HTML in it is shown as the characters it is made of.

  A block with a whole `<script>` in it is the sharpest case of that. In the app
  such a block is a card that runs it, once pressed, in a frame with an opaque
  origin that knows nothing about the note it sits in; on a page it is escaped
  like the rest, script and all, and the reader sees the characters. Same rule,
  read twice: markup that does something is still markup, and whose note it is
  decides. See `packages/markdown/src/html-block.ts`.
- **Languages the editor has and the Worker does not.** Shell, SQL, Ruby, Swift
  and the other hundred are stream parsers that only exist inside CodeMirror. A
  fence naming one is a plain fence on a page. Adding a grammar to the table in
  `blog/code.ts` is all it takes for one more.
- **Line numbers** are the editor's gutter, not the renderer's. Neither the
  reading view nor a page has them.
- **An equation in a browser older than woff2.** The Worker serves KaTeX's faces
  as woff2 and nothing else, so a browser from before 2016 sets the maths in its
  own serif. The markup and the layout are still KaTeX's.

## What a site chooses

Publishing a space used to publish every note in it. That is the right default
for a space somebody made to be a blog, and the wrong one for the space somebody
already writes in, which is most spaces.

So there are two places a decision can live, and they are not equals.

**The note decides for itself.** `publish: true` or `publish: false` in its front
matter, which is Obsidian Publish's own key, so a vault that already has them
keeps them and a vault that leaves nib keeps working. A note that says either has
settled its own case, and no rule about its folder changes that: what the author
wrote in the file wins over a row in a pane, always. A value we do not
understand - `publish: maybe` - is read as silence rather than as a page taken
down by a typo.

**The site decides for the rest.** In `Publish`: folders that are published,
folders that are never published, and one default for everything outside both.
The deeper rule counts, so `Work` private and `Work/Notes` published reads the
way it sounds. The rows offered are the top of the tree, where somebody thinks in
folders, plus any deeper folder that already carries a rule, so a vault of four
hundred folders is not four hundred rows and nothing is hidden.

Where it is kept: one JSON column on the space's row beside the bookmarks, the
folder icons, the graph and the excluded paths, because all of those are read on
the same request and a second table would be a second read per page. See
`services/sync/src/blog/site.ts` for the column and the one decision read off it,
and `spaces/site.ts` for the route that writes it.

### What a note says about itself, and where that is kept

`publish`, `permalink`, `aliases`, `title`, `description`, `image` (or `cover`)
and `date` all live in the note. The site has to decide about a thousand notes to
answer one request, and the note bodies are in R2, so what the head of a note
says is read once - when the note is written, which is one parse of something
already in hand - and kept on the row as JSON. The note's first heading and its
first sentence ride along, because they come out of the same read and they are
what a list of pages and a feed entry want.

Every note written since this existed carries it. A vault that synced last month
does not, and a `publish: false` nobody has read is a page on the internet that
was meant to be private - so a space being published, or having its rules
changed, or being asked what those rules would do, reads its own unread notes
first, two hundred at a time, and the nightly sweep finishes anything bigger.
See `blog/front.ts` and `blog/fill.ts`.

### What a publish will change

Obsidian Publish shows an upload dialog: these files will be added, these
changed, these removed. nib has nothing to upload. A page **is** the note, served
live, so the words on a page change when the note changes and no publish is
involved.

What a publish can change is which pages exist. So that is what the sheet says,
before the button: how many pages the site will have, how many appear, how many
go away, and the names of both. Worked out by the server - the same function that
serves the pages, so the answer cannot drift from the truth - and asked again a
quarter of a second after each rule is changed.

A diff of a page's text is deliberately not offered: there is no older version on
the site to diff against, because the site is showing the note as it stands. The
note's own history is where its earlier words are; see `docs/sync.md`.

## Where a page lives

`Notes/First idea.md` is `/notes/first-idea` by default. `permalink: ideas/first`
puts it at `/ideas/first` instead, and its path no longer answers. `aliases:` -
the same key the app follows a link by - are other paths that land on it.

And then the part nobody thinks about until it has happened: a page moves. A note
is renamed, a permalink is reconsidered, an alias is dropped. The old path is
already in somebody's history, somebody's feed reader and somebody else's link,
and a 404 is the one answer that helps nobody.

So a path is remembered at the moment it stops being true, which is the moment
the note is written: what the path and the front matter were is in hand there, so
nothing has to be walked and nothing at all is written in the ordinary case. What
it becomes is a permanent redirect to wherever the page is now. Fifty paths per
note are kept, oldest let go after that. See `blog/paths.ts`.

This is the thing a static site generator makes people keep a redirects file by
hand for.

## What the head of a page says

A published page now says what it is to the machines that read pages: a title, a
description, where it lives, and the card a link pasted into a chat draws.

- The description is the note's own `description:`, or its first sentence -
  skipping the heading, the fences, the quotes and the pictures - or the site's
  own description behind both.
- The picture is the note's `image:` or `cover:`, or the first picture in the page
  itself, or the site's. `/i/<hash>` is where a picture in a note already lives,
  so that is what a note names; an address of somebody else's is taken as it was
  written. A card with a picture is a different card, so the kind is said rather
  than guessed at.
- The canonical, `og:url` and the feed link are absolute, because the machines
  that read them do not resolve a relative address.

One place writes all of it, and it writes only what it was given: a page with no
description has no description tag rather than an empty one. See `blog/head.ts`.

## What the machines read

`sitemap.xml` lists every page and the site's own front. No priorities and no
change frequencies: both are guesses no search engine has read since 2015, and a
wrong guess is worse than none.

`feed.xml` is the writing, newest first by the note's `date:` and otherwise by
when it was last written, thirty entries, each with the description the note gave
or its first words. Never the whole note: a feed is a table of contents, and a
page read in a feed reader is a page nobody visits.

Atom rather than RSS, and one rather than both. Atom says what a date means and
what a summary is made of; RSS leaves both to the reader, and every reader that
reads RSS reads Atom.

`robots.txt` points at the sitemap, and says `Disallow: /` while the site has a
password - because everything a crawler would be shown then is the password form.

All three are built per request from the same list the index is drawn from, and
cached for an hour. A blog written in twice a week does not need a build step.

## A site behind a password

What it is for: notes somebody wants a few named people to read and nobody else -
a draft with a client, a handbook for a team, a wedding page. The alternative in
the app is sharing, which is an account and a link per person; this is one word
said out loud to a room.

What it is not: security for the notes themselves. One password everybody in a
room knows is one password somebody forwards, so it keeps a site out of a search
engine and out of a stranger's hands, and that is the whole of the claim.
Anything that must not leave is not published.

How it is kept: PBKDF2 with a hundred thousand rounds and a salt of its own, so
the column is not a password. What a reader carries afterwards is a ticket signed
with a key made when the password was set - not the password, and not a session
anybody has to store - so setting a new password or taking it off ends every
ticket the old one handed out. A month, `HttpOnly`, `Secure`, `SameSite=Lax`.

The form is the site's own design and says nothing but the site's name: no hint,
because a hint is half the password, and no explanation of what is behind it,
because whoever sent the address said that. It is the one page in nib that may
post anything anywhere, and the policy says so in as many words:
`form-action 'self'` on that page and `'none'` on every other. It carries
`noindex`, and nothing behind it is ever cached by anything but the reader's own
browser.

See `blog/gate.ts`.

## The icon a tab shows

The space's own mark, served at `/favicon.svg` and linked from every page.

Drawn by the app rather than the Worker, and the reason is the icons: a space
wears an emoji, a Lucide stroke or a finished drawing out of a set the app fetches
when it is first asked for one. The side that has the sets is the side that can
render one, and a Worker that bundled every set to answer with half a kilobyte
would start slower for every request there is. So the app reads the mark it has
already drawn in the sheet, writes it as a small SVG document, and the account
keeps it; see `apps/desktop/src/lib/site-icon.ts`. A space with no icon yet gets
its first letter on the same ground, drawn by the Worker out of the name it
already has, so the two answers look like one.

An SVG and nothing else. Every browser still shipped draws an SVG favicon; the
PNG that one or two platforms would rather have needs a rasteriser in a Worker or
a canvas dance in the app, and a tab icon is not worth either.

### Checking this part

- `services/sync/test/site.test.ts` - what a note says about itself, which notes
  the rules publish, what a preview says before anything changes, permalinks,
  aliases, the redirect a rename leaves, the head of a page, the sitemap, the
  feed, robots, the favicon, and the password from both sides of the form.
- `apps/desktop/src/lib/publishing.test.ts` - the rules read off the listing, a
  folder in one list or the other, the preview asked of the server, and a password
  that is never handed back.
- `python apps/desktop/test/e2e/site.py` - the sheet on a desktop and a phone
  against a real Worker: a folder made private, what the sheet says will change, a
  page served and a page not served, a permalink, a rename that redirects, the
  feed and the sitemap, a password typed on the site itself, and the favicon.

## How to check it

- `python apps/desktop/test/e2e/publishing.py` builds the web app, runs the
  Worker on workerd with the migrations applied, publishes the fixture through
  the real API, opens it in the reading view and as a published page, compares
  the tag and class tree of both, and writes the two pictures beside each other
  under `apps/desktop/test/e2e/shots/publishing/`. It fails on any structural
  difference that is not in the list above. It also lists every address the page
  asked its browser for and fails if one of them is somebody else's; on 12.09.2026
  that list was the page, its two stylesheets, the three KaTeX faces its equations
  are set in, and the one picture the fixture names and the space does not hold.
- `pnpm --filter @nib/sync test` covers the rest: the stylesheet is the one the
  generator writes, it is served and cached, every class the page uses has a rule
  in it, the fences are coloured, the headings have ids, nothing runs, and the
  maths sheet and its faces are served from the blog with nothing left on the page
  for anybody else to serve.
