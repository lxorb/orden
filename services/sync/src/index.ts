import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, presentUser, requireUser } from './auth'
import { blobs, publicBlobs } from './blobs'
import { serveBlog, spaceForHost } from './blog'
import { mcp, mcpAdmin } from './mcp'
import { notes } from './notes'
import { oauth, oauthMetadata } from './oauth'
import { spaces } from './spaces'
import { QUOTA, usedBytes } from './storage'
import type { Env, Variables } from './types'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The desktop app is not served from the API's origin, so it needs to be let in
 *  by name. Auth rides on a bearer token, never on cookies. */
app.use(
  '/v1/*',
  cors({
    origin: (origin) =>
      /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost|https:\/\/nibeditor\.com)$/.test(
        origin,
      )
        ? origin
        : '',
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
)

app.route('/v1/auth', auth)

// Images are served by hash, with no session: a note is read wherever it was
// shared, and a published blog has no reader to authenticate. Registered ahead
// of the guard below for that reason.
app.route('/i', publicBlobs)

// The connector carries its own token, so it sits outside the session guard.
// Open to every origin: LLM clients run anywhere, some of them in a browser.
const anyOrigin = cors({
  origin: '*',
  allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id'],
  exposeHeaders: ['www-authenticate', 'mcp-protocol-version', 'mcp-session-id'],
})
app.use('/mcp', anyOrigin)
app.route('/mcp', mcp)

// How a client finds the sign-in, and the sign-in itself. Registered ahead of
// the catch-all, which would otherwise answer with the web app's HTML.
app.use('/.well-known/*', anyOrigin)
app.route('/.well-known', oauthMetadata)
app.use('/oauth/*', anyOrigin)
app.route('/oauth', oauth)

/** Everything past this point needs a session. */
app.use('/v1/*', async (context, next) => {
  const user = await requireUser(context.env, context.req.header('authorization'))
  if (!user) return context.json({ error: 'sign in first' }, 401)

  context.set('user', user)
  await next()
})

app.get('/v1/me', (context) => context.json({ user: presentUser(context.get('user')) }))

/** Long enough for any name, short enough that a blog footer stays a footer. */
const NAME_LIMIT = 60

/** The one thing about an account that can be changed: what to call it. */
app.patch('/v1/me', async (context) => {
  const user = context.get('user')
  const body = await context.req.json<{ name?: string }>()

  // Inner runs of whitespace go too: a name is words, not layout. So do the
  // other control characters, which nothing can show and which would only
  // ever arrive by accident or on purpose.
  const name = (body.name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
  if (name.length > NAME_LIMIT) {
    return context.json({ error: `use at most ${NAME_LIMIT} characters` }, 400)
  }

  await context.env.DB.prepare('update users set name = ? where id = ?')
    .bind(name || null, user.id)
    .run()

  return context.json({ user: presentUser({ ...user, name: name || null }) })
})

app.get('/v1/usage', async (context) => {
  const user = context.get('user')
  return context.json({ used: await usedBytes(context.env, user.id), limit: QUOTA })
})

app.route('/v1/blobs', blobs)
app.route('/v1/spaces', spaces)
app.route('/v1/mcp', mcpAdmin)
app.route('/v1', notes)

app.get('/health', (context) => context.json({ ok: true }))

/** Anything that is not the API is either a published space, looked up by
 *  hostname, or the app itself. */
app.all('*', async (context) => {
  const url = new URL(context.req.url)
  const space = await spaceForHost(context.env, url.host)

  if (space) return serveBlog(context.env, space, url)

  // A name on the shared domain that nobody publishes under has nothing to
  // show, and the editor does not live there either. Temporary, because the
  // name may be taken tomorrow.
  if (url.hostname.endsWith(`.${context.env.BLOG_ROOT}`)) {
    return context.redirect(context.env.APP_ORIGIN, 302)
  }

  // The web build of the editor. It stores notes in the browser until someone
  // signs in, so it is served to anyone who asks.
  const assets = context.env.ASSETS
  if (assets) return assets.fetch(context.req.raw)

  return context.text('Not found', 404)
})

export default app
