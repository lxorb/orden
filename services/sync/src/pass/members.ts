import { isSignature } from '@orden/pass/shape'
import {
  handoversIn,
  isCount,
  isRole,
  isSealed,
  LONGEST_NAME,
  type Member,
  MOST_HANDOVERS,
  MOST_KEY_BYTES,
  MOST_MEMBERS,
  MOST_VAULTS,
  pinIn,
} from '@orden/pass/wire'
import type { Role } from '@orden/pass/types'
import { Hono } from 'hono'
import { listIn, readBody } from '../body'
import { isEmail, normaliseEmail } from '../crypto'
import { mayInviteToPass } from '../limits'
import { NOT_AN_EMAIL, TRY_IN_AN_HOUR } from '../refused'
import type { Env, Variables } from '../types'
import { activeIn, mayAct } from './access'
import {
  ALREADY_MEMBER,
  NO_SUCH_MEMBER,
  NO_SUCH_VAULT,
  NOT_A_KEY,
  NOT_A_PROOF,
  NOT_A_ROLE,
  NOT_YOUR_ROLE,
  OWNER_STAYS,
  ROTATED,
  TOO_MANY_MEMBERS,
  TOO_MANY_VAULTS,
} from './refusals'
import { bump, SEQ } from './seq'
import { fromOf, tellVault } from './tell'
import { fieldsSent, jsonOf, optionalIn } from './trust-body'

export const members = new Hono<{ Bindings: Env; Variables: Variables }>()

const LONGEST_ADDRESS = 320

interface MemberDb {
  email: string
  user_id: string | null
  role: Role
  state: 'pending' | 'confirm' | 'active' | 'removed'
  key: string | null
}

async function memberOf(env: Env, vault: string, email: string): Promise<MemberDb | null> {
  const row = await env.DB.prepare(
    `select email, user_id, role, state, key from pass_members
      where vault_id = ? and email = ?`,
  )
    .bind(vault, email)
    .first<MemberDb>()
  return row && row.state !== 'removed' ? row : null
}

function emailOf(param: string): string {
  return normaliseEmail(param)
}

function invitedRole(value: string | undefined): Role | null {
  return isRole(value) && value !== 'owner' ? value : null
}

function vouchIn(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return isSignature(value) ? value : undefined
}

members.get('/vaults/:id/members', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  const { results } = await context.env.DB.prepare(
    `select m.email,
            case when m.state = 'active' then coalesce(u.name, '') else '' end as name,
            m.role, m.state,
            case when m.state = 'active' or ?2 then k.pub end as pub,
            case when m.state = 'active' or ?2 then k.sign_pub end as signPub,
            m.vouch
       from pass_members m
       left join users u on u.email = m.email
       left join pass_keyrings k on k.user_id = u.id
      where m.vault_id = ?1 and m.state <> 'removed'
      order by m.role = 'owner' desc, m.email`,
  )
    .bind(id, mayAct(held, 'manager') ? 1 : 0)
    .all<Member>()
  return context.json({
    members: results.map((one) => ({ ...one, name: one.name.slice(0, LONGEST_NAME) })),
  })
})

members.post('/vaults/:id/invites', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const email = normaliseEmail(body.text('email', LONGEST_ADDRESS) ?? '')
  const role = invitedRole(body.text('role', 16))
  const key = body.nullableText('key', MOST_KEY_BYTES) ?? null
  const keyVersion = body.count('keyVersion')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  if (!role) return context.json({ error: NOT_A_ROLE }, 400)
  if (key !== null && (!isSealed(key, MOST_KEY_BYTES) || !isCount(keyVersion))) {
    return context.json({ error: NOT_A_KEY }, 400)
  }
  const sent = await fieldsSent(context)
  const vouch = vouchIn(sent.vouch)
  const pin = optionalIn(sent.pin, pinIn)
  if (vouch === undefined || pin === undefined) return context.json({ error: NOT_A_PROOF }, 400)

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  if (email === user.email) return context.json({ error: ALREADY_MEMBER }, 409)
  if (!(await mayInviteToPass(context.env, user.id))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }
  if (key !== null && keyVersion !== held.key_version) {
    return context.json({ error: ROTATED, keyVersion: held.key_version }, 409)
  }

  const invitee = await context.env.DB.prepare(
    `select u.id, k.pub from users u left join pass_keyrings k on k.user_id = u.id
      where u.email = ?`,
  )
    .bind(email)
    .first<{ id: string; pub: string | null }>()
  const state = key === null && invitee?.pub ? 'confirm' : 'pending'

  const db = context.env.DB
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `insert into pass_members
           (vault_id, email, user_id, role, state, key, key_version, invited_by, seq, vouch, pin)
         select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ${SEQ}, ?10, ?11
          where (select count(*) from pass_members where vault_id = ?1 and state <> 'removed') < ?9
            and exists (select 1 from pass_vaults where id = ?1 and deleted_at is null)
         on conflict(vault_id, email) do update set
           user_id = excluded.user_id, role = excluded.role, state = excluded.state,
           key = excluded.key, key_version = excluded.key_version,
           invited_by = excluded.invited_by, seq = excluded.seq,
           vouch = excluded.vouch, pin = excluded.pin, accepted = null
          where pass_members.state = 'removed'`,
      )
      .bind(
        id,
        email,
        invitee?.id ?? null,
        role,
        state,
        key,
        key === null ? held.key_version : keyVersion,
        user.id,
        MOST_MEMBERS,
        role === 'manager' ? vouch : null,
        jsonOf(pin),
      ),
    db
      .prepare(
        `update pass_vaults set seq = ${SEQ}
          where id = ?1 and exists (select 1 from pass_members
                                     where vault_id = ?1 and email = ?2 and seq = ${SEQ})`,
      )
      .bind(id, email),
  ])
  if (!results[1]?.meta.changes) {
    const there = await memberOf(context.env, id, email)
    return context.json({ error: there ? ALREADY_MEMBER : TOO_MANY_MEMBERS }, 409)
  }
  await tellVault(context.env, id, [user.id], from)
  return context.json({ state })
})

members.put('/vaults/:id/members/:email/key', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const email = emailOf(context.req.param('email'))
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const key = body.text('key', MOST_KEY_BYTES)
  const keyVersion = body.count('keyVersion')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isSealed(key, MOST_KEY_BYTES) || !isCount(keyVersion)) {
    return context.json({ error: NOT_A_KEY }, 400)
  }

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  if (keyVersion !== held.key_version) {
    return context.json({ error: ROTATED, keyVersion: held.key_version }, 409)
  }

  const db = context.env.DB
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_members set key = ?, key_version = ?, state = 'pending', seq = ${SEQ}
          where vault_id = ? and email = ? and state in ('pending', 'confirm')`,
      )
      .bind(key, keyVersion, id, email),
  ])
  if (!results[1]?.meta.changes) return context.json({ error: NO_SUCH_MEMBER }, 404)
  await tellVault(context.env, id, [user.id], from)
  return context.json({ ok: true })
})

members.put('/vaults/:id/members/:email', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const email = emailOf(context.req.param('email'))
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const role = invitedRole(body.text('role', 16))
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!role) return context.json({ error: NOT_A_ROLE }, 400)
  const vouch = vouchIn((await fieldsSent(context)).vouch)
  if (vouch === undefined) return context.json({ error: NOT_A_PROOF }, 400)

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  const target = await memberOf(context.env, id, email)
  if (!target) return context.json({ error: NO_SUCH_MEMBER }, 404)
  if (target.role === 'owner') return context.json({ error: OWNER_STAYS }, 409)

  const db = context.env.DB
  await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_members set role = ?, vouch = ?, seq = ${SEQ}
          where vault_id = ? and email = ? and state <> 'removed' and role <> 'owner'`,
      )
      .bind(role, role === 'manager' ? vouch : null, id, email),
  ])
  await tellVault(context.env, id, [user.id], from)
  return context.json({ ok: true })
})

members.delete('/vaults/:id/members/:email', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const email = emailOf(context.req.param('email'))
  const from = fromOf(context.req.query('from'))

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  const leaving = email === user.email
  if (!leaving && !mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  const target = await memberOf(context.env, id, email)
  if (!target) return context.json({ error: NO_SUCH_MEMBER }, 404)
  if (target.role === 'owner') return context.json({ error: OWNER_STAYS }, 409)

  const db = context.env.DB
  await db.batch([
    bump(db),
    db
      .prepare('delete from pass_links where vault_id = ? and user_id = ?')
      .bind(id, target.user_id ?? ''),
    db
      .prepare(
        `update pass_members set state = 'removed', key = null, seq = ${SEQ}
          where vault_id = ? and email = ? and state = 'active' and role <> 'owner'`,
      )
      .bind(id, email),
    db
      .prepare(
        `delete from pass_members
          where vault_id = ? and email = ? and state in ('pending', 'confirm')`,
      )
      .bind(id, email),
    db.prepare(`update pass_vaults set seq = ${SEQ} where id = ?`).bind(id),
  ])
  await tellVault(context.env, id, [user.id, ...(target.user_id ? [target.user_id] : [])], from)
  return context.json({ ok: true })
})

members.put('/vaults/:id/owner', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const email = normaliseEmail(body.text('email', LONGEST_ADDRESS) ?? '')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isEmail(email)) return context.json({ error: NOT_AN_EMAIL }, 400)
  const handover = vouchIn((await fieldsSent(context)).handover)
  if (handover === undefined) return context.json({ error: NOT_A_PROOF }, 400)

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (held.role !== 'owner') return context.json({ error: NOT_YOUR_ROLE }, 403)
  const target = await memberOf(context.env, id, email)
  if (target?.state !== 'active' || !target.user_id || email === user.email) {
    return context.json({ error: NO_SUCH_MEMBER }, 404)
  }
  const heir = await context.env.DB.prepare('select sign_pub from pass_keyrings where user_id = ?')
    .bind(target.user_id)
    .first<{ sign_pub: string | null }>()
  const before = handoversIn(listIn(held.handovers)) ?? []
  const handovers =
    handover !== null && heir?.sign_pub
      ? [...before, { to: heir.sign_pub, sig: handover }].slice(-MOST_HANDOVERS)
      : before

  const db = context.env.DB
  const handed = `exists (select 1 from pass_vaults where id = ?1 and owner_id = ?3 and seq = ${SEQ})`
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_vaults set owner_id = ?3, handovers = ?5, seq = ${SEQ}
          where id = ?1 and owner_id = ?2 and deleted_at is null
            and (select count(*) from pass_vaults where owner_id = ?3 and deleted_at is null) < ?4`,
      )
      .bind(id, user.id, target.user_id, MOST_VAULTS, JSON.stringify(handovers)),
    db
      .prepare(
        `update pass_members set role = 'owner', seq = ${SEQ}
          where vault_id = ?1 and email = ?2 and state = 'active' and ${handed}`,
      )
      .bind(id, email, target.user_id),
    db
      .prepare(
        `update pass_members set role = 'manager', seq = ${SEQ}
          where vault_id = ?1 and email = ?2 and ${handed}`,
      )
      .bind(id, user.email, target.user_id),
  ])
  if (!results[1]?.meta.changes) return context.json({ error: TOO_MANY_VAULTS }, 409)
  await tellVault(context.env, id, [user.id], from)
  return context.json({ ok: true })
})
