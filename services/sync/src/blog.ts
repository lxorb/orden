import { documentTitle, findLinks, renderMarkdown, type Wikilink } from '@nib/markdown'
import { noteKey } from './notes'
import type { Env, Note, Space } from './types'

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'

/** Scripts cannot run on a published note, whatever its markdown contained. */
const CSP = [
  "default-src 'none'",
  "script-src 'none'",
  `style-src 'unsafe-inline' ${new URL(KATEX_CSS).origin}`,
  `font-src ${new URL(KATEX_CSS).origin}`,
  'img-src https: data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

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

  return (
    (await env.DB.prepare('select * from spaces where blog_domain = ? and blog_enabled = 1')
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

/** What a `[[wikilink]]` on a published page points at. A note the space does
 *  not publish resolves to nothing, and the renderer leaves it as words. */
function linkResolver(notes: readonly Note[]) {
  const byName = pages(notes)

  return (link: Wikilink) => ({
    // A link naming no note points inside the page it is written on, which is
    // an empty target plus whichever heading it named.
    href: link.target ? (byName.get(nameOf(link.target)) ?? null) : '',
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
footer{margin-top:5rem;padding-top:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82em}
.by{margin:-.4em 0 2.2em;color:var(--muted);font-size:.94em}
.back{margin:0 0 1.6em;font-size:.88em}
.back a{color:var(--muted);border:0}
.back a:hover{color:var(--accent)}
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
      'content-security-policy': CSP,
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** How many notes an index lists. Well past any blog anyone writes, and a
 *  ceiling so that one hostname cannot ask for an unbounded page. */
const MOST_LISTED = 2000

export async function serveBlog(env: Env, space: Space, url: URL): Promise<Response> {
  const slug = url.pathname.replace(/^\/+|\/+$/g, '')
  const heading = space.blog_title ?? space.name

  const owner = await env.DB.prepare('select name from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null }>()
  const author = owner?.name ?? null

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
    const rendered = renderMarkdown(source, {
      footnotes: true,
      escapeHtml: true,
      resolveEmbed: await embedded(env, space, [only], source),
    })

    return page(title(only, source), withByline(rendered, author), env, author)
  }

  const { results } = await env.DB.prepare(
    'select * from notes where space_id = ? and deleted = 0 order by path limit ?',
  )
    .bind(space.id, MOST_LISTED)
    .all<Note>()

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
  const rendered = renderMarkdown(source, {
    footnotes: true,
    escapeHtml: true,
    resolveLink: linkResolver(results),
    resolveEmbed: await embedded(env, space, results, source),
  })

  // The way back sits above the note, where a reader who came from the
  // index looks for it, and the author right under the title.
  return page(
    title(note, source),
    `<p class="back"><a href="/">← ${escape(heading)}</a></p>${withByline(rendered, author)}`,
    env,
    author,
  )
}
