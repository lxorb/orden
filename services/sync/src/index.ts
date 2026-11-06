import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { SIGN_IN, SIGN_IN_TO_DO_THAT } from './refused'
import { cors } from 'hono/cors'
import { account } from './account'
import { ask } from './ask'
import { accountById, auth, presentUser, requireWhoever, sessions } from './auth'
import { readBody } from './body'
import { blobs, publicBlobs } from './blobs'
import { hostnameOf, serveBlog, spaceForHost } from './blog'
import { blogRootOf, isOwnOrigin } from './hosts'
import { serveApp, servePage, switchChannel } from './channel'
import { cleanPersonName, NAME_LIMIT } from './crypto'
import { failed } from './failed'
import { bearer } from './mcp/tokens'
import { programMayReach } from './programs'
import { people, ownProfile } from './people/routes'
import { presentOwnProfile } from './people/profile'
import { push } from './push/targets'
import { sendDue } from './push/reminders'
import { fillFronts } from './blog/fill'
import { sweepLeftovers } from './leftovers'
import { forgetHalfDone, resealBorrowed, second } from './second'
import { sweepAnswers } from './spaces/answers'
import { sweepVersions } from './versions'
import { expireGuests, guestMayReach, presentGuest, renameGuest } from './guests'
import { mcp, mcpAdmin } from './mcp'
import { notes } from './notes'
import { chatDoor } from './chats/door'
import { chats } from './chats/routes'
import { sweepChats } from './chats/sweep'
import { oauth, oauthMetadata } from './oauth'
import { expireClients } from './oauth/clients'
import { rooms } from './rooms'
import { devices } from './hub/devices'
import { aiVault } from './ai/vault'
import { hubDoor } from './hub/door'
import { onlineAdmin } from './machines/admin'
import { sweepAudit } from './machines/audit'
import { machineBundle } from './machines/bundle'
import { onlineDoor } from './machines/door'
import { appCatalogues } from './apps/catalogue'
import { appsDoor } from './apps/door'
import { appIce } from './apps/ice'
import { isMachineHost, machineDomain } from './machines/hetzner-host'
import { online } from './machines/routes'
import { siteIcons } from './site-icons'
import { settings } from './settings'
import { protectedRoutes } from './protected'
import { v2Docs, v2Spaces } from './sync2'
import { syncAdmin } from './sync2/admin'
import { sweepMisnamed, v2Blobs, v2Files } from './sync2/files'
import { v2Maps } from './sync2/maps'
import { sweepTreeOps } from './sync2/tree'
import { spaces } from './spaces'
import { join } from './spaces/join'
import { crashes, sweepCrashes } from './crashes'
import { feedback } from './feedback'
import { openWaitingIssues } from './feedback-issues'
import { recheckDomains } from './spaces/proof'
import { expireRequests, sharedWithMe } from './spaces/share'
import { themes } from './themes'
import { purgeExpired, trash } from './trash'
import { QUOTA, usedBytes } from './storage'
import type { Env, Variables, Whoever } from './types'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.onError(failed)

const appOrigins = cors({
  origin: (origin, context: Context<{ Bindings: Env }>) =>
    /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(
      origin,
    ) || isOwnOrigin(context.env, origin)
      ? origin
      : '',
  allowHeaders: ['authorization', 'content-type', 'x-nib-device', 'x-nib-diagram'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
})
app.use('/v1/*', appOrigins)
app.use('/v2/*', appOrigins)

app.route('/v1/auth', auth)

app.route('/i', publicBlobs)

app.route('/themes', themes)

const anyOrigin = cors({
  origin: '*',
  allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id'],
  exposeHeaders: ['www-authenticate', 'mcp-protocol-version', 'mcp-session-id'],
})
app.use('/mcp', anyOrigin)
app.route('/mcp', mcp)

app.route('/rooms', rooms)

app.route('/v2/hub', hubDoor)

app.route('/v2/chats', chatDoor)

app.route('/v2/online', onlineDoor)
app.route('/v2/apps', appsDoor)
app.route('/v2/online/machine', machineBundle)

app.route('/v1/join', join)

app.route('/v1/feedback', feedback)

app.route('/v1/crashes', crashes)

app.use('/.well-known/*', anyOrigin)
app.route('/.well-known', oauthMetadata)
app.use('/oauth/*', anyOrigin)
app.route('/oauth', oauth)

const guard: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (context, next) => {
  const header = context.req.header('authorization')
  const who: Asking | null =
    (await requireWhoever(context.env, header)) ?? (await asProgram(context.env, header))
  if (!who) return context.json({ error: SIGN_IN }, 401)

  context.set('who', who)

  if (who.kind === 'guest') {
    const path = new URL(context.req.url).pathname
    if (!guestMayReach(context.req.method, path)) {
      return context.json({ error: SIGN_IN_TO_DO_THAT }, 403)
    }
    context.set('guest', who.guest)
  } else {
    if (who.program) {
      const path = new URL(context.req.url).pathname
      if (!programMayReach(context.req.method, path, who.readOnly === true)) {
        return context.json({ error: 'that is not something a token can do' }, 403)
      }
    }

    context.set('user', who.user)
  }

  await next()
}
app.use('/v1/*', guard)
app.use('/v2/*', guard)

type Asking = Whoever & { program?: true; readOnly?: boolean }

async function asProgram(env: Env, header: string | undefined): Promise<Asking | null> {
  const token = await bearer(env, header)
  if (!token) return null

  const user = await accountById(env, token.user_id)
  if (!user) return null

  return { kind: 'user', user, program: true, readOnly: !!token.read_only }
}

app.get('/v1/me', async (context) => {
  const who = context.get('who')
  if (who.kind === 'guest') return context.json({ guest: presentGuest(who.guest) })

  const flags = await context.env.DB.prepare('select sync_version from users where id = ?')
    .bind(who.user.id)
    .first<{ sync_version: number }>()
  const [profile, nicks] = await Promise.all([
    ownProfile(context.env, who.user.id),
    context.env.DB.prepare('select space_id, nick from space_nicks where user_id = ?')
      .bind(who.user.id)
      .all<{ space_id: string; nick: string }>(),
  ])
  return context.json({
    user: {
      ...presentUser(who.user),
      syncVersion: flags?.sync_version === 2 ? 2 : 1,
      ...(profile ? presentOwnProfile(profile, Date.now()) : {}),
      nicks: Object.fromEntries(nicks.results.map((row) => [row.space_id, row.nick])),
    },
  })
})

app.patch('/v1/me', async (context) => {
  const who = context.get('who')
  const body = await readBody(context)
  const given = body.text('name', NAME_LIMIT * 8)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const name = cleanPersonName(given ?? '')
  if (name.length > NAME_LIMIT) {
    return context.json({ error: `use at most ${NAME_LIMIT} characters` }, 400)
  }

  if (who.kind === 'guest') {
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

app.route('/v1/ask', ask)

app.route('/v1/blobs', blobs)
app.route('/v1/shared', sharedWithMe)
app.route('/v1/spaces', spaces)
app.route('/v1/trash', trash)
app.route('/v1/settings', settings)
app.route('/v1/protected', protectedRoutes)
app.route('/v2/site-icons', siteIcons)
app.route('/v1/mcp', mcpAdmin)
app.route('/v1/sessions', sessions)
app.route('/v1/second', second)
app.route('/v1/account', account)
app.route('/v1', notes)

app.route('/v2/devices', devices)
app.route('/v2/apps/catalogue', appCatalogues)
app.route('/v2/apps/ice', appIce)
app.route('/v2/ai', aiVault)

app.route('/v2/spaces', v2Spaces)
app.route('/v2/spaces', v2Maps)
app.route('/v2/docs', v2Docs)
app.route('/v2/files', v2Files)
app.route('/v2/blobs', v2Blobs)
app.route('/v2/admin', syncAdmin)

app.route('/v2/push', push)

app.route('/v2/chats', chats)

app.route('/v2', people)

app.route('/v2/online/admin', onlineAdmin)
app.route('/v2/online', online)

app.get('/health', (context) => context.json({ ok: true }))

app.get('/even', (context) => servePlugin(context.env, context.req.raw))
app.get('/even/', (context) => servePlugin(context.env, context.req.raw))

function servePlugin(env: Env, request: Request): Promise<Response> | Response {
  if (!env.ASSETS) return new Response('Not found', { status: 404 })
  return servePage(env.ASSETS, request, '/even.html')
}

app.all('*', async (context) => {
  const url = new URL(context.req.url)
  const space = await spaceForHost(context.env, url.host)

  if (space) return serveBlog(context.env, space, url, context.req.raw)

  const hostname = hostnameOf(url.host)
  const root = blogRootOf(context.env, hostname)
  if (root && hostname !== root) return context.redirect(context.env.APP_ORIGIN, 302)

  const switched = switchChannel(context.req.raw)
  if (switched) return switched

  const assets = context.env.ASSETS
  if (assets) return unframed(await serveApp(assets, context.req.raw))

  return context.text('Not found', 404)
})

function unframed(response: Response): Response {
  if (!response.headers.get('content-type')?.includes('text/html')) return response

  const headers = new Headers(response.headers)
  headers.set('content-security-policy', "frame-ancestors 'none'")
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const EVERY_MINUTE = '* * * * *'

function scheduled(event: ScheduledEvent, env: Env, context: ExecutionContext) {
  const at = Date.now()

  if (event.cron === EVERY_MINUTE) {
    context.waitUntil(sendDue(env, at))
    context.waitUntil(openWaitingIssues(env, at))
    return
  }

  context.waitUntil(purgeExpired(env, at))
  context.waitUntil(expireGuests(env, at))
  context.waitUntil(expireRequests(env, at))
  context.waitUntil(expireClients(env, at))
  context.waitUntil(recheckDomains(env, at))
  context.waitUntil(sweepVersions(env, at))
  context.waitUntil(sweepTreeOps(env, at))
  context.waitUntil(sweepAnswers(env, at))
  context.waitUntil(sweepChats(env, at))
  context.waitUntil(sweepAudit(env, at))
  context.waitUntil(sweepCrashes(env, at))
  context.waitUntil(forgetHalfDone(env, at))
  context.waitUntil(resealBorrowed(env))
  context.waitUntil(sweepLeftovers(env))
  context.waitUntil(sweepMisnamed(env))
  context.waitUntil(fillFronts(env, null))
}

function serve(request: Request, env: Env, context?: ExecutionContext) {
  if (isMachineHost(new URL(request.url).hostname, machineDomain(env))) return fetch(request)
  return app.fetch(request, env, context)
}

export default { fetch: serve, scheduled }

export { NoteRoom } from './rooms/room'
export { AccountHub } from './hub/hub'
export { ChatLog } from './chats/log'
export { AppRelay } from './apps/relay'
