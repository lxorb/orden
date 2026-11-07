import { beforeEach, describe, expect, test, vi } from 'vitest'

const handed: { command: string; args: unknown; options: unknown }[] = []

vi.mock('@tauri-apps/api/core', () => ({
  Channel: {},
  invoke: (command: string, args?: unknown, options?: unknown) => {
    handed.push({ command, args, options })
    return Promise.resolve(null)
  },
}))

const { invoke } = await import('./native')

beforeEach(() => {
  handed.length = 0
})

describe('bytes on their way to a file', () => {
  test('go to the crate as they are, the path beside them, never as base64', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024).fill(7)
    await invoke('write_bytes', { path: 'C:/Notes/über uns.png', bytes })

    expect(handed).toHaveLength(1)
    expect(handed[0]?.command).toBe('write_bytes')
    expect(handed[0]?.args).toBe(bytes)
    expect(handed[0]?.options).toEqual({
      headers: { 'Orden-Args': encodeURIComponent('{"path":"C:/Notes/über uns.png"}') },
    })
  })

  test('a piece of a larger buffer is sent as that piece', async () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5])
    await invoke('write_bytes', { path: '/a.bin', bytes: whole.subarray(1, 3) })

    expect([...(handed[0]?.args as Uint8Array)]).toEqual([2, 3])
  })

  test('a file kept beside a note goes the same way, with where it goes beside it', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    await invoke('save_asset', { notePath: '/s/a.md', folder: 'assets', name: 'p.png', bytes })

    expect(handed[0]?.args).toBe(bytes)
    expect(handed[0]?.options).toEqual({
      headers: {
        'Orden-Args': encodeURIComponent('{"notePath":"/s/a.md","folder":"assets","name":"p.png"}'),
      },
    })
  })

  test('a picture pasted into a terminal and a file dropped on the explorer go the same way', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    await invoke('local_image', { kind: 'png', bytes })
    await invoke('remote_image', { host: 'pi', kind: 'png', bytes })
    await invoke('explorer_write', { folder: '/a', under: 'b/c.bin', bytes })

    expect(handed.map((one) => one.args)).toEqual([bytes, bytes, bytes])
    expect(handed.map((one) => one.options)).toEqual(
      [{ kind: 'png' }, { host: 'pi', kind: 'png' }, { folder: '/a', under: 'b/c.bin' }].map(
        (rest) => ({ headers: { 'Orden-Args': encodeURIComponent(JSON.stringify(rest)) } }),
      ),
    )
  })

  test('base64 and every other command go on unchanged', async () => {
    await invoke('write_bytes', { path: '/a.png', base64: 'AQI=' })
    await invoke('read_note', { path: '/a.md' }, { headers: { x: '1' } })

    expect(handed).toEqual([
      { command: 'write_bytes', args: { path: '/a.png', base64: 'AQI=' }, options: undefined },
      { command: 'read_note', args: { path: '/a.md' }, options: { headers: { x: '1' } } },
    ])
  })
})
