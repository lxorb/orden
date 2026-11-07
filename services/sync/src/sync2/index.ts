import { keepRequestOf, opsRequestOf, pullRequestOf, pushRequestOf } from '@orden/sync-core'
import { indexRequestOf, searchRequestOf } from '@orden/scan/wire'
import { Hono } from 'hono'
import { laterOf, pokeSpace } from '../hub/poke'
import { mayChangeTree, mayKeepVersions, mayPushDocuments } from '../limits'
import { remindRelisted } from '../push/relisted'
import { NO_SUCH_NOTE, OUT_OF_SPACE, ROOM_AWAY, TOO_MANY_CHANGES } from '../refused'
import { atLeast, refusal, spaceOf } from '../spaces/space'
import type { Env, Variables } from '../types'
import { deviceIn } from '../versions'
import { deviceOf, whoseId } from './device'
import { keepDoc, pullDocs, pushDocs, snapshotPage } from './docs'
import { answer, requestBody } from './envelope'
import { feedPage } from './feed'
import { reproject } from './maps'
import { applyOps } from './ops'
import { preparedSpace, prepareSpace } from './prepare'
import { indexItems, searchPage } from './reading'
import { said } from '../said'

interface App {
  Bindings: Env
  Variables: Variables
}

const NOT_A_REQUEST = 'that is not a request this route reads'

function cursorIn(value: string | undefined): number {
  const asked = Math.floor(Number(value ?? 0))
  return Number.isFinite(asked) && asked > 0 ? asked : 0
}

export const v2Spaces = new Hono<App>()

v2Spaces.post('/:space/prepare', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const cursor = await prepareSpace(context.env, space.id, await deviceOf(context))
  return answer(context, { cursor })
})

v2Spaces.post('/:space/ops', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const request = opsRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  if (!(await mayChangeTree(context.env, whoseId(context.get('who'))))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }

  const device = await deviceOf(context)
  await preparedSpace(context.env, space, device)
  const who = context.get('who')
  const asker = who.kind === 'user' ? who.user.id : null
  const done = await applyOps(context.env, space, asker, device, request.ops)
  if (done.changed) {
    await reproject(context.env, space.id, done.tree)
    await pokeSpace(context.env, laterOf(context), space.id, done.cursor, device)
  }
  await remindRelisted(context.env, space.id, done.relisted).catch(() => undefined)

  return answer(context, { results: done.value, cursor: done.cursor })
})

v2Spaces.get('/:space/feed', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  await preparedSpace(context.env, space)
  const page = await feedPage(context.env, space.id, cursorIn(context.req.query('since')))
  return answer(context, { ...page, device: await deviceOf(context) })
})

v2Spaces.get('/:space/snapshot', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  await preparedSpace(context.env, space)
  const after = context.req.query('after') ?? ''
  return answer(context, await snapshotPage(context.env, space.id, after))
})

v2Spaces.post('/:space/index', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const request = indexRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  return answer(context, { items: await indexItems(context.env, space.id, request.ids) })
})

v2Spaces.post('/:space/search', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const request = searchRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  const page = await searchPage(context.env, space.id, request)
  return answer(context, { hits: page.hits, loose: page.loose, after: page.after })
})

export const v2Docs = new Hono<App>()

v2Docs.post('/pull', async (context) => {
  const request = pullRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  const docs = await pullDocs(context.env, context.get('who'), request.docs, request.part)
  if (!docs) return context.json({ error: ROOM_AWAY }, 503, { 'retry-after': '1' })
  return answer(context, { docs })
})

v2Docs.post('/push', async (context) => {
  const request = pushRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  const who = context.get('who')
  if (!(await mayPushDocuments(context.env, whoseId(who)))) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }

  const docs = await pushDocs(
    context.env,
    who,
    await deviceOf(context),
    deviceIn(said((name) => context.req.header(name), 'device')),
    request.docs,
  )
  return answer(context, { docs })
})

v2Docs.post('/keep', async (context) => {
  const request = keepRequestOf(await requestBody(context))
  if (!request) return context.json({ error: NOT_A_REQUEST }, 400)
  const who = context.get('who')
  if (
    !(await mayPushDocuments(context.env, whoseId(who))) ||
    !(await mayKeepVersions(context.env, whoseId(who)))
  ) {
    return context.json({ error: TOO_MANY_CHANGES }, 429)
  }

  const kept = await keepDoc(context.env, who, request)
  if (kept === 'gone') return context.json({ error: NO_SUCH_NOTE }, 404)
  if (kept === 'role') return context.json({ error: refusal('write') }, 403)
  if (kept === 'full') return context.json({ error: OUT_OF_SPACE }, 507)
  return answer(context, { ok: true })
})
