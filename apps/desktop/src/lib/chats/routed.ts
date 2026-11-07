import type { Chats, ChatView, Draft } from './api'
import type { Remote } from './remote.svelte'
import { isRemote } from './remotes'

const notHere = () => Promise.reject(new Error('that chat is not connected'))

export function routed(base: Chats, find: (chat: string) => Remote | null): Chats {
  const away = (chat: string) => isRemote(chat)
  const remote = (chat: string): Remote | null => (away(chat) ? find(chat) : null)
  return {
    get list() {
      return base.list
    },
    get ready() {
      return base.ready
    },
    get me() {
      return base.me
    },
    get receipts() {
      return base.receipts
    },
    set receipts(on: boolean) {
      base.receipts = on
    },
    get fileEpoch() {
      return base.fileEpoch
    },
    watch: (listener) => base.watch(listener),
    heard: (listener) => base.heard(listener),
    entry: (chat) => (away(chat) ? (find(chat)?.entry(chat) ?? null) : base.entry(chat)),
    message: (chat, id) =>
      away(chat) ? Promise.resolve(find(chat)?.message(chat, id) ?? null) : base.message(chat, id),
    markRead: (chat, seq) => {
      if (!away(chat)) return base.markRead(chat, seq)
      const found = find(chat)
      const conversation = found?.conversationIn(chat)
      if (found && conversation) found.read(conversation, seq)
      return Promise.resolve()
    },
    open: (chat): ChatView => {
      if (!away(chat)) return base.open(chat)
      const found = find(chat)
      if (!found) throw new Error('that chat is not connected')
      return found.open(chat)
    },
    send: (chat, event) => (away(chat) ? notHere() : base.send(chat, event)),
    post: (chat, draft: Draft) =>
      away(chat) ? (remote(chat)?.post(chat, draft) ?? notHere()) : base.post(chat, draft),
    schedule: (chat, draft, sendAt) =>
      away(chat) ? notHere() : base.schedule(chat, draft, sendAt),
    scheduled: (chat) => (away(chat) ? Promise.resolve([]) : base.scheduled(chat)),
    edit: (chat, message, body, files) =>
      away(chat)
        ? (remote(chat)?.edit(chat, message, body) ?? notHere())
        : base.edit(chat, message, body, files),
    remove: (chat, message, everyone) =>
      away(chat)
        ? (remote(chat)?.remove(chat, message, everyone) ?? notHere())
        : base.remove(chat, message),
    react: (chat, message, emoji, on) =>
      away(chat)
        ? (remote(chat)?.react(chat, message, emoji, on) ?? notHere())
        : base.react(chat, message, emoji, on),
    pin: (chat, message, on) =>
      away(chat)
        ? (remote(chat)?.pin(chat, message, on) ?? notHere())
        : base.pin(chat, message, on),
    vote: (chat, message, answers) =>
      away(chat)
        ? (remote(chat)?.vote(chat, message, answers) ?? notHere())
        : base.vote(chat, message, answers),
    setMeta: (chat, meta) =>
      away(chat)
        ? meta.topic !== undefined
          ? (remote(chat)?.describe(chat, meta.topic) ?? notHere())
          : Promise.resolve()
        : base.setMeta(chat, meta),
    unsend: (chat) => (away(chat) ? Promise.resolve(null) : base.unsend(chat)),
    retry: (chat, message) =>
      away(chat) ? (remote(chat)?.retry(chat, message) ?? notHere()) : base.retry(chat, message),
    discard: (chat, message) => {
      if (!away(chat)) return base.discard(chat, message)
      remote(chat)?.discard(chat, message)
      return Promise.resolve()
    },
    notifyFor: (chat, notify, mutedUntil) =>
      away(chat)
        ? (remote(chat)?.notifyFor(chat, notify, mutedUntil) ?? notHere())
        : base.notifyFor(chat, notify, mutedUntil),
    members: (chat) =>
      away(chat) ? (remote(chat)?.members(chat) ?? Promise.resolve([])) : base.members(chat),
    search: (query, chat) =>
      chat !== undefined && away(chat)
        ? (remote(chat)?.search(query, chat) ?? Promise.resolve([]))
        : base.search(query, chat),
    parse: (query) => base.parse(query),
    linking: (names) => base.linking(names),
    history: (chat, ask) =>
      away(chat)
        ? (remote(chat)?.history(chat, ask) ?? Promise.resolve([]))
        : base.history(chat, ask),
    draft: (chat) => base.draft(chat),
    keepDraft: (chat, text) => base.keepDraft(chat, text),
    offer: (chat, text, more) => base.offer(chat, text, more),
    offers: (listener) => base.offers(listener),
    takeOffer: (chat, parent) => base.takeOffer(chat, parent),
    noteReach: (chat, path) => (away(chat) ? Promise.resolve(null) : base.noteReach(chat, path)),
    shareNote: (chat, path) => (away(chat) ? Promise.resolve(false) : base.shareNote(chat, path)),
    upload: (bytes, chat) => {
      if (chat === undefined || !away(chat)) return base.upload(bytes)
      const found = find(chat)
      return Promise.resolve(found ? found.upload(bytes) : null)
    },
    fileUrl: (chat, hash) =>
      away(chat)
        ? (remote(chat)?.fileUrl(chat, hash) ?? Promise.resolve(null))
        : base.fileUrl(chat, hash),
    preview: (url) => base.preview(url),
    make: (folder, name) => base.make(folder, name),
    chatAt: (path) => base.chatAt(path),
  }
}
