import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { keyName, sealedDatabase, sealedStore } from './sealed'

function vault() {
  const kept = new Map<string, string>()
  return {
    kept,
    read: (name: string) => Promise.resolve(kept.get(name) ?? null),
    write: (name: string, value: string | null) => {
      if (value === null) kept.delete(name)
      else kept.set(name, value)
      return Promise.resolve()
    },
  }
}

const words = (text: string) => new TextEncoder().encode(text)

test('a large secret is kept sealed on the device with only its key in the vault', async () => {
  const keys = vault()
  const db = sealedDatabase()
  const sealed = sealedStore(keys, db)
  const session = words('session '.repeat(2000))
  await sealed.write('telegram-a', session)
  expect(await sealed.read('telegram-a')).toEqual(session)
  expect([...keys.kept.keys()]).toEqual([keyName('telegram-a')])
  expect(keys.kept.get(keyName('telegram-a'))?.length).toBeLessThan(100)

  const store = (await db.transaction('sealed')).objectStore('sealed')
  const row = await new Promise<{ data: ArrayBuffer }>((resolve) => {
    const asked = store.get('telegram-a')
    asked.onsuccess = () => resolve(asked.result as { data: ArrayBuffer })
  })
  expect(new TextDecoder().decode(row.data)).not.toContain('session')
})

test('without its key, or after it is forgotten, nothing comes back', async () => {
  const keys = vault()
  const sealed = sealedStore(keys, sealedDatabase())
  await sealed.write('signal-b', words('keys'))
  keys.kept.clear()
  expect(await sealed.read('signal-b')).toBeNull()

  await sealed.write('signal-b', words('again'))
  expect(await sealed.read('signal-b')).toEqual(words('again'))
  await sealed.write('signal-b', null)
  expect(keys.kept.size).toBe(0)
  expect(await sealed.read('signal-b')).toBeNull()
})

test('a key that does not open the sealed bytes gives nothing, not an error', async () => {
  const keys = vault()
  const sealed = sealedStore(keys, sealedDatabase())
  await sealed.write('whatsapp-c', words('creds'))
  keys.kept.set(keyName('whatsapp-c'), btoa('x'.repeat(32)))
  expect(await sealed.read('whatsapp-c')).toBeNull()
})
