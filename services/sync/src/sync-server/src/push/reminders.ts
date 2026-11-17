import { type Shut, shutFor } from '../protected'
import type { Env } from '../types'
import { liveTarget } from './live'
import { type Message, push, type Target } from './send'

const AT_ONCE = 200

const KEPT_FOR = 86_400_000

export const REMIND_BEFORE: readonly number[] = [0, 5, 15, 30, 60, -1]

export const TRY_AGAIN_AFTER = 300_000

export const MOST_TRIES = 4

const SHUT_TITLE = 'A protected note has a reminder'

interface Due {
  note_id: string
  id: string
  user_id: string
  space_id: string
  at: number
  title: string
  body: string
  space: string
  path: string
  hash: string
  line: number
  tries: number
}

export function forgetReminders(env: Env, noteId: string): D1PreparedStatement {
  return env.DB.prepare('delete from push_reminders where note_id = ?').bind(noteId)
}

export async function sendDue(
  env: Env,
  now: number,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<number> {
  await env.DB.prepare('delete from push_reminders where at < ?')
    .bind(now - KEPT_FOR)
    .run()

  const { results: due } = await env.DB.prepare(
    `select r.note_id, r.id, r.user_id, r.space_id, r.at, r.title, r.body, r.path, r.hash, r.line,
            r.tries, s.name as space
       from push_reminders r
       left join notes n on n.id = r.note_id
       join spaces s on s.id = r.space_id and s.deleted = 0
      where (n.deleted = 0 or r.note_id = 'inbox:' || r.user_id) and r.sent_at is null and r.at <= ?1 and coalesce(r.retry_at, 0) <= ?1
      order by r.retry_at is not null, r.at limit ?2`,
  )
    .bind(now, AT_ONCE)
    .all<Due>()

  let sent = 0
  const targets = new Map<string, Target[]>()
  const shuts = new Map<string, Shut>()
  for (const one of due) {
    const claimed = await env.DB.prepare(
      'update push_reminders set sent_at = ? where note_id = ? and id = ? and sent_at is null',
    )
      .bind(now, one.note_id, one.id)
      .run()
    if (!claimed.meta.changes) continue

    let theirs = targets.get(one.user_id)
    if (!theirs) {
      theirs = (
        await env.DB.prepare(
          `select t.id, t.user_id, t.kind, t.token, t.keys, t.zone from push_targets t
            where t.user_id = ?1 and ${liveTarget('?2')}`,
        )
          .bind(one.user_id, Date.now())
          .all<Target>()
      ).results
      targets.set(one.user_id, theirs)
    }

    let shut = shuts.get(one.user_id)
    if (!shut) {
      shut = await shutFor(env, one.user_id)
      shuts.set(one.user_id, shut)
    }
    const hidden = shut(one.space_id, one.path)

    const message: Message = {
      kind: 'reminder',
      id: one.id,
      title: hidden ? SHUT_TITLE : one.title,
      body: hidden ? '' : one.body,
      fields: {
        at: String(one.at),
        space: one.space,
        path: one.path,
        hash: one.hash,
        line: String(one.line),
      },
    }
    const delivered = await Promise.all(
      theirs.map((target) => push(env, target, message, now, send)),
    )
    if (delivered.includes('sent')) {
      sent++
    } else if (
      delivered.includes('busy') &&
      !delivered.includes('failed') &&
      one.tries + 1 < MOST_TRIES
    ) {
      await env.DB.prepare(
        `update push_reminders set sent_at = null, tries = ?, retry_at = ?
          where note_id = ? and id = ? and sent_at = ?`,
      )
        .bind(one.tries + 1, now + TRY_AGAIN_AFTER * 2 ** one.tries, one.note_id, one.id, now)
        .run()
    }
  }
  return sent
}
