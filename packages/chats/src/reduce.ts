import type { FileRef, Logged, Message, Meta, Placed, Post, Who, Wording } from './types'

type LoggedPost = Post & Placed

interface Register<T> {
  seq: number
  value: T
}

interface Version {
  seq: number
  at: number
  author: Who
  body: string
  files?: FileRef[]
}

interface Marks {
  post?: LoggedPost
  edits: Map<number, Version>
  deleted: boolean
  pin?: Register<boolean>
  reactions: Map<string, Register<boolean> & { emoji: string; who: Who }>
  votes: Map<Who, Register<number[]> & { at: number }>
  children: Set<string>
}

export interface ChatState {
  readonly messages: Map<string, Message>
  meta: Meta
  seq: number
  readonly marks: Map<string, Marks>
  readonly metaSeqs: Record<keyof Meta, number>
}

export function chatState(): ChatState {
  return {
    messages: new Map(),
    meta: { topic: '', posting: 'writers', slowmode: 0 },
    seq: 0,
    marks: new Map(),
    metaSeqs: { topic: 0, posting: 0, slowmode: 0 },
  }
}

export function apply(state: ChatState, event: Logged): Message[] {
  state.seq = Math.max(state.seq, event.seq)
  switch (event.kind) {
    case 'post':
      return posted(state, event)
    case 'edit': {
      const version: Version = {
        seq: event.seq,
        at: event.at,
        author: event.author,
        body: event.body,
      }
      if (event.files) version.files = event.files
      marksOf(state, event.target).edits.set(event.seq, version)
      return rebuilt(state, [event.target])
    }
    case 'delete': {
      const marks = marksOf(state, event.target)
      marks.deleted = true
      return rebuilt(state, [event.target, marks.post?.parent])
    }
    case 'react': {
      const { reactions } = marksOf(state, event.target)
      const key = `${event.emoji}\u0000${event.author}`
      if (newer(reactions.get(key), event.seq)) {
        reactions.set(key, {
          seq: event.seq,
          value: event.on,
          emoji: event.emoji,
          who: event.author,
        })
      }
      return rebuilt(state, [event.target])
    }
    case 'pin': {
      const marks = marksOf(state, event.target)
      if (newer(marks.pin, event.seq)) marks.pin = { seq: event.seq, value: event.on }
      return rebuilt(state, [event.target])
    }
    case 'vote': {
      const { votes } = marksOf(state, event.target)
      if (newer(votes.get(event.author), event.seq)) {
        votes.set(event.author, { seq: event.seq, value: event.answers, at: event.at })
      }
      return rebuilt(state, [event.target])
    }
    case 'meta':
      metaSet(state, event.seq, 'topic', event.topic)
      metaSet(state, event.seq, 'posting', event.posting)
      metaSet(state, event.seq, 'slowmode', event.slowmode)
      return []
    case 'schedule':
      return []
  }
}

function posted(state: ChatState, event: LoggedPost): Message[] {
  const marks = marksOf(state, event.message)
  const before = marks.post
  if (before && before.seq <= event.seq) return []
  marks.post = event
  if (event.parent !== undefined) marksOf(state, event.parent).children.add(event.message)
  return rebuilt(state, [event.message, event.parent, before?.parent])
}

function metaSet<K extends keyof Meta>(
  state: ChatState,
  seq: number,
  key: K,
  value: Meta[K] | undefined,
) {
  if (value === undefined || state.metaSeqs[key] >= seq) return
  state.metaSeqs[key] = seq
  state.meta[key] = value
}

function newer(register: Register<unknown> | undefined, seq: number): boolean {
  return register === undefined || register.seq < seq
}

function marksOf(state: ChatState, id: string): Marks {
  let marks = state.marks.get(id)
  if (!marks) {
    marks = {
      edits: new Map(),
      deleted: false,
      reactions: new Map(),
      votes: new Map(),
      children: new Set(),
    }
    state.marks.set(id, marks)
  }
  return marks
}

function rebuilt(state: ChatState, ids: readonly (string | undefined)[]): Message[] {
  const out: Message[] = []
  for (const id of new Set(ids)) {
    if (id === undefined) continue
    const message = built(state, id)
    if (!message) continue
    state.messages.set(id, message)
    out.push(message)
  }
  return out
}

function built(state: ChatState, id: string): Message | null {
  const marks = state.marks.get(id)
  const post = marks?.post
  if (!marks || !post) return null

  const message: Message = {
    id,
    seq: post.seq,
    at: post.at,
    author: post.author,
    body: '',
    alsoToChat: post.alsoToChat === true,
    files: [],
    mentions: [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: marks.deleted,
    replies: 0,
  }
  if (post.parent !== undefined) message.parent = post.parent
  repliesOf(state, id, message)
  if (marks.deleted) return message

  const versions = wordings(post, marks)
  const current = versions.at(-1) ?? post
  message.body = current.body
  message.files = filesOf(versions, post)
  message.mentions = post.mentions ?? []
  message.reactions = reactionsOf(marks)
  message.pinned = marks.pin?.value === true
  message.history = historyOf(post, versions)
  if (versions.length > 0) message.editedAt = current.at
  if (post.quote !== undefined) message.quote = post.quote
  if (post.preview) message.preview = post.preview
  if (post.via) message.via = post.via
  if (post.poll) message.poll = { ...post.poll, votes: votesOf(post, marks) }
  return message
}

function wordings(post: LoggedPost, marks: Marks): Version[] {
  return [...marks.edits.values()]
    .filter((edit) => edit.author === post.author && edit.seq > post.seq)
    .sort((a, b) => a.seq - b.seq)
}

function filesOf(versions: readonly Version[], post: LoggedPost): FileRef[] {
  let files = post.files ?? []
  for (const version of versions) if (version.files) files = version.files
  return files
}

function historyOf(post: LoggedPost, versions: readonly Version[]): Wording[] {
  if (versions.length === 0) return []
  const earlier = [{ body: post.body, at: post.at }, ...versions.slice(0, -1)]
  return earlier.map((one) => ({ body: one.body, at: one.at }))
}

function reactionsOf(marks: Marks): Record<string, Who[]> {
  const reactions = new Map<string, Who[]>()
  const on = [...marks.reactions.values()].filter((one) => one.value).sort((a, b) => a.seq - b.seq)
  for (const one of on) reactions.set(one.emoji, [...(reactions.get(one.emoji) ?? []), one.who])
  return Object.fromEntries(reactions)
}

function votesOf(post: LoggedPost, marks: Marks): Record<Who, number[]> {
  const poll = post.poll
  const votes: Record<Who, number[]> = {}
  if (!poll) return votes
  const standing = [...marks.votes.entries()].sort(([, a], [, b]) => a.seq - b.seq)
  for (const [who, vote] of standing) {
    const answers = [...new Set(vote.value)].sort((a, b) => a - b)
    if (answers.length === 0 || answers.length !== vote.value.length) continue
    if (!poll.several && answers.length > 1) continue
    if (
      answers.some(
        (answer) => !Number.isInteger(answer) || answer < 0 || answer >= poll.answers.length,
      )
    )
      continue
    if (poll.ends !== undefined && vote.at > poll.ends) continue
    votes[who] = answers
  }
  return votes
}

function repliesOf(state: ChatState, id: string, message: Message) {
  const marks = state.marks.get(id)
  if (!marks) return
  for (const child of marks.children) {
    const reply = state.marks.get(child)
    const post = reply?.post
    if (!reply || !post || reply.deleted || post.parent !== id) continue
    message.replies += 1
    message.lastReplyAt = Math.max(message.lastReplyAt ?? post.at, post.at)
  }
}
