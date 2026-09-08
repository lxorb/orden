/** Sharing a space: who else may reach it, the link that lets somebody ask, and
 *  the requests waiting on the owner.
 *
 *  Everything here is the owner's, which is what `owner` means. What the people
 *  it lets in may then do is decided somewhere else, by `atLeast` in front of
 *  every route that names a space; and how they got in is in `join.ts`.
 *
 *  Two kinds of person show up in the one sheet. A member is an address rather
 *  than an account, so somebody with no Nib account can be given a space today
 *  and find it waiting the first time they prove that address. A guest is
 *  whoever followed the space's own link, which names nobody and so has no
 *  address to write down: what the owner sees of them is the name their device
 *  gave them or the one they typed. Both hold one of the two given roles, and
 *  the sheet treats them the same because they are the same thing to it: a
 *  person in a space who is not its owner. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { isEmail, normaliseEmail, now, randomToken, sha256 } from '../crypto'
import { inviteMessage, mailer, mayMail } from '../email'
import { forgetEmptyGuest } from '../guests'
import type { Env, Space, User, Variables } from '../types'
import { atLeast, isGiven, spaceOf, type Given } from './space'

/** More people in one space than anyone shares with, and the bound on every
 *  listing below. */
const MOST = 200
export const EMAIL_LIMIT = 320
/** How long the link in an invitation stays a shortcut. After that the address
 *  still opens the space; only the link has stopped carrying it there. */
const INVITE_TTL = 30 * 24 * 60 * 60 * 1000

type Mode = 'open' | 'approval'

function isMode(value: unknown): value is Mode {
  return value === 'open' || value === 'approval'
}

/** A role somebody can be given: never `owner`, which is the space's own column. */
function givenRole(value: unknown): Given | null {
  return isGiven(value) ? value : null
}

interface MemberRow {
  email: string
  role: Given
  joined_at: number | null
  name: string | null
}

interface RequestRow {
  email: string
  role: Given
  created_at: number
  name: string | null
}

interface LinkRow {
  space_id: string
  token: string
  role: Given
  mode: Mode
  created_at: number
}

/** Somebody the space's own link let in. `joined_at` is whether they are in:
 *  null with no `declined_at` is a request the owner has not answered yet. */
interface GuestRow {
  guest_id: string
  name: string
  /** What they typed into a link that asks first, unverified. Shown to the owner
   *  because it is what the request said, and never treated as proved. */
  email: string | null
  role: Given
  joined_at: number | null
  declined_at: number | null
  created_at: number
}

/** Where a link takes somebody. The web app reads this path, and so does the
 *  desktop app when it is what opened it; see docs/collaboration.md. */
function joinUrl(env: Env, token: string): string {
  return `${env.APP_ORIGIN}/join/${token}`
}

/** What to call somebody in a sentence: the name on the account, else the part
 *  of the address in front of the at sign. Never the whole address, which is
 *  not a name and which the other person may not have been given. */
export function personName(user: { name: string | null; email: string }): string {
  const chosen = user.name?.trim()
  if (chosen) return chosen

  return user.email.split('@')[0] ?? user.email
}

async function membersOf(env: Env, spaceId: string): Promise<MemberRow[]> {
  const { results } = await env.DB.prepare(
    `select m.email, m.role, m.joined_at, u.name
       from space_members m
       left join users u on u.email = m.email
      where m.space_id = ?
      order by m.created_at, m.email limit ?`,
  )
    .bind(spaceId, MOST)
    .all<MemberRow>()

  return results
}

async function requestsOf(env: Env, spaceId: string): Promise<RequestRow[]> {
  const { results } = await env.DB.prepare(
    `select r.email, r.role, r.created_at, u.name
       from space_requests r
       left join users u on u.email = r.email
      where r.space_id = ?
      order by r.created_at, r.email limit ?`,
  )
    .bind(spaceId, MOST)
    .all<RequestRow>()

  return results
}

async function guestsOf(env: Env, spaceId: string): Promise<GuestRow[]> {
  const { results } = await env.DB.prepare(
    `select g.id as guest_id, g.name, g.email, m.role, m.joined_at, m.declined_at, m.created_at
       from guest_members m join guests g on g.id = m.guest_id
      where m.space_id = ? and m.declined_at is null
      order by m.created_at, g.id limit ?`,
  )
    .bind(spaceId, MOST)
    .all<GuestRow>()

  return results
}

async function linkOf(env: Env, spaceId: string): Promise<LinkRow | null> {
  const row = await env.DB.prepare('select * from space_links where space_id = ?')
    .bind(spaceId)
    .first<LinkRow>()

  return row ?? null
}

/** One row of the sheet's People list. Whichever kind of person it is, exactly
 *  one of `email` and `guest` says which and names them: a member is an address,
 *  a guest is an id, and the sheet keys its rows on whichever it got. */
function presentMember(member: MemberRow) {
  return {
    email: member.email,
    guest: null,
    name: member.name,
    role: member.role,
    // Nobody has opened it yet. Shown quietly beside the name rather than as a
    // second list: they are already in, they have simply not been in.
    pending: member.joined_at === null,
  }
}

function presentGuest(guest: GuestRow) {
  return {
    email: guest.email,
    guest: guest.guest_id,
    name: guest.name,
    role: guest.role,
    // A guest who is in has been in: the link they followed was the arriving.
    pending: false,
  }
}

function presentLink(env: Env, link: LinkRow) {
  return { url: joinUrl(env, link.token), role: link.role, mode: link.mode }
}

/** Everything the sheet draws, in one request.
 *
 *  Members and guests are one list, and so are the two ways of waiting: what the
 *  owner is being asked is the same question either way, and a sheet with two
 *  Waiting sections would be saying so twice. */
async function sharing(env: Env, space: Space, owner: User) {
  const [members, requests, guests, link] = await Promise.all([
    membersOf(env, space.id),
    requestsOf(env, space.id),
    guestsOf(env, space.id),
    linkOf(env, space.id),
  ])

  return {
    owner: { email: owner.email, name: owner.name },
    members: [
      ...members.map(presentMember),
      ...guests.filter((one) => one.joined_at !== null).map(presentGuest),
    ],
    requests: [
      ...requests.map((one) => ({
        email: one.email,
        guest: null,
        name: one.name,
        role: one.role,
        at: one.created_at,
      })),
      ...guests
        .filter((one) => one.joined_at === null)
        .map((one) => ({
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

share.get('/:id/share', atLeast('owner'), async (context) => {
  return context.json(await sharing(context.env, spaceOf(context), context.get('user')))
})

/** Somebody is given the space, and told so. The row is written first and the
 *  mail sent after: the membership is what lets them in, and a mail that could
 *  not go out is not a reason for the sharing not to have happened. */
share.post('/:id/share/invite', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const owner = context.get('user')

  const body = await readBody(context)
  const given = body.text('email', EMAIL_LIMIT)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const email = normaliseEmail(given ?? '')
  const role = givenRole(asked)

  if (!isEmail(email)) return context.json({ error: 'enter a valid email address' }, 400)
  if (!role) return context.json({ error: 'say whether they may write or read' }, 400)
  if (email === owner.email) return context.json({ error: 'this space is already yours' }, 409)

  const held = await membersOf(context.env, space.id)
  if (held.length >= MOST && !held.some((one) => one.email === email)) {
    return context.json({ error: 'that is as many people as one space holds' }, 409)
  }

  const token = randomToken()
  await context.env.DB.prepare(
    `insert into space_members (space_id, email, role, invite_hash, expires_at, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict(space_id, email) do update set
       role = excluded.role,
       invite_hash = excluded.invite_hash,
       expires_at = excluded.expires_at`,
  )
    .bind(space.id, email, role, await sha256(token), now() + INVITE_TTL, now())
    .run()

  // Asking to be let in and then being let in is one thing, not two.
  await context.env.DB.prepare('delete from space_requests where space_id = ? and email = ?')
    .bind(space.id, email)
    .run()

  // Whether the mail went is not answered back. The gate is per address across
  // every space there is, so saying so would tell an owner whether somebody
  // else had just written to that address.
  if (await mayMail(context.env, email)) {
    const message = inviteMessage({
      space: space.name,
      from: personName(owner),
      role,
      link: joinUrl(context.env, token),
    })
    await mailer(context.env).send(email, message.subject, message)
  }

  return context.json(await sharing(context.env, space, owner))
})

share.patch('/:id/share/members/:email', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: 'say whether they may write or read' }, 400)

  const email = normaliseEmail(context.req.param('email'))
  const held = await context.env.DB.prepare(
    'select role from space_members where space_id = ? and email = ?',
  )
    .bind(space.id, email)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that address' }, 404)

  await context.env.DB.prepare('update space_members set role = ? where space_id = ? and email = ?')
    .bind(role, space.id, email)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

share.delete('/:id/share/members/:email', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare('delete from space_members where space_id = ? and email = ?')
    .bind(space.id, email)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

/** Somebody letting themselves out. The one thing under this path that is not
 *  the owner's: being in a space is something a person can stop, and having to
 *  ask the owner to do it for them is not a way to leave. */
share.delete('/:id/share/me', atLeast('read'), async (context) => {
  const space = spaceOf(context)
  if (space.role === 'owner') return context.json({ error: 'this space is yours' }, 409)

  await context.env.DB.prepare('delete from space_members where space_id = ? and email = ?')
    .bind(space.id, context.get('user').email)
    .run()

  return context.json({ ok: true })
})

/** The link, made on the first ask and kept afterwards. Changing what it hands
 *  out changes it for the copy already in somebody's message, which is what an
 *  owner means by changing it; a link that should stop working is revoked. */
share.put('/:id/share/link', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const askedRole = body.text('role', 16)
  const askedMode = body.text('mode', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(askedRole)
  const mode = isMode(askedMode) ? askedMode : null
  if (!role) return context.json({ error: 'say whether the link may write or read' }, 400)
  if (!mode) return context.json({ error: 'say whether the link asks first' }, 400)

  const held = await linkOf(context.env, space.id)
  const token = held?.token ?? randomToken()

  await context.env.DB.prepare(
    `insert into space_links (space_id, token, role, mode, created_at)
     values (?1, ?2, ?3, ?4, ?5)
     on conflict(space_id) do update set role = excluded.role, mode = excluded.mode`,
  )
    .bind(space.id, token, role, mode, now())
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

share.delete('/:id/share/link', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await context.env.DB.prepare('delete from space_links where space_id = ?').bind(space.id).run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

share.post('/:id/share/requests/:email', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const email = normaliseEmail(context.req.param('email'))

  const waiting = await context.env.DB.prepare(
    'select role from space_requests where space_id = ? and email = ?',
  )
    .bind(space.id, email)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody by that address' }, 404)

  // Already proved the address to have asked at all, so they are in rather than
  // invited: joined_at is set now and no mail goes anywhere.
  await context.env.DB.prepare(
    `insert into space_members (space_id, email, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?4)
     on conflict(space_id, email) do update set role = excluded.role`,
  )
    .bind(space.id, email, waiting.role, now())
    .run()

  await context.env.DB.prepare('delete from space_requests where space_id = ? and email = ?')
    .bind(space.id, email)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

share.delete('/:id/share/requests/:email', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const email = normaliseEmail(context.req.param('email'))

  await context.env.DB.prepare('delete from space_requests where space_id = ? and email = ?')
    .bind(space.id, email)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

/* ── The guests the link let in ───────────────────────────────────────── */

/** A guest is one row rather than a membership and a request, so the three
 *  things the owner can do to one are three verbs on one path: let them in,
 *  change what they may do, and end it. Which of the two lists they were in when
 *  it happened is the row's own business.
 *
 *  Nothing here takes an address, because a guest has none to take. */

/** An id is a UUID; the length is all this needs to know. */
const ID_LIMIT = 64

function guestIdOf(context: { req: { param: (name: string) => string | undefined } }): string {
  return (context.req.param('guest') ?? '').slice(0, ID_LIMIT)
}

/** Letting a waiting guest in, at the role the link promised them. */
share.post('/:id/share/guests/:guest', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const guest = guestIdOf(context)

  const waiting = await context.env.DB.prepare(
    `select role from guest_members
      where space_id = ? and guest_id = ? and joined_at is null and declined_at is null`,
  )
    .bind(space.id, guest)
    .first<{ role: Given }>()

  if (!waiting) return context.json({ error: 'nobody is waiting by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set joined_at = ? where space_id = ? and guest_id = ?',
  )
    .bind(now(), space.id, guest)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

share.patch('/:id/share/guests/:guest', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const guest = guestIdOf(context)

  const body = await readBody(context)
  const asked = body.text('role', 16)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const role = givenRole(asked)
  if (!role) return context.json({ error: 'say whether they may write or read' }, 400)

  const held = await context.env.DB.prepare(
    'select role from guest_members where space_id = ? and guest_id = ?',
  )
    .bind(space.id, guest)
    .first<{ role: Given }>()

  if (!held) return context.json({ error: 'nobody by that name' }, 404)

  await context.env.DB.prepare(
    'update guest_members set role = ? where space_id = ? and guest_id = ?',
  )
    .bind(role, space.id, guest)
    .run()

  return context.json(await sharing(context.env, space, context.get('user')))
})

/** Declining somebody who is waiting, and taking out somebody who is in. One
 *  gesture, because to the owner it is one: this person is not in my space.
 *
 *  A guest who was waiting keeps their row, stamped, so the calm page they are
 *  waiting on can say they were told no rather than only stop saying anything. A
 *  guest who was in loses the row, which is what ends their access on the next
 *  pass - and loses the guest itself once nothing of theirs is left. */
share.delete('/:id/share/guests/:guest', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const guest = guestIdOf(context)

  const held = await context.env.DB.prepare(
    'select joined_at from guest_members where space_id = ? and guest_id = ?',
  )
    .bind(space.id, guest)
    .first<{ joined_at: number | null }>()

  if (held?.joined_at === null) {
    await context.env.DB.prepare(
      'update guest_members set declined_at = ? where space_id = ? and guest_id = ?',
    )
      .bind(now(), space.id, guest)
      .run()
  } else {
    await context.env.DB.prepare('delete from guest_members where space_id = ? and guest_id = ?')
      .bind(space.id, guest)
      .run()
    await forgetEmptyGuest(context.env, guest)
  }

  return context.json(await sharing(context.env, space, context.get('user')))
})
