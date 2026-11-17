import type { Logged, Message, Who } from '@orden/chats'
import type { Refusal } from '@orden/chats/wire'
import type { Shown } from './shapes'
import type { OutboxRow } from './cache'
import { fold, type Kept } from './fold'

export type Filter = (message: Message) => boolean

function aboutOf(row: OutboxRow): string[] {
  const event = row.event
  if (event.kind === 'post') return [event.message]
  if (event.kind === 'schedule' || event.kind === 'meta') return []
  return [event.target]
}

export async function overlay(
  placed: readonly Kept[],
  outbox: readonly OutboxRow[],
  me: Who,
  filter: Filter,
): Promise<{ messages: Shown[]; pending: Shown[] }> {
  const known = new Map(placed.map((one) => [one.message.id, one]))
  const posted: string[] = []
  const sending = new Set<string>()
  const refusals = new Map<string, Refusal>()

  let seq = Number.MAX_SAFE_INTEGER - outbox.length - 1
  for (const row of outbox) {
    seq += 1
    for (const id of aboutOf(row)) {
      if (row.refused) {
        if (!refusals.has(id)) refusals.set(id, row.refused)
      } else sending.add(id)
    }
    if (row.refused && row.event.kind !== 'post') continue
    const event = { ...row.event, seq, at: row.madeAt, author: me } as Logged
    const lookup = {
      get: (id: string) => Promise.resolve(known.get(id)),
      newestReply: () => Promise.resolve(undefined),
    }
    for (const one of await fold(event, lookup)) {
      if (event.kind === 'post' && one.message.id === event.message) {
        posted.push(one.message.id)
        one.message = { ...one.message, seq: Number.MAX_SAFE_INTEGER, at: row.madeAt }
      }
      known.set(one.message.id, one)
    }
  }

  const shown = (message: Message): Shown => ({
    ...message,
    sending: sending.has(message.id),
    refused: refusals.get(message.id) ?? null,
  })
  const pendingIds = new Set(posted)
  const messages = placed
    .map((one) => known.get(one.message.id)?.message ?? one.message)
    .filter((message) => !pendingIds.has(message.id) && filter(message))
    .map(shown)
  const pending = posted
    .map((id) => known.get(id)?.message)
    .filter((message): message is Message => message !== undefined && filter(message))
    .filter((message) => !message.deleted)
    .map(shown)
  return { messages, pending }
}
