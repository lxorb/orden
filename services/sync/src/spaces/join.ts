import { Hono, type Context } from 'hono'
import { SPACE_IS_FULL } from '../refused'
import { accountFor, claimWhatWasGuested, openSession, presentUser, requireWhoever } from '../auth'
import { objectBody, readBody } from '../body'
import { cleanPersonName, isEmail, NAME_LIMIT, normaliseEmail, now, sha256 } from '../crypto'
import { forgetMailed, mailer, mayMail, requestMessage } from '../email'
import { forgetEmptyGuest, newGuest, presentGuest } from '../guests'
import { machineOf, mayTellTheOwner } from '../limits'
import { asksForSecond, halfWay } from '../second'
import type { Env, Guest, Space, User, Variables } from '../types'
import { EMAIL_LIMIT, itemName, MOST_MEMBERS, personName, presentItem } from './share'
import { onceShared, presentSpace, type Given } from './space'

const EXPIRED = 'that link has expired'

const NO_LONGER_WAITING = 'that request has run out'

async function askingAgain(context: Reply): Promise<boolean> {
  return (await objectBody(context))?.again === true
}

type Mode = 'open' | 'approval'

const DEVICE_LIMIT = 24

const GUESTS_A_MINUTE = 20
const MOST_GUESTS = 200

const MOST_WAITING = MOST_MEMBERS

interface About {
  item: string
  path: string | null
}

type Leads =
  | ({ kind: 'link'; space: Space; role: Given; mode: Mode } & About)
  | ({ kind: 'invite'; space: Space; role: Given; email: string; hash: string } & About)

type Reply = Context<{ Bindings: Env; Variables: Variables }>

async function tokenLeadsTo(env: Env, token: string): Promise<Leads | null> {
  if (!token || token.length > 128) return null

  const link = await env.DB.prepare(
    `select l.role, l.mode, l.item, n.path as item_path, sp.* from space_links l
       join spaces sp on sp.id = l.space_id
       left join notes n on n.id = l.item and n.deleted = 0
      where l.token = ? and sp.deleted = 0 and (l.item = '' or n.id is not null)`,
  )
    .bind(token)
    .first<Space & { role: Given; mode: Mode; item: string; item_path: string | null }>()

  if (link) {
    return {
      kind: 'link',
      space: link,
      role: link.role,
      mode: link.mode,
      item: link.item,
      path: link.item_path,
    }
  }

  const hash = await sha256(token)
  const invite = await env.DB.prepare(
    `select m.email, m.role, m.expires_at, m.item, n.path as item_path, sp.* from space_members m
       join spaces sp on sp.id = m.space_id
       left join notes n on n.id = m.item and n.deleted = 0
      where m.invite_hash = ? and sp.deleted = 0 and (m.item = '' or n.id is not null)`,
  )
    .bind(hash)
    .first<
      Space & {
        email: string
        role: Given
        expires_at: number | null
        item: string
        item_path: string | null
      }
    >()

  if (!invite) return null
  if (invite.expires_at !== null && invite.expires_at < now()) return null

  return {
    kind: 'invite',
    space: invite,
    role: invite.role,
    email: invite.email,
    hash,
    item: invite.item,
    path: invite.item_path,
  }
}

function landedOn(env: Env, found: Leads, role: Given | 'owner', owner: OwnerRow | null) {
  if (!found.item || found.path === null) {
    return { space: presentSpace(found.space, env, role, true) }
  }

  return {
    item: presentItem({
      id: found.item,
      path: found.path,
      updatedAt: now(),
      role: role === 'owner' ? found.role : role,
      space: { id: found.space.id, name: found.space.name },
      owner: owner ?? { name: null, email: '' },
    }),
  }
}

interface OwnerRow {
  name: string | null
  email: string
}

function ownerOf(env: Env, space: Space) {
  return env.DB.prepare('select name, email from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null; email: string }>()
}

function spendInvitation(env: Env, hash: string): Promise<unknown> {
  return env.DB.prepare(
    'update space_members set invite_hash = null, expires_at = null where invite_hash = ?',
  )
    .bind(hash)
    .run()
}

async function memberNow(
  env: Env,
  found: Leads,
  email: string,
  role: Given,
): Promise<Given | null> {
  const { space, item } = found

  const roleOf = () =>
    env.DB.prepare('select role from space_members where space_id = ? and email = ? and item = ?')
      .bind(space.id, email, item)
      .first<{ role: Given }>()

  const counted = await env.DB.prepare(
    'select count(*) as held from space_members where space_id = ? and item = ?',
  )
    .bind(space.id, item)
    .first<{ held: number }>()

  if ((counted?.held ?? 0) >= MOST_MEMBERS) return (await roleOf())?.role ?? null

  await env.DB.prepare(
    `insert into space_members (space_id, email, item, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?5)
     on conflict(space_id, email, item)
       do update set joined_at = coalesce(space_members.joined_at, ?5)`,
  )
    .bind(space.id, email, item, role, now())
    .run()
  await onceShared(env, space.id, item)

  return (await roleOf())?.role ?? role
}

function spaceIsFull(context: Reply) {
  return context.json({ error: SPACE_IS_FULL }, 409)
}

async function roomForAGuest(env: Env, spaceId: string, item: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select sum(case when joined_at is not null then 1 else 0 end) as held,
            sum(case when created_at > ?2 then 1 else 0 end) as lately
       from guest_members where space_id = ?1 and item = ?3`,
  )
    .bind(spaceId, now() - 60_000, item)
    .first<{ held: number | null; lately: number | null }>()

  return (held?.held ?? 0) < MOST_GUESTS && (held?.lately ?? 0) < GUESTS_A_MINUTE
}

async function roomToWait(env: Env, spaceId: string, item: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select (select count(*) from space_requests where space_id = ?1 and item = ?2)
          + (select count(*) from guest_members
              where space_id = ?1 and item = ?2
                and joined_at is null and declined_at is null) as waiting`,
  )
    .bind(spaceId, item)
    .first<{ waiting: number }>()

  return (held?.waiting ?? 0) < MOST_WAITING
}

function tooManyWaiting(context: Reply) {
  return context.json({ error: 'that many people are already waiting to be let in' }, 429)
}

function guestStanding(env: Env, spaceId: string, guestId: string, item: string) {
  return env.DB.prepare(
    `select role, joined_at, declined_at from guest_members
      where space_id = ? and guest_id = ? and item = ?`,
  )
    .bind(spaceId, guestId, item)
    .first<{ role: Given; joined_at: number | null; declined_at: number | null }>()
}

async function writeGuestMember(
  env: Env,
  spaceId: string,
  guestId: string,
  role: Given,
  waiting: boolean,
  item: string,
): Promise<void> {
  await env.DB.prepare(
    `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(space_id, guest_id, item) do nothing`,
  )
    .bind(spaceId, guestId, item, role, waiting ? null : now(), now())
    .run()
  if (!waiting) await onceShared(env, spaceId, item)
}

async function tellTheOwner(context: Reply, found: Leads, who: string): Promise<void> {
  const env = context.env
  const space = found.space
  const owner = await ownerOf(env, space)
  if (!owner) return

  if (!(await mayTellTheOwner(env, space.id))) return
  if (!(await mayMail(env, owner.email, machineOf(context.req))).ok) return

  const named = found.path === null ? space.name : itemName(found.path)
  const message = requestMessage({ space: named, who, link: env.APP_ORIGIN })

  if (!(await mailer(env).send(owner.email, message.subject, message))) {
    await forgetMailed(env, owner.email)
  }
}

export const join = new Hono<{ Bindings: Env; Variables: Variables }>()

join.get('/:token', async (context) => {
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: EXPIRED }, 404)

  const owner = await ownerOf(context.env, found.space)

  return context.json({
    kind: found.kind,
    space: found.space.name,
    note: found.path === null ? null : itemName(found.path),
    role: found.role,
    email: found.kind === 'invite' ? found.email : null,
    asks: found.kind === 'link' && found.mode === 'approval',
    from: owner ? personName(owner) : null,
  })
})

join.post('/:token', async (context) => {
  const who = await requireWhoever(context.env, context.req.header('authorization'))
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: EXPIRED }, 404)

  if (found.kind === 'invite' && !who) return await redeemInvitation(context, found)

  if (found.kind === 'invite' && who?.kind === 'guest') {
    if (who.guest.email !== found.email) {
      return context.json({ error: 'that invitation was sent to another address' }, 403)
    }

    return await redeemInvitation(context, found)
  }

  if (who?.kind === 'user') return await asAnAccount(context, found, who.user)
  if (who?.kind === 'guest') return await asAGuest(context, found, who.guest)

  if (await askingAgain(context)) return context.json({ error: NO_LONGER_WAITING }, 410)
  return await asNobody(context, found)
})

join.delete('/:token', async (context) => {
  const who = await requireWhoever(context.env, context.req.header('authorization'))
  if (!who) return context.json({ error: 'sign in first' }, 401)

  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: EXPIRED }, 404)
  const { space, item } = found

  if (who.kind === 'user') {
    await context.env.DB.prepare(
      'delete from space_requests where space_id = ? and email = ? and item = ?',
    )
      .bind(space.id, who.user.email, item)
      .run()
  } else {
    await context.env.DB.prepare(
      `delete from guest_members
        where space_id = ? and guest_id = ? and item = ?
          and joined_at is null and declined_at is null`,
    )
      .bind(space.id, who.guest.id, item)
      .run()
    await forgetEmptyGuest(context.env, who.guest.id)
  }

  return context.json({ ok: true })
})

async function redeemInvitation(context: Reply, found: Leads) {
  if (found.kind !== 'invite') return context.json({ error: EXPIRED }, 404)

  const user = await accountFor(context.env, found.email, context.req.header('accept-language'))

  await claimWhatWasGuested(context.env, user, null)

  if (await asksForSecond(context.env, user.id)) {
    return context.json({ second: true, holding: await halfWay(context.env, user) })
  }

  const role = await memberNow(context.env, found, user.email, found.role)
  if (!role) return spaceIsFull(context)
  await spendInvitation(context.env, found.hash)

  return context.json({
    token: await openSession(context.env, user.id),
    user: presentUser(user),
    ...landedOn(context.env, found, role, await ownerOf(context.env, found.space)),
  })
}

async function asAnAccount(context: Reply, found: Leads, user: User) {
  const { space, item } = found
  const owner = () => ownerOf(context.env, space)

  if (space.user_id === user.id) {
    return context.json(
      landedOn(context.env, found, 'owner', { name: user.name, email: user.email }),
    )
  }

  if (found.kind === 'invite') {
    if (found.email !== user.email) {
      return context.json({ error: 'that invitation was sent to another address' }, 403)
    }

    const role = await memberNow(context.env, found, user.email, found.role)
    if (!role) return spaceIsFull(context)

    await spendInvitation(context.env, found.hash)
    return context.json(landedOn(context.env, found, role, await owner()))
  }

  if (found.mode === 'approval') {
    const already = await context.env.DB.prepare(
      'select role from space_members where space_id = ? and email = ? and item = ?',
    )
      .bind(space.id, user.email, item)
      .first<{ role: Given }>()

    if (already) {
      return context.json(landedOn(context.env, found, already.role, await owner()))
    }

    if (await askingAgain(context)) {
      const waiting = await context.env.DB.prepare(
        'select 1 from space_requests where space_id = ? and email = ? and item = ?',
      )
        .bind(space.id, user.email, item)
        .first()
      if (!waiting) return context.json({ error: NO_LONGER_WAITING }, 410)
    }

    if (!(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

    await context.env.DB.prepare(
      `insert into space_requests (space_id, email, item, role, created_at)
       values (?1, ?2, ?3, ?4, ?5)
       on conflict(space_id, email, item) do nothing`,
    )
      .bind(space.id, user.email, item, found.role, now())
      .run()

    await tellTheOwner(context, found, personName(user))
    return context.json({ waiting: true })
  }

  const role = await memberNow(context.env, found, user.email, found.role)
  if (!role) return spaceIsFull(context)

  return context.json(landedOn(context.env, found, role, await owner()))
}

async function asAGuest(context: Reply, found: Leads, guest: Guest) {
  const { space, item } = found
  const standing = await guestStanding(context.env, space.id, guest.id, item)
  const said = presentGuest(guest)

  if (standing?.joined_at) {
    return context.json({
      guest: said,
      ...landedOn(context.env, found, standing.role, await ownerOf(context.env, space)),
    })
  }

  if (standing?.declined_at) return context.json({ guest: said, declined: true })
  if (standing) return context.json({ guest: said, waiting: true })
  if (await askingAgain(context)) return context.json({ error: NO_LONGER_WAITING }, 410)

  if (!(await roomForAGuest(context.env, space.id, item))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const asks = found.kind === 'link' && found.mode === 'approval'
  if (asks && !(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

  await writeGuestMember(context.env, space.id, guest.id, found.role, asks, item)

  if (asks) {
    await tellTheOwner(context, found, guest.name)
    return context.json({ guest: said, waiting: true })
  }

  return context.json({
    guest: said,
    ...landedOn(context.env, found, found.role, await ownerOf(context.env, space)),
  })
}

async function asNobody(context: Reply, found: Leads) {
  if (found.kind !== 'link') return context.json({ error: EXPIRED }, 404)
  const { space, item } = found

  if (!(await roomForAGuest(context.env, space.id, item))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const body = await readBody(context)
  const device = body.text('device', DEVICE_LIMIT)
  const said = body.text('name', NAME_LIMIT * 8)
  const address = body.text('email', EMAIL_LIMIT)

  if (found.mode === 'open') {
    const { guest, token } = await newGuest(context.env, device ?? null, null, null)
    await writeGuestMember(context.env, space.id, guest.id, found.role, false, item)

    return context.json({
      token,
      guest: presentGuest(guest),
      ...landedOn(context.env, found, found.role, await ownerOf(context.env, space)),
    })
  }

  if (body.problem) return context.json({ error: body.problem }, 400)

  const named = cleanPersonName(said ?? '').slice(0, NAME_LIMIT)
  const gave = normaliseEmail(address ?? '')
  if (!named && !isEmail(gave)) return context.json({ error: 'say who you are' }, 400)

  if (!(await roomToWait(context.env, space.id, item))) return tooManyWaiting(context)

  const { guest, token } = await newGuest(
    context.env,
    device ?? null,
    named || gave,
    isEmail(gave) ? gave : null,
  )
  await writeGuestMember(context.env, space.id, guest.id, found.role, true, item)
  await tellTheOwner(context, found, guest.name)

  return context.json({ token, guest: presentGuest(guest), waiting: true })
}
