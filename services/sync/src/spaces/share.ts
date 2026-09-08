/** Sharing a space: who else may reach it, the link that lets somebody ask, and
 *  the requests waiting on the owner.
 *
 *  Everything here is the owner's, which is what `owner` means. What the people
 *  it lets in may then do is decided somewhere else, by `atLeast` in front of
 *  every route that names a space.
 *
 *  A membership is an address rather than an account, so somebody with no Nib
 *  account can be given a space today and find it waiting the first time they
 *  prove that address. The mail carries a link, and the link carries nothing
 *  but the space it is about: what actually opens a space is the emailed code
 *  the app already signs in with, so an invitation that is forwarded to the
 *  wrong person opens nothing. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { isEmail, normaliseEmail, now, randomToken, sha256 } from '../crypto'
import { inviteMessage, mailer, mayMail, requestMessage } from '../email'
import { requireUser } from '../auth'
import type { Env, Space, User, Variables } from '../types'
import { atLeast, isGiven, presentSpace, spaceOf, type Given } from './space'

/** More people in one space than anyone shares with, and the bound on every
 *  listing below. */
const MOST = 200
const EMAIL_LIMIT = 320
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

/** Where a link takes somebody. The web app reads this path, and so does the
 *  desktop app when it is what opened it; see docs/collaboration.md. */
function joinUrl(env: Env, token: string): string {
  return `${env.APP_ORIGIN}/join/${token}`
}

/** What to call somebody in a sentence: the name on the account, else the part
 *  of the address in front of the at sign. Never the whole address, which is
 *  not a name and which the other person may not have been given. */
function personName(user: { name: string | null; email: string }): string {
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

async function linkOf(env: Env, spaceId: string): Promise<LinkRow | null> {
  const row = await env.DB.prepare('select * from space_links where space_id = ?')
    .bind(spaceId)
    .first<LinkRow>()

  return row ?? null
}

function presentMember(member: MemberRow) {
  return {
    email: member.email,
    name: member.name,
    role: member.role,
    // Nobody has opened it yet. Shown quietly beside the name rather than as a
    // second list: they are already in, they have simply not been in.
    pending: member.joined_at === null,
  }
}

function presentLink(env: Env, link: LinkRow) {
  return { url: joinUrl(env, link.token), role: link.role, mode: link.mode }
}

/** Everything the sheet draws, in one request. */
async function sharing(env: Env, space: Space, owner: User) {
  const [members, requests, link] = await Promise.all([
    membersOf(env, space.id),
    requestsOf(env, space.id),
    linkOf(env, space.id),
  ])

  return {
    owner: { email: owner.email, name: owner.name },
    members: members.map(presentMember),
    requests: requests.map((one) => ({
      email: one.email,
      name: one.name,
      role: one.role,
      at: one.created_at,
    })),
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

/* ── Following a link ─────────────────────────────────────────────────── */

/** What a token is about. Answered without a session, because it is what the
 *  page shows somebody who has not signed in yet: the space they were sent to,
 *  and what they will be able to do there. A token that names nothing is a 404,
 *  so the endpoint says nothing about spaces to somebody guessing. */
async function tokenLeadsTo(
  env: Env,
  token: string,
): Promise<
  | { kind: 'link'; space: Space; role: Given; mode: Mode }
  | { kind: 'invite'; space: Space; role: Given; email: string }
  | null
> {
  if (!token || token.length > 128) return null

  const link = await env.DB.prepare(
    `select l.role, l.mode, sp.* from space_links l
       join spaces sp on sp.id = l.space_id
      where l.token = ? and sp.deleted = 0`,
  )
    .bind(token)
    .first<Space & { role: Given; mode: Mode }>()

  if (link) return { kind: 'link', space: link, role: link.role, mode: link.mode }

  const invite = await env.DB.prepare(
    `select m.email, m.role, m.expires_at, sp.* from space_members m
       join spaces sp on sp.id = m.space_id
      where m.invite_hash = ? and sp.deleted = 0`,
  )
    .bind(await sha256(token))
    .first<Space & { email: string; role: Given; expires_at: number | null }>()

  if (!invite) return null
  // The address still opens the space; only the shortcut has run out.
  if (invite.expires_at !== null && invite.expires_at < now()) return null

  return { kind: 'invite', space: invite, role: invite.role, email: invite.email }
}

export const join = new Hono<{ Bindings: Env; Variables: Variables }>()

join.get('/:token', async (context) => {
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: 'that link has expired' }, 404)

  const owner = await context.env.DB.prepare('select name, email from users where id = ?')
    .bind(found.space.user_id)
    .first<{ name: string | null; email: string }>()

  return context.json({
    kind: found.kind,
    space: found.space.name,
    role: found.role,
    // Which address the invitation was written to, so the sign-in can be filled
    // in rather than typed. An open link is for whoever has it and names none.
    email: found.kind === 'invite' ? found.email : null,
    asks: found.kind === 'link' && found.mode === 'approval',
    from: owner ? personName(owner) : null,
  })
})

/** Coming in, with the address already proved: the session behind this is one
 *  the emailed code handed out, which is the whole of what is asked of somebody
 *  who has never used Nib. */
join.post('/:token', async (context) => {
  const user = await requireUser(context.env, context.req.header('authorization'))
  if (!user) return context.json({ error: 'sign in first' }, 401)

  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: 'that link has expired' }, 404)

  const space = found.space
  if (space.user_id === user.id) {
    return context.json({ space: presentSpace(space, context.env, 'owner', true) })
  }

  if (found.kind === 'invite' && found.email !== user.email) {
    return context.json({ error: 'that invitation was sent to another address' }, 403)
  }

  if (found.kind === 'link' && found.mode === 'approval') {
    const already = await context.env.DB.prepare(
      'select role from space_members where space_id = ? and email = ?',
    )
      .bind(space.id, user.email)
      .first<{ role: Given }>()

    if (already) {
      return context.json({ space: presentSpace(space, context.env, already.role, true) })
    }

    await context.env.DB.prepare(
      `insert into space_requests (space_id, email, role, created_at) values (?1, ?2, ?3, ?4)
       on conflict(space_id, email) do nothing`,
    )
      .bind(space.id, user.email, found.role, now())
      .run()

    const owner = await context.env.DB.prepare('select name, email from users where id = ?')
      .bind(space.user_id)
      .first<{ name: string | null; email: string }>()

    if (owner && (await mayMail(context.env, owner.email))) {
      const message = requestMessage({
        space: space.name,
        who: personName(user),
        link: context.env.APP_ORIGIN,
      })
      await mailer(context.env).send(owner.email, message.subject, message)
    }

    return context.json({ waiting: true })
  }

  // An invitation, or a link anybody may walk through. Either way the address
  // is proved and the row is already theirs, or is written now.
  await context.env.DB.prepare(
    `insert into space_members (space_id, email, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?4)
     on conflict(space_id, email) do update set joined_at = coalesce(space_members.joined_at, ?4)`,
  )
    .bind(space.id, user.email, found.role, now())
    .run()

  const held = await context.env.DB.prepare(
    'select role from space_members where space_id = ? and email = ?',
  )
    .bind(space.id, user.email)
    .first<{ role: Given }>()

  return context.json({
    space: presentSpace(space, context.env, held?.role ?? found.role, true),
  })
})
