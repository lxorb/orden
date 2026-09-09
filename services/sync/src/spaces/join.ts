/** Following a link into a space somebody shared.
 *
 *  If somebody shares something with you, you should not have to sign in to see
 *  it. So a link is its own proof, and which proof it is depends on which link:
 *
 *  An **invitation** was written to an address and mailed to it, so holding the
 *  mail is holding the address. Opening the link establishes the session for
 *  that address the way a magic link does, once, and lands in the space. It is
 *  the same account the emailed code would have opened, and the code is still
 *  there for whoever comes to a link that has been used or has run out.
 *
 *  An **open link** names nobody, so there is nothing to prove and asking for an
 *  address anyway is a sign-up wearing a different hat. It hands out a guest
 *  instead: a session with a name on it and no account behind it, in that one
 *  space at that one role. See src/guests.ts.
 *
 *  A link that **asks first** is the same guest, with one field in front of it so
 *  that the owner has something to accept or decline, and a wait that turns into
 *  the space when they do.
 *
 *  All three end at `POST /v1/join/:token`, which is also what somebody waiting
 *  asks again: the answer to "let me in" and the answer to "am I in yet" are the
 *  same answer. `GET` is the peek and stays open to anybody, because it is what
 *  the page shows before there is a session to have. Mail clients follow links,
 *  so nothing that changes anything happens on a GET. */

import { Hono, type Context } from 'hono'
import { accountFor, claimWhatWasGuested, openSession, presentUser, requireWhoever } from '../auth'
import { readBody } from '../body'
import { cleanName, isEmail, NAME_LIMIT, normaliseEmail, now, sha256 } from '../crypto'
import { mailer, mayMail, requestMessage } from '../email'
import { claimGuest, newGuest, presentGuest } from '../guests'
import { machineOf, mayTellTheOwner } from '../limits'
import type { Env, Guest, Space, User, Variables } from '../types'
import { EMAIL_LIMIT, MOST_MEMBERS, personName } from './share'
import { presentSpace, type Given } from './space'

type Mode = 'open' | 'approval'

/** What a device calls itself, which becomes the first half of a guest's name.
 *  A word, not a sentence. */
const DEVICE_LIMIT = 24

/** How many guests one space takes through its link in a minute, and how many it
 *  holds at once. A link anybody may follow is a door with no lock on it, so the
 *  bound belongs on the door rather than on whoever knocks: without it one
 *  address could make rows all afternoon. */
const GUESTS_A_MINUTE = 20
const MOST_GUESTS = 200

/** How many people may be waiting on one space at once, of either kind. The
 *  Share sheet lists two hundred of each list, and somebody it cannot show is
 *  somebody the owner can neither accept nor decline - the same reason a space
 *  holds two hundred people. */
const MOST_WAITING = MOST_MEMBERS

/** Where a token leads. One of two things, because there are two kinds of link:
 *  the space's own, which anybody may hold, and an invitation, which was written
 *  to one address. */
type Leads =
  | { kind: 'link'; space: Space; role: Given; mode: Mode }
  | { kind: 'invite'; space: Space; role: Given; email: string; hash: string }

type Reply = Context<{ Bindings: Env; Variables: Variables }>

/** What a token is about. Answered without a session, because it is what the
 *  page shows somebody who has not signed in yet: the space they were sent to,
 *  and what they will be able to do there. A token that names nothing is a 404,
 *  so the endpoint says nothing about spaces to somebody guessing. */
async function tokenLeadsTo(env: Env, token: string): Promise<Leads | null> {
  if (!token || token.length > 128) return null

  const link = await env.DB.prepare(
    `select l.role, l.mode, sp.* from space_links l
       join spaces sp on sp.id = l.space_id
      where l.token = ? and sp.deleted = 0`,
  )
    .bind(token)
    .first<Space & { role: Given; mode: Mode }>()

  if (link) return { kind: 'link', space: link, role: link.role, mode: link.mode }

  const hash = await sha256(token)
  const invite = await env.DB.prepare(
    `select m.email, m.role, m.expires_at, sp.* from space_members m
       join spaces sp on sp.id = m.space_id
      where m.invite_hash = ? and sp.deleted = 0`,
  )
    .bind(hash)
    .first<Space & { email: string; role: Given; expires_at: number | null }>()

  if (!invite) return null
  // The address still opens the space; only the shortcut has run out.
  if (invite.expires_at !== null && invite.expires_at < now()) return null

  return { kind: 'invite', space: invite, role: invite.role, email: invite.email, hash }
}

/** Whoever owns the space, for the sentence a page or a mail puts their name in. */
function ownerOf(env: Env, space: Space) {
  return env.DB.prepare('select name, email from users where id = ?')
    .bind(space.user_id)
    .first<{ name: string | null; email: string }>()
}

/** An invitation opens the space once. What it hands out is a session for an
 *  address nobody typed a code for, so it is spent the moment it works: after
 *  this the link says it has expired, and the code is the way in. The membership
 *  stays, because the membership was never the link's to take away. */
function spendInvitation(env: Env, hash: string): Promise<unknown> {
  return env.DB.prepare(
    'update space_members set invite_hash = null, expires_at = null where invite_hash = ?',
  )
    .bind(hash)
    .run()
}

/** The membership, written or found, and the role it actually holds. Somebody
 *  already in the space at a role the owner gave them keeps it: a link is how
 *  they arrived, not what they are.
 *
 *  Null when the space is full and this person is not in it. The invitation route
 *  holds itself to the same number, and a link that did not would be the way
 *  round it: past it the Share sheet cannot list the people it holds, so the owner
 *  can neither see nor take out whoever came in last. */
async function memberNow(
  env: Env,
  space: Space,
  email: string,
  role: Given,
): Promise<Given | null> {
  const roleOf = () =>
    env.DB.prepare('select role from space_members where space_id = ? and email = ?')
      .bind(space.id, email)
      .first<{ role: Given }>()

  const counted = await env.DB.prepare(
    'select count(*) as held from space_members where space_id = ?',
  )
    .bind(space.id)
    .first<{ held: number }>()

  // A full space still lets in somebody who is already a member: what is refused
  // is one more row, not one more visit.
  if ((counted?.held ?? 0) >= MOST_MEMBERS) return (await roleOf())?.role ?? null

  await env.DB.prepare(
    `insert into space_members (space_id, email, role, joined_at, created_at)
     values (?1, ?2, ?3, ?4, ?4)
     on conflict(space_id, email) do update set joined_at = coalesce(space_members.joined_at, ?4)`,
  )
    .bind(space.id, email, role, now())
    .run()

  return (await roleOf())?.role ?? role
}

/** What a link says when the space it leads to holds as many people as it can. */
function spaceIsFull(context: Reply) {
  return context.json({ error: 'that is as many people as one space holds' }, 409)
}

/** Whether the space has room for another guest through its link: how many are
 *  in it, and how many arrived in the last minute.
 *
 *  Only the guests who are actually in count towards the first. A row for
 *  somebody the owner never answered, or said no to, is not a person in the
 *  space, and counting them used to make the ceiling permanent: two hundred
 *  people knocking on a link once was a link that had stopped working for ever,
 *  with nothing an owner could do about it. Waiting is bounded by `roomToWait`
 *  instead, and a row nobody answered runs out after a month; see
 *  `expireGuests`. */
async function roomForAGuest(env: Env, spaceId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select sum(case when joined_at is not null then 1 else 0 end) as held,
            sum(case when created_at > ?2 then 1 else 0 end) as lately
       from guest_members where space_id = ?1`,
  )
    .bind(spaceId, now() - 60_000)
    .first<{ held: number | null; lately: number | null }>()

  return (held?.held ?? 0) < MOST_GUESTS && (held?.lately ?? 0) < GUESTS_A_MINUTE
}

/** Whether one more person may be waiting on this space. Both kinds count,
 *  because both are one line in the sheet's Waiting list: an account that
 *  followed a link which asks first, and a guest that did. */
async function roomToWait(env: Env, spaceId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select (select count(*) from space_requests where space_id = ?1)
          + (select count(*) from guest_members
              where space_id = ?1 and joined_at is null and declined_at is null) as waiting`,
  )
    .bind(spaceId)
    .first<{ waiting: number }>()

  return (held?.waiting ?? 0) < MOST_WAITING
}

/** What a link that asks first says when the owner has as many people waiting as
 *  the sheet can show them. */
function tooManyWaiting(context: Reply) {
  return context.json({ error: 'that many people are already waiting to be let in' }, 429)
}

/** Where one guest stands in one space: in it, waiting on the owner, told no, or
 *  nowhere near it. */
function guestStanding(env: Env, spaceId: string, guestId: string) {
  return env.DB.prepare(
    'select role, joined_at, declined_at from guest_members where space_id = ? and guest_id = ?',
  )
    .bind(spaceId, guestId)
    .first<{ role: Given; joined_at: number | null; declined_at: number | null }>()
}

/** A guest in a space, at a role, either in it or waiting to be. */
function writeGuestMember(
  env: Env,
  spaceId: string,
  guestId: string,
  role: Given,
  waiting: boolean,
): Promise<unknown> {
  // A guest arriving twice at once is one row, not a 500: what `guestStanding`
  // read a moment ago is not a lock on it.
  return env.DB.prepare(
    `insert into guest_members (space_id, guest_id, role, joined_at, created_at)
     values (?, ?, ?, ?, ?)
     on conflict(space_id, guest_id) do nothing`,
  )
    .bind(spaceId, guestId, role, waiting ? null : now(), now())
    .run()
}

/** The owner is told that somebody is waiting, at the same rate anybody is told
 *  anything: it is the person receiving the mail who is protected, whoever
 *  caused the send. And at most once an hour about any one space, because what
 *  the owner needs to know is that somebody is at the door rather than how many
 *  times it was knocked on.
 *
 *  Nothing is said back about any of this. The person at the link is waiting on
 *  the owner either way, and whether a message went is not their business. */
async function tellTheOwner(context: Reply, space: Space, who: string): Promise<void> {
  const env = context.env
  const owner = await ownerOf(env, space)
  if (!owner) return

  if (!(await mayTellTheOwner(env, space.id))) return
  if (!(await mayMail(env, owner.email, machineOf(context.req))).ok) return

  const message = requestMessage({ space: space.name, who, link: env.APP_ORIGIN })
  await mailer(env).send(owner.email, message.subject, message)
}

export const join = new Hono<{ Bindings: Env; Variables: Variables }>()

join.get('/:token', async (context) => {
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: 'that link has expired' }, 404)

  const owner = await ownerOf(context.env, found.space)

  return context.json({
    kind: found.kind,
    space: found.space.name,
    role: found.role,
    // Which address the invitation was written to, so a page can say who it is
    // for. An open link is for whoever has it and names none.
    email: found.kind === 'invite' ? found.email : null,
    asks: found.kind === 'link' && found.mode === 'approval',
    from: owner ? personName(owner) : null,
  })
})

join.post('/:token', async (context) => {
  const who = await requireWhoever(context.env, context.req.header('authorization'))
  const found = await tokenLeadsTo(context.env, context.req.param('token'))
  if (!found) return context.json({ error: 'that link has expired' }, 404)

  // An invitation is proof of an address, so it opens that account whoever is
  // holding the tab. An account already signed in as somebody else is the one
  // case it is not: that is answered below, where the address is checked.
  if (found.kind === 'invite' && who?.kind !== 'user') {
    return await redeemInvitation(context, found, who?.guest ?? null)
  }

  if (who?.kind === 'user') return await asAnAccount(context, found, who.user)
  if (who?.kind === 'guest') return await asAGuest(context, found, who.guest)

  return await asNobody(context, found)
})

/** The mailed link, opening the account it was written to. The whole of what
 *  somebody with no Nib account does: they press the link. */
async function redeemInvitation(context: Reply, found: Leads, guest: Guest | null) {
  if (found.kind !== 'invite') return context.json({ error: 'that link has expired' }, 404)

  const user = await accountFor(context.env, found.email, context.req.header('accept-language'))
  const role = await memberNow(context.env, found.space, user.email, found.role)
  if (!role) return spaceIsFull(context)
  await spendInvitation(context.env, found.hash)

  // Whatever this device held as a guest, and whatever any guest said it was at
  // this address, is the account's now.
  if (guest) await claimGuest(context.env, guest.id, user)
  await claimWhatWasGuested(context.env, user, null)

  return context.json({
    token: await openSession(context.env, user.id),
    user: presentUser(user),
    space: presentSpace(found.space, context.env, role, true),
  })
}

/** Somebody with an account, walking through a link. The address behind the
 *  session is proved, so an invitation written to it is theirs and one written to
 *  somebody else is not. */
async function asAnAccount(context: Reply, found: Leads, user: User) {
  const { space } = found

  if (space.user_id === user.id) {
    return context.json({ space: presentSpace(space, context.env, 'owner', true) })
  }

  if (found.kind === 'invite') {
    if (found.email !== user.email) {
      return context.json({ error: 'that invitation was sent to another address' }, 403)
    }

    const role = await memberNow(context.env, space, user.email, found.role)
    if (!role) return spaceIsFull(context)

    await spendInvitation(context.env, found.hash)
    return context.json({ space: presentSpace(space, context.env, role, true) })
  }

  if (found.mode === 'approval') {
    const already = await context.env.DB.prepare(
      'select role from space_members where space_id = ? and email = ?',
    )
      .bind(space.id, user.email)
      .first<{ role: Given }>()

    if (already) {
      return context.json({ space: presentSpace(space, context.env, already.role, true) })
    }

    if (!(await roomToWait(context.env, space.id))) return tooManyWaiting(context)

    await context.env.DB.prepare(
      `insert into space_requests (space_id, email, role, created_at) values (?1, ?2, ?3, ?4)
       on conflict(space_id, email) do nothing`,
    )
      .bind(space.id, user.email, found.role, now())
      .run()

    await tellTheOwner(context, space, personName(user))
    return context.json({ waiting: true })
  }

  const role = await memberNow(context.env, space, user.email, found.role)
  if (!role) return spaceIsFull(context)

  return context.json({ space: presentSpace(space, context.env, role, true) })
}

/** A guest at a link. Either they are asking again about the space they are
 *  waiting on, which is the same question as walking through it, or this is a
 *  second link and a second space for the same guest. */
async function asAGuest(context: Reply, found: Leads, guest: Guest) {
  const { space } = found
  const standing = await guestStanding(context.env, space.id, guest.id)
  const said = presentGuest(guest)

  if (standing?.joined_at) {
    return context.json({
      guest: said,
      space: presentSpace(space, context.env, standing.role, true),
    })
  }

  if (standing?.declined_at) return context.json({ guest: said, declined: true })
  if (standing) return context.json({ guest: said, waiting: true })

  if (!(await roomForAGuest(context.env, space.id))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const asks = found.kind === 'link' && found.mode === 'approval'
  if (asks && !(await roomToWait(context.env, space.id))) return tooManyWaiting(context)

  await writeGuestMember(context.env, space.id, guest.id, found.role, asks)

  if (asks) {
    await tellTheOwner(context, space, guest.name)
    return context.json({ guest: said, waiting: true })
  }

  return context.json({
    guest: said,
    space: presentSpace(space, context.env, found.role, true),
  })
}

/** Nobody at all, at a link the space itself holds. This is where a guest comes
 *  from: one session, one name, one space. */
async function asNobody(context: Reply, found: Leads) {
  if (found.kind !== 'link') return context.json({ error: 'that link has expired' }, 404)
  const { space } = found

  if (!(await roomForAGuest(context.env, space.id))) {
    return context.json({ error: 'that link is busy, try again in a minute' }, 429)
  }

  const body = await readBody(context)
  // A body is optional here: an open link asks for nothing at all, so what
  // arrived is complained about where it matters rather than at the door.
  const device = body.text('device', DEVICE_LIMIT)
  const said = body.text('name', NAME_LIMIT * 8)
  const address = body.text('email', EMAIL_LIMIT)

  if (found.mode === 'open') {
    const { guest, token } = await newGuest(context.env, device ?? null, null, null)
    await writeGuestMember(context.env, space.id, guest.id, found.role, false)

    return context.json({
      token,
      guest: presentGuest(guest),
      space: presentSpace(space, context.env, found.role, true),
    })
  }

  if (body.problem) return context.json({ error: body.problem }, 400)

  // One field, and either half of it will do: the owner has to have something
  // to accept, and a name is as much as a link that asks first can ask for.
  const named = cleanName(said ?? '').slice(0, NAME_LIMIT)
  const gave = normaliseEmail(address ?? '')
  if (!named && !isEmail(gave)) return context.json({ error: 'say who you are' }, 400)

  if (!(await roomToWait(context.env, space.id))) return tooManyWaiting(context)

  const { guest, token } = await newGuest(
    context.env,
    device ?? null,
    named || gave,
    isEmail(gave) ? gave : null,
  )
  await writeGuestMember(context.env, space.id, guest.id, found.role, true)
  await tellTheOwner(context, space, guest.name)

  return context.json({ token, guest: presentGuest(guest), waiting: true })
}
