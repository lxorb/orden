import {
  codeBlocks,
  documentTitle,
  findLinks,
  type Heading,
  noteWithoutComments,
  renderMarkdown,
  type Wikilink,
} from '@orden/markdown'
import { DECK_HEIGHT, DECK_PAGE_CSS, DECK_SCRIPT, DECK_WIDTH, deckBody } from '@orden/markdown/deck'
import { diagramAlt, diagramFigure, diagramKey, isDiagram } from '@orden/markdown/diagrams'
import { objectIn } from './body'
import '@orden/markdown/eager'
import { isCanvasTarget, isPagesTarget, isPdfTarget } from '@orden/markdown/links'
import { isDeck } from '@orden/markdown/slide-breaks'
import { deckOf } from '@orden/markdown/slides'
import { blogFence } from './blog/code'
import { feed, type FeedPage, moment, newestFirst, robots, rss, sitemap } from './blog/feed'
import { answersFrom, formHtml, formOf } from './blog/form'
import { type NoteFront, readFront } from './blog/front'
import { keptCover } from './blog/kept-cover'
import { gateBody, letIn, matches, newTicket, ticketCookie } from './blog/gate'
import { escape, type Head, headOf } from './blog/head'
import { MATH_CSS, MATH_CSS_PATH, MATH_FONTS } from './blog/math'
import { answers, asked as readQuery, hasWords, matching } from './blog/find'
import { linkedFrom, type Listed } from './blog/nav'
import { legacyPathsOf, pageOf, pathsOf, rememberedNote } from './blog/paths'
import { SITE_JS, SITE_JS_PATH, THEME_JS, THEME_JS_HASH } from './blog/script'
import { type Around, aside, bar, contents, counter, ownFiles, underneath } from './blog/shell'
import { PAGE_CSS, PAGE_CSS_PATH, SLIDES_CSS, SLIDES_CSS_PATH } from './blog/style'
import { askInChunks, places } from './bound'
import { blogRootOf, sameOriginPath } from './hosts'
import { machineOf, mayGuess, maySendAnswer, mayTakeAnswer } from './limits'
import { noteKey } from './notes'
import { noteKind } from './rooms/kind'
import { keepAnswer } from './spaces/answers'
import { readSpaceFiles, type SpaceFile } from './spaces/files'
import { publishes, readSite, type Site, type SitePassword, SVG_POLICY } from './blog/site'
import type { Env, Note, Space } from './types'
import { SAID, said } from './said'

export { slugFor } from './blog/paths'

function csp(options: { nonce?: string; scripts?: boolean; counter?: string } = {}): string {
  const { nonce, scripts, counter } = options

  return [
    "default-src 'none'",
    nonce
      ? `script-src 'nonce-${nonce}'`
      : scripts
        ? `script-src 'self' '${THEME_JS_HASH}'${counter ? ` ${counter}` : ''}`
        : "script-src 'none'",
    scripts ? "connect-src 'self'" : "connect-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' https: data:",
    'media-src https: data:',
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function hostnameOf(host: string): string {
  return (host.toLowerCase().split(':')[0] ?? '').replace(/\.$/, '')
}

export async function spaceForHost(env: Env, host: string): Promise<Space | null> {
  const hostname = hostnameOf(host)
  if (!hostname) return null

  const root = blogRootOf(env, hostname)
  if (root && hostname !== root) {
    const subdomain = hostname.slice(0, -(root.length + 1))
    return (
      (await env.DB.prepare('select * from spaces where blog_subdomain = ? and blog_enabled = 1')
        .bind(subdomain)
        .first<Space>()) ?? null
    )
  }

  if (root) return null

  return (
    (await env.DB.prepare(
      `select * from spaces
        where blog_domain = ? and blog_enabled = 1 and blog_domain_verified_at is not null`,
    )
      .bind(hostname)
      .first<Space>()) ?? null
  )
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

function nameOf(path: string): string {
  return path.replace(/\\/g, '/').replace(MARKDOWN, '').toLowerCase()
}

interface Page {
  note: Note
  front: NoteFront
  slug: string
}

function pages(listed: readonly Page[]): Map<string, string> {
  const byName = new Map<string, string>()

  const ordered = [...listed].sort(
    (one, other) => other.note.path.split('/').length - one.note.path.split('/').length,
  )

  for (const page of ordered) {
    const whole = nameOf(page.note.path)
    const url = `/${page.slug}`
    const parts = whole.split('/')

    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
    byName.set(whole, url)
    byName.set(`/${whole}`, url)
  }

  return byName
}

const MOST_EMBEDDED = 20

function blobUrl(file: SpaceFile): string {
  const extension = /\.([a-z0-9]+)$/i.exec(file.path)?.[1]?.toLowerCase() ?? 'bin'
  return `/i/${file.hash}.${extension}`
}

function fileUrls(files: readonly SpaceFile[]): Map<string, string> {
  const byName = new Map<string, string>()

  const ordered = [...files].sort(
    (one, other) => other.path.split('/').length - one.path.split('/').length,
  )

  for (const file of ordered) {
    const url = blobUrl(file)
    const parts = file.path.toLowerCase().split('/')
    for (let at = 0; at < parts.length; at++) byName.set(parts.slice(at).join('/'), url)
    byName.set(`/${parts.join('/')}`, url)
  }

  return byName
}

const NO_FRONT: NoteFront = {}

function fileFor(space: Space, site: Site, slug: string, url: URL): Response | null {
  const found = fileAt(space, slug)
  if (!found || !publishes(site.rules, found.path, NO_FRONT)) return null

  return toFile(found, url)
}

function fileAt(space: Space, slug: string): SpaceFile | null {
  const files = readSpaceFiles(space.files)
  if (!files.length) return null

  let wanted = slug
  try {
    wanted = decodeURIComponent(slug)
  } catch {
    // Not valid encoding, so it is already the name it stands for.
  }

  return files.find((one) => one.path.toLowerCase() === wanted.toLowerCase()) ?? null
}

function toFile(file: SpaceFile, url: URL): Response {
  return Response.redirect(new URL(blobUrl(file), url).toString(), 302)
}

export async function publishesFile(
  env: Env,
  space: Space,
  file: SpaceFile,
  request: Request,
): Promise<boolean> {
  const site = readSite(space.site)
  if (!space.blog_note) {
    if (!publishes(site.rules, file.path, NO_FRONT)) return false
    return !site.password || (await letIn(site.password, request.headers.get('cookie'), Date.now()))
  }

  const url = new URL(`/${encodeURIComponent(file.path)}`, request.url)
  const answer = await served(env, space, url, request, site)
  return answer.headers.get('location') === new URL(blobUrl(file), url).toString()
}

function linkResolver(listed: readonly Page[], files: readonly SpaceFile[]) {
  const byName = pages(listed)
  const byFile = fileUrls(files)

  return (link: Wikilink) => ({
    href: !link.target
      ? ''
      : isPdfTarget(link.target)
        ? (byFile.get(nameOf(link.target)) ?? null)
        : (byName.get(nameOf(link.target)) ?? null),
  })
}

function noteHrefResolver(from: string, listed: readonly Page[], files: readonly SpaceFile[]) {
  const byName = pages(listed)
  const byFile = fileUrls(files)

  return (target: string) => {
    const written = decoded(target)
    if (!written) return null

    const path = against(from, written)
    if (isPdfTarget(path)) return byFile.get(path.toLowerCase()) ?? null

    return byName.get(nameOf(path)) ?? byName.get(nameOf(written)) ?? null
  }
}

function decoded(target: string): string | null {
  try {
    return decodeURIComponent(target.trim()) || null
  } catch {
    return null
  }
}

function against(from: string, target: string): string {
  const here = from.replace(/\\/g, '/').split('/').slice(0, -1)
  const out: string[] = [...here]

  for (const step of target.replace(/\\/g, '/').split('/')) {
    if (step === '' || step === '.') continue
    if (step === '..') out.pop()
    else out.push(step)
  }

  return out.join('/')
}

async function embedded(
  env: Env,
  space: Space,
  notes: readonly Note[],
  source: string,
): Promise<(link: Wikilink) => string | null> {
  const byName = new Map<string, Note>()
  for (const note of notes) {
    byName.set(nameOf(note.path), note)
    byName.set(`/${nameOf(note.path)}`, note)
  }

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
      if (object) bodies.set(name, noteWithoutComments(await object.text()))
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

function withByline(html: string, author: string | null): string {
  if (!author) return html

  const byline = `<p class="by">by ${escape(author)}</p>`
  const heading = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(html)

  return heading
    ? html.slice(0, heading[0].length) + byline + html.slice(heading[0].length)
    : byline + html
}

function sheet(body: string, kind = 'text/css'): Response {
  return new Response(body, {
    headers: {
      'content-type': `${kind}; charset=utf-8`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

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

function mathLink(body: string): string {
  return body.includes('class="katex') ? `\n<link rel="stylesheet" href="${MATH_CSS_PATH}">` : ''
}

const PAGE_LANGUAGE = 'en'

const RIGHT_TO_LEFT_PAGES = ['ar', 'fa', 'ps', 'ur']
const PAGE_DIRECTION = RIGHT_TO_LEFT_PAGES.includes(PAGE_LANGUAGE.split('-')[0] ?? '')
  ? 'rtl'
  : 'ltr'

interface Furniture {
  bar?: string
  left?: string
  right?: string
  under?: string
  own?: { css: string | null; js: string | null }
  counter?: string
  theme?: string | null
}

function page(
  head: Head,
  body: string,
  env: Env,
  options: {
    status?: number
    locked?: boolean
    headers?: Record<string, string>
    shell?: Furniture
  } = {},
): Response {
  const author = head.author ?? null
  const shell = options.shell ?? {}

  const sheets = [PAGE_CSS_PATH, ...(shell.theme ? [shell.theme] : [])]
  if (shell.own?.css) sheets.push(shell.own.css)

  const scripts = !options.locked
  const html = `<!doctype html>
<html lang="${PAGE_LANGUAGE}" dir="${PAGE_DIRECTION}"><head>
${headOf(head, sheets)}${mathLink(body)}
${scripts ? `<script>${THEME_JS}</script>` : ''}
${scripts ? `<script defer src="${SITE_JS_PATH}"></script>` : ''}
${shell.own?.js && scripts ? `<script defer src="${shell.own.js}"></script>` : ''}
${shell.counter ?? ''}
</head><body class="site">
${shell.bar ?? ''}
<div class="frame">
${shell.left ?? ''}
<div class="middle"><main id="write">${body}
<footer>${author ? `<span>${escape(author)}</span>` : ''}<span>Published with <a href="${env.APP_ORIGIN}">Orden</a></span></footer>
</main>${shell.under ? `<div class="under">${shell.under}</div>` : ''}</div>
${shell.right ?? ''}
</div></body></html>`

  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': options.locked ? 'private, no-store' : 'public, max-age=60',
      vary: SAID(['preview']).join(', '),
      'content-security-policy': csp({
        scripts,
        ...(shell.counter ? { counter: new URL(counterUrl(shell.counter)).origin } : {}),
      }),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
      ...options.headers,
    },
  })
}

function counterUrl(tag: string): string {
  return /src="([^"]+)"/.exec(tag)?.[1] ?? 'https://example.invalid'
}

function deckPage(head: Head, body: string): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const html = `<!doctype html>
<html lang="${PAGE_LANGUAGE}" dir="${PAGE_DIRECTION}"><head>
${headOf(
  {
    ...head,
    style: `.deck .stage{--stage-width:${DECK_WIDTH}px;--stage-height:${DECK_HEIGHT}px}${DECK_PAGE_CSS}`,
  },
  [PAGE_CSS_PATH, SLIDES_CSS_PATH],
)}${mathLink(body)}
</head><body class="deck-page">${body}
<script nonce="${nonce}">${DECK_SCRIPT}</script>
</body></html>`

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, max-age=60',
      'content-security-policy': csp({ nonce }),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}

const SLIDES_QUERY = 'slides'

function presentLink(source: string): string {
  return isDeck(source) ? `<p class="present"><a href="?${SLIDES_QUERY}">Present</a></p>` : ''
}

function publishedDeck(source: string, options: Parameters<typeof renderMarkdown>[1]): string {
  return deckBody(
    deckOf(source).map((slide) => ({
      html: renderMarkdown(slide.markdown, { ...options, breaks: true, cover: false }),
      shape: slide.shape,
      vertical: slide.vertical,
      fragments: slide.fragments,
    })),
  )
}

function hardBreaksIn(raw: string | null | undefined): boolean {
  return objectIn(raw)?.hardBreaks === true
}

const MOST_LISTED = 2000

function titleOf(page: Page): string {
  return (
    page.front.title ??
    page.front.heading ??
    page.note.path.replace(MARKDOWN, '').split('/').pop() ??
    page.note.path
  )
}

async function sitePages(env: Env, space: Space, site: Site): Promise<Page[]> {
  const listing = await env.DB.prepare(
    `select * from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_LISTED)
    .all<Note>()

  const listed: Page[] = []
  for (const note of listing.results) {
    if (isCanvasTarget(note.path) || isPagesTarget(note.path)) continue
    if (noteKind(note) === 'plane') continue

    const front = readFront(note.front)
    if (!publishes(site.rules, note.path, front)) continue

    listed.push({ note, front, slug: pageOf(note.path, front) })
  }

  return apart(listed)
}

function apart(listed: Page[]): Page[] {
  const wanted = new Set(listed.map((one) => one.slug))
  const taken = new Set<string>()
  return listed.map((one) => {
    let slug = one.slug
    for (let n = 2; taken.has(slug); n++) {
      slug = `${one.slug}-${String(n)}`
      if (wanted.has(slug)) slug = one.slug
    }
    taken.add(slug)
    return slug === one.slug ? one : { ...one, slug }
  })
}

function feedPages(listed: readonly Page[], origin: string): FeedPage[] {
  return listed.map((page) => ({
    url: `${origin}/${page.slug}`,
    title: titleOf(page),
    updated: page.note.updated_at,
    date: page.front.date,
    summary: page.front.description ?? page.front.summary,
  }))
}

function favicon(space: Space, site: Site): Response {
  const letter = escape((space.blog_title ?? space.name).trim().slice(0, 1).toUpperCase())

  const drawn =
    site.icon ??
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<rect width="32" height="32" rx="7" fill="#17161c"/>` +
      `<text x="16" y="23" text-anchor="middle" fill="#fff" font-family="ui-sans-serif,system-ui,sans-serif" font-size="19" font-weight="600">${letter}</text>` +
      `</svg>`

  return new Response(drawn, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': SVG_POLICY,
    },
  })
}

function pictureAt(
  said: string | undefined,
  files: Map<string, string>,
  origin: string,
): string | undefined {
  if (!said) return undefined

  const written =
    said
      .replace(/^!?\[\[/, '')
      .replace(/\]\]$/, '')
      .split('|')[0]
      ?.trim() ?? ''
  if (!written) return undefined

  if (/^https?:\/\//i.test(written)) return written
  if (written.startsWith('/')) return `${origin}${written}`

  const held = files.get(written.replace(/\\/g, '/').toLowerCase())
  return held ? `${origin}${held}` : undefined
}

function firstPicture(html: string, origin: string): string | undefined {
  const found = /<img\b[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1]
  if (!found) return undefined

  if (/^https?:\/\//i.test(found)) return found
  return found.startsWith('/') ? `${origin}${found}` : undefined
}

function machineIn(request: Request): string | null {
  return machineOf({ header: (name) => request.headers.get(name) ?? undefined })
}

async function answered(request: Request, held: SitePassword): Promise<boolean> {
  const form = await request.formData().catch(() => null)
  const said = form?.get('password')

  return typeof said === 'string' ? matches(held, said) : false
}

function listed(page: Page): Listed {
  return { slug: page.slug, title: titleOf(page), path: page.note.path, front: page.front }
}

function graphOf(pages: readonly Page[], only?: Set<string>): string {
  const shown = only ? pages.filter((one) => only.has(one.slug)) : pages
  const at = new Map(shown.map((one, index) => [one.slug, index]))
  const byName = new Map<string, string>()

  for (const page of shown) {
    const whole = nameOf(page.note.path)
    const parts = whole.split('/')
    for (let one = 0; one < parts.length; one++) byName.set(parts.slice(one).join('/'), page.slug)
    byName.set(`/${whole}`, page.slug)
    for (const alias of page.front.aliases ?? []) byName.set(alias, page.slug)
  }

  const degree = new Map<string, number>()
  const edges: { a: number; b: number; both: boolean }[] = []
  const seen = new Set<string>()

  for (const page of shown) {
    const from = at.get(page.slug)
    if (from === undefined) continue

    for (const link of page.front.links ?? []) {
      const target = byName.get(link)
      const to = target === undefined ? undefined : at.get(target)
      if (to === undefined || to === from) continue

      const key = from < to ? `${from}-${to}` : `${to}-${from}`
      if (seen.has(key)) {
        const held = edges.find(
          (one) => (one.a === from && one.b === to) || (one.a === to && one.b === from),
        )
        if (held) held.both = true
        continue
      }

      seen.add(key)
      edges.push({ a: from, b: to, both: false })
      degree.set(page.slug, (degree.get(page.slug) ?? 0) + 1)
      degree.set(target ?? '', (degree.get(target ?? '') ?? 0) + 1)
    }
  }

  return JSON.stringify({
    nodes: shown.map((one) => ({
      id: one.slug,
      name: titleOf(one),
      path: `/${one.slug}`,
      degree: degree.get(one.slug) ?? 0,
      tags: one.front.tags ?? [],
    })),
    edges,
  })
}

export function asIsland(json: string): string {
  return json.replace(/</g, '\\u003c')
}

function graphBody(pages: readonly Page[], here: string, only?: Set<string>): string {
  const shown = only ? pages.filter((one) => only.has(one.slug)) : pages

  const rows = shown
    .map((one) => `<li><a href="/${escape(one.slug)}">${escape(titleOf(one))}</a></li>`)
    .join('')

  return (
    `<div class="graph" data-here="${escape(here)}">` +
    `<script type="application/json">${asIsland(graphOf(pages, only))}</script>` +
    `</div><ul class="index">${rows}</ul>`
  )
}

function near(pages: readonly Page[], page: Page): Set<string> {
  const around = new Set<string>([page.slug])
  const all = pages.map(listed)
  const here = listed(page)

  for (const one of linkedFrom(all, here)) around.add(one.slug)

  const byName = pages.reduce((map, one) => {
    const parts = nameOf(one.note.path).split('/')
    for (let at = 0; at < parts.length; at++) map.set(parts.slice(at).join('/'), one.slug)
    map.set(`/${parts.join('/')}`, one.slug)
    for (const alias of one.front.aliases ?? []) map.set(alias, one.slug)
    return map
  }, new Map<string, string>())

  for (const link of page.front.links ?? []) {
    const found = byName.get(link)
    if (found) around.add(found)
  }

  return around
}

const MOST_DIAGRAMS = 24

async function heldBlobs(
  env: Env,
  userId: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (!hashes.length) return new Set<string>()

  const found = await askInChunks(hashes, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select hash from blobs where user_id = ? and type = 'image/svg+xml'
        and hash in (${places(chunk.length)})`,
    )
      .bind(userId, ...chunk)
      .all<{ hash: string }>()

    return results
  })

  return new Set(found.map((row) => row.hash))
}

async function diagramsIn(env: Env, space: Space, source: string): Promise<Map<string, string>> {
  const fences = codeBlocks(source)
    .filter((one) => isDiagram(one.language))
    .slice(0, MOST_DIAGRAMS)

  if (!fences.length) return new Map<string, string>()

  const named = await Promise.all(
    fences.map(async (one) => ({
      fence: one,
      light: await diagramKey(space.id, one.language, one.code, 'light'),
      dark: await diagramKey(space.id, one.language, one.code, 'dark'),
    })),
  )

  const held = await heldBlobs(env, space.user_id, [
    ...new Set(named.flatMap((one) => [one.light, one.dark])),
  ])

  const drawn = new Map<string, string>()
  for (const { fence, light, dark } of named) {
    if (!held.has(light)) continue

    drawn.set(
      `${fence.language}\n${fence.code}`,
      diagramFigure(fence.language.toLowerCase(), diagramAlt(fence.code), {
        light: `/i/${light}.svg`,
        dark: held.has(dark) ? `/i/${dark}.svg` : null,
      }),
    )
  }

  return drawn
}

function fencesOf(noteId: string, url: URL, request: Request, drawn: ReadonlyMap<string, string>) {
  const sent = url.searchParams.get('sent') === noteId
  const wrong = url.searchParams.get('wrong')

  return (code: string, language: string): string | null => {
    if (isDiagram(language)) return drawn.get(`${language}\n${code}`) ?? null

    if (language.toLowerCase() !== 'form') return blogFence(code, language)

    const form = formOf(code)
    if (!form) return null

    return formHtml(form, noteId, sent, request.method === 'GET' ? wrong : null)
  }
}

async function takeAnswer(
  env: Env,
  space: Space,
  site: Site,
  request: Request,
  noteId: string,
): Promise<Response> {
  const back = (where: string) =>
    new Response(null, {
      status: 303,
      headers: { location: where, 'cache-control': 'private, no-store' },
    })

  if (site.password && !(await letIn(site.password, request.headers.get('cookie'), Date.now()))) {
    return back('/')
  }

  const note = await env.DB.prepare(
    "select * from notes where id = ? and space_id = ? and deleted = 0 and kind != 'file'",
  )
    .bind(noteId, space.id)
    .first<Note>()

  if (!note) return new Response('Not found', { status: 404 })

  const front = readFront(note.front)
  const shown = space.blog_note
    ? note.path === space.blog_note
    : publishes(site.rules, note.path, front)
  if (!shown) return new Response('Not found', { status: 404 })

  const object = await env.NOTES.get(noteKey(space.id, note.id))
  const source = noteWithoutComments(object ? await object.text() : '')

  const fence = codeBlocks(source).find((one) => one.language.toLowerCase() === 'form')
  const form = fence ? formOf(fence.code) : null
  const listed = space.blog_note ? [] : await sitePages(env, space, site)
  const slug = listed.find((one) => one.note.id === note.id)?.slug ?? pageOf(note.path, front)
  const where = space.blog_note ? '/' : new URL(`/${slug}`, request.url).pathname
  if (!form) return back(where)

  const machine = machineIn(request)
  if (!(await maySendAnswer(env, machine)) || !(await mayTakeAnswer(env, space.id))) {
    return back(`${where}?wrong=busy`)
  }

  const sent = await request.formData().catch(() => null)
  if (!sent) return back(where)

  const read = answersFrom(form, sent)
  if ('wrong' in read) return back(`${where}?wrong=${read.wrong}`)

  if (!(await keepAnswer(env, space.id, note.id, read.answers))) {
    return back(`${where}?wrong=full`)
  }

  return back(`${where}?sent=${encodeURIComponent(note.id)}`)
}

export async function serveBlog(
  env: Env,
  space: Space,
  url: URL,
  request: Request,
): Promise<Response> {
  const site = readSite(space.site)
  const answer = await served(env, space, url, request, site)
  if (!site.password) return answer

  const headers = new Headers(answer.headers)
  headers.set('cache-control', 'private, no-store')
  return new Response(answer.body, { status: answer.status, headers })
}

async function served(
  env: Env,
  space: Space,
  url: URL,
  request: Request,
  site: Site,
): Promise<Response> {
  if (url.pathname === PAGE_CSS_PATH) return sheet(PAGE_CSS)
  if (url.pathname === SLIDES_CSS_PATH) return sheet(SLIDES_CSS)
  if (url.pathname === MATH_CSS_PATH) return sheet(MATH_CSS)
  if (url.pathname === SITE_JS_PATH) return sheet(SITE_JS, 'text/javascript')

  const wanted = MATH_FONTS[url.pathname]
  if (wanted) return face(wanted)

  const slug = url.pathname.replace(/^\/+|\/+$/g, '')
  const heading = space.blog_title ?? space.name
  const slides = url.searchParams.has(SLIDES_QUERY)
  const preview = said((name) => request.headers.get(name), 'preview') === '1'

  if (slug === 'favicon.svg') return favicon(space, site)
  if (slug === 'robots.txt') return robots(url.origin, !!site.password)

  const answering = /^form\/([A-Za-z0-9_-]{1,64})$/.exec(slug)
  if (answering?.[1] && request.method === 'POST') {
    return takeAnswer(env, space, site, request, answering[1])
  }

  if (site.password) {
    const held = site.password
    const said =
      request.method === 'POST' &&
      (await mayGuess(env, space.id, machineIn(request))) &&
      (await answered(request, held))

    if (said) {
      return new Response(null, {
        status: 303,
        headers: {
          location: sameOriginPath(url.pathname),
          'set-cookie': ticketCookie(await newTicket(held, Date.now())),
          'cache-control': 'private, no-store',
        },
      })
    }

    if (!(await letIn(held, request.headers.get('cookie'), Date.now()))) {
      const wrong = request.method === 'POST'
      return page(
        { title: heading, site: heading, url: `${url.origin}/`, noindex: true },
        gateBody(heading, sameOriginPath(url.pathname), wrong),
        env,
        { status: wrong ? 401 : 200, locked: true },
      )
    }
  }

  const owner = await env.DB.prepare('select name, settings from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null; settings: string | null }>()
  const author = owner?.name ?? null
  const breaks = hardBreaksIn(owner?.settings)

  const files = readSpaceFiles(space.files)
  const byFile = fileUrls(files)

  const about = (title: string, over: Partial<Head> = {}): Head => ({
    title,
    site: heading,
    url: `${url.origin}/${slug}`,
    author,
    description: site.description,
    image: pictureAt(site.image, byFile, url.origin),
    feed: true,
    icon: true,
    ...over,
  })

  const theme = site.theme ? `/i/${site.theme.hash}.css` : null
  const own = ownFiles(byFile)
  const counting = counter(site)

  const missing = () =>
    page(about('Not found'), '<h1>Not found</h1>', env, {
      status: 404,
      shell: { theme, own, counter: counting },
    })

  if (space.blog_note) {
    const file = slug ? fileAt(space, slug) : null
    if (slug && !file) return missing()

    const only = await env.DB.prepare(
      "select * from notes where space_id = ? and path = ? and deleted = 0 and kind != 'file'",
    )
      .bind(space.id, space.blog_note)
      .first<Note>()

    if (!only) return missing()

    const object = await env.NOTES.get(noteKey(space.id, only.id))
    const source = noteWithoutComments(object ? await object.text() : '')
    const front = readFront(only.front)

    const reading = {
      escapeHtml: true,
      code: fencesOf(only.id, url, request, await diagramsIn(env, space, source)),
      breaks,
      cover: keptCover(only.meta) ?? true,
      locale: PAGE_LANGUAGE,
      resolveLink: linkResolver([], files),
      resolveNoteHref: noteHrefResolver(only.path, [], files),
      resolveEmbed: await embedded(env, space, [only], source),
    }

    if (file) {
      const rendered = renderMarkdown(source, { footnotes: true, ...reading })
      return rendered.includes(`="${blobUrl(file)}`) ? toFile(file, url) : missing()
    }

    const head = about(front.title ?? title(only, source), {
      url: `${url.origin}/`,
      description: front.description ?? front.summary ?? site.description,
      image:
        pictureAt(front.image ?? keptCover(only.meta)?.src, byFile, url.origin) ??
        pictureAt(site.image, byFile, url.origin),
      date: front.date,
      feed: false,
    })

    if (slides && isDeck(source)) return deckPage(head, publishedDeck(source, reading))

    const headings: Heading[] = []
    const rendered = renderMarkdown(source, { footnotes: true, toc: true, headings, ...reading })
    head.image ??= firstPicture(rendered, url.origin)

    return page(head, withByline(rendered, author) + presentLink(source), env, {
      shell: {
        theme,
        own,
        counter: counting,
        ...(preview ? {} : { right: contents(headings) }),
      },
    })
  }

  const asked = slug ? fileFor(space, site, slug, url) : null
  if (asked) return asked

  const pageList = await sitePages(env, space, site)
  const all = pageList.map(listed)

  const around: Around = {
    site: heading,
    pages: all,
    searchable: all.length > 1,
    query: url.searchParams.get('q') ?? '',
  }

  if (slug === 'sitemap.xml') {
    const written = feedPages(pageList, url.origin)
    const newest = newestFirst(written)[0]
    const both = ['feed.xml', 'rss.xml'].map((name) => ({
      url: `${url.origin}/${name}`,
      title: heading,
      updated: newest?.updated ?? space.updated_at,
      date: newest?.date,
    }))

    return sitemap([
      { url: `${url.origin}/`, title: heading, updated: space.updated_at },
      ...written,
      ...both,
    ])
  }

  if (slug === 'feed.xml' || slug === 'rss.xml') {
    const about = {
      title: heading,
      url: url.origin,
      author,
      description: site.description,
    }

    const written = feedPages(pageList, url.origin)
    return slug === 'rss.xml' ? rss(written, about) : feed(written, about)
  }

  if (slug === 'search') {
    const query = url.searchParams.get('q') ?? ''
    const one = readQuery(query)
    const hits = hasWords(one) ? await matching(env, space.id, one) : []
    const byId = new Map(pageList.map((page) => [page.note.id, page]))

    const found = (
      hasWords(one)
        ? hits.flatMap((hit) => {
            const held = byId.get(hit.noteId)
            return held ? [{ page: held, words: hit.words }] : []
          })
        : pageList.map((held) => ({ page: held, words: held.front.summary ?? '' }))
    ).filter(({ page: held }) => {
      const tags = held.front.tags ?? []
      const path = held.note.path.toLowerCase()

      return (
        one.tags.every((tag) => tags.includes(tag)) &&
        one.folders.every((folder) => path.includes(folder))
      )
    })

    return page(
      about(query ? `${query}, ${heading}` : `Search ${heading}`, {
        url: `${url.origin}/search`,
        noindex: true,
      }),
      `<h1>Search</h1>${answers(
        found.map(({ page: held, words }) => ({
          slug: held.slug,
          title: titleOf(held),
          words,
        })),
        one,
        query,
      )}`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, 'search'),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  if (slug === 'graph') {
    return page(
      about(`Graph, ${heading}`, { url: `${url.origin}/graph` }),
      `<h1>Graph</h1>${graphBody(pageList, '')}`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, 'graph'),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  if (!slug) {
    const items = newestFirst(feedPages(pageList, url.origin))
      .map((one) => {
        const date = new Date(moment(one)).toISOString().slice(0, 10)
        const where = escape(new URL(one.url).pathname)
        return `<li><a href="${where}"><span>${escape(one.title)}</span><time datetime="${date}">${date}</time></a></li>`
      })
      .join('')

    const byline = author ? `<p class="by">by ${escape(author)}</p>` : ''

    return page(
      about(heading, { url: `${url.origin}/` }),
      `<h1>${escape(heading)}</h1>${byline}<ul class="index">${items}</ul>`,
      env,
      {
        shell: {
          bar: bar(around),
          left: aside(around, ''),
          theme,
          own,
          counter: counting,
        },
      },
    )
  }

  const decodedSlug = decoded(slug) ?? slug
  const found =
    pageList.find((one) => one.slug === decodedSlug) ??
    pageList.find((one) => pathsOf(one.note.path, one.front).includes(decodedSlug))

  if (!found) {
    const was = await rememberedNote(env, space.id, decodedSlug)
    const moved = was ? pageList.find((one) => one.note.id === was) : null
    if (moved) return Response.redirect(new URL(`/${moved.slug}`, url).toString(), 301)

    const before = pageList.find((one) =>
      legacyPathsOf(one.note.path, one.front).includes(decodedSlug),
    )
    if (before) return Response.redirect(new URL(`/${before.slug}`, url).toString(), 301)

    return missing()
  }

  const note = found.note
  const object = await env.NOTES.get(noteKey(space.id, note.id))
  const source = noteWithoutComments(object ? await object.text() : '')

  const reading = {
    escapeHtml: true,
    code: fencesOf(note.id, url, request, await diagramsIn(env, space, source)),
    breaks,
    cover: keptCover(note.meta) ?? true,
    locale: PAGE_LANGUAGE,
    resolveLink: linkResolver(pageList, files),
    resolveNoteHref: noteHrefResolver(note.path, pageList, files),
    resolveEmbed: await embedded(
      env,
      space,
      pageList.map((one) => one.note),
      source,
    ),
  }

  const head = about(found.front.title ?? title(note, source), {
    article: true,
    url: `${url.origin}/${found.slug}`,
    description: found.front.description ?? found.front.summary ?? site.description,
    image:
      pictureAt(found.front.image ?? keptCover(note.meta)?.src, byFile, url.origin) ??
      pictureAt(site.image, byFile, url.origin),
    date: found.front.date,
  })

  if (slides && isDeck(source)) return deckPage(head, publishedDeck(source, reading))

  const headings: Heading[] = []
  const rendered = renderMarkdown(source, { footnotes: true, toc: true, headings, ...reading })
  head.image ??= firstPicture(rendered, url.origin)

  if (preview) {
    return page(head, withByline(rendered, author), env, { shell: { theme, own } })
  }

  const here = listed(found)

  return page(
    head,
    `<p class="back"><a href="/">← ${escape(heading)}</a></p>${withByline(rendered, author)}${presentLink(source)}`,
    env,
    {
      shell: {
        bar: bar(around),
        left: aside(around, found.slug),
        right: contents(headings),
        under: `${underneath(around, here)}${
          all.length > 2 ? graphBody(pageList, found.slug, near(pageList, found)) : ''
        }`,
        theme,
        own,
        counter: counting,
      },
    },
  )
}
