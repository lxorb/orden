import { chatLinkOf } from '@orden/chats/links'
import { chatPushLinkOf } from '@orden/chats/push'
import { keep, openExternal, storedText } from '../../platform/src/api'

export const WIDE = 600
const SPACE = 'orden:chat-space'
interface Listed {
  id: string
  space: string
}
export class ChatNav {
  space = $state<string | null>(storedText(SPACE))
  chat = $state<string | null>(null)
  message = $state<string | null>(null)
  get deep(): boolean {
    return this.chat !== null
  }
  show(space: string): void {
    if (space === this.space) return
    this.space = space
    this.chat = null
    this.message = null
    keep(SPACE, space)
  }
  settle(spaces: readonly string[]): void {
    if (this.space !== null && spaces.includes(this.space)) return
    const first = spaces[0]
    if (first !== undefined) this.show(first)
  }
  open(chat: string, space: string | null = null, message: string | null = null): void {
    if (space !== null) this.show(space)
    this.chat = chat
    this.message = message
  }
  back(): boolean {
    if (this.chat === null) return false
    this.chat = null
    this.message = null
    return true
  }
  follow(href: string, chats: readonly Listed[]): boolean {
    const link = chatPushLinkOf(href) ?? chatLinkOf(href)
    if (!link) return false
    const held = chats.find((one) => one.id === link.chat)
    if (held) this.open(held.id, held.space, link.message ?? null)
    return held !== undefined
  }
}
export function hostFor(nav: ChatNav, chats: () => readonly Listed[]) {
  return {
    here: <T extends Listed>(listed: readonly T[]): T[] => listed.filter((one) => one.space === nav.space),
    opens: () => true,
    isOpen: (entry: Listed) => entry.id === nav.chat,
    openEntry: (entry: Listed, message?: string) => nav.open(entry.id, entry.space, message ?? null),
    followHref: (href: string) => {
      if (nav.follow(href, chats())) return
      if (/^(https?|mailto|orden):/i.test(href)) void openExternal(href).catch(() => undefined)
    },
  }
}
