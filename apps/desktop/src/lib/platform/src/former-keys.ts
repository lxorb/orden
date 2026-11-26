import { log } from './log'

const RENAMED: readonly (readonly [string, string])[] = [
  ['nib:', 'orden:'],
  ['nib.', 'orden.'],
]
const GONE: readonly string[] = ['orden:language']
function renamedOf(key: string | null): string | null {
  const pair = key === null ? undefined : RENAMED.find(([old]) => key.startsWith(old))
  return key !== null && pair ? pair[1] + key.slice(pair[0].length) : null
}
function carried(storage: Storage, key: string, renamed: string): boolean {
  const value = storage.getItem(key)
  if (value === null || storage.getItem(renamed) !== null) return true
  try {
    storage.setItem(renamed, value)
  } catch {
    return false
  }
  return storage.getItem(renamed) === value
}
export function carryKeys(storage: Storage): void {
  const old: string[] = []
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    if (key !== null && renamedOf(key) !== null) old.push(key)
  }
  const stayed: string[] = []
  for (const key of old) {
    const renamed = renamedOf(key)
    if (renamed === null) continue
    if (carried(storage, key, renamed)) storage.removeItem(key)
    else stayed.push(key)
  }
  if (stayed.length > 0) {
    log('warn', `orden: could not carry what was kept under the old name, so it stays there: ${stayed.join(', ')}`)
  }
  for (const key of GONE) storage.removeItem(key)
}
try {
  carryKeys(localStorage)
} catch {
  // A window told to keep no site data refuses the getter, and holds nothing to carry.
}
