import { Hono } from 'hono'
import { textAtMost } from './body'
import type { Env } from './types'

const REGISTRY = 'https://raw.githubusercontent.com/lxorb/orden-themes/main'

const ID = /^[a-z0-9][a-z0-9-]{0,38}$/

const EDGE_SECONDS = 3600
const CLIENT_SECONDS = 300

const MOST_BYTES = 512 * 1024

function headers(type: string): Record<string, string> {
  return {
    'content-type': type,
    'cache-control': `public, max-age=${CLIENT_SECONDS}, s-maxage=${EDGE_SECONDS}`,
    'access-control-allow-origin': '*',
  }
}

async function fromRegistry(path: string): Promise<string | null> {
  const response = await fetch(`${REGISTRY}/${path}`, {
    cf: { cacheTtl: EDGE_SECONDS, cacheEverything: true },
  })

  if (!response.ok) return null

  return await textAtMost(response, MOST_BYTES)
}

function wrong(message: string, status: 400 | 404 | 502): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: headers('application/json; charset=utf-8'),
  })
}

export const themes = new Hono<{ Bindings: Env }>()

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
