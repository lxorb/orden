import { isChatId } from './pointer'

const PREFIX = 'nib://chat/'

const MESSAGE = /^[0-9A-Za-z_-]{1,64}$/

export function chatLink(chat: string, message?: string): string {
  return message === undefined ? `${PREFIX}${chat}` : `${PREFIX}${chat}/${message}`
}

export function chatLinkOf(url: string): { chat: string; message?: string } | null {
  if (!url.startsWith(PREFIX)) return null
  const [chat, message, ...rest] = url.slice(PREFIX.length).split('/')
  if (rest.length > 0 || !isChatId(chat)) return null
  if (message === undefined) return { chat }
  return MESSAGE.test(message) ? { chat, message } : null
}
