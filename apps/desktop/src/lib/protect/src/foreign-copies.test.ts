import { beforeEach, describe, expect, test } from 'vitest'
import '../test/storage'

const { Protection } = await import('./protection.svelte')

const ROOT = '/space'
const NOTE = `${ROOT}/Diary.md`
const DROPBOX = `${ROOT}/Diary (Laptop's conflicted copy 2026-11-15).md`
const SYNCTHING = `${ROOT}/Diary.sync-conflict-20261115-101010-ABCDEFG.md`

beforeEach(() => localStorage.clear())

const beside = (protection: InstanceType<typeof Protection>) =>
  protection.seesFiles(() => [NOTE, DROPBOX, SYNCTHING])

describe('a foreign sync tool copy beside a locked note', () => {
  test('is locked while the note keeps its name', () => {
    const protection = new Protection()
    protection.set(ROOT, NOTE, 'password')
    expect(protection.locked(DROPBOX)).toBe(true)
    expect(protection.agentsMay(SYNCTHING)).toBe(false)
  })

  test('stays locked when the locked note is renamed or moved into another folder', () => {
    const protection = new Protection()
    beside(protection)
    protection.set(ROOT, NOTE, 'password')
    protection.moved(NOTE, `${ROOT}/Old/Diary.md`, ROOT)
    expect(protection.locked(`${ROOT}/Old/Diary.md`)).toBe(true)
    expect(protection.locked(DROPBOX)).toBe(true)
    expect(new Protection().agentsMay(SYNCTHING)).toBe(false)
  })

  test('stays locked when the locked note is deleted', async () => {
    const protection = new Protection()
    beside(protection)
    protection.set(ROOT, NOTE, 'password')
    await protection.gone(NOTE, ROOT, 'trash-1')
    expect(protection.agentsMay(DROPBOX)).toBe(false)
    expect(protection.agentsMay(SYNCTHING)).toBe(false)
  })
})

test('a sync tool’s copy of a copy of a locked note is locked too', () => {
  const protection = new Protection()
  protection.set(ROOT, NOTE, 'password')
  const twice = `${ROOT}/Diary.sync-conflict-20261101-120000-ABCDEFG.sync-conflict-20261102-130000-HIJKLMN.md`
  const mixed = `${ROOT}/Diary (Laptop's conflicted copy 2026-11-02).sync-conflict-20261101-120000-ABCDEFG.md`
  expect(protection.agentsMay(twice)).toBe(false)
  expect(protection.agentsMay(mixed)).toBe(false)
  expect(protection.locked(twice)).toBe(true)
})
