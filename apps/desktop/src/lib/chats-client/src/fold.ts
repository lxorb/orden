import type { Logged, Message, Who } from '@orden/chats'

export interface Marks {
  r: [string, Who, number][]
  v: [Who, number][]
}

export interface Kept {
  message: Message
  upto: number
  marks: Marks
}

export interface Lookup {
  get(id: string): Promise<Kept | undefined>
  newestReply(parent: string, except: ReadonlySet<string>): Promise<Message | undefined>
}

export interface Folded {
  kept: Map<string, Kept>
  gone: Set<string>
  seq: number
}

export function marksOf(message: Message, upto: number): Marks {
  const r: [string, Who, number][] = []
  for (const [emoji, people] of Object.entries(message.reactions)) {
    for (const who of people) r.push([emoji, who, upto])
  }
  const v = Object.keys(message.poll?.votes ?? {}).map((who): [Who, number] => [who as Who, upto])
  return { r, v }
}

export function keepsRow(message: Message): boolean {
  return !message.deleted || message.replies > 0
}

export async function foldAll(
  events: readonly Logged[],
  lookup: Lookup,
  since: number,
): Promise<Folded> {
  const kept = new Map<string, Kept>()
  const gone = new Set<string>()
  let seq = since
  const read: Lookup = {
    get: async (id) => (gone.has(id) ? undefined : (kept.get(id) ?? (await lookup.get(id)))),
    newestReply: async (parent, except) => {
      const here = [...kept.values()]
        .map((one) => one.message)
        .filter((one) => one.parent === parent)
      const passed = new Set([...except, ...gone, ...here.map((one) => one.id)])
      const there = await lookup.newestReply(parent, passed)
      return [
        ...here.filter((one) => !one.deleted && !except.has(one.id)),
        ...(there ? [there] : []),
      ].sort((a, b) => b.seq - a.seq)[0]
    },
  }
  for (const event of events) {
    if (event.seq <= seq) continue
    seq = event.seq
    for (const one of await fold(event, read)) {
      if (keepsRow(one.message)) {
        kept.set(one.message.id, one)
        gone.delete(one.message.id)
      } else {
        kept.delete(one.message.id)
        gone.add(one.message.id)
      }
    }
  }
  return { kept, gone, seq }
}

export async function fold(event: Logged, lookup: Lookup): Promise<Kept[]> {
  switch (event.kind) {
    case 'post': {
      if (await lookup.get(event.message)) return []
      const message: Message = {
        id: event.message,
        seq: event.seq,
        at: event.at,
        author: event.author,
        body: event.body,
        alsoToChat: event.alsoToChat === true,
        files: event.files ?? [],
        mentions: event.mentions ?? [],
        reactions: {},
        pinned: false,
        history: [],
        deleted: false,
        replies: 0,
      }
      if (event.parent !== undefined) message.parent = event.parent
      if (event.quote !== undefined) message.quote = event.quote
      if (event.preview) message.preview = event.preview
      if (event.via) message.via = event.via
      if (event.poll) message.poll = { ...event.poll, votes: {} }
      const out: Kept[] = [{ message, upto: event.seq, marks: { r: [], v: [] } }]

      const parent =
        event.parent === undefined ? undefined : await fresh(lookup, event.parent, event)
      if (parent) {
        const was = parent.message
        out.push({
          ...parent,
          upto: event.seq,
          message: {
            ...was,
            replies: was.replies + 1,
            lastReplyAt: Math.max(was.lastReplyAt ?? event.at, event.at),
          },
        })
      }
      return out
    }

    case 'edit': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const was = kept.message
      if (was.deleted || was.author !== event.author || event.seq <= was.seq)
        return [touched(kept, event)]
      const message: Message = {
        ...was,
        body: event.body,
        files: event.files ?? was.files,
        editedAt: event.at,
        history: [...was.history, { body: was.body, at: was.editedAt ?? was.at }],
      }
      return [{ ...kept, upto: event.seq, message }]
    }

    case 'delete': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const was = kept.message
      if (was.deleted) return [touched(kept, event)]
      const message: Message = {
        id: was.id,
        seq: was.seq,
        at: was.at,
        author: was.author,
        body: '',
        alsoToChat: was.alsoToChat,
        files: [],
        mentions: [],
        reactions: {},
        pinned: false,
        history: [],
        deleted: true,
        replies: was.replies,
      }
      if (was.parent !== undefined) message.parent = was.parent
      if (was.lastReplyAt !== undefined) message.lastReplyAt = was.lastReplyAt
      const out: Kept[] = [{ message, upto: event.seq, marks: { r: [], v: [] } }]

      const parent = was.parent === undefined ? undefined : await fresh(lookup, was.parent, event)
      if (parent && was.parent !== undefined) {
        const newest = await lookup.newestReply(was.parent, new Set([was.id]))
        const replies = Math.max(0, parent.message.replies - 1)
        const changed: Message = { ...parent.message, replies }
        if (replies > 0 && newest) changed.lastReplyAt = newest.at
        else delete changed.lastReplyAt
        out.push({ ...parent, upto: event.seq, message: changed })
      }
      return out
    }

    case 'react': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      if (kept.message.deleted) return [touched(kept, event)]
      const r = kept.marks.r.filter(([emoji, who]) => emoji !== event.emoji || who !== event.author)
      if (event.on) r.push([event.emoji, event.author, event.seq])
      const byEmoji = new Map<string, Who[]>()
      for (const [emoji, who] of r) byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), who])
      const reactions = Object.fromEntries(byEmoji)
      return [
        {
          upto: event.seq,
          marks: { ...kept.marks, r },
          message: { ...kept.message, reactions },
        },
      ]
    }

    case 'pin': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      if (kept.message.deleted) return [touched(kept, event)]
      return [{ ...kept, upto: event.seq, message: { ...kept.message, pinned: event.on } }]
    }

    case 'vote': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const poll = kept.message.poll
      if (kept.message.deleted || !poll) return [touched(kept, event)]
      const answers = [...new Set(event.answers)].sort((a, b) => a - b)
      const takes =
        answers.length > 0 &&
        answers.length === event.answers.length &&
        (poll.several || answers.length === 1) &&
        answers.every((one) => Number.isInteger(one) && one >= 0 && one < poll.answers.length) &&
        (poll.ends === undefined || event.at <= poll.ends)

      const v = kept.marks.v.filter(([who]) => who !== event.author)
      const votes: Record<Who, number[]> = {}
      for (const [who] of v) {
        const standing = poll.votes[who]
        if (standing) votes[who] = standing
      }
      if (takes) {
        v.push([event.author, event.seq])
        votes[event.author] = answers
      }
      return [
        {
          upto: event.seq,
          marks: { ...kept.marks, v },
          message: { ...kept.message, poll: { ...poll, votes } },
        },
      ]
    }

    case 'meta':
    case 'schedule':
      return []
  }
}

async function fresh(lookup: Lookup, id: string, event: Logged): Promise<Kept | undefined> {
  const kept = await lookup.get(id)
  return kept && kept.upto < event.seq ? kept : undefined
}

function touched(kept: Kept, event: Logged): Kept {
  return { ...kept, upto: event.seq }
}
