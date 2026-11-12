import { account } from '../account.svelte'
import { show, unshow } from '../notify'
import { deviceActivity } from '../people/here'
import { people } from '../people/people.svelte'
import { residency } from '../reminders/residency.svelte'
import { hub } from '../sync2/hub.svelte'
import { dndUntil, hush } from './hush.svelte'
import { ChatNotices, type NoticeWorld } from './notify'
import { inFront } from './on-screen'
import { chats } from './store.svelte'
import { openChat } from './view/open'

const world: NoticeWorld = {
  me: () => chats.me,

  chat(chat) {
    const entry = chats.entry(chat)
    if (!entry) return Promise.resolve(null)
    const space = account.spaces.find((one) => one.id === entry.space)?.name ?? null
    return Promise.resolve({
      place: entry.name ? `#${entry.name}` : space,
      members: entry.members,
      notify: entry.notify,
      mutedUntil: entry.mutedUntil,
      readSeq: entry.readSeq,
    })
  },

  authorOf: async (chat, message) => (await chats.message(chat, message))?.author ?? null,

  async nameOf(chat, who) {
    const [kind, id] = who.split(':')
    const known = kind === 'user' && id ? people.called(id, chats.entry(chat)?.space) : undefined
    if (known) return known
    return (await chats.members(chat)).find((one) => one.who === who)?.name ?? ''
  },

  chosen: () => ({
    keywords: hush.keywords,
    hours: hush.hours,
    dndUntil: dndUntil(),
    previews: hush.previews,
    sound: hush.sound,
  }),

  active: () => deviceActivity().active,
  seen: inFront,
  now: () => Date.now(),
  show,
  unshow,

  open(chat, message) {
    const path = chats.entry(chat)?.path
    if (path) openChat(path, {}, message)
  },

  async reply(chat, body, parent) {
    await chats.post(chat, { body, ...(parent ? { parent } : {}) })
  },

  read: (chat, seq) => void chats.markRead(chat, seq),
}

const notices = new ChatNotices(world, () => ({
  hidden: 'New message',
  reply: 'Reply',
  send: 'Send',
}))

chats.heard((chat, messages) => {
  if (hub.leads) notices.arrived(chat, messages)
})
chats.watch(() => {
  residency.chats = chats.list.length > 0
  for (const entry of chats.list) notices.read(entry.id, entry.readSeq)
})
