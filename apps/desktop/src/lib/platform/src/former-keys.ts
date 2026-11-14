const RENAMED: readonly (readonly [string, string])[] = [
  ['nib:', 'orden:'],
  ['nib.', 'orden.'],
]

const GONE: readonly string[] = ['orden:language']

function renamedOf(key: string | null): string | null {
  const pair = key === null ? undefined : RENAMED.find(([old]) => key.startsWith(old))
  return key !== null && pair ? pair[1] + key.slice(pair[0].length) : null
}

export function carryKeys(storage: Storage): void {
  const old: string[] = []
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    if (key !== null && renamedOf(key) !== null) old.push(key)
  }

  for (const key of old) {
    const value = storage.getItem(key)
    const renamed = renamedOf(key)
    if (renamed === null) continue
    try {
      if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value)
    } catch {
      continue
    }
    storage.removeItem(key)
  }

  for (const key of GONE) storage.removeItem(key)
}

try {
  carryKeys(localStorage)
} catch {
  // A window told to keep no site data refuses the getter, and holds nothing to carry.
}
