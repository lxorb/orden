import { describe, expect, test } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'
import { GROWS_AT_MOST } from '../../../../../scripts/growth'
import { Engine } from './engine'
import { localFirst, localSpaceId } from './local'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import type { World } from './world'

const ROOT = '/device/space'

async function heard(size: number, note: boolean): Promise<number> {
  const disk = new MemoryDisk()
  disk.folders.add(ROOT)
  const world: World = {
    disk,
    account: { ask: () => Promise.resolve(null) },
    name: 'here',
    now: () => 1000,
    random: Math.random,
    digest: (text) => Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
    join: (root, path) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
    list: () => Promise.resolve([]),
    blobs: {
      read: (path) => disk.readBytes(path),
      write: (path, bytes) => disk.writeBytes(path, bytes),
      hash: (bytes) => Promise.resolve(String(hash32('b', new TextDecoder().decode(bytes)))),
      up: () => Promise.resolve(true),
      down: () => Promise.resolve(null),
      replace: () => Promise.resolve(null),
    },
  }
  const engine = await Engine.start(world, new MemoryStore('here').open(), { freshens: false })
  const id = localSpaceId(Math.random)
  await engine.core.commit(engine.core.addSpace(id, ROOT, 'owner'))
  const space = engine.core.spaces.get(id)
  if (!space) throw new Error('no space')
  await localFirst(engine.core, space, new Map())
  const paths: string[] = []
  for (let at = 0; at < size; at++) {
    const path = `${ROOT}/Dropped/${note ? `Note ${String(at)}.md` : `Photo ${String(at)}.png`}`
    if (note) await disk.write(path, `words ${String(at)}`)
    else await disk.writeBytes(path, new TextEncoder().encode(`bytes ${String(at)}`))
    paths.push(path)
  }
  const started = performance.now()
  if (!engine.ownWork(`${ROOT}/Dropped`)) await engine.created(`${ROOT}/Dropped`, true)
  for (const path of paths) {
    if (engine.ownWork(path) || engine.entryAt(path)) continue
    await engine.created(path, false, note ? ((await disk.read(path)) ?? '') : undefined)
  }
  const spent = performance.now() - started
  expect(space.entries.size).toBe(size + 1)
  expect(new Set([...space.paths().values()]).size).toBe(size + 1)
  return spent
}

describe('a folder of many dropped into a space', () => {
  test.each([
    ['notes', true],
    ['files', false],
  ])(
    'takes its %s in time that grows with them, not with their square',
    async (_said, note) => {
      await heard(100, note)
      let small = Infinity
      let large = Infinity
      for (let round = 0; round < 3; round++) {
        small = Math.min(small, await heard(300, note))
        large = Math.min(large, await heard(1200, note))
      }
      expect(large / Math.max(small, 0.05)).toBeLessThan(GROWS_AT_MOST)
    },
    120_000,
  )
})
