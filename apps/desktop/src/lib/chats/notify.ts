import type { Message, Notify, Who } from '@orden/chats'
import { decide, type Hush } from '@orden/chats/notify'
import type { Notice } from '../notify'

export interface Told {
  place: string | null
  members: number
  notify: Notify | null
  mutedUntil: number | null
  readSeq: number
}

export interface Chosen extends Hush {
  previews: boolean
  sound: boolean
}

export interface Words {
  hidden: string
  reply: string
  send: string
}

export interface NoticeWorld {
  me(): Who | null
  chat(chat: string): Promise<Told | null>
  authorOf(chat: string, message: string): Promise<Who | null>
  nameOf(chat: string, who: Who): Promise<string>
  chosen(): Chosen
  active(): boolean
  seen(chat: string): boolean
  now(): number
  show(notice: Notice): void
  unshow(tag: string): void
  open(chat: string, message: string): void
  reply(chat: string, body: string, parent?: string): Promise<void>
  read(chat: string, seq: number): void
}

const LONGEST_LINE = 200

export function lineOf(message: Message): string {
  const first = message.body
    .split('\n')
    .map((line) =>
      line
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/(\*\*|__|~~|\|\||`)/g, '')
        .trim(),
    )
    .find(Boolean)
  const line = first ?? message.poll?.question ?? message.files[0]?.name ?? ''
  return line.length > LONGEST_LINE ? `${line.slice(0, LONGEST_LINE - 1)}…` : line
}

export class ChatNotices {
  private readonly told = new Map<string, number>()
  private readonly showing = new Map<string, number>()
  private readonly turns = new Map<string, Promise<void>>()

  constructor(
    private readonly world: NoticeWorld,
    private readonly words: () => Words,
  ) {}

  arrived(chat: string, messages: readonly Message[]): void {
    this.turn(chat, async () => {
      const told = await this.world.chat(chat)
      if (told) await this.tell(chat, told, messages)
    })
  }

  read(chat: string, seq: number): void {
    this.keep(chat, seq)
    const shown = this.showing.get(chat)
    if (shown !== undefined && shown <= seq) {
      this.showing.delete(chat)
      this.world.unshow(chat)
    }
  }

  private keep(chat: string, seq: number): void {
    this.told.set(chat, Math.max(this.told.get(chat) ?? 0, seq))
  }

  private turn(chat: string, work: () => Promise<void>): void {
    const next = (this.turns.get(chat) ?? Promise.resolve()).then(work).catch(() => {
      // A message whose people could not be asked about is not told: the chat's count
      // still moves, and the next message is decided as ever.
    })
    this.turns.set(chat, next)
    void next.then(() => {
      if (this.turns.get(chat) === next) this.turns.delete(chat)
    })
  }

  private async tell(id: string, chat: Told, messages: readonly Message[]): Promise<void> {
    const decided = this.told.get(id) ?? 0
    const fresh = messages
      .filter((one) => one.seq > Math.max(decided, chat.readSeq) && !one.deleted)
      .sort((a, b) => b.seq - a.seq)
    const newest = fresh[0]
    if (!newest) return
    this.keep(id, newest.seq)

    const me = this.world.me()
    if (!me) return
    const chosen = this.world.chosen()
    const now = this.world.now()
    const local = new Date(now)
    const moment = { now, day: local.getDay(), minute: local.getHours() * 60 + local.getMinutes() }
    const seen = this.world.seen(id)
    const active = this.world.active()

    for (const message of fresh) {
      const repliesTo = message.parent ? await this.world.authorOf(id, message.parent) : null
      const ping = decide({
        me,
        message: {
          author: message.author,
          body: message.body,
          mentions: message.mentions,
          repliesTo,
        },
        chat,
        hush: chosen,
        moment,
        active,
        seen,
      })
      if (ping === 'show') {
        await this.show(id, chat, message, chosen)
        return
      }
      if (ping !== 'level') return
    }
  }

  private async show(id: string, chat: Told, message: Message, chosen: Chosen): Promise<void> {
    const words = this.words()
    const name = chosen.previews ? await this.world.nameOf(id, message.author) : ''
    this.showing.set(id, message.seq)
    this.world.show({
      title: chosen.previews ? name : words.hidden,
      body: chosen.previews ? lineOf(message) : '',
      tag: id,
      from: chosen.previews ? (chat.place ?? '') : '',
      silent: !chosen.sound,
      opened: () => this.world.open(id, message.id),
      reply: {
        placeholder: words.reply,
        send: words.send,
        replied: (text) => void this.answer(id, message, text),
      },
    })
  }

  private async answer(id: string, message: Message, text: string): Promise<void> {
    await this.world.reply(id, text.trim(), message.parent)
    this.world.read(id, message.seq)
    this.read(id, message.seq)
  }
}
