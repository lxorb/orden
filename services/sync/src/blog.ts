import { documentTitle, findLinks, renderMarkdown, type Wikilink } from '@nib/markdown'
import { DECK_HEIGHT, DECK_SCRIPT, DECK_WIDTH, deckBody } from '@nib/markdown/deck'
import { isCanvasTarget, isPdfTarget } from '@nib/markdown/links'
import { deckOf, isDeck } from '@nib/markdown/slides'
import { noteKey } from './notes'
import { readSpaceFiles, type SpaceFile } from './spaces/files'
import type { Env, Note, Space } from './types'

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'

/** Scripts cannot run on a published note, whatever its markdown contained.
 *
 *  A note read as slides is the one page that needs one - a deck has to turn its
 *  pages - and it gets a nonce rather than a door left open: the only script that
 *  runs is the one written here, and the note's own markup is still shown as text
 *  rather than parsed. See `deckPage`. */
function csp(nonce?: string): string {
  return [
    "default-src 'none'",
    nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
    `style-src 'unsafe-inline' ${new URL(KATEX_CSS).origin}`,
    `font-src ${new URL(KATEX_CSS).origin}`,
    'img-src https: data:',
    // A recording or a film a note embeds, which is served from the same place
    // its pictures are: the blob behind the file, over https. Said out loud
    // because media does not fall back to `img-src`, and left off `default-src`
    // so nothing else about this page gains a way out.
    'media-src https: data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** The host a request names, as a name to compare: the port goes, the case
 *  goes, and so does the trailing dot that a fully qualified name may carry.
 *  `Field.Nibeditor.com.` is the same host as `field.nibeditor.com` and must
 *  not read as a domain of someone's own. */
export function hostnameOf(host: string): string {
  return (host.toLowerCase().split(':')[0] ?? '').replace(/\.$/, '')
}

/** Which space, if any, a hostname publishes. */
export async function spaceForHost(env: Env, host: string): Promise<Space | null> {
  const hostname = hostnameOf(host)
  if (!hostname) return null

  if (hostname.endsWith(`.${env.BLOG_ROOT}`)) {
    const subdomain = hostname.slice(0, -(env.BLOG_ROOT.length + 1))
    return (
      (await env.DB.prepare('select * from spaces where blog_subdomain = ? and blog_enabled = 1')
        .bind(subdomain)
        .first<Space>()) ?? null
    )
  }

  // The shared domain itself is the app, whatever any row might say. The
  // API refuses such a row; this is for the day something else writes one.
  if (hostname === env.BLOG_ROOT) return null

  // A domain of one's own answers only once a record in it has said the domain
  // is this account's. A row is not a claim to a name in DNS: without this,
  // typing a name first was enough to be served on it. See spaces/proof.ts.
  return (
    (await env.DB.prepare(
      `select * from spaces
        where blog_domain = ? and blog_enabled = 1 and blog_domain_verified_at is not null`,
    )
      .bind(hostname)
      .first<Space>()) ?? null
  )
}

/** `Notes/First Idea.md` becomes `notes/first-idea`. */
export function slugFor(path: string): string {
  return path
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .split('/')
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join('/')
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** A note's path as the name a link uses for it: no extension, folded case. The
 *  same reading the editor does, so a link that follows in the app resolves on
 *  the page. */
function nameOf(path: string): string {
  return path.replace(/\\/g, '/').replace(MARKDOWN, '').toLowerCase()
}

/** Where each note of a space is published, by every name a link could use for
 *  it: its own name and every tail of its path, which is what `[[Note]]` and
 *  `[[folder/Note]]` are. A name two notes answer to goes to the shallower one,
 *  which is the reading the editor settles on too.
 *
 *  Built once per page rather than per link: a note with fifty links in it would
 *  otherwise walk the space fifty times. */
function pages(notes: readonly Note[]): Map<string, string> {
  const byName = new Map<string, string>()

  // Deepest first, so a shallower note overwrites it and wins the bare name.
  const ordered = [...notes].sort(
    (one, other) => other.path.split('/').length - one.path.split('/').length,
  )

  for (const note of ordered) {
    const whole = nameOf(note.path)
    const url = `/${slugFor(note.path)}`
    const parts = whole.split('/')

    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
    byName.set(whole, url)
  }

  return byName
}

/** How many embeds one page will fetch the notes for. Well past any note anyone
 *  writes, and a ceiling so one page cannot pull a whole space out of storage. */
const MOST_EMBEDDED = 20

/** Where the bytes of a file are served: the hash of its contents, with the
 *  extension after it so that saving it keeps a sensible name. The same URL a
 *  pasted picture gets, and for the same reason - addressed by content, it can
 *  never go stale. */
function blobUrl(file: SpaceFile): string {
  const extension = /\.([a-z0-9]+)$/i.exec(file.path)?.[1]?.toLowerCase() ?? 'bin'
  return `/i/${file.hash}.${extension}`
}

/** Where each file of a space is served, by every name a link could use for it:
 *  its whole path and every tail of it, which is the same reading `pages` does
 *  for the notes. A name two files answer to goes to the shallower one. */
function fileUrls(files: readonly SpaceFile[]): Map<string, string> {
  const byName = new Map<string, string>()

  // Deepest first, so a shallower file overwrites it and wins the bare name.
  const ordered = [...files].sort(
    (one, other) => other.path.split('/').length - one.path.split('/').length,
  )

  for (const file of ordered) {
    const url = blobUrl(file)
    // Already forward-slashed: a path with a separator of anyone's platform in
    // it was never recorded; see `wrong` in spaces/files.ts.
    const parts = file.path.toLowerCase().split('/')
    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
  }

  return byName
}

/** The file a request is asking for, when the path names one the space keeps.
 *
 *  A markdown link writes the path the note wrote, so the reader's browser asks
 *  the blog for `files/paper.pdf`. The bytes are a blob; this sends them there,
 *  which keeps one place serving them and the `#page=` on the link intact. */
function fileFor(space: Space, slug: string, url: URL): Response | null {
  const files = readSpaceFiles(space.files)
  if (!files.length) return null

  let wanted = slug
  try {
    wanted = decodeURIComponent(slug)
  } catch {
    // Not valid encoding, so it is already the name it stands for.
  }

  const found = files.find((one) => one.path.toLowerCase() === wanted.toLowerCase())
  return found ? Response.redirect(new URL(blobUrl(found), url).toString(), 302) : null
}

/** What a `[[wikilink]]` on a published page points at. A note the space does
 *  not publish resolves to nothing, and the renderer leaves it as words. */
function linkResolver(notes: readonly Note[], files: readonly SpaceFile[]) {
  const byName = pages(notes)
  const byFile = fileUrls(files)

  return (link: Wikilink) => ({
    // A link naming no note points inside the page it is written on, which is
    // an empty target plus whichever heading it named. A PDF is a file rather
    // than a note and is served from where its bytes are; the renderer writes
    // the page the link named after it.
    href: !link.target
      ? ''
      : isPdfTarget(link.target)
        ? (byFile.get(nameOf(link.target)) ?? null)
        : (byName.get(nameOf(link.target)) ?? null),
  })
}

/** The notes the embeds on one page name, by the name each embed used, so the
 *  renderer can ask for them without waiting on storage. */
async function embedded(
  env: Env,
  space: Space,
  notes: readonly Note[],
  source: string,
): Promise<(link: Wikilink) => string | null> {
  const byName = new Map<string, Note>()
  for (const note of notes) byName.set(nameOf(note.path), note)

  const wanted = new Set<string>()
  for (const link of findLinks(source)) {
    if (!link.embed || link.kind !== 'wikilink' || !link.target) continue
    if (wanted.size >= MOST_EMBEDDED) break
    wanted.add(nameOf(link.target))
  }

  const bodies = new Map<string, string>()
  await Promise.all(
    [...wanted].map(async (name) => {
      const note = byName.get(name)
      if (!note) return

      const object = await env.NOTES.get(noteKey(space.id, note.id))
      if (object) bodies.set(name, await object.text())
    }),
  )

  return (link) => bodies.get(nameOf(link.target)) ?? null
}

function title(note: Note, body: string): string {
  return (
    documentTitle(body) ??
    note.path
      .replace(/\.(md|markdown|mdown|mkd)$/i, '')
      .split('/')
      .pop() ??
    note.path
  )
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

/** The author's name under the note's own heading when it opens with one,
 *  and above the text when it does not: a name reads as a byline under a
 *  title, and as a header line over prose that has none. Nothing at all
 *  when there is no name - no placeholder, and never the email. */
function withByline(html: string, author: string | null): string {
  if (!author) return html

  const byline = `<p class="by">by ${escape(author)}</p>`
  const heading = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(html)

  return heading
    ? html.slice(0, heading[0].length) + byline + html.slice(heading[0].length)
    : byline + html
}

const STYLE = `
:root{--bg:#fbfcfd;--fg:#1a1d23;--muted:#8a93a2;--line:#e1e6ed;--accent:#5b4be0;--surface:#f3f5f8;--scrollbar:#c3cbd6}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#dde2ea;--muted:#767e8c;--line:#232830;--accent:#7c6bf5;--surface:#14171c;--scrollbar:#39404d}}
*{box-sizing:border-box}
@media (pointer:fine){::-webkit-scrollbar{width:11px;height:11px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{background-color:var(--scrollbar);background-clip:padding-box;border:3px solid transparent;border-radius:99px}::-webkit-scrollbar-thumb:hover{background-color:var(--muted)}::-webkit-scrollbar-button{display:none}@supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent}}}
body{margin:0;background:var(--bg);color:var(--fg);font:16.5px/1.72 ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:42rem;margin:0 auto;padding:6rem 1.5rem 8rem}
h1,h2,h3,h4{line-height:1.28;letter-spacing:-.015em;margin:1.9em 0 .6em}
h1{font-size:1.92em;margin-top:0}
h2{font-size:1.5em}h3{font-size:1.22em}
p{margin:0 0 1.15em}
a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
a:hover{border-bottom-color:var(--accent)}
code{font-family:ui-monospace,monospace;font-size:.88em;background:var(--surface);border:1px solid color-mix(in srgb,var(--line) 55%,transparent);border-radius:5px;padding:.08em .26em}
pre{background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:1rem;overflow-x:auto}
pre code{background:none;border:0;padding:0}
blockquote{margin:1.5em 0;padding-left:1.15em;border-left:2px solid var(--line);color:var(--muted)}
.callout{margin:1.5em 0;padding:.85em 1.1em;border-left:3px solid var(--callout,var(--accent));border-radius:0 9px 9px 0;background:color-mix(in srgb,var(--callout,var(--accent)) 8%,transparent)}
.callout-title{display:flex;align-items:center;gap:.45em;margin:0;color:var(--callout,var(--accent));font-weight:620;font-size:.92em}
.callout-title .callout-icon{width:1.05em;height:1.05em;flex:none}
summary.callout-title{cursor:pointer;list-style:none;user-select:none}
summary.callout-title::-webkit-details-marker{display:none}
.callout-title .callout-fold{width:.9em;height:.9em;flex:none;margin-left:-.1em;opacity:.75;transition:transform .13s cubic-bezier(.22,1,.36,1)}
details.callout[open]>.callout-title .callout-fold{transform:rotate(90deg)}
@media (prefers-reduced-motion:reduce){.callout-title .callout-fold{transition:none}}
.callout-body{margin-top:.5em}
.callout-body>:first-child{margin-top:0}
.callout-body>:last-child{margin-bottom:0}
.callout-body:empty{display:none}
.callout-note,.callout-info,.callout-todo{--callout:#4a8df6}
.callout-abstract{--callout:#3aada8}
.callout-tip,.callout-success{--callout:#16a06a}
.callout-important,.callout-example{--callout:var(--accent)}
.callout-question{--callout:#d99b2e}
.callout-warning{--callout:#e0a233}
.callout-caution,.callout-failure,.callout-danger{--callout:#d92b34}
.callout-bug{--callout:#d4569b}
.callout-quote{--callout:var(--muted)}
table{border-collapse:collapse;width:100%;margin:1.6em 0;font-size:.94em}
th,td{border:1px solid var(--line);padding:.5em .75em;text-align:left}
th{background:var(--surface)}
img{max-width:100%;height:auto;border-radius:9px}
hr{border:0;height:1px;background:var(--line);margin:2.4em 0}
ul.index{list-style:none;padding:0}
ul.index li{border-bottom:1px solid var(--line)}
ul.index a{display:flex;justify-content:space-between;gap:1rem;padding:.85rem 0;border:0;color:var(--fg)}
ul.index a:hover{color:var(--accent)}
ul.index time{color:var(--muted);font-size:.85em;flex:none}
figure.embed{margin:1.4em 0;padding:0 1.15rem;background:color-mix(in srgb,var(--surface) 55%,transparent);border:1px solid var(--line);border-radius:9px;font-size:.94em}
figure.embed>div>:first-child{margin-top:.9em}
figure.embed figcaption{margin:0 -1.15rem;padding:.4rem 1.15rem .45rem;border-top:1px solid var(--line);color:var(--muted);font-size:.8em}
.embed-media{max-width:100%;border-radius:9px;vertical-align:middle}
audio.embed-media{width:min(100%,26rem);height:2.4rem}
video.embed-media{display:block;margin:1.5em auto;height:auto;background:var(--surface);border:1px solid var(--line)}
figure.embed-file{display:flex;align-items:center;gap:.55em;padding:.5em 1.15rem;font-size:.9em}
figure.embed-file a{border:0;color:inherit}
figure.embed-file a:hover{color:var(--accent)}
.embed-icon{flex:none;width:1.05em;height:1.05em;color:var(--muted)}
footer{margin-top:5rem;padding-top:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82em}
.by{margin:-.4em 0 2.2em;color:var(--muted);font-size:.94em}
.back{margin:0 0 1.6em;font-size:.88em}
.back a{color:var(--muted);border:0}
.back a:hover{color:var(--accent)}
.present{margin:2.4em 0 0;font-size:.88em}
.present a{color:var(--muted);border:0}
.present a:hover{color:var(--accent)}
`

/** The author's name, when they have given one: in the head for machines,
 *  in the footer for readers. */
function page(heading: string, body: string, env: Env, author: string | null): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(heading)}</title>
${author ? `<meta name="author" content="${escape(author)}">\n` : ''}<link rel="stylesheet" href="${KATEX_CSS}">
<style>${STYLE}</style>
</head><body><main>${body}
<footer>${author ? `${escape(author)} · ` : ''}Published with <a href="${env.APP_ORIGIN}">Nib</a></footer>
</main></body></html>`

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'content-security-policy': csp(),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** The stage a published deck is read on.
 *
 *  The behaviour is shared with the app and with an exported file - the markup and
 *  the handful of lines that turn the pages come from `@nib/markdown/deck` - and
 *  the look follows this page's own palette above, the way the rest of a published
 *  note does. A published page carries its stylesheet rather than the app's; see
 *  STYLE. */
const SLIDES_STYLE = `
body{overflow:hidden}
.deck{position:fixed;inset:0;overflow:hidden;background:var(--bg);user-select:none;-webkit-user-select:none}
.stage{position:absolute;top:50%;left:50%;width:${DECK_WIDTH}px;height:${DECK_HEIGHT}px;margin:${-DECK_HEIGHT / 2}px 0 0 ${-DECK_WIDTH / 2}px;transform:scale(var(--stage-scale,1));transform-origin:center;--stage-text:30px}
.stage.away{display:none}
.slide{width:100%;height:100%;padding:68px 96px;box-sizing:border-box;overflow:hidden;animation:slide-in .17s cubic-bezier(.22,1,.36,1)}
.slide #write{height:100%;overflow:hidden;font-size:calc(var(--stage-text) * var(--stage-fit,1));line-height:1.5}
.slide #write>:first-child{margin-top:0}
.slide[data-shape=title] #write{display:flex;flex-direction:column;justify-content:center}
.slide[data-shape=title] #write h1{font-size:2.6em;margin:0}
.slide[data-shape=title] #write h2{font-size:1.5em;margin:.5em 0 0;color:var(--muted);font-weight:480}
.slide[data-shape=picture]{padding:0}
.slide[data-shape=picture] #write,.slide[data-shape=picture] #write p{display:flex;height:100%;margin:0;align-items:center;justify-content:center}
.slide[data-shape=picture] #write img{width:100%;height:100%;object-fit:contain;border-radius:0}
.slide #write li.fragment{opacity:0;transition:opacity .17s cubic-bezier(.22,1,.36,1)}
.slide #write li.fragment.shown{opacity:1}
.slide #write pre{max-height:100%;overflow:hidden}
.rail{position:absolute;inset:auto 0 0 0;height:2px;background:var(--line)}
.rail .run{height:100%;width:calc(var(--at,0) * 100%);background:var(--accent);transition:width .17s cubic-bezier(.22,1,.36,1)}
.count{position:absolute;right:20px;bottom:16px;font-size:.8rem;font-variant-numeric:tabular-nums;color:var(--muted);opacity:0;transition:opacity .34s ease}
.count[data-shown=yes]{opacity:1}
@keyframes slide-in{from{opacity:0;transform:translate(var(--from-x,0),var(--from-y,0))}}
.deck[data-move=forward] .slide{--from-x:28px}
.deck[data-move=back] .slide{--from-x:-28px}
.deck[data-move=down] .slide{--from-y:28px}
.deck[data-move=up] .slide{--from-y:-28px}
@media (prefers-reduced-motion:reduce){.slide,.rail .run,.slide #write li.fragment{animation:none;transition:none}}
@media print{
html,body{height:auto;overflow:visible}
.deck{position:static;display:block;overflow:visible}
.stage,.stage.away{display:block;position:static;margin:0;transform:none;break-after:page}
.stage:last-of-type{break-after:auto}
.slide{animation:none}
.slide #write li.fragment{opacity:1}
.rail,.count{display:none}
}
`

/** A deck as a page of its own. Every slide is in it, so a reader with scripting
 *  off still gets the whole talk and a printer gets one sheet per slide. */
function deckPage(heading: string, body: string, author: string | null): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(heading)}</title>
${author ? `<meta name="author" content="${escape(author)}">\n` : ''}<link rel="stylesheet" href="${KATEX_CSS}">
<style>${STYLE}${SLIDES_STYLE}</style>
</head><body>${body}
<script nonce="${nonce}">${DECK_SCRIPT}</script>
</body></html>`

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The reader's own browser may keep it; a shared cache may not. The nonce
      // is minted per response, and one handed to a second reader out of a cache
      // in front of this would be a nonce that is not a nonce.
      'cache-control': 'private, max-age=60',
      'content-security-policy': csp(nonce),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** The words `?slides` is asked for by, and the one word that offers it. A note
 *  that is not a deck never shows the link, so nothing on the page promises
 *  something it cannot do. */
const SLIDES_QUERY = 'slides'

function presentLink(source: string): string {
  return isDeck(source) ? `<p class="present"><a href="?${SLIDES_QUERY}">Present</a></p>` : ''
}

/** A published note read as slides: the same renderer and the same markup rules
 *  as the page itself, one slide at a time. */
function publishedDeck(source: string, options: Parameters<typeof renderMarkdown>[1]): string {
  return deckBody(
    deckOf(source).map((slide) => ({
      html: renderMarkdown(slide.markdown, options),
      shape: slide.shape,
      vertical: slide.vertical,
      fragments: slide.fragments,
    })),
  )
}

/** How many notes an index lists. Well past any blog anyone writes, and a
 *  ceiling so that one hostname cannot ask for an unbounded page. */
const MOST_LISTED = 2000

export async function serveBlog(env: Env, space: Space, url: URL): Promise<Response> {
  const slug = url.pathname.replace(/^\/+|\/+$/g, '')
  const heading = space.blog_title ?? space.name
  /** Whether the reader asked for the note as a talk rather than as a page. */
  const slides = url.searchParams.has(SLIDES_QUERY)

  const owner = await env.DB.prepare('select name from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null }>()
  const author = owner?.name ?? null

  // A file the space keeps beside its notes, asked for by the path a link in one
  // of them wrote. Before the notes, because it is settled by the path alone.
  const asked = slug ? fileFor(space, slug, url) : null
  if (asked) return asked

  // One note published on its own is the whole site: it sits at the root with
  // no index above it, and nothing else in the space is reachable. Asked for by
  // name rather than found in the listing, so it is served whatever else the
  // space holds.
  if (space.blog_note) {
    if (slug) return page('Not found', '<h1>Not found</h1>', env, author)

    const only = await env.DB.prepare(
      'select * from notes where space_id = ? and path = ? and deleted = 0',
    )
      .bind(space.id, space.blog_note)
      .first<Note>()

    if (!only) return page('Not found', '<h1>Not found</h1>', env, author)

    const object = await env.NOTES.get(noteKey(space.id, only.id))
    const source = object ? await object.text() : ''

    // One note is the whole site, so there is nowhere for a link between notes
    // to go; an embed still shows what it names, which is inside this page.
    const reading = {
      escapeHtml: true,
      // One note is the whole site, so `linkResolver` has no other note to point
      // at - but the files beside it are still served, and a link to one still
      // has somewhere to go.
      resolveLink: linkResolver([], readSpaceFiles(space.files)),
      resolveEmbed: await embedded(env, space, [only], source),
    }

    if (slides && isDeck(source)) {
      return deckPage(title(only, source), publishedDeck(source, reading), author)
    }

    const rendered = renderMarkdown(source, { footnotes: true, ...reading })

    return page(
      title(only, source),
      withByline(rendered, author) + presentLink(source),
      env,
      author,
    )
  }

  const listing = await env.DB.prepare(
    'select * from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_LISTED)
    .all<Note>()

  // A canvas syncs as a note because it is text somebody edits on two machines,
  // but it is a drawing rather than a page: published it would come out as the
  // JSON it is made of. So it is not listed and has no page of its own.
  const results = listing.results.filter((note) => !isCanvasTarget(note.path))

  if (!slug) {
    const items = results
      .map((note) => {
        const date = new Date(note.updated_at).toISOString().slice(0, 10)
        const label = note.path.replace(/\.(md|markdown|mdown|mkd)$/i, '')
        return `<li><a href="/${slugFor(note.path)}"><span>${escape(label)}</span><time datetime="${date}">${date}</time></a></li>`
      })
      .join('')

    const byline = author ? `<p class="by">by ${escape(author)}</p>` : ''

    return page(
      heading,
      `<h1>${escape(heading)}</h1>${byline}<ul class="index">${items}</ul>`,
      env,
      author,
    )
  }

  const note = results.find((entry) => slugFor(entry.path) === slug)
  if (!note) return page('Not found', '<h1>Not found</h1>', env, author)

  const object = await env.NOTES.get(noteKey(space.id, note.id))
  const source = object ? await object.text() : ''

  // A published note is public: its raw HTML is shown, never run. Its links to
  // other notes point at where those notes are published, and its embeds show
  // what they name - one level deep, which is the renderer's own rule.
  const reading = {
    escapeHtml: true,
    resolveLink: linkResolver(results, readSpaceFiles(space.files)),
    resolveEmbed: await embedded(env, space, results, source),
  }

  // A note whose rules break it into slides can be read as a talk instead. The
  // same renderer and the same rules, one slide to a screen.
  if (slides && isDeck(source)) {
    return deckPage(title(note, source), publishedDeck(source, reading), author)
  }

  const rendered = renderMarkdown(source, { footnotes: true, ...reading })

  // The way back sits above the note, where a reader who came from the
  // index looks for it, and the author right under the title.
  return page(
    title(note, source),
    `<p class="back"><a href="/">← ${escape(heading)}</a></p>${withByline(rendered, author)}${presentLink(source)}`,
    env,
    author,
  )
}
