import {
  isCount,
  isPassId,
  isSealed,
  keyProofIn,
  MOST_ITEM_BYTES,
  MOST_ITEMS,
  MOST_KEY_BYTES,
  MOST_MEMBERS,
  MOST_META_BYTES,
} from '@orden/pass/wire'
import { Hono } from 'hono'
import {
  chunks,
  objectBody,
  isEmail,
  normaliseEmail,
  NOT_AN_OBJECT,
  type Env,
  type Variables,
} from '../../sync-server/src/api'
import { activeIn, holdsSql, mayAct, membershipOf } from './access'
import {
  KEEPS_ITS_OWNER,
  NO_SUCH_VAULT,
  NOT_A_KEY,
  NOT_EVERYONE,
  NOT_YOUR_ROLE,
  STALE,
} from './refusals'
import { vaultRowOf } from './rows'
import { bump, SEQ } from './seq'
import { fromOf, tellVault } from './tell'
import { jsonOf, optionalIn } from './trust-body'

export const rotations = new Hono<{ Bindings: Env; Variables: Variables }>()

const AT_ONCE = 1000

const MINE = `exists (select 1 from pass_vaults where id = ?1 and seq = ${SEQ} and key_version = ?2)`

interface Resealed {
  key: string
  body: string
  rev: number
}

function entriesIn<T>(
  value: unknown,
  most: number,
  name: (key: string) => string | null,
  each: (one: unknown) => T | null,
): Map<string, T> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > most) return null
  const kept = new Map<string, T>()
  for (const [raw, one] of entries) {
    const named = name(raw)
    const read = each(one)
    if (named === null || kept.has(named) || read === null) return null
    kept.set(named, read)
  }
  return kept
}

function keyIn(value: unknown): string | null {
  return isSealed(value, MOST_KEY_BYTES) ? value : null
}

function resealedIn(value: unknown): Resealed | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { key, body, rev } = value as Record<string, unknown>
  if (!isSealed(key, MOST_KEY_BYTES) || !isSealed(body, MOST_ITEM_BYTES) || !isCount(rev)) {
    return null
  }
  return rev < 1 ? null : { key, body, rev }
}

function emailIn(raw: string): string | null {
  const email = normaliseEmail(raw)
  return isEmail(email) ? email : null
}

rotations.post('/vaults/:id/rotate', async (context) => {
  const user = context.get('user')
  const id = context.req.param('id')
  const from = fromOf(context.req.query('from'))
  const sent = await objectBody(context)
  if (!sent) return context.json({ error: NOT_AN_OBJECT }, 400)
  const { rev, keyVersion, meta } = sent
  const people = entriesIn(sent.members, MOST_MEMBERS, emailIn, keyIn)
  const sealed = entriesIn(
    sent.items,
    MOST_ITEMS,
    (raw) => (isPassId(raw) ? raw : null),
    resealedIn,
  )
  const proof = optionalIn(sent.proof, keyProofIn)
  if (
    !isCount(rev) ||
    rev < 1 ||
    !isCount(keyVersion) ||
    !isSealed(meta, MOST_META_BYTES) ||
    people === null ||
    sealed === null ||
    proof === undefined
  )
    return context.json({ error: NOT_A_KEY }, 400)

  const held = await activeIn(context.env, id, user.email)
  if (!held) return context.json({ error: NO_SUCH_VAULT }, 404)
  if (!mayAct(held, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
  if (held.rev !== rev || held.key_version + 1 !== keyVersion) {
    return context.json({ error: STALE, current: vaultRowOf(held, user.id) }, 409)
  }

  const db = context.env.DB
  const [owner, { results: live }] = await Promise.all([
    db
      .prepare(`select email from pass_members where vault_id = ? and role = 'owner'`)
      .bind(id)
      .first<{ email: string }>(),
    db
      .prepare('select id, rev from pass_items where vault_id = ? and deleted_at is null')
      .bind(id)
      .all<{ id: string; rev: number }>(),
  ])
  if (!people.has(user.email) || (owner && !people.has(owner.email))) {
    return context.json({ error: KEEPS_ITS_OWNER }, 409)
  }
  if (sealed.size !== live.length || !live.every((one) => sealed.get(one.id)?.rev === one.rev))
    return context.json({ error: NOT_EVERYONE }, 409)

  const peopleJson = JSON.stringify(Object.fromEntries(people))
  const revs = JSON.stringify(Object.fromEntries(live.map((one) => [one.id, one.rev])))
  const pieces = chunks(
    [...sealed.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    AT_ONCE,
  )
  const results = await db.batch([
    bump(db),
    db
      .prepare(
        `update pass_vaults set rev = rev + 1, meta = ?4, key_version = ?2, seq = ${SEQ},
                key_proof = ?7
          where id = ?1 and rev = ?3 and key_version = ?2 - 1 and deleted_at is null
            and (select count(*) from pass_items where vault_id = ?1 and deleted_at is null) = ?5
            and (select count(*) from pass_items i join json_each(?6) j on j.key = i.id
                  where i.vault_id = ?1 and i.deleted_at is null and i.rev = j.value) = ?5
            and ${holdsSql('?1', '?8', 'manager')}
            and ?8 in (select key from json_each(?9))`,
      )
      .bind(id, keyVersion, rev, meta, live.length, revs, jsonOf(proof), user.email, peopleJson),
    db
      .prepare(
        `update pass_members set key = j.value, key_version = ?2, seq = ${SEQ},
                state = case when pass_members.state = 'active' then 'active' else 'pending' end
           from json_each(?3) j
          where pass_members.vault_id = ?1 and pass_members.email = j.key
            and pass_members.state <> 'removed' and ${MINE}`,
      )
      .bind(id, keyVersion, peopleJson),
    db
      .prepare(
        `update pass_members set key = null, seq = ${SEQ},
                state = case when exists (select 1 from pass_keyrings k
                                           where k.user_id = pass_members.user_id)
                             then 'confirm' else 'pending' end
          where vault_id = ?1 and state in ('active', 'pending', 'confirm') and role <> 'owner'
            and email not in (select key from json_each(?3)) and ${MINE}`,
      )
      .bind(id, keyVersion, peopleJson),
    db.prepare(`delete from pass_versions where vault_id = ?1 and ${MINE}`).bind(id, keyVersion),
    ...pieces.map((piece, at) =>
      db
        .prepare(
          `update pass_items set key = json_extract(j.value, '$.key'),
                  body = json_extract(j.value, '$.body'), rev = pass_items.rev + 1,
                  key_version = ?2, seq = ${SEQ} + ?4 + j.n
             from (select key, value, row_number() over (order by key) as n
                     from json_each(?3)) j
            where pass_items.vault_id = ?1 and pass_items.id = j.key
              and pass_items.deleted_at is null and ${MINE}`,
        )
        .bind(id, keyVersion, JSON.stringify(Object.fromEntries(piece)), at * AT_ONCE),
    ),
    db
      .prepare(
        `update pass_seq set seq = seq + ?3
          where id = 1 and exists (select 1 from pass_vaults
                                    where id = ?1 and seq = pass_seq.seq and key_version = ?2)`,
      )
      .bind(id, keyVersion, live.length),
  ])
  if (!results[1]?.meta.changes) {
    const after = await activeIn(context.env, id, user.email)
    if (!after) return context.json({ error: NO_SUCH_VAULT }, 404)
    if (!mayAct(after, 'manager')) return context.json({ error: NOT_YOUR_ROLE }, 403)
    const current = await membershipOf(context.env, id, user.email)
    if (current && (current.rev !== rev || current.key_version + 1 !== keyVersion)) {
      return context.json({ error: STALE, current: vaultRowOf(current, user.id) }, 409)
    }
    return context.json({ error: NOT_EVERYONE }, 409)
  }
  await tellVault(context.env, id, [user.id], from)
  return context.json({ rev: rev + 1, keyVersion })
})
