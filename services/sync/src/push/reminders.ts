import { isTodoList } from '@orden/bases/todo-lists'
import { metaFromText } from '@orden/sync-core/meta'
import { taskHash } from '@orden/bases'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { readTask } from '@orden/markdown/task-line'
import { momentOf, plainWords, reminderId, remindTimes } from '@orden/markdown/task-reminders'
import type { Env } from '../types'
import { liveTarget } from './live'
import { type Message, push, type Target } from './send'

export const REMIND_BEFORE: readonly number[] = [0, 5, 15, 30, 60, -1]

const MOST_PER_NOTE = 64

const AT_ONCE = 200

const KEPT_FOR = 86_400_000

export const TRY_AGAIN_AFTER = 300_000

export const MOST_TRIES = 4

interface Saved {
  id: string
  space_id: string
  path: string
  meta?: string | null
}

interface Kept {
  id: string
  at: number
  title: string
  body: string
  hash: string
  line: number
}

function taskLines(content: string): { line: number; text: string }[] {
  const lines = content.split(/\r?\n/)
  const found: { line: number; text: string }[] = []
  const block = frontMatterBlock(content)
  let at = block ? content.slice(0, block.close).split('\n').length : 0
  let fence: string | null = null
  for (; at < lines.length; at++) {
    const line = lines[at] ?? ''
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      const sign = marker.charAt(0)
      if (fence === null) fence = sign
      else if (sign === fence) fence = null
      continue
    }
    if (fence === null && /^\s*[-*+] \[.\]/.test(line)) found.push({ line: at, text: line })
  }
  return found
}

export function remindersIn(
  content: string,
  space: string,
  path: string,
  zone: string,
  auto: number | null,
  now: number,
  from = now,
): Kept[] {
  const body = path.replace(/^.*\//, '').replace(/\.md$/i, '')
  const kept: Kept[] = []
  for (const { line, text } of taskLines(content)) {
    const task = readTask(text)
    if (!task) continue
    const hash = taskHash(task.text)
    for (const wall of remindTimes(task, auto, 'start', zone)) {
      const at = momentOf(wall, zone)
      if (!(at > from)) continue
      kept.push({
        id: reminderId(space, path, hash, wall),
        at,
        title: plainWords(task.text),
        body,
        hash,
        line,
      })
    }
  }
  return kept.sort((a, b) => a.at - b.at).slice(0, MOST_PER_NOTE)
}

function autoOf(settings: string | null): number | null {
  try {
    const chosen = (JSON.parse(settings ?? '{}') as { remindBefore?: unknown }).remindBefore
    if (typeof chosen === 'number' && REMIND_BEFORE.includes(chosen)) {
      return chosen < 0 ? null : chosen
    }
  } catch {
    // Settings nobody can read are the defaults.
  }
  return 0
}

export async function keepReminders(env: Env, note: Saved, content: string, now = Date.now()) {
  const owner = await env.DB.prepare(
    `select s.user_id, s.name, u.settings,
            (select zone from push_targets t where t.user_id = s.user_id and ${liveTarget('?2')}
              order by t.created_at desc limit 1) as zone
       from spaces s join users u on u.id = s.user_id where s.id = ?1`,
  )
    .bind(note.space_id, Date.now())
    .first<{ user_id: string; name: string; settings: string | null; zone: string | null }>()

  const forget = env.DB.prepare('delete from push_reminders where note_id = ?').bind(note.id)
  if (!owner?.zone || !isTodoList(note.path, metaFromText(note.meta))) {
    await forget.run()
    return
  }

  const before = await env.DB.prepare(
    'select id, sent_at, tries, retry_at from push_reminders where note_id = ?',
  )
    .bind(note.id)
    .all<{ id: string; sent_at: number | null; tries: number; retry_at: number | null }>()
  const sentAt = new Map(
    before.results.flatMap((one) => (one.sent_at === null ? [] : [[one.id, one.sent_at] as const])),
  )
  const waiting = new Set(before.results.filter((one) => one.sent_at === null).map((one) => one.id))
  const tried = new Map(before.results.map((one) => [one.id, one]))

  const kept = remindersIn(
    content,
    owner.name,
    note.path,
    owner.zone,
    autoOf(owner.settings),
    now,
    now - KEPT_FOR,
  ).filter((one) => one.at > now || waiting.has(one.id))

  await env.DB.batch([
    forget,
    ...kept.map((one) =>
      env.DB.prepare(
        `insert into push_reminders
           (note_id, id, user_id, space_id, at, title, body, path, hash, line, sent_at,
            tries, retry_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        note.id,
        one.id,
        owner.user_id,
        note.space_id,
        one.at,
        one.title,
        one.body,
        note.path,
        one.hash,
        one.line,
        sentAt.get(one.id) ?? null,
        tried.get(one.id)?.tries ?? 0,
        tried.get(one.id)?.retry_at ?? null,
      ),
    ),
  ])
}

interface Due {
  note_id: string
  id: string
  user_id: string
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
    `select r.note_id, r.id, r.user_id, r.at, r.title, r.body, r.path, r.hash, r.line, r.tries,
            s.name as space
       from push_reminders r
       join notes n on n.id = r.note_id and n.deleted = 0
       join spaces s on s.id = r.space_id and s.deleted = 0
      where r.sent_at is null and r.at <= ?1 and coalesce(r.retry_at, 0) <= ?1
      order by r.retry_at is not null, r.at limit ?2`,
  )
    .bind(now, AT_ONCE)
    .all<Due>()

  let sent = 0
  const targets = new Map<string, Target[]>()
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

    const message: Message = {
      kind: 'reminder',
      id: one.id,
      title: one.title,
      body: one.body,
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
