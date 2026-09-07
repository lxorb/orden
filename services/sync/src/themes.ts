import { Hono } from 'hono'
import type { Env } from './types'

/** The theme store's catalogue, served from here rather than from where it lives.
 *
 *  The registry is a public GitHub repository, and the app could read it
 *  directly. It does not, for three reasons. Every reader looking at the gallery
 *  would be a request from their address to GitHub, which is nobody's business
 *  but theirs. The registry could not then move without a release of the app, and
 *  a store whose address is baked into every installed copy is a store that can
 *  never move. And raw.githubusercontent.com sends no cache headers worth having,
 *  so thirty readers would be thirty round trips instead of one.
 *
 *  Nothing here is behind the session: a catalogue of themes is public, and the
 *  web app asks for it from its own origin as well. Read-only, so it is open to
 *  every origin. */

/** Where the registry lives today. The one place that knows. */
const REGISTRY = 'https://raw.githubusercontent.com/lxorb/nib-themes/main'

/** What an id may be: the same shape the registry gives its folders and the app
 *  checks before it writes a file. Checked here as well, because this is where
 *  it is pasted into a URL. */
const ID = /^[a-z0-9][a-z0-9-]{0,38}$/

/** How long an answer is good for.
 *
 *  Long at the edge, because the catalogue is the same bytes for everyone and a
 *  theme's stylesheet is the same bytes for as long as its version is. Short in
 *  the reader's own cache, so a theme published this morning is offered this
 *  morning rather than tomorrow. */
const EDGE_SECONDS = 3600
const CLIENT_SECONDS = 300

/** A theme is text, and nothing here is ever big. A registry answering with
 *  something enormous is a registry that has gone wrong. */
const MOST_BYTES = 512 * 1024

function headers(type: string): Record<string, string> {
  return {
    'content-type': type,
    'cache-control': `public, max-age=${CLIENT_SECONDS}, s-maxage=${EDGE_SECONDS}`,
    // Read-only public data, asked for by the desktop app, by the web app and
    // by a development build on localhost. There is nothing to authenticate and
    // so nothing an origin could be trusted with that another could not.
    'access-control-allow-origin': '*',
  }
}

/** Fetches one file from the registry, through the edge cache.
 *
 *  `cacheEverything` is what makes the cache apply at all: without it Cloudflare
 *  caches by file extension, and `index.json` is not one of the extensions it
 *  caches by. */
async function fromRegistry(path: string): Promise<string | null> {
  const response = await fetch(`${REGISTRY}/${path}`, {
    cf: { cacheTtl: EDGE_SECONDS, cacheEverything: true },
  })

  if (!response.ok) return null

  const text = await response.text()
  return new TextEncoder().encode(text).length > MOST_BYTES ? null : text
}

/** Something went wrong, said so the app can read it.
 *
 *  Through the same headers as an answer that worked, because the desktop app is
 *  not on this origin: a body without them is a body the app is not allowed to
 *  look at, and the reader would be shown whatever the browser says about a
 *  request that failed instead of the sentence written here. */
function wrong(message: string, status: 400 | 404 | 502): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: headers('application/json; charset=utf-8'),
  })
}

export const themes = new Hono<{ Bindings: Env }>()

/** A browser asks before it fetches across origins. Answered here rather than
 *  through the shared CORS middleware, which is set up for the session routes
 *  and their allowed list of origins. */
themes.options('/*', (context) =>
  context.body(null, 204, {
    ...headers('text/plain'),
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
  }),
)

themes.get('/index.json', async () => {
  const found = await fromRegistry('index.json')
  if (found === null) return wrong('the theme store is not answering', 502)

  return new Response(found, { headers: headers('application/json; charset=utf-8') })
})

themes.get('/:id/theme.css', async (context) => {
  const id = context.req.param('id')
  if (!ID.test(id)) return wrong('that is not a theme', 400)

  const found = await fromRegistry(`themes/${id}/theme.css`)
  if (found === null) return wrong('no such theme', 404)

  return new Response(found, { headers: headers('text/css; charset=utf-8') })
})
