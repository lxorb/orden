import { documentTitle, findLinks, renderMarkdown, type Wikilink } from '@nib/markdown'
import { DECK_HEIGHT, DECK_PAGE_CSS, DECK_SCRIPT, DECK_WIDTH, deckBody } from '@nib/markdown/deck'
import { isCanvasTarget, isPdfTarget } from '@nib/markdown/links'
import { deckOf, isDeck } from '@nib/markdown/slides'
import { blogFence } from './blog/code'
import { MATH_CSS, MATH_CSS_PATH, MATH_FONTS } from './blog/math'
import { PAGE_CSS, PAGE_CSS_PATH, SLIDES_CSS, SLIDES_CSS_PATH } from './blog/style'
import { noteKey } from './notes'
import { readSpaceFiles, type SpaceFile } from './spaces/files'
import type { Env, Note, Space } from './types'

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
    // The page's own stylesheets, which are served from here; see `sheet` below.
    // Inline styles as well, because KaTeX lays an equation out in `style`
    // attributes and a slide is placed by ones the stage writes.
    "style-src 'self' 'unsafe-inline'",
    // The faces an equation is set in, which the Worker carries too; see `face`.
    // Both of these lines used to name the CDN KaTeX came from, which told a
    // third party who was reading what and left the maths of a page broken for
    // anybody offline or behind a blocker.
    "font-src 'self'",
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

/** A stylesheet of the app's own, served from here.
 *
 *  Linked rather than written into the page: it is the same bytes for every note
 *  of every blog, its path is its own hash, so a reader fetches it once and keeps
 *  it, and the second page of a blog carries no stylesheet at all. See
 *  scripts/blog-css.ts. */
function sheet(css: string): Response {
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** One of the faces an equation is set in, served from here.
 *
 *  Carried in the bundle as base64 and handed over as the bytes it was. The whole
 *  set is 254kB of woff2; a reader's browser fetches the two or three faces the
 *  page it is reading actually uses and nothing else, and each path is that file's
 *  own hash, so a face is fetched once and kept. See scripts/blog-css.ts. */
function face(base64: string): Response {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  return new Response(bytes, {
    headers: {
      'content-type': 'font/woff2',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** KaTeX's sheet, linked by a page with an equation on it and by no other: a note
 *  without maths should not fetch a stylesheet for maths, let alone a font. The
 *  class the renderer writes around every formula is what says whether there is
 *  one - the same question an exported document asks of itself; see
 *  apps/desktop/src/lib/math-fonts.ts. */
function mathLink(body: string): string {
  return body.includes('class="katex') ? `\n<link rel="stylesheet" href="${MATH_CSS_PATH}">` : ''
}

/** The author's name, when they have given one: in the head for machines,
 *  in the footer for readers.
 *
 *  `#write` is Typora's name for a rendered note and is the id the writing
 *  surface, the reading view and an exported document all carry, so every rule in
 *  base.css and document.css - the very sheets the app loads - lands on this page
 *  too. That is the whole of what makes a published note look like the note. */
function page(heading: string, body: string, env: Env, author: string | null): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(heading)}</title>
${author ? `<meta name="author" content="${escape(author)}">\n` : ''}<link rel="stylesheet" href="${PAGE_CSS_PATH}">${mathLink(body)}
</head><body><main id="write">${body}
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

/** A deck as a page of its own. Every slide is in it, so a reader with scripting
 *  off still gets the whole talk and a printer gets one sheet per slide.
 *
 *  The same two sheets the app presents from - the prose of a note, and the stage
 *  it is read on - plus the two things a page with no app around it adds: how big
 *  the stage is, and that a slide which is not the one being read is not drawn.
 *  Both come from `@nib/markdown/deck`, along with the markup and the handful of
 *  lines that turn the pages, so the app, an exported deck and this one are one
 *  deck rather than three that look alike. */
function deckPage(heading: string, body: string, author: string | null): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(heading)}</title>
${author ? `<meta name="author" content="${escape(author)}">\n` : ''}<link rel="stylesheet" href="${PAGE_CSS_PATH}">
<link rel="stylesheet" href="${SLIDES_CSS_PATH}">${mathLink(body)}
<style>.deck .stage{--stage-width:${DECK_WIDTH}px;--stage-height:${DECK_HEIGHT}px}${DECK_PAGE_CSS}</style>
</head><body class="deck-page">${body}
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
 *  as the page itself, one slide at a time.
 *
 *  One thing differs, and it is the same thing that differs in the app: a single
 *  newline is a line break on a slide, because a slide is a poster. The page the
 *  same note is published as keeps CommonMark's space. The options the page was
 *  built with are spread rather than written into, since the caller renders the
 *  page with them too. */
function publishedDeck(source: string, options: Parameters<typeof renderMarkdown>[1]): string {
  return deckBody(
    deckOf(source).map((slide) => ({
      html: renderMarkdown(slide.markdown, { ...options, breaks: true }),
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
  // The stylesheets, first of all: they are the same bytes whatever the space,
  // they are asked for by every page of every blog, and neither the account nor
  // the notes have anything to say about them.
  if (url.pathname === PAGE_CSS_PATH) return sheet(PAGE_CSS)
  if (url.pathname === SLIDES_CSS_PATH) return sheet(SLIDES_CSS)
  if (url.pathname === MATH_CSS_PATH) return sheet(MATH_CSS)

  // And the faces that last sheet names, which were the one thing a reader of a
  // page with an equation on it still fetched from somebody else.
  const wanted = MATH_FONTS[url.pathname]
  if (wanted) return face(wanted)

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
      code: blogFence,
      // One note is the whole site, so `linkResolver` has no other note to point
      // at - but the files beside it are still served, and a link to one still
      // has somewhere to go.
      resolveLink: linkResolver([], readSpaceFiles(space.files)),
      resolveEmbed: await embedded(env, space, [only], source),
    }

    if (slides && isDeck(source)) {
      return deckPage(title(only, source), publishedDeck(source, reading), author)
    }

    const rendered = renderMarkdown(source, { footnotes: true, toc: true, ...reading })

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
    code: blogFence,
    resolveLink: linkResolver(results, readSpaceFiles(space.files)),
    resolveEmbed: await embedded(env, space, results, source),
  }

  // A note whose rules break it into slides can be read as a talk instead. The
  // same renderer and the same rules, one slide to a screen.
  if (slides && isDeck(source)) {
    return deckPage(title(note, source), publishedDeck(source, reading), author)
  }

  const rendered = renderMarkdown(source, { footnotes: true, toc: true, ...reading })

  // The way back sits above the note, where a reader who came from the
  // index looks for it, and the author right under the title.
  return page(
    title(note, source),
    `<p class="back"><a href="/">← ${escape(heading)}</a></p>${withByline(rendered, author)}${presentLink(source)}`,
    env,
    author,
  )
}
