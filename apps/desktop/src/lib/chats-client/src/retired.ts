import { forget, isRecord, isString, keep, stored, storedText } from '../../platform/src/api'

const ACCOUNTS = 'orden:chat-accounts'
const CLEARED = 'orden:chats-retired'
const SEALED = 'orden-chat-sealed'
const DATABASES = [SEALED, 'orden-signal']
const FIELDS = [
  'password',
  'token',
  'appToken',
  'apiId',
  'apiHash',
  'clientSecret',
  'refresh',
  'session',
  'kept',
]

export interface RetiredWorld {
  forgetSecret(name: string): Promise<void>
  sealedNames(): Promise<string[]>
  dropDatabase(name: string): Promise<void>
}

export function secretName(provider: string, account: string, field: string): string {
  const clean = (part: string) => part.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 20)
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let at = 0; at < account.length; at++) {
    const code = account.charCodeAt(at)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `chat-${clean(provider)}_${a.toString(36)}${b.toString(36)}_${clean(field)}`
}

function linkedAccounts(): { provider: string; account: string }[] {
  const saved = stored(ACCOUNTS)
  if (!Array.isArray(saved)) return []
  return saved.flatMap((one: unknown) =>
    isRecord(one) && isString(one.provider) && isString(one.account)
      ? [{ provider: one.provider, account: one.account }]
      : [],
  )
}

export function retiredSecrets(sealed: readonly string[]): string[] {
  const names = new Set<string>()
  for (const { provider, account } of linkedAccounts()) {
    for (const who of new Set([account, account.toLowerCase()]))
      for (const field of FIELDS) names.add(secretName(provider, who, field))
  }
  for (const name of sealed) names.add(secretName('sealed', name, 'key'))
  return [...names]
}

export async function forgetRetiredChats(world: RetiredWorld): Promise<void> {
  if (storedText(CLEARED) !== null) return
  const sealed = await world.sealedNames().catch(() => [])
  for (const name of retiredSecrets(sealed)) await world.forgetSecret(name).catch(() => undefined)
  for (const name of DATABASES) await world.dropDatabase(name).catch(() => undefined)
  forget(ACCOUNTS)
  keep(CLEARED, '1')
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the device store failed'))
  })
}

async function sealedNames(): Promise<string[]> {
  const db = await done(indexedDB.open(SEALED))
  try {
    if (!db.objectStoreNames.contains('sealed')) return []
    const keys = await done(db.transaction('sealed').objectStore('sealed').getAllKeys())
    return keys.filter(isString)
  } finally {
    db.close()
  }
}

export async function forgetRetiredChatsHere(): Promise<void> {
  if (typeof indexedDB === 'undefined' || storedText(CLEARED) !== null) return
  const { forgetKey } = await import('../../ai-providers/src/api')
  await forgetRetiredChats({
    forgetSecret: (name) => forgetKey(name, true),
    sealedNames,
    dropDatabase: (name) => done(indexedDB.deleteDatabase(name)).then(() => undefined),
  })
}
