import type { AliasService } from './alias-http'

export interface AliasAccount {
  provider: AliasService
  key: string
  mailbox: string | null
  suffix: string | null
}

const SERVICES: readonly string[] = ['simplelogin', 'addy']

const textOrNull = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

export function aliasAccountIn(text: string): AliasAccount | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const { provider, key, mailbox, suffix } = raw as Record<string, unknown>
  if (typeof provider !== 'string' || !SERVICES.includes(provider)) return null
  if (typeof key !== 'string' || key === '') return null
  return {
    provider: provider as AliasService,
    key,
    mailbox: textOrNull(mailbox),
    suffix: textOrNull(suffix),
  }
}
