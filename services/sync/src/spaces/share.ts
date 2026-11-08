import { Hono, type MiddlewareHandler } from 'hono'
import { NOT_AN_EMAIL, NO_SUCH_NOTE, SPACE_IS_FULL } from '../refused'
import { readBody } from '../body'
import { isEmail, normaliseEmail, now, randomToken, sha256 } from '../crypto'
import { forgetMailed, inviteMessage, mailer, mayMail, refusedMail } from '../email'
import { forgetEmptyGuest } from '../guests'
import { machineOf } from '../limits'
import { avatarIn } from '../people/avatar'
import { roomsRevoked } from '../rooms'
import type { Env, Note, Space, User, Variables } from '../types'
import { atLeast, isGiven, MOST_ITEMS, onceShared, spaceOf, trustAgain, type Given } from './space'

const SAY_WHICH_ROLE = 'say whether they may write or read'

export const MOST_MEMBERS = 200

export function roomForMember(space: string, email: string, item: string, most: string): string {
  return `((select count(*) from space_members where space_id = ${space} and item = ${item}) < ${most}
          or exists (select 1 from space_members
                      where space_id = ${space} and email = ${email} and item = ${item}))`
}

export const EMAIL_LIMIT = 320
const ID_LIMIT = 64
const INVITE_TTL = 30 * 24 * 60 * 60 * 1000

const WAITED_FOR = 30 * 24 * 60 * 60 * 1000

export async function expireRequests(env: Env, at: number): Promise<number> {
  const gone = await env.DB.prepare('delete from space_requests where created_at < ?')
    .bind(at - WAITED_FOR)
    .run()

  return gone.meta.changes
}

type Mode = 'open' | 'approval'

function isMode(value: unknown): value is Mode {
  return value === 'open' || value === 'approval'
}

function givenRole(value: unknown): Given | null {
  return isGiven(value) ? value : null
}

export interface Scope {
  id: string
  path: string | null
}

const WHOLE_SPACE: Scope = { id: '', path: null }

async function scopeOf(
  env: Env,
  spaceId: string,
  asked: string | undefined,
): Promise<Scope | null> {
  const id = (asked ?? '').slice(0, ID_LIMIT)
  if (!id) return WHOLE_SPACE

  const note = await env.DB.prepare(
    'select id, path from notes where id = ? and space_id = ? and deleted = 0',
  )
    .bind(id, spaceId)
    .first<Pick<Note, 'id' | 'path'>>()

  return note ? { id: note.id, path: note.path } : null
}

async function itemsShared(env: Env, spaceId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `select item from space_members where space_id = ?1 and item <> ''
      union select item from space_links where space_id = ?1 and item <> ''
      union select item from guest_members where space_id = ?1 and item <> ''
      limit ?2`,
  )
    .bind(spaceId, MOST_ITEMS + 1)
    .all<{ item: string }>()

  return new Set(results.map((row) => row.item))
}

export async function roomForAnItem(env: Env, spaceId: string, item: string): Promise<boolean> {
  if (!item) return true

  const held = await itemsShared(env, spaceId)
  return held.has(item) || held.size < MOST_ITEMS
}

export const TOO_MANY_ITEMS = 'that is as many notes as one space shares on their own'

interface FaceColumns {
  user_id: string | null
  avatar: string | null
  accent: string | null
}

interface MemberRow extends FaceColumns {
  email: string
  role: Given
  joined_at: number | null
  name: string | null
}

interface RequestRow extends FaceColumns {
  email: string
  role: Given
  created_at: number
  name: string | null
}

const FACE = 'u.id as user_id, u.avatar, u.accent'

function faceOf(row: FaceColumns) {
  return { id: row.user_id, avatar: avatarIn(row.avatar), accent: row.accent }
}

interface LinkRow {
  space_id: string
  item: string
  token: string
  role: Given
  mode: Mode
  created_at: number
}

interface GuestRow {
  guest_id: string
  name: string
  email: string | null
  role: Given
  joined_at: number | null
  declined_at: number | null
  created_at: number
}

function joinUrl(env: Env, token: string): string {
  return `${env.APP_ORIGIN}/join/${token}`
}

export function personName(user: { name: string | null; email: string }): string {
  const chosen = user.name?.trim()
  if (chosen) return chosen

  return user.email.split('@')[0] ?? user.email
}

export function itemName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.(md|markdown|mdown|mkd)$/i, '')
}

async function accountAt(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare('select id from users where email = ?')
    .bind(email)
    .first<{ id: string }>()

  return row?.id ?? null
}

async function membersOf(env: Env, spaceId: string, item: string): Promise<MemberRow[]> {
  const { results } = await env.DB.prepare(
    `select m.email, m.role, m.joined_at, u.name, ${FACE}
       from space_members m
       left join users u on u.email = m.email
      where m.space_id = ? and m.item = ?
      order by m.created_at, m.email limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<MemberRow>()

  return results
}

async function requestsOf(env: Env, spaceId: string, item: string): Promise<RequestRow[]> {
  const { results } = await env.DB.prepare(
    `select r.email, r.role, r.created_at, u.name, ${FACE}
       from space_requests r
       left join users u on u.email = r.email
      where r.space_id = ? and r.item = ?
      order by r.created_at, r.email limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<RequestRow>()

  return results
}

async function guestsOf(env: Env, spaceId: string, item: string): Promise<GuestRow[]> {
  const { results } = await env.DB.prepare(
    `select g.id as guest_id, g.name, g.email, m.role, m.joined_at, m.declined_at, m.created_at
       from guest_members m join guests g on g.id = m.guest_id
      where m.space_id = ? and m.item = ? and m.declined_at is null
      order by m.created_at, g.id limit ?`,
  )
    .bind(spaceId, item, MOST_MEMBERS)
    .all<GuestRow>()

  return results
}

async function linkOf(env: Env, spaceId: string, item: string): Promise<LinkRow | null> {
  const row = await env.DB.prepare('select * from space_links where space_id = ? and item = ?')
    .bind(spaceId, item)
    .first<LinkRow>()

  return row ?? null
}

function presentMember(member: MemberRow) {
  return {
    ...faceOf(member),
    email: member.email,
    guest: null,
    name: member.name,
    role: member.role,
    pending: member.joined_at === null,
  }
}

function presentGuest(guest: GuestRow) {
  return {
    id: null,
    avatar: null,
    accent: null,
    email: guest.email,
    guest: guest.guest_id,
    name: guest.name,
    role: guest.role,
    pending: false,
  }
}

function presentLink(env: Env, link: LinkRow) {
  return { url: joinUrl(env, link.token), role: link.role, mode: link.mode }
}

async function sharing(env: Env, space: Space, owner: User, scope: Scope) {
  const [members, requests, guests, link, face] = await Promise.all([
    membersOf(env, space.id, scope.id),
    requestsOf(env, space.id, scope.id),
    guestsOf(env, space.id, scope.id),
    linkOf(env, space.id, scope.id),
    env.DB.prepare(`select ${FACE} from users u where u.id = ?`)
      .bind(owner.id)
      .first<FaceColumns>(),
  ])

  return {
    owner: {
      email: owner.email,
      name: owner.name,
      ...faceOf(face ?? { user_id: owner.id, avatar: null, accent: null }),
    },
    item: scope.path === null ? null : { id: scope.id, path: scope.path },
    members: [
      ...members.map(presentMember),
      ...guests.filter((one) => one.joined_at !== null).map(presentGuest),
    ],
    requests: [
      ...requests.map((one) => ({
        ...faceOf(one),
        email: one.email,
        guest: null,
        name: one.name,
        role: one.role,
        at: one.created_at,
      })),
      ...guests
        .filter((one) => one.joined_at === null)
        .map((one) => ({
          id: null,
          avatar: null,
          accent: null,
          email: one.email,
          guest: one.guest_id,
          name: one.name,
          role: one.role,
          at: one.created_at,
        })),
    ],
    link: link ? presentLink(env, link) : null,
  }
}

export const share = new Hono<{ Bindings: Env; Variables: Variables }>()

function about(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (context, next) => {
    const space = spaceOf(context)
    const scope = await scopeOf(context.env, space.id, context.req.query('item'))
    if (!scope) return context.json({ error: NO_SUCH_NOTE }, 404)

    context.set('scope', scope)
    await next()
  }
}

share.get('/:id/share', atLeast('owner'), about(), async (context) => {
  return context.json(
    await sharing(context.env, spaceOf(context), context.get('user'), context.get('scope')),
  )
})

share.post('/:id/share/invite', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const owner = context.get('user')

  const body = await readBody(context)
  const given = body.text('email', EMAIL_LIMIT)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const email = normaliseEmail(given ?? '')
  const role = givenRole(asked)

  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)
  if (email === owner.email) {
    return context.json(
      { error: scope.id ? 'this note is already yours' : 'this space is already yours' },
      409,
    )
  }

  const held = await membersOf(context.env, space.id, scope.id)
  if (held.length >= MOST_MEMBERS && !held.some((one) => one.email === email)) {
    return context.json({ error: SPACE_IS_FULL }, 409)
  }

  if (!(await roomForAnItem(context.env, space.id, scope.id))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }

  const may = await mayMail(context.env, email, machineOf(context.req))
  if (may.refusal) return refusedMail(context, may.refusal)

  const before = held.find((one) => one.email === email)?.role

  const token = randomToken()
  const invited = await context.env.DB.prepare(
    `insert into space_members (space_id, email, item, role, invite_hash, expires_at, created_at)
     select ?1, ?2, ?3, ?4, ?5, ?6, ?7
      where ${roomForMember('?1', '?2', '?3', '?8')}
     on conflict(space_id, email, item) do update set
       role = excluded.role,
       invite_hash = excluded.invite_hash,
       expires_at = excluded.expires_at`,
  )
    .bind(
      space.id,
      email,
      scope.id,
      role,
      await sha256(token),
      now() + INVITE_TTL,
      now(),
      MOST_MEMBERS,
    )
    .run()
  if (!invited.meta.changes) return context.json({ error: SPACE_IS_FULL }, 409)
  await onceShared(context.env, space.id, scope.id)

  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  if (before === 'write' && role === 'read') {
    await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'read', scope.id)
  }

  if (may.ok) {
    const message = inviteMessage({
      space: space.name,
      item: scope.path === null ? null : itemName(scope.path),
      from: personName(owner),
      role,
      link: joinUrl(context.env, token),
    })

    if (!(await mailer(context.env).send(email, message.subject, message))) {
      await forgetMailed(context.env, email)
    }
  }

  return context.json(await sharing(context.env, space, owner, scope))
})

share.patch('/:id/share/members/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)

  const email = normaliseEmail(context.req.param('email'))
  const held = await context.env.DB.prepare(
    'select role from space_members where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that address' }, 404)

  await context.env.DB.prepare(
    'update space_members set role = ? where space_id = ? and email = ? and item = ?',
  )
    .bind(role, space.id, email, scope.id)
    .run()

  if (held.role === 'write' && role === 'read') {
    await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'read', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/members/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare(
    'delete from space_members where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'none', scope.id)

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.post('/:id/share/trust', atLeast('owner'), async (context) => {
  await trustAgain(context.env, spaceOf(context).id)
  return context.json({ ok: true })
})

share.delete('/:id/share/me', atLeast('read'), async (context) => {
  const space = spaceOf(context)
  const who = context.get('who')
  if (space.role === 'owner') return context.json({ error: 'this space is yours' }, 409)

  if (who.kind === 'guest') {
    await context.env.DB.prepare(
      "delete from guest_members where space_id = ? and guest_id = ? and item = ''",
    )
      .bind(space.id, who.guest.id)
      .run()
    await forgetEmptyGuest(context.env, who.guest.id)
    await roomsRevoked(context.env, space.id, who.guest.id, 'none')

    return context.json({ ok: true })
  }

  await context.env.DB.prepare(
    "delete from space_members where space_id = ? and email = ? and item = ''",
  )
    .bind(space.id, who.user.email)
    .run()

  await roomsRevoked(context.env, space.id, who.user.id, 'none')

  return context.json({ ok: true })
})

share.put('/:id/share/link', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  const body = await readBody(context)
  const askedRole = body.text('role', 16)
  const askedMode = body.text('mode', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(askedRole)
  const mode = isMode(askedMode) ? askedMode : null
  if (!role) return context.json({ error: 'say whether the link may write or read' }, 400)
  if (!mode) return context.json({ error: 'say whether the link asks first' }, 400)

  if (!(await roomForAnItem(context.env, space.id, scope.id))) {
    return context.json({ error: TOO_MANY_ITEMS }, 409)
  }

  const held = await linkOf(context.env, space.id, scope.id)
  const token = held?.token ?? randomToken()

  await context.env.DB.prepare(
    `insert into space_links (space_id, item, token, role, mode, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict(space_id, item) do update set role = excluded.role, mode = excluded.mode`,
  )
    .bind(space.id, scope.id, token, role, mode, now())
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/link', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')

  const waiting = await context.env.DB.prepare(
    `select guest_id from guest_members
      where space_id = ? and item = ? and joined_at is null and declined_at is null`,
  )
    .bind(space.id, scope.id)
    .all<{ guest_id: string }>()

  await context.env.DB.batch([
    context.env.DB.prepare('delete from space_links where space_id = ? and item = ?').bind(
      space.id,
      scope.id,
    ),
    context.env.DB.prepare('delete from space_requests where space_id = ? and item = ?').bind(
      space.id,
      scope.id,
    ),
    context.env.DB.prepare(
      `delete from guest_members
        where space_id = ? and item = ? and joined_at is null and declined_at is null`,
    ).bind(space.id, scope.id),
  ])
  for (const { guest_id } of waiting.results) await forgetEmptyGuest(context.env, guest_id)

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.post('/:id/share/requests/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  const waiting = await context.env.DB.prepare(
    'select role from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody by that address' }, 404)

  const before = await context.env.DB.prepare(
    'select role from space_members where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .first<{ role: Given }>()

  const admitted = await context.env.DB.prepare(
    `insert into space_members (space_id, email, item, role, joined_at, created_at)
     select ?1, ?2, ?3, ?4, ?5, ?5
      where ${roomForMember('?1', '?2', '?3', '?6')}
     on conflict(space_id, email, item) do update set
       role = excluded.role,
       joined_at = coalesce(space_members.joined_at, excluded.joined_at)`,
  )
    .bind(space.id, email, scope.id, waiting.role, now(), MOST_MEMBERS)
    .run()
  if (!admitted.meta.changes) return context.json({ error: SPACE_IS_FULL }, 409)
  await onceShared(context.env, space.id, scope.id)

  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  if (before?.role === 'write' && waiting.role === 'read') {
    await roomsRevoked(context.env, space.id, await accountAt(context.env, email), 'read', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/requests/:email', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare(
    'delete from space_requests where space_id = ? and email = ? and item = ?',
  )
    .bind(space.id, email, scope.id)
    .run()

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

function guestIdOf(context: { req: { param: (name: string) => string | undefined } }): string {
  return (context.req.param('guest') ?? '').slice(0, ID_LIMIT)
}

share.post('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const waiting = await context.env.DB.prepare(
    `select role from guest_members
      where space_id = ? and guest_id = ? and item = ?
        and joined_at is null and declined_at is null`,
  )
    .bind(space.id, guest, scope.id)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody is waiting by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set joined_at = ? where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(now(), space.id, guest, scope.id)
    .run()
  await onceShared(context.env, space.id, scope.id)

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.patch('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: SAY_WHICH_ROLE }, 400)

  const held = await context.env.DB.prepare(
    'select role from guest_members where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(space.id, guest, scope.id)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set role = ? where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(role, space.id, guest, scope.id)
    .run()

  if (held.role === 'write' && role === 'read') {
    await roomsRevoked(context.env, space.id, guest, 'read', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

share.delete('/:id/share/guests/:guest', atLeast('owner'), about(), async (context) => {
  const space = spaceOf(context)
  const scope = context.get('scope')
  const guest = guestIdOf(context)

  const held = await context.env.DB.prepare(
    'select joined_at from guest_members where space_id = ? and guest_id = ? and item = ?',
  )
    .bind(space.id, guest, scope.id)
    .first<{ joined_at: number | null }>()

  if (held?.joined_at === null) {
    await context.env.DB.prepare(
      'update guest_members set declined_at = ? where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(now(), space.id, guest, scope.id)
      .run()
  } else {
    await context.env.DB.prepare(
      'delete from guest_members where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(space.id, guest, scope.id)
      .run()
    await forgetEmptyGuest(context.env, guest)
    await roomsRevoked(context.env, space.id, guest, 'none', scope.id)
  }

  return context.json(await sharing(context.env, space, context.get('user'), scope))
})

interface SharedRow {
  id: string
  path: string
  updated_at: number
  role: Given
  space_id: string
  space_name: string
  owner_name: string | null
  owner_email: string
}

const SHARED_WITH_ME = `select n.id, n.path, n.updated_at, m.role,
    sp.id as space_id, sp.name as space_name, u.name as owner_name, u.email as owner_email
  from space_members m
  join notes n on n.id = m.item and n.deleted = 0
  join spaces sp on sp.id = m.space_id and sp.deleted = 0
  join users u on u.id = sp.user_id
 where m.email = ?1 and m.item <> ''
 order by u.email, n.path limit ?2`

const GUEST_SHARED_WITH_ME = `select n.id, n.path, n.updated_at, g.role,
    sp.id as space_id, sp.name as space_name, u.name as owner_name, u.email as owner_email
  from guest_members g
  join notes n on n.id = g.item and n.deleted = 0
  join spaces sp on sp.id = g.space_id and sp.deleted = 0
  join users u on u.id = sp.user_id
 where g.guest_id = ?1 and g.item <> '' and g.joined_at is not null
 order by u.email, n.path limit ?2`

export function presentItem(item: {
  id: string
  path: string
  updatedAt: number
  role: Given
  space: { id: string; name: string }
  owner: { name: string | null; email: string }
}) {
  return {
    id: item.id,
    path: item.path,
    name: itemName(item.path),
    role: item.role,
    updatedAt: item.updatedAt,
    owner: { name: personName(item.owner) },
    space: { id: item.space.id, name: item.space.name },
  }
}

function presentShared(row: SharedRow) {
  return presentItem({
    id: row.id,
    path: row.path,
    updatedAt: row.updated_at,
    role: row.role,
    space: { id: row.space_id, name: row.space_name },
    owner: { name: row.owner_name, email: row.owner_email },
  })
}

export const sharedWithMe = new Hono<{ Bindings: Env; Variables: Variables }>()

sharedWithMe.get('/', async (context) => {
  const who = context.get('who')
  const { results } =
    who.kind === 'user'
      ? await context.env.DB.prepare(SHARED_WITH_ME)
          .bind(who.user.email, MOST_ITEMS)
          .all<SharedRow>()
      : await context.env.DB.prepare(GUEST_SHARED_WITH_ME)
          .bind(who.guest.id, MOST_ITEMS)
          .all<SharedRow>()

  return context.json({ shared: results.map(presentShared) })
})

sharedWithMe.delete('/:noteId', async (context) => {
  const who = context.get('who')
  const noteId = context.req.param('noteId').slice(0, ID_LIMIT)

  const note = await context.env.DB.prepare('select id, space_id from notes where id = ?')
    .bind(noteId)
    .first<Pick<Note, 'id' | 'space_id'>>()

  if (note && who.kind === 'guest') {
    await context.env.DB.prepare(
      'delete from guest_members where space_id = ? and guest_id = ? and item = ?',
    )
      .bind(note.space_id, who.guest.id, note.id)
      .run()
    await forgetEmptyGuest(context.env, who.guest.id)
    await roomsRevoked(context.env, note.space_id, who.guest.id, 'none', note.id)
  }

  if (note && who.kind === 'user') {
    await context.env.DB.prepare(
      'delete from space_members where space_id = ? and email = ? and item = ?',
    )
      .bind(note.space_id, who.user.email, note.id)
      .run()

    await roomsRevoked(context.env, note.space_id, who.user.id, 'none', note.id)
  }

  return context.json({ ok: true })
})
