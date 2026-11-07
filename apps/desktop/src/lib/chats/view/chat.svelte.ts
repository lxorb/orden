import type { FileRef, Member, Message, Poll, Preview, Who } from '@orden/chats'
import { chatLink } from '@orden/chats/links'
import { copyText } from '../../clipboard'
import { t } from '../../i18n.svelte'
import { paletteWords } from '../../surfaces.svelte'
import type { ChatAbilities, ChatEntry, ChatView, Service, Shown } from '../api'
import { trimmed } from './compose'
import { type Item, rowsOf } from './rows'
import { saved } from './saved.svelte'
import { store } from './source.svelte'
import { dayOf } from './when'

export const ORDEN_CAN: ChatAbilities = {
  files: true,
  maxFile: null,
  voice: true,
  polls: true,
  quote: true,
  threads: true,
  react: 'any',
  editFor: Infinity,
  removeFor: Infinity,
  removeForMe: false,
  pin: true,
  vote: true,
  markUnread: true,
  members: true,
  topic: true,
  mute: true,
  search: true,
  link: true,
  schedule: true,
  unsend: true,
  nib: true,
  stickers: false,
  gifs: false,
  formatting: 'markdown',
}

export type Aside = { kind: 'quote'; message: Message } | { kind: 'edit'; message: Message } | null

export class ChatPage {
  readonly id: string
  readonly view: ChatView
  replying = $state<string | null>(null)
  aside = $state<Aside>(null)
  flashed = $state<string | null>(null)

  constructor(id: string) {
    this.id = id
    this.view = store().open(id)
  }

  get me(): Who | null {
    const own = this.view.me
    return own === undefined ? store().me : own
  }

  get can(): ChatAbilities {
    return this.view.can ?? ORDEN_CAN
  }

  get service(): Service | null {
    return this.view.service ?? null
  }

  mayEdit(message: Message): boolean {
    const window = this.can.editFor
    return window !== null && Date.now() - message.at <= window
  }

  mayRemoveForAll(message: Message): boolean {
    const window = this.can.removeFor
    if (window === null) return false
    return this.me !== null && message.author === this.me ? Date.now() - message.at <= window : true
  }

  get entry(): ChatEntry | null {
    return this.view.entry
  }

  get messages(): readonly Shown[] {
    return this.view.messages
  }

  get before(): boolean {
    return !this.view.atStart
  }

  get after(): boolean {
    return !this.view.atEnd
  }

  readonly members: Member[] = $derived.by(() =>
    this.view.members.map((one) => ({ who: one.who, name: one.name ?? t('Deleted account') })),
  )

  get ready(): boolean {
    return !this.view.loading || this.view.messages.length > 0
  }

  readonly items: Item<Shown>[] = $derived.by(() =>
    rowsOf({
      messages: this.view.messages,
      outbox: this.view.pending,
      me: this.me,
      readAtOpen: this.view.lineAt,
      dayOf,
      reads: this.view.presence.reads,
    }),
  )

  older(): Promise<void> {
    return this.view.atStart ? Promise.resolve() : this.view.older()
  }

  newer(): Promise<void> {
    return this.view.atEnd ? Promise.resolve() : this.view.newer()
  }

  async jump(message: string): Promise<void> {
    if (!this.view.messages.some((one) => one.id === message)) {
      if (!(await this.view.jump(message))) return
    }
    this.flashed = message
  }

  bottom(): Promise<void> {
    return this.view.atEnd ? Promise.resolve() : this.view.latest()
  }

  seen(seq: number): void {
    const entry = this.entry
    if (!entry || seq > entry.readSeq) this.view.read(seq)
  }

  markUnread(message: Message): void {
    this.view.markUnread(message.seq)
  }

  post(
    text: string,
    more: {
      parent?: string
      alsoToChat?: boolean
      files?: FileRef[]
      poll?: Poll
      preview?: Preview
    } = {},
  ): void {
    const body = trimmed(text)
    if (!body && !more.files?.length && !more.poll) return
    const quote = this.aside?.kind === 'quote' && !more.parent ? this.aside.message.id : undefined
    void store().post(this.id, {
      body,
      ...(quote ? { quote } : {}),
      ...(more.parent ? { parent: more.parent } : {}),
      ...(more.alsoToChat ? { alsoToChat: true } : {}),
      ...(more.files?.length ? { files: more.files } : {}),
      ...(more.poll ? { poll: more.poll } : {}),
      ...(more.preview ? { preview: more.preview } : {}),
    })
    if (!more.parent) this.aside = null
  }

  schedule(text: string, sendAt: number): void {
    const body = trimmed(text)
    if (body) void store().schedule(this.id, { body }, sendAt)
  }

  unsend(): Promise<string | null> {
    return store().unsend(this.id)
  }

  edit(message: Message, text: string): void {
    const body = trimmed(text)
    if (body === message.body) return
    if (!body) this.remove(message.id)
    else void store().edit(this.id, message.id, body)
  }

  remove(message: string, everyone?: boolean): void {
    if (everyone === undefined) void store().remove(this.id, message)
    else void store().remove(this.id, message, everyone)
  }

  sticker(ref: string): void {
    void store().post(this.id, { body: '', sticker: ref })
  }

  react(message: Message, emoji: string): void {
    const me = this.me
    const on = !(me && message.reactions[emoji]?.includes(me))
    void store().react(this.id, message.id, emoji, on)
  }

  pin(message: Message): void {
    void store().pin(this.id, message.id, !message.pinned)
  }

  vote(message: Message, answers: number[]): void {
    void store().vote(this.id, message.id, answers)
  }

  topic(topic: string): void {
    void store().setMeta(this.id, { topic })
  }

  retry(message: string): void {
    void store().retry(this.id, message)
  }

  discard(message: string): void {
    void store().discard(this.id, message)
  }

  save(message: Message): void {
    saved.toggle(this.id, message)
  }

  addAsTask(message: Message): void {
    void import('./keep').then((keep) =>
      keep.addAsTask(this, message, this.service ? null : (this.entry?.space ?? null)),
    )
  }

  async saveAsNote(message: Message): Promise<void> {
    const keep = await import('./keep')
    await keep.saveAsNote(this, message, this.service ? null : (this.entry?.space ?? null))
  }

  isSaved(message: Message): boolean {
    return saved.has(this.id, message.id)
  }

  search(): void {
    const name = this.entry?.name ?? ''
    paletteWords.words = /[\s"]/.test(name) ? `in:"${name.replace(/"/g, '')}" ` : `in:#${name} `
  }

  copyLink(message: Message): Promise<void> {
    return copyText(chatLink(this.id, message.id))
  }

  async pinned(): Promise<Message[]> {
    if (this.service) return this.messages.filter((one) => one.pinned && !one.deleted)
    const found = await store().search('has:pin', this.id)
    return found.map((one) => one.message)
  }

  lastOwn(): Message | null {
    const me = this.me
    for (let at = this.messages.length - 1; at >= 0; at--) {
      const one = this.messages[at]
      if (one?.author === me && !one.deleted && !one.poll) return this.mayEdit(one) ? one : null
    }
    return null
  }

  close(): void {
    this.view.close()
  }
}
