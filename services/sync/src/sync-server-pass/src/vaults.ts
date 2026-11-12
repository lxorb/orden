import {
  acceptedIn,
  isCount,
  isPassId,
  isSealed,
  keyProofIn,
  MOST_KEY_BYTES,
  MOST_META_BYTES,
  MOST_PAGE,
  MOST_VAULTS,
} from '@orden/pass/wire'
import { Hono } from 'hono'
import { readBody, now, type Env, type Variables } from '../../sync-server/src/api'
import { activeIn, holdsSql, mayAct, membershipOf } from './access'
import { filesGone } from './files'
import {
  NO_SUCH_VAULT,
  NOT_A_PROOF,
  NOT_A_VAULT,
  NOT_YOUR_ROLE,
  ROTATED,
  STALE,
  TAKEN,
  TOO_MANY_VAULTS,
} from './refusals'
import { ITEM_COLUMNS, type ItemDb, itemRowOf, vaultRowOf } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, membersOf, tell, tellVault } from './tell'
import { fieldsSent, jsonOf, optionalIn } from './trust-body'

export const vaults = new Hono<{ Bindings: Env; Variables: Variables }>()

vaults.put('/vaults/:id', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const body = await readBody(context)
  const rev = body.count('rev')
  const meta = body.text('meta', MOST_META_BYTES)
  const key = body.nullableText('key', MOST_KEY_BYTES)
  const keyVersion = body.count('keyVersion') ?? 1
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isPassId(id) || !isCount(rev) || !isSealed(meta, MOST_META_BYTES)) {
    return context.json({ error: NOT_A_VAULT }, 400)
  }
  const sent = await fieldsSent(context)
  const proof = optionalIn(sent.proof, keyProofIn)
  const accepted = optionalIn(sent.accepted, acceptedIn)
  if (proof === undefined || accepted === undefined) {
    return context.json({ error: NOT_A_PROOF }, 400)
  }

  const db = context.env.DB
  if (rev === 0) {
    if (!isSealed(key, MOST_KEY_BYTES) || !isCount(keyVersion) || keyVersion < 1) {
      return context.json({ error: NOT_A_VAULT }, 400)
    }
    const results = await db.batch([
      bump(db),
      db
        .prepare(
          `insert into pass_vaults
             (id, owner_id, rev, meta, key_version, deleted_at, seq, key_proof)
           select ?1, ?2, 1, ?3, ?4, null, ${SEQ}, ?6
            where (select count(*) from pass_vaults where owner_id = ?2 and deleted_at is null) < ?5
           on conflict(id) do nothing`,
        )
        .bind(id, user.id, meta, keyVersion, MOST_VAULTS, jsonOf(proof)),
      db
        .prepare(
          `insert into pass_members
             (vault_id, email, user_id, role, state, key, key_version, invited_by, seq, accepted)
           select ?1, ?2, ?3, 'owner', 'active', ?4, ?5, null, ${SEQ}, ?6
            where exists (select 1 from pass_vaults where id = ?1 and owner_id = ?3 and seq = ${SEQ})`,
        )
        .bind(id, user.email, user.id, key, keyVersion, jsonOf(accepted)),
    ])
    if (!results[1]?.meta.changes) {
      const held = await membershipOf(context.env, id, user.email)
      if (held) return context.json({ error: STALE, current: vaultRowOf(held, user.id) }, 409)
      const taken = await db
        .prepare('select 1 as one from pass_vaults where id = ?')
        .bind(id)
        .first()
      return context.json({ error: taken ? TAKEN : TOO_MANY_VAULTS }, 409)
    }
    await tell(context.env, [user.id], from)
    return context.json({ rev: 1 })
  }

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)

  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_vaults set rev = rev + 1, meta = ?1, seq = ${SEQ}
          where id = ?2 and rev = ?3 and deleted_at is null and ${holdsSql('?2', '?4', 'manager')}`,
      )
      .bind(meta, id, rev, user.email),
  ])
  if (!results[1]?.meta.changes) {
    const after = await activeIn(context.env, id, user.email)
    if (!after) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(after, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
    const current = await membershipOf(context.env, id, user.email)
    return context.json({ error: STALE, current: current && vaultRowOf(current, user.id) }, 409)
  }
  await tellVault(context.env, id, [user.id], from)
  return context.json({ rev: rev + 1 })
})

vaults.put('/vaults/:id/trust', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const sent = await fieldsSent(context)
  const proof = optionalIn(sent.proof, keyProofIn)
  const accepted = optionalIn(sent.accepted, acceptedIn)
  const keyVersion = sent.keyVersion
  if (proof === undefined || accepted === undefined || (proof !== null && !isCount(keyVersion))) {
    return context.json({ error: NOT_A_PROOF }, 400)
  }
  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (proof !== null && !mayAct(held, 'manager')) {
    return context.json({ error: NOT_YOUR_ROLE }, 403)
  }
  if (proof !== null && keyVersion !== held.key_version) {
    return context.json({ error: ROTATED, keyVersion: held.key_version }, 409)
  }
  const db = context.env.DB
  await db.batch([
    bump(db),
    ...(accepted === null
      ? []
      : [
          db
            .prepare(
              `update pass_members set accepted = ?, seq = ${SEQ}
                where vault_id = ? and email = ? and state = 'active'`,
            )
            .bind(jsonOf(accepted), id, user.email),
        ]),
    ...(proof === null
      ? []
      : [
          db
            .prepare(
              `update pass_vaults set key_proof = ?1, seq = ${SEQ}
                where id = ?2 and key_version = ?3 and deleted_at is null
                  and ${holdsSql('?2', '?4', 'manager')}`,
            )
            .bind(jsonOf(proof), id, keyVersion, user.email),
        ]),
  ])
  await tellVault(context.env, id, [user.id], from)
  return context.json({ ok: true })
})

vaults.delete('/vaults/:id', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (held.role !== 'owner') return context.json({ error: NOT_YOUR_ROLE }, 403)

  const told = await membersOf(context.env, id)
  const db = context.env.DB
  await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_vaults set deleted_at = ?, meta = '', rev = rev + 1, seq = ${SEQ}
          where id = ? and deleted_at is null`,
      )
      .bind(now(), id),
    db.prepare('update pass_members set key = null where vault_id = ?').bind(id),
    db
      .prepare(`delete from pass_members where vault_id = ? and state in ('pending', 'confirm')`)
      .bind(id),
    db.prepare('delete from pass_items where vault_id = ?').bind(id),
    db.prepare('delete from pass_versions where vault_id = ?').bind(id),
    db.prepare('delete from pass_links where vault_id = ?').bind(id),
    ...filesGone(db, 'vault_id = ?1', [id]),
  ])
  await tell(context.env, [user.id, ...told], from)
  return context.json({ ok: true })
})

vaults.get('/vaults/:id/items', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const after = context.req.query('after') ?? ''
  if (after !== '' && !isPassId(after)) return context.json({ error: NOT_A_VAULT }, 400)
  if (!(await activeIn(context.env, id, user.email))) {
    return context.json({ error: NO_SUCH_VAULT }, 404)
  }
  const { results } = await context.env.DB.prepare(
    `select ${ITEM_COLUMNS} from pass_items
      where vault_id = ? and deleted_at is null and id > ? order by id limit ?`,
  )
    .bind(id, after, MOST_PAGE + 1)
    .all<ItemDb>()
  return context.json({
    items: results.slice(0, MOST_PAGE).map(itemRowOf),
    more: results.length > MOST_PAGE,
  })
})
