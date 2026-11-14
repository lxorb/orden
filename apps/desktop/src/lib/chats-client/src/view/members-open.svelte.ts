import { SidebarWidth } from '../../../sidebar-width.svelte'
import { keepJson, stored } from '../../../platform/src/api'

const KEY = 'orden:chat-members'
const MOST = 200

function read(): string[] {
  const value = stored(KEY)
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

class MembersOpen {
  chats = $state<string[]>(read())
  readonly width = new SidebarWidth(() => 'right', 'orden:chat-members-width')

  shown(chat: string): boolean {
    return this.chats.includes(chat)
  }

  set(chat: string, open: boolean): void {
    const rest = this.chats.filter((one) => one !== chat)
    this.chats = open ? [...rest, chat].slice(-MOST) : rest
    keepJson(KEY, this.chats)
  }

  toggle(chat: string): void {
    this.set(chat, !this.shown(chat))
  }
}

export const membersOpen = new MembersOpen()
