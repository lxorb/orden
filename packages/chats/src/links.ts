import { isChatId } from './pointer'

const PREFIX = 'orden://chat/'

const PREFIXES = [PREFIX, 'nib://chat/']

const MESSAGE = /^[0-9A-Za-z_-]{1,64}$/

export function chatLink(chat: string, message?: string): string {
  return message === undefined ? `${PREFIX}${chat}` : `${PREFIX}${chat}/${message}`
}

export function chatLinkOf(url: string): { chat: string; message?: string } | null {
  const prefix = PREFIXES.find((one) => url.startsWith(one))
  if (!prefix) return null
  const [chat, message, ...rest] = url.slice(prefix.length).split('/')
  if (rest.length > 0 || !isChatId(chat)) return null
  if (message === undefined) return { chat }
  return MESSAGE.test(message) ? { chat, message } : null
}
