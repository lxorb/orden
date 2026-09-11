import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ask } from './ask'
import { auth, presentUser, requireWhoever } from './auth'
import { readBody } from './body'
import { blobs, publicBlobs } from './blobs'
import { hostnameOf, serveBlog, spaceForHost } from './blog'
import { cleanName, NAME_LIMIT } from './crypto'
import { expireGuests, guestMayReach, presentGuest, renameGuest } from './guests'
import { mcp, mcpAdmin } from './mcp'
import { notes } from './notes'
import { oauth, oauthMetadata } from './oauth'
import { expireClients } from './oauth/clients'
import { rooms } from './rooms'
import { settings } from './settings'
import { spaces } from './spaces'
import { join } from './spaces/join'
import { recheckDomains } from './spaces/proof'
import { expireRequests, sharedWithMe } from './spaces/share'
import { themes } from './themes'
import { purgeExpired, trash } from './trash'
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

// The theme store's catalogue. Public, read-only, and asked for by the app
// before anybody has signed in, so it sits ahead of the guard like the images.
app.route('/themes', themes)

// The connector carries its own token, so it sits outside the session guard.
// Open to every origin: LLM clients run anywhere, some of them in a browser.
const anyOrigin = cors({
  origin: '*',
  allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id'],
  exposeHeaders: ['www-authenticate', 'mcp-protocol-version', 'mcp-session-id'],
})
app.use('/mcp', anyOrigin)
app.route('/mcp', mcp)

// A note several devices are writing in at once. A socket rather than a request,
// and a socket carries no `Authorization` header, so it names its token in the
// subprotocol and is let in ahead of the guard below; see rooms/index.ts.
app.route('/rooms', rooms)

// A link somebody was sent to a shared space. Both halves sit outside the guard
// below, because a link is its own proof: what it is about is answered to
// anybody, and walking through it is what hands out the session. See
// spaces/join.ts.
app.route('/v1/join', join)

// How a client finds the sign-in, and the sign-in itself. Registered ahead of
// the catch-all, which would otherwise answer with the web app's HTML.
app.use('/.well-known/*', anyOrigin)
app.route('/.well-known', oauthMetadata)
app.use('/oauth/*', anyOrigin)
app.route('/oauth', oauth)

/** Everything past this point needs a session, of one of the two kinds there
 *  are. A guest's reaches the handful of routes `guestMayReach` names and
 *  nothing else: the spaces its links granted, and who it is. */
app.use('/v1/*', async (context, next) => {
  const who = await requireWhoever(context.env, context.req.header('authorization'))
  if (!who) return context.json({ error: 'sign in first' }, 401)

  context.set('who', who)

  if (who.kind === 'guest') {
    const path = new URL(context.req.url).pathname
    if (!guestMayReach(context.req.method, path)) {
      return context.json({ error: 'sign in to do that' }, 403)
    }
    context.set('guest', who.guest)
  } else {
    context.set('user', who.user)
  }

  await next()
})

app.get('/v1/me', (context) => {
  const who = context.get('who')
  // A guest is not an account and is not answered as one: what comes back is a
  // name, which is all a guest has and all the other people in a note need.
  return who.kind === 'guest'
    ? context.json({ guest: presentGuest(who.guest) })
    : context.json({ user: presentUser(who.user) })
})

/** The one thing about whoever is here that can be changed: what to call them.
 *  One route for both, because a guest renaming itself so that a caret carries
 *  something real is the same act as an account choosing a name. */
app.patch('/v1/me', async (context) => {
  const who = context.get('who')
  const body = await readBody(context)
  // Read with room to spare, because what is measured is the name that comes
  // out of the cleaning below rather than what arrived.
  const given = body.text('name', NAME_LIMIT * 8)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const name = cleanName(given ?? '')
  if (name.length > NAME_LIMIT) {
    return context.json({ error: `use at most ${NAME_LIMIT} characters` }, 400)
  }

  if (who.kind === 'guest') {
    // A guest keeps the name it arrived with rather than losing it to an empty
    // field: a caret with nothing over it is worse than one with a made-up word.
    const named = name || who.guest.name
    await renameGuest(context.env, who.guest.id, named)
    return context.json({ guest: presentGuest({ ...who.guest, name: named }) })
  }

  await context.env.DB.prepare('update users set name = ? where id = ?')
    .bind(name || null, who.user.id)
    .run()

  return context.json({ user: presentUser({ ...who.user, name: name || null }) })
})

app.get('/v1/usage', async (context) => {
  const user = context.get('user')
  return context.json({ used: await usedBytes(context.env, user.id), limit: QUOTA })
})

// The glasses' question flow, and the account's OpenAI key: written here, read by
// nothing. Registered ahead of `/v1` so `/v1/ask` is not read as a note id. See
// ask/index.ts.
app.route('/v1/ask', ask)

app.route('/v1/blobs', blobs)
// The files somebody else shared on their own, which belong to no space this
// account can reach: its own route rather than a corner of the space listing,
// because that is exactly what they are not part of. See spaces/share.ts.
app.route('/v1/shared', sharedWithMe)
app.route('/v1/spaces', spaces)
app.route('/v1/trash', trash)
app.route('/v1/settings', settings)
app.route('/v1/mcp', mcpAdmin)
app.route('/v1', notes)

app.get('/health', (context) => context.json({ ok: true }))

/** The Even Realities plugin, which is the same web app with a bridge to a pair
 *  of glasses in it. The build writes it as `even.html` beside `index.html`, and
 *  the assets router's not-found handling would answer `/even/` with the
 *  editor's own page, so the path is named here and asked for by file name.
 *  Registered ahead of the catch-all for that reason. See docs/even.md. */
app.get('/even', (context) => servePlugin(context.env, context.req.url))
app.get('/even/', (context) => servePlugin(context.env, context.req.url))

function servePlugin(env: Env, from: string): Promise<Response> | Response {
  if (!env.ASSETS) return new Response('Not found', { status: 404 })

  const url = new URL(from)
  url.pathname = '/even.html'
  return env.ASSETS.fetch(new Request(url, { headers: { accept: 'text/html' } }))
}

/** Anything that is not the API is either a published space, looked up by
 *  hostname, or the app itself. */
app.all('*', async (context) => {
  const url = new URL(context.req.url)
  const space = await spaceForHost(context.env, url.host)

  if (space) return serveBlog(context.env, space, url)

  // A name on the shared domain that nobody publishes under has nothing to
  // show, and the editor does not live there either. Temporary, because the
  // name may be taken tomorrow. Read through the same normalising as above, so
  // one spelling of a host cannot be a blog and another the app.
  if (hostnameOf(url.host).endsWith(`.${context.env.BLOG_ROOT}`)) {
    return context.redirect(context.env.APP_ORIGIN, 302)
  }

  // The web build of the editor. It stores notes in the browser until someone
  // signs in, so it is served to anyone who asks.
  const assets = context.env.ASSETS
  if (assets) return assets.fetch(context.req.raw)

  return context.text('Not found', 404)
})

/** The daily job: everything that has run out of time.
 *
 *  What has waited its 14 days in Recently deleted goes, and so does everything
 *  else here that nothing else would ever take away - a guest nobody let in, a
 *  request nobody answered, a client that registered and never came back - and
 *  the proof on every domain of somebody's own is read again. Each is its own
 *  statement in its own module and none of them can fail another, which is why
 *  they are five calls rather than one. */
function scheduled(_event: ScheduledEvent, env: Env, context: ExecutionContext) {
  const at = Date.now()

  context.waitUntil(purgeExpired(env, at))
  context.waitUntil(expireGuests(env, at))
  context.waitUntil(expireRequests(env, at))
  context.waitUntil(expireClients(env, at))
  context.waitUntil(recheckDomains(env, at))
}

export default { fetch: app.fetch, scheduled }

// Named at the top level because a Durable Object class is looked up on the
// module, not through a binding.
export { NoteRoom } from './rooms/room'
