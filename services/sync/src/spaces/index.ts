import { Hono } from 'hono'
import { readBody } from '../body'
import { chunks } from '../bound'
import { now } from '../crypto'
import { releaseDomain } from '../hostnames'
import { spaceEnded } from '../rooms'
import { facesIn } from '../people/seen'
import type { Env, Space, Variables, Whoever } from '../types'
import { spaceArranged } from './arranged'
import { bookmarks } from './bookmarks'
import { spaceExcluded } from './excluded'
import { spaceArchived } from './archived'
import { spaceFiles } from './files'
import { spaceGraph } from './graph'
import { spaceSort } from './sort'
import { folderIcons, isIcon, isTint } from './icons'
import { answers } from './answers'
import { site } from './site'
import { publish } from './publish'
import { share } from './share'
import {
  addSpace,
  atLeast,
  itemsSharedIn,
  notesAmong,
  onceSharedAmong,
  presentSpace,
  refusal,
  sharedAmong,
  spaceOf,
  type Role,
  withoutSetup,
} from './space'

const SPACE_NAME_LIMIT = 80

function spaceName(given: string): string {
  return given.replace(/\p{Cc}/gu, '').replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, '')
}
const ID_LIMIT = 64
const MOST_IN_ORDER = 500

export const spaces = new Hono<{ Bindings: Env; Variables: Variables }>()

const REACHABLE = `select sp.*,
    case when sp.user_id = ?1 then 'owner' else m.role end as role
  from spaces sp
  left join space_members m on m.space_id = sp.id and m.email = ?2 and m.item = ''
 where sp.deleted = ?3 and (sp.user_id = ?1 or m.role is not null)
 order by case when sp.user_id = ?1 then 0 else 1 end, sp.position, sp.created_at
 limit ?4`

const GUEST_REACHABLE = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?1 and g.item = ''
 where sp.deleted = ?2 and g.joined_at is not null
 order by sp.position, sp.created_at
 limit ?3`

function reachable(env: Env, who: Whoever, deleted: 0 | 1) {
  if (who.kind === 'guest') {
    return env.DB.prepare(GUEST_REACHABLE)
      .bind(who.guest.id, deleted, MOST_IN_ORDER)
      .all<Space & { role: Role }>()
  }

  return env.DB.prepare(REACHABLE)
    .bind(who.user.id, who.user.email, deleted, MOST_IN_ORDER)
    .all<Space & { role: Role }>()
}

spaces.get('/', async (context) => {
  const who = context.get('who')
  const mine = who.kind === 'user' ? who.user.id : null
  const { results } = await reachable(context.env, who, 0)

  const own = results.filter((one) => one.user_id === mine).map((one) => one.id)
  const shared = await sharedAmong(context.env, own)

  const items = await itemsSharedIn(context.env, own)

  const once = await onceSharedAmong(context.env, own)

  const together = results
    .filter((one) => one.user_id !== mine || shared.has(one.id))
    .map((one) => one.id)
  const faces = mine ? await facesIn(context.env, mine, together) : new Map<string, string[]>()

  const gone = await reachable(context.env, who, 1)

  const held = await notesAmong(
    context.env,
    results.map((one) => one.id),
  )

  const asking = context.get('who').program === true

  return context.json({
    spaces: results.map((one) => {
      const view = {
        ...presentSpace(
          one,
          context.env,
          one.role,
          shared.has(one.id),
          held.get(one.id) ?? 0,
          items.get(one.id) ?? [],
        ),
        people: faces.get(one.id) ?? [],
        onceShared: once.spaces.has(one.id),
        onceSharedItems: once.items.get(one.id) ?? [],
      }

      return asking ? withoutSetup(view) : view
    }),
    deleted: gone.results.map((one) => one.id),
  })
})

spaces.post('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const name = body.text('name', SPACE_NAME_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const label = spaceName(name ?? '')
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  const space = await addSpace(context.env, user.id, label)

  return context.json({ space: presentSpace(space, context.env) }, 201)
})

spaces.put('/order', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const order = body.texts('order', MOST_IN_ORDER, ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!order) return context.json({ error: 'send an order' }, 400)

  const { results } = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 0 limit ?',
  )
    .bind(user.id, MOST_IN_ORDER)
    .all<{ id: string }>()

  const owned = new Set(results.map((row) => row.id))
  const listed = order.filter((id) => owned.has(id))
  const rest = results.map((row) => row.id).filter((id) => !listed.includes(id))

  const ids = [...listed, ...rest]
  const statements = chunks(ids.map((id, index) => ({ id, index }))).map((chunk) => {
    const cases = chunk.map((one) => `when ? then ${one.index}`).join(' ')
    return context.env.DB.prepare(
      `update spaces set position = case id ${cases} else position end where user_id = ?`,
    ).bind(...chunk.map((one) => one.id), user.id)
  })

  if (statements.length) await context.env.DB.batch(statements)

  return context.json({ ok: true })
})

spaces.patch('/:id', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const name = body.text('name', SPACE_NAME_LIMIT)
  const chosen = body.nullableText('icon', ID_LIMIT)
  const painted = body.nullableText('tint', ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (name !== undefined && space.role !== 'owner') {
    return context.json({ error: refusal('owner') }, 403)
  }

  const label = name === undefined ? space.name : spaceName(name)
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  const icon =
    chosen === undefined
      ? space.icon
      : chosen === null
        ? null
        : isIcon(chosen)
          ? chosen
          : space.icon

  const tint =
    icon === null
      ? null
      : painted === undefined
        ? space.tint
        : painted === null
          ? null
          : isTint(painted)
            ? painted
            : space.tint

  await context.env.DB.prepare(
    'update spaces set name = ?, icon = ?, tint = ?, updated_at = ? where id = ?',
  )
    .bind(label, icon, tint, now(), space.id)
    .run()

  return context.json({
    space: presentSpace({ ...space, name: label, icon, tint }, context.env, space.role),
  })
})

spaces.delete('/:id', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const at = now()
  await context.env.DB.prepare(
    `update spaces
        set deleted = 1, deleted_at = ?, blog_enabled = 0, blog_subdomain = null, blog_domain = null,
            blog_domain_token = null, blog_domain_verified_at = null,
            blog_note = null, updated_at = ?
      where id = ?`,
  )
    .bind(at, at, space.id)
    .run()

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

  await spaceEnded(context.env, space.id)

  return context.json({ ok: true })
})

spaces.route('/', publish)
spaces.route('/', site)
spaces.route('/', answers)
spaces.route('/', bookmarks)
spaces.route('/', folderIcons)
spaces.route('/', spaceArranged)
spaces.route('/', spaceGraph)
spaces.route('/', spaceSort)
spaces.route('/', spaceExcluded)
spaces.route('/', spaceArchived)
spaces.route('/', spaceFiles)
spaces.route('/', share)
