import { t } from '../i18n.svelte'
import { answer, frameWord, method } from '../mobile/bridge'
import { invoke, isMobile, platform } from '../tauri'

export function deviceName(): string {
  switch (platform()) {
    case 'macos':
      return 'Touch ID'
    case 'windows':
      return 'Windows Hello'
    case 'ios':
      return 'Face ID'
    case 'android':
      return t('Screen lock')
    default:
      return t('System password')
  }
}

let can: Promise<boolean> | null = null

export function deviceCan(): Promise<boolean> {
  can ??= (async () => {
    const phone = isMobile ? method('ownerCan') : undefined
    if (phone) return phone(await frameWord())
    return (await invoke<unknown>('owner_can').catch(() => false)) === true
  })()
  return can
}

export async function deviceSays(reason: string): Promise<boolean> {
  if (!(await deviceCan())) return false
  const ask = isMobile ? method('ownerCheck') : undefined
  if (!ask) return (await invoke<unknown>('owner_check', { reason })) === true
  const word = await frameWord()
  return new Promise((resolve) => {
    answer('__nibOwner', (said: string) => {
      answer('__nibOwner', undefined)
      resolve(said === 'yes')
    })
    ask(word, reason)
  })
}
