import { answer, frameWord, method, invoke, isMobile, platform } from '../../platform/src/api'

export function deviceName(): string {
  switch (platform()) {
    case 'macos':
      return 'Touch ID'
    case 'windows':
      return 'Windows Hello'
    case 'ios':
      return 'Face ID'
    case 'android':
      return 'Screen lock'
    default:
      return 'System password'
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
    answer('__ordenOwner', (said: string) => {
      answer('__ordenOwner', undefined)
      resolve(said === 'yes')
    })
    ask(word, reason)
  })
}
