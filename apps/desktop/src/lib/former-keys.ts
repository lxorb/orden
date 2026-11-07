const OLD = 'nib:'
const NEW = 'orden:'

export function carryKeys(storage: Storage): void {
  const old: string[] = []
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    if (key?.startsWith(OLD)) old.push(key)
  }

  for (const key of old) {
    const value = storage.getItem(key)
    const renamed = NEW + key.slice(OLD.length)
    try {
      if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value)
    } catch {
      continue
    }
    storage.removeItem(key)
  }
}

try {
  carryKeys(localStorage)
} catch {
  // A window told to keep no site data refuses the getter, and holds nothing to carry.
}
