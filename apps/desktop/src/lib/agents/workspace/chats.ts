import { may, type Message, type Who } from '@orden/chats'
import { chatsText, hitsText, type Listed, messagesText, type Reading } from '@orden/chats/agent'
import { type AgentAnswer, threadSpaceOf } from '../../automation/caller'
import type { ChatEntry, Chats } from '../../chats/api'
import { chatsOn } from '../../settings.svelte'
import { workspace } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, count, done, flag, maybe, need, text } from './call'
import { Refused } from './problem'
import { openChat } from './reader-view'
import { placeFor, reachable } from './spaces'

const MOST_READ = 200
const MOST_FOUND = 50

async function chatsStore(): Promise<Chats> {
  if (!chatsOn()) {
    throw new Refused('not_found', 'chats are off; the user turns them on in Settings')
  }
  const { chats } = await import('../../chats/store.svelte')
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!chats.me) throw new Refused('not_found', 'chats need nib’s account, and nobody is signed in')
  return chats
}

interface Seen {
  entry: ChatEntry
  name: string
  space: string
}

function seenBy(call: Call, store: Chats): Seen[] {
  const spaces = reachable(call)
  return store.list.flatMap((entry) => {
    const space = spaces.find((one) => one.root === entry.root)
    return space && entry.name ? [{ entry, name: entry.name, space: space.name }] : []
  })
}

function chatFor(call: Call, store: Chats): Seen {
  const named = need(call, 'chat')
  const folded = named.replace(/^#/, '').trim().toLowerCase()
  const seen = seenBy(call, store)
  const byName = seen.filter((one) => one.name.toLowerCase() === folded)
  const home = workspace.spaces.find((one) => one.id === threadSpaceOf(call.caller))?.root
  const front = workspace.activeSpace?.root
  const byId = seen.find((one) => one.entry.id === named)
  if (byId) return byId
  const inHome = byName.filter((one) => one.entry.root === home)
  const inFront = home === undefined ? byName.filter((one) => one.entry.root === front) : []
  const fitting = inHome.length ? inHome : inFront.length ? inFront : byName
  const [found, ...others] = fitting
  if (!found)
    throw new Refused('not_found', `there is no chat called ${named}: list_chats names them`)
  if (others.length) {
    const ids = fitting.map((one) => `${one.entry.id} in ${one.space}`).join(', ')
    throw new Refused(
      'ambiguous',
      `${String(fitting.length)} chats are called ${named}: ${ids}. Name one by its id`,
    )
  }
  return found
}

async function readingOf(store: Chats, chats: readonly string[]): Promise<Reading> {
  const names = new Map<Who, string>()
  for (const chat of chats) {
    for (const member of await store.members(chat).catch(() => [])) {
      names.set(member.who, member.name ?? 'Deleted account')
    }
  }
  return { me: store.me, nameOf: (who) => names.get(who) ?? who }
}

export async function listChats(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const space = maybe(call, 'space')
  const only = space === null ? null : placeFor(call, space).space.name
  const listed: Listed[] = seenBy(call, store)
    .filter((one) => only === null || one.space === only)
    .filter((one) => !flag(call, 'unread') || one.entry.unread > 0 || one.entry.mentions > 0)
    .map(({ entry, name, space: where }) => ({
      id: entry.id,
      name,
      space: where,
      members: entry.members,
      unread: entry.unread,
      mentions: entry.mentions,
      lastAt: entry.lastAt,
    }))
  return done(chatsText(listed))
}

async function seqOf(store: Chats, chat: Seen, message: string): Promise<number> {
  const [found] = await store.history(chat.entry.id, { around: message, limit: 1 })
  if (!found) throw new Refused('not_found', `#${chat.name} has no message ${message}`)
  return found.seq
}

export async function readChat(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const limit = count(call, 'limit', 50, MOST_READ)
  const parent = maybe(call, 'replies_of')
  const around = maybe(call, 'around')
  const before = maybe(call, 'before')
  const after = maybe(call, 'after')
  const id = chat.entry.id

  let messages: Message[]
  if (around !== null) {
    messages = await store.history(id, { around, limit })
    if (!messages.length) throw new Refused('not_found', `#${chat.name} has no message ${around}`)
  } else {
    messages = await store.history(id, {
      limit,
      ...(parent !== null ? { parent } : {}),
      ...(before !== null ? { before: await seqOf(store, chat, before) } : {}),
      ...(after !== null ? { after: await seqOf(store, chat, after) } : {}),
    })
  }
  return done(messagesText(chat.name, messages, await readingOf(store, [id])))
}

export async function searchChats(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const query = need(call, 'query')
  const seen = new Map(seenBy(call, store).map((one) => [one.entry.id, one.name]))
  const hits = (await store.search(query))
    .flatMap((hit) => {
      const name = seen.get(hit.chat)
      return name === undefined ? [] : [{ chat: name, id: hit.chat, message: hit.message }]
    })
    .slice(0, count(call, 'limit', 20, MOST_FOUND))
  const reading = await readingOf(store, [...new Set(hits.map((one) => one.id))])
  return done(hitsText(hits, reading))
}

function mayPost(chat: Seen): void {
  if (!may(chat.entry.role, 'post', chat.entry.meta.posting)) {
    throw new Refused('read_only', `the reader may only read #${chat.name}`)
  }
}

function askFirst(call: Call, chat: Seen, summary: string): Promise<AgentAnswer | null> {
  if (chat.entry.members <= 1) return Promise.resolve(null)
  return asked(call, 'publishing', summary, `chat:${chat.entry.id}`)
}

function viaOf(call: Call): { via: { agent: string } } | Record<string, never> {
  const agent = call.caller.agent
  return agent ? { via: { agent: agent.name } } : {}
}

export async function draftMessage(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const words = text(call, 'text') ?? ''
  if (!words.trim()) throw new Refused('bad_arguments', 'say text')
  mayPost(chat)
  const parent = maybe(call, 'reply_to') ?? undefined
  if (chat.entry.path) {
    await openChat(chat.entry.path)
  }
  store.offer(chat.entry.id, words, parent ? { parent } : {})
  return done(`Drafted in #${chat.name}. The reader sends it.`)
}

export async function postMessage(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const words = text(call, 'text') ?? ''
  if (!words.trim()) throw new Refused('bad_arguments', 'say text')
  mayPost(chat)
  const parent = maybe(call, 'reply_to')
  const quote = maybe(call, 'quote')

  const question = await askFirst(call, chat, `#${chat.name}: ${words}`)
  if (question) return question

  const id = await store.post(chat.entry.id, {
    body: words,
    ...(parent !== null ? { parent } : {}),
    ...(quote !== null ? { quote } : {}),
    ...viaOf(call),
  })
  return done(`Posted in #${chat.name} as ${id}.`)
}

export async function react(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const message = need(call, 'message')
  const emoji = need(call, 'emoji')
  const on = call.args.on === undefined ? true : flag(call, 'on')
  mayPost(chat)
  await seqOf(store, chat, message)

  const question = await askFirst(call, chat, `#${chat.name}: ${emoji} ${on ? '+' : '-'}`)
  if (question) return question

  await store.react(chat.entry.id, message, emoji, on)
  return done(`${on ? 'Reacted' : 'Took back'} ${emoji} on ${message} in #${chat.name}.`)
}
