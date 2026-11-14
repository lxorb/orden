import type { Message, Who } from '@orden/chats'
import { GROUP_WITHIN } from '@orden/chats/limits'

export type Item<M extends Message = Message> =
  | { kind: 'day'; key: string; day: string; at: number }
  | { kind: 'new'; key: 'new' }
  | {
      kind: 'message'
      key: string
      message: M
      head: boolean
      pending: boolean
      seen: Who[]
    }

export interface Rowing<M extends Message = Message> {
  messages: readonly M[]
  outbox: readonly M[]
  me: Who | null
  readAtOpen: number | null
  dayOf: (at: number) => string
  reads: ReadonlyMap<Who, number>
}

function shown(message: Message): boolean {
  return !message.deleted || message.replies > 0
}

export function rowsOf<M extends Message>(rowing: Rowing<M>): Item<M>[] {
  const { me, readAtOpen, dayOf } = rowing
  const items: Item<M>[] = []
  const placed = rowing.messages.filter(shown)
  const seen = seenAt(placed, rowing.reads, me)

  let lastDay: string | null = null
  let previous: M | null = null
  let lined = readAtOpen === null

  const add = (message: M, pending: boolean) => {
    const day = dayOf(message.at)
    let head = previous === null || startsGroup(previous, message)
    if (day !== lastDay) {
      items.push({ kind: 'day', key: `day:${day}`, day, at: message.at })
      lastDay = day
      head = true
    }
    if (!lined && !pending && message.author !== me && message.seq > (readAtOpen ?? 0)) {
      items.push({ kind: 'new', key: 'new' })
      lined = true
      head = true
    }
    items.push({
      kind: 'message',
      key: message.id,
      message,
      head,
      pending,
      seen: pending ? [] : (seen.get(message.id) ?? []),
    })
    previous = message
  }

  for (const message of placed) add(message, false)
  for (const message of rowing.outbox) add(message, true)
  return items
}

function startsGroup(previous: Message, next: Message): boolean {
  return (
    previous.author !== next.author ||
    next.at - previous.at > GROUP_WITHIN ||
    (previous.via?.agent ?? null) !== (next.via?.agent ?? null) ||
    previous.deleted ||
    next.deleted
  )
}

function seenAt(
  messages: readonly Message[],
  reads: ReadonlyMap<Who, number>,
  me: Who | null,
): Map<string, Who[]> {
  const out = new Map<string, Who[]>()
  if (reads.size === 0 || messages.length === 0) return out
  const order = [...reads].filter(([who]) => who !== me).sort(([, a], [, b]) => a - b)
  for (const [who, seq] of order) {
    const at = lastAtOrBefore(messages, seq)
    if (at === -1) continue
    const id = messages[at]?.id
    if (id === undefined) continue
    const list = out.get(id) ?? []
    list.push(who)
    out.set(id, list)
  }
  return out
}

function lastAtOrBefore(messages: readonly Message[], seq: number): number {
  let low = 0
  let high = messages.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((messages[middle]?.seq ?? Infinity) <= seq) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }
  return found
}
