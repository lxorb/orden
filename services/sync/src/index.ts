import './wiring'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import {
  SIGN_IN,
  SIGN_IN_TO_DO_THAT,
  account,
  left,
  accountById,
  auth,
  presentUser,
  requireWhoever,
  sessions,
  readBody,
  blobs,
  publicBlobs,
  hostnameOf,
  spaceForHost,
  blogRootOf,
  isAppHost,
  isOwnOrigin,
  passHost,
  serveApp,
  servePage,
  servePass,
  switchChannel,
  cleanPersonName,
  NAME_LIMIT,
  failed,
  programMayReach,
  people,
  ownProfile,
  presentOwnProfile,
  push,
  sendDue,
  fillFronts,
  sweepLeftovers,
  finishErasing,
  forgetHalfDone,
  resealBorrowed,
  second,
  sweepAnswers,
  sweepVersions,
  expireGuests,
  guestMayReach,
  presentGuest,
  renameGuest,
  notes,
  rooms,
  devices,
  hubDoor,
  siteIcons,
  settings,
  protectedRoutes,
  v2Docs,
  v2Spaces,
  sweepMisnamed,
  v2Blobs,
  v2Files,
  v2Maps,
  sweepTreeOps,
  spaces,
  join,
  crashes,
  sweepCrashes,
  usage,
  feedback,
  openWaitingIssues,
  recheckDomains,
  expireRequests,
  sharedWithMe,
  themes,
  time,
  inbox,
  pad,
  purgeExpired,
  trash,
  QUOTA,
  usedBytes,
  steadyEnv,
  SAID,
  type Env,
  type Variables,
  type Whoever,
} from './sync-server/src/api'
import { cors } from 'hono/cors'
import {
  ask,
  bearer,
  mcp,
  mcpAdmin,
  aiVault,
  onlineAdmin,
  sweepAudit,
  machineBundle,
  onlineDoor,
  appCatalogues,
  appsDoor,
  appIce,
  isMachineHost,
  machineDomain,
  online,
  syncAdmin,
} from './sync-server-machines/src/api'
import { serveBlog } from './sync-server-blog/src/api'
import {
  chatDoor,
  chats,
  sweepChats,
  oauth,
  oauthMetadata,
  expireClients,
} from './sync-server-chats/src/api'
import { openLink, pass, sweepPassLinks, servePassLink } from './sync-server-pass/src/api'
const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.onError(failed)

const appOrigins = cors({
  origin: (origin, context: Context<{ Bindings: Env }>) =>
    /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/.test(
      origin,
    ) || isOwnOrigin(context.env, origin)
      ? origin
      : '',
  allowHeaders: ['authorization', 'content-type', ...SAID(['device', 'diagram'])],
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

app.route('/v1/account/left', left)

app.route('/v1/feedback', feedback)

app.route('/v1/crashes', crashes)
app.route('/v1/usage', usage)
app.route('/v1/pass-link', openLink)

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
app.route('/v2/pass', pass)

app.route('/v2/spaces', v2Spaces)
app.route('/v2/spaces', v2Maps)
app.route('/v2/docs', v2Docs)
app.route('/v2/files', v2Files)
app.route('/v2/blobs', v2Blobs)
app.route('/v2/admin', syncAdmin)

app.route('/v2/push', push)

app.route('/v2/time', time)

app.route('/v2/inbox', inbox)

app.route('/v2/pad', pad)

app.route('/v2/chats', chats)

app.route('/v2', people)

app.route('/v2/online/admin', onlineAdmin)
app.route('/v2/online', online)

app.get('/health', (context) => context.json({ ok: true }))

app.get('/pass-link/:id', async (context, next) => {
  if (isAppHost(context.env, context.req.url)) {
    return await servePassLink(context.env, context.req.raw)
  }
  await next()
  return undefined
})

app.get('/even', (context) => servePlugin(context.env, context.req.raw))
app.get('/even/', (context) => servePlugin(context.env, context.req.raw))

function servePlugin(env: Env, request: Request): Promise<Response> | Response {
  if (!env.ASSETS) return new Response('Not found', { status: 404 })
  return servePage(env.ASSETS, request, '/even.html')
}

app.all('*', async (context) => {
  const url = new URL(context.req.url)

  if (hostnameOf(url.host) === passHost(context.env)) {
    const switched = switchChannel(context.req.raw)
    if (switched) return switched
    const assets = context.env.ASSETS
    if (assets) return unframed(await servePass(assets, context.req.raw))
    return context.text('Not found', 404)
  }

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

function scheduled(event: ScheduledEvent, given: Env, context: ExecutionContext) {
  const env = steadyEnv(given)
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
  context.waitUntil(sweepPassLinks(env, at))
  context.waitUntil(sweepTreeOps(env, at))
  context.waitUntil(sweepAnswers(env, at))
  context.waitUntil(sweepChats(env, at))
  context.waitUntil(sweepAudit(env, at))
  context.waitUntil(sweepCrashes(env, at))
  context.waitUntil(forgetHalfDone(env, at))
  context.waitUntil(resealBorrowed(env))
  context.waitUntil(sweepLeftovers(env))
  context.waitUntil(finishErasing(env))
  context.waitUntil(sweepMisnamed(env))
  context.waitUntil(fillFronts(env, null))
}

function serve(request: Request, env: Env, context?: ExecutionContext) {
  if (isMachineHost(new URL(request.url).hostname, machineDomain(env))) return fetch(request)
  return app.fetch(request, steadyEnv(env), context)
}

export default { fetch: serve, scheduled }

export { NoteRoom } from './sync-server/src/api'
export { AccountHub } from './sync-server/src/api'
export { ChatLog } from './sync-server-chats/src/api'
export { AppRelay } from './sync-server-machines/src/api'
