import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What a stretch is sent to this computer's model as (#1151): the model opened first,
 *  then one body per pass, the names around the field and the samples, which
 *  dictation.rs reads back (`framed`). Nothing opened or sent while the model is still
 *  downloading, which that starts instead. */

const world = vi.hoisted(() => ({
  ready: true,
  calls: [] as { command: string; body: unknown }[],
  opened: 0,
  fetched: 0,
}))

vi.mock('./local.svelte', () => ({
  local: {
    get ready() {
      return world.ready
    },
    open: () => {
      world.opened++
      return Promise.resolve()
    },
    fetch: () => {
      world.fetched++
      return Promise.resolve()
    },
  },
}))
vi.mock('../native', () => ({
  invoke: (command: string, body: unknown) => {
    world.calls.push({ command, body })
    return Promise.resolve('Hallo Jürgen')
  },
}))

const { hearsHere } = await import('./listening')

beforeEach(() => {
  Object.assign(world, { ready: true, opened: 0, fetched: 0 })
  world.calls.length = 0
})

describe('a stretch heard on this computer', () => {
  test('goes as the names, then the samples, once the model is open', async () => {
    const hears = await hearsHere(['Jürgen Weißmüller', 'Tauri'])
    expect(world.opened).toBe(1)
    const samples = new Float32Array([0.5, -0.25, 0])
    expect(await hears(samples, 'a prompt', 3)).toBe('Hallo Jürgen')

    const [call] = world.calls
    expect(call?.command).toBe('dictation_local_hear')
    const body = call?.body as Uint8Array
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    const length = view.getUint32(0, true)
    expect(new TextDecoder().decode(body.subarray(4, 4 + length))).toBe('Jürgen Weißmüller\nTauri')
    const sound = body.slice(4 + length)
    expect([...new Float32Array(sound.buffer)]).toEqual([0.5, -0.25, 0])
  })

  test('goes without the names on a live pass, which is not biased towards them', async () => {
    const hears = await hearsHere(['Tauri'])
    await hears(new Float32Array([1]), '', 1)
    const body = world.calls[0]?.body as Uint8Array
    expect(new DataView(body.buffer).getUint32(0, true)).toBe(0)
    expect(body.byteLength).toBe(4 + 4)
  })

  test('is a part of a longer buffer sent as itself', async () => {
    const hears = await hearsHere([])
    const all = new Float32Array([1, 2, 3, 4])
    await hears(all.subarray(1, 3), '', 3)
    const body = world.calls[0]?.body as Uint8Array
    expect(body.byteLength).toBe(4 + 8)
    expect([...new Float32Array(body.slice(4).buffer)]).toEqual([2, 3])
  })

  test('is not sent while the model is downloading, which it starts', async () => {
    world.ready = false
    await expect(hearsHere([])).rejects.toThrow('The speech model is still downloading.')
    expect(world.fetched).toBe(1)
    expect(world.opened).toBe(0)
    expect(world.calls).toEqual([])
  })
})
