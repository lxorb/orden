import { keep, storedText, invoke, isNative } from '../platform/src/api'

const EVENT = 'orden://ai-accounts'

export const COPY = 'orden:ai-accounts'

export interface Kept {
  text: string | null
  stamp: string
}

export const STALE = 'stale'

export async function readKept(): Promise<Kept> {
  if (!isNative) return { text: storedText(COPY), stamp: '' }
  const said: unknown = await invoke<unknown>('ai_accounts_read')
  if (typeof said !== 'object' || said === null) return { text: null, stamp: '' }
  const { text, stamp } = said as { text?: unknown; stamp?: unknown }
  return {
    text: typeof text === 'string' ? text : null,
    stamp: typeof stamp === 'string' ? stamp : '',
  }
}

export async function writeKept(text: string, stamp: string): Promise<string> {
  if (!isNative) {
    keep(COPY, text)
    return ''
  }
  const said: unknown = await invoke<unknown>('ai_accounts_write', { text, stamp })
  return typeof said === 'string' ? said : ''
}

export async function hearChanges(on: () => void): Promise<void> {
  if (!isNative) return
  const { listen } = await import('@tauri-apps/api/event')
  await listen<unknown>(EVENT, () => {
    on()
  })
}
