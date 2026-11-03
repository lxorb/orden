import { describe, expect, test, vi } from 'vitest'
import type { Engine } from './engine'
import { kept } from './watching'

vi.mock('../surfaces.svelte', () => ({ syncMark: { ask: () => undefined } }))

const ROOT = '/home/me/.local/share/ch.emilvinu.nib/Spaces/Two'
const engine = {
  core: {
    world: { foldsCase: false, blobs: {} },
    spaces: new Map([['s', { row: { root: ROOT } }]]),
  },
} as unknown as Engine

describe('what the watch keeps', () => {
  test('a note in a space under a dotted folder: Linux’s own place for them', () => {
    expect(kept(engine, `${ROOT}/both.md`, false)).toBe(true)
  })

  test('what is dotted inside the space stays the app’s', () => {
    expect(kept(engine, `${ROOT}/.trash/both.md`, false)).toBe(false)
    expect(kept(engine, `${ROOT}/.hidden.md`, false)).toBe(false)
  })
})
