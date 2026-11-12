import { describe, expect, test } from 'vitest'
import { hash32 } from '@orden/sync-core'
import { Engine } from './engine'
import { localFirst, localSpaceId } from './local'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import type { World } from './world'

const ROOT = '/device/space'

const later = () => new Promise((settle) => setTimeout(settle, 5))

async function here() {
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
      async read(path) {
        await later()
        return disk.readBytes(path)
      },
      write: (path, bytes) => disk.writeBytes(path, bytes),
      hash: (bytes) => Promise.resolve(String(hash32('b', new TextDecoder().decode(bytes)))),
      up: () => Promise.resolve(true),
      down: () => Promise.resolve(null),
      replace: () => Promise.resolve(null),
    },
  }
  const engine = await Engine.start(world, new MemoryStore('here').open(), { freshens: false })
  const space = localSpaceId(Math.random)
  await engine.core.commit(engine.core.addSpace(space, ROOT, 'owner'))
  const state = engine.core.spaces.get(space)
  if (!state) throw new Error('no space')
  expect(await localFirst(engine.core, state, new Map())).toBe(true)
  return { disk, engine, state }
}

describe('a file made once and heard twice', () => {
  test('is one entry at its own name, never a second one numbered beside it (#1904)', async () => {
    const { disk, engine, state } = await here()
    const path = `${ROOT}/GIMP.application`
    const text = '{"v":1,"host":"d","run":{"kind":"installed","id":"gimp","name":"GIMP"}}\n'
    await disk.writeBytes(path, new TextEncoder().encode(text))

    await Promise.all([engine.created(path, false), engine.created(path, false)])

    const files = [...state.entries.values()].filter((one) => one.kind === 'file')
    expect(files.map((one) => [one.name, one.local_path])).toEqual([
      ['GIMP.application', 'GIMP.application'],
    ])
    expect(new TextDecoder().decode((await disk.readBytes(path)) ?? new Uint8Array())).toBe(text)
  })

  test('a folder heard twice is one folder', async () => {
    const { disk, engine, state } = await here()
    disk.folders.add(`${ROOT}/Apps`)
    await Promise.all([engine.created(`${ROOT}/Apps`, true), engine.created(`${ROOT}/Apps`, true)])
    expect([...state.entries.values()].filter((one) => one.name === 'Apps')).toHaveLength(1)
  })
})
