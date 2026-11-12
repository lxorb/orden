import {
  changesTo,
  datedChanges,
  type InboxFields,
  type Item,
  rendered,
} from '@orden/bases/inbox-items'
import { ACCOUNT_INBOX } from '@orden/bases/inbox'
import { inboxStamp, MOST_INBOX_CHANGES, type InboxChange } from '@orden/sync-core'
import { inboxSince, writeInbox } from './inbox'
import { type ListedSpace as Space, spacesFor } from './spaces/listed'
import { keepReminders } from './push/reminders'
import type { Env } from './types'

const BY = 'connector'

export function homeSpace<T extends Pick<Space, 'role' | 'shared'>>(
  spaces: readonly T[],
): T | null {
  const mine = spaces.filter((one) => one.role !== 'read')
  return (
    mine.find((one) => one.role === 'owner' && !one.shared) ??
    mine.find((one) => one.role === 'owner') ??
    mine[0] ??
    null
  )
}

async function inboxItems(env: Env, userId: string): Promise<Item[]> {
  const out: Item[] = []
  for (let since = 0; ;) {
    const page = await inboxSince(env, userId, since)
    out.push(...page.items.map(({ id, fields }) => ({ id, fields })))
    if (!page.more || page.cursor <= since) return out
    since = page.cursor
  }
}

export async function inboxText(env: Env, userId: string): Promise<string> {
  return rendered(await inboxItems(env, userId))
}

const newId = () => `i${crypto.randomUUID().replace(/-/g, '').slice(0, 15)}`

export async function writeInboxText(
  env: Env,
  userId: string,
  markdown: string,
  today: string,
): Promise<string | null> {
  const items = await inboxItems(env, userId)
  const held = new Map(items.map((one) => [one.id, one.fields]))
  const changes = datedChanges(
    (id) => held.get(id),
    changesTo(items, markdown, newId, () => true),
    today,
  )
  const at = Date.now()
  const stamped: InboxChange[] = changes.map((one, count) => ({
    id: one.id,
    fields: one.fields,
    stamps: Object.fromEntries(
      Object.keys(one.fields).map((key) => [key, inboxStamp(at, count, BY)]),
    ),
  }))
  for (let from = 0; from < stamped.length; from += MOST_INBOX_CHANGES) {
    const done = await writeInbox(env, userId, stamped.slice(from, from + MOST_INBOX_CHANGES), BY)
    if (done === 'full') return null
  }
  const after = new Map<string, InboxFields>(held)
  for (const one of changes) after.set(one.id, { ...after.get(one.id), ...one.fields })
  const text = rendered([...after].map(([id, fields]) => ({ id, fields })))
  await keepInboxReminders(env, userId, text)
  return text
}

const inboxNoteId = (userId: string) => `inbox:${userId}`

export async function keepInboxReminders(env: Env, userId: string, text?: string): Promise<void> {
  const home = homeSpace(await spacesFor(env, userId))
  if (!home) return
  const content = text ?? (await inboxText(env, userId))
  await keepReminders(
    env,
    { id: inboxNoteId(userId), space_id: home.id, path: ACCOUNT_INBOX },
    content,
  ).catch(() => undefined)
}
