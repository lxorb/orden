import type { Pointer } from './types'

export const CHAT_EXTENSION = '.chat'

const CHAT_ID = /^c_[0-9a-f]{32}$/

export function isChatId(value: unknown): value is string {
  return typeof value === 'string' && CHAT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function chatOf(text: string): Pointer | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const { v, chat } = value
  if (v !== 1 || !isChatId(chat)) return null
  return withIcon({ v, chat }, worn(value.icon), worn(value.iconColor))
}

const MOST_WORN = 100

function worn(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MOST_WORN
    ? value
    : null
}

export function withIcon(pointer: Pointer, icon: string | null, iconColor: string | null): Pointer {
  const bare: Pointer = { v: pointer.v, chat: pointer.chat }
  if (icon === null) return bare
  return iconColor === null ? { ...bare, icon } : { ...bare, icon, iconColor }
}

export function chatText(pointer: Pointer): string {
  const { v, chat, icon, iconColor } = withIcon(
    pointer,
    pointer.icon ?? null,
    pointer.iconColor ?? null,
  )
  return `${JSON.stringify({ v, chat, icon, iconColor })}\n`
}
