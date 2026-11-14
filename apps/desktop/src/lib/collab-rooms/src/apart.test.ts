import { beforeEach, describe, expect, test, vi } from 'vitest'

import { conflictPath } from '@orden/markdown/paths'
import { apart } from './apart'
import { record } from '../../sync/record.svelte'

const wrote: { command: string; path: string; content: string }[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    wrote.push({ command, path: text(args.path), content: text(args.content) })
    if (command === 'read_note') return Promise.reject(new Error('no such file'))
    return Promise.resolve(undefined)
  },
  joinPath: (...parts: string[]) => parts.join('/'),
  isDesktop: false,
  isNative: false,
}))

const NOTE = { path: '/Two hands/Plan.md', id: 'n1', version: 7 }
const THEIRS = '# Plan\n\nwhat the room holds\n'

describe('a device and the room that each wrote while apart', () => {
  beforeEach(() => {
    wrote.length = 0
    record.forgetEverything()
  })

  test("keeps the room's copy beside the note and then offers its own", async () => {
    expect(await apart('both', NOTE, THEIRS)).toBe('offer')

    expect(wrote.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: conflictPath(NOTE.path), content: THEIRS },
    ])
    expect(record.clashes).toEqual([])
  })

  test('lets the later copy stand for the rule that says so', async () => {
    expect(await apart('newest', NOTE, THEIRS)).toBe('take')

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([])
  })

  test('writes nothing at all and says so in the pane for the rule that asks', async () => {
    expect(await apart('ask', NOTE, THEIRS)).toBe('wait')

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([
      expect.objectContaining({ path: NOTE.path, id: 'n1', version: 7, theirs: THEIRS }),
    ])
  })

  test('keeps the note out of a push while its clash waits', async () => {
    await apart('ask', NOTE, THEIRS)

    expect(record.held.has(NOTE.path)).toBe(true)
  })

  test('takes the room&apos;s words for a file that has none here', async () => {
    for (const rule of ['both', 'newest', 'ask'] as const) {
      expect(await apart(rule, { ...NOTE, path: '' }, THEIRS)).toBe('take')
    }

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([])
  })
})
