import { describe, expect, test, vi } from 'vitest'

const answered: { bytes: number[] } = { bytes: [] }
const asked: unknown[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args: unknown) => {
    asked.push({ command, args })
    return Promise.resolve(new Uint8Array(answered.bytes).buffer)
  },
}))

const { peekAt } = await import('./commands')

describe('a look into a file', () => {
  test('comes back as its bytes, never as base64, with whether more were there', async () => {
    answered.bytes = [...new TextEncoder().encode('hello'), 1]
    const read = await peekAt('/a/b.txt', 5)

    expect(asked).toEqual([{ command: 'explorer_peek', args: { path: '/a/b.txt', most: 5 } }])
    expect(new TextDecoder().decode(read.bytes)).toBe('hello')
    expect(read.cut).toBe(true)
  })

  test('a whole file is not cut, and an empty one is no bytes', async () => {
    answered.bytes = [1, 2, 0]
    expect(await peekAt('/a/c.bin', 8)).toEqual({ bytes: new Uint8Array([1, 2]), cut: false })
    answered.bytes = [0]
    expect(await peekAt('/a/d.bin', 8)).toEqual({ bytes: new Uint8Array(), cut: false })
  })
})
