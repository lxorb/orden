import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GIVES_UP_AFTER, InstructionsField, SETTLES_AFTER } from './instructions-field.svelte'

/** The field a space's AGENTS.md is edited in: what it writes, when, and what it never
 *  writes. Stands in for the disk; the write path itself is workspace/note-text.ts. */

const PATH = '/space/AGENTS.md'

function disk(start: string | null) {
  const held = { text: start, unreadable: false }
  const writes: { before: string; after: string; first: boolean }[] = []
  const made: string[] = []
  const hands = {
    space: vi.fn(() => Promise.resolve(true)),
    read: vi.fn(() => Promise.resolve(held.text)),
    there: vi.fn(() => Promise.resolve(held.unreadable)),
    write: vi.fn((_path: string, before: string, after: string, first: boolean) => {
      writes.push({ before, after, first })
      held.text = after
      return Promise.resolve()
    }),
    make: vi.fn((_path: string, text: string) => {
      made.push(text)
      held.text = text
      return Promise.resolve()
    }),
  }
  return { held, writes, made, hands }
}

describe('the field for a space’s AGENTS.md', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('opens on what the file says, and writes nothing for being opened', async () => {
    const { hands, writes, made } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    expect(field.text).toBe('# Rules')
    await field.flush()
    expect(writes).toEqual([])
    expect(made).toEqual([])
  })

  test('with no file it opens empty, and opening and closing makes none', async () => {
    const { hands, made, writes } = disk(null)
    const field = new InstructionsField(PATH, hands)
    await field.load()
    expect(field.text).toBe('')

    await field.flush()
    expect(made).toEqual([])
    expect(writes).toEqual([])
  })

  test('typed and rested, it writes once what the file now says is replaced by', async () => {
    const { hands, writes } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('# Rules\n- tea')
    await vi.advanceTimersByTimeAsync(SETTLES_AFTER)
    expect(writes).toEqual([{ before: '# Rules', after: '# Rules\n- tea', first: true }])
  })

  test('only the first write of a sitting keeps a version', async () => {
    const { hands, writes } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('one')
    await field.flush()
    field.type('two')
    await field.flush()
    expect(writes.map((one) => one.first)).toEqual([true, false])
  })

  test('typed and closed at once, nothing is lost', async () => {
    const { hands, held } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('# Rules, changed')
    await field.flush()
    expect(held.text).toBe('# Rules, changed')
  })

  test('with no file, words make it', async () => {
    const { hands, made } = disk(null)
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('# Rules')
    await field.flush()
    expect(made).toEqual(['# Rules'])
  })

  test('with no file, typed and taken back, none is made', async () => {
    const { hands, made } = disk(null)
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('# R')
    field.type('')
    await field.flush()
    expect(made).toEqual([])
  })

  test('cleared on purpose, the file stays and is empty', async () => {
    const { hands, held, writes } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('')
    await field.flush()
    expect(held.text).toBe('')
    expect(writes).toHaveLength(1)
  })

  test('a file that is there and would not read is left alone, and the field locked', async () => {
    const { hands, held, writes, made } = disk(null)
    held.unreadable = true
    const field = new InstructionsField(PATH, hands)
    await field.load()

    expect(field.unreadable).toBe(true)
    field.type('over it')
    await field.flush()
    expect(writes).toEqual([])
    expect(made).toEqual([])
  })

  test('a write from elsewhere simply appears while nothing is typed', async () => {
    const { hands } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.heard('# Rules from the agent')
    expect(field.text).toBe('# Rules from the agent')
  })

  test('a file a sync or an agent made appears in a field that opened empty', async () => {
    const { hands } = disk(null)
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.heard('# Arrived')
    expect(field.text).toBe('# Arrived')
  })

  test('a write from elsewhere while typing takes nothing from under the caret, and both stay', async () => {
    const { hands, held } = disk('one\n\ntwo\n')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('one, typed\n\ntwo\n')
    held.text = 'one\n\ntwo, theirs\n'
    field.heard(held.text)
    expect(field.text).toBe('one, typed\n\ntwo\n')

    await field.flush()
    expect(held.text).toBe('one, typed\n\ntwo, theirs\n')
    expect(field.text).toBe('one, typed\n\ntwo, theirs\n')
  })

  test('its own write coming back changes nothing', async () => {
    const { hands } = disk('# Rules')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('mine')
    await field.flush()
    field.heard('mine')
    expect(field.text).toBe('mine')
    expect(field.dirty).toBe(false)
  })

  test('a reader’s field writes nothing, whatever reaches it', async () => {
    const { hands, writes } = disk('# Theirs')
    const field = new InstructionsField(PATH, hands, () => true)
    await field.load()

    field.type('mine')
    await field.flush()
    expect(field.text).toBe('# Theirs')
    expect(writes).toEqual([])
  })

  test('a write that fails stays owed, and the words stay in the field', async () => {
    const { hands, held } = disk('# Rules')
    hands.write.mockImplementationOnce(() => Promise.reject(new Error('disk')))
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('mine')
    await field.flush()
    expect(field.text).toBe('mine')
    expect(field.dirty).toBe(true)

    await field.flush()
    expect(held.text).toBe('mine')
  })

  test('a space that has gone is not made again, and the field locks with its words in it', async () => {
    const { hands, made } = disk(null)
    const field = new InstructionsField(PATH, hands)
    await field.load()

    hands.space.mockResolvedValue(false)
    field.type('# After it went')
    await vi.advanceTimersByTimeAsync(SETTLES_AFTER)

    expect(made).toEqual([])
    expect(field.locked).toBe(true)
    expect(field.text).toBe('# After it went')
  })

  test('a write that never comes back does not hold up the ones after it', async () => {
    const { hands, writes } = disk('# Rules')
    hands.write.mockImplementationOnce(() => new Promise<void>(() => undefined))
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('one')
    void field.flush()
    await vi.advanceTimersByTimeAsync(GIVES_UP_AFTER)

    field.type('two')
    await field.flush()
    expect(writes.at(-1)?.after).toBe('two')
  })

  test('a CRLF file is the same file: a version once, and no stray CR', async () => {
    const { held, writes, hands } = disk('one\r\ntwo\r\n')
    hands.write.mockImplementation((_path, before, after, first) => {
      writes.push({ before, after, first })
      held.text = after.replace(/\n/g, '\r\n')
      return Promise.resolve()
    })
    const field = new InstructionsField(PATH, hands)
    await field.load()
    expect(field.text).toBe('one\ntwo\n')

    field.type('one\ntwo\nthree\n')
    await field.flush()
    field.type('one\ntwo\nthree\nfour\n')
    await field.flush()
    field.type('one\ntwo\nthree\nfour\nfive\n')
    await field.flush()

    expect(writes.map((one) => one.first)).toEqual([true, false, false])
    expect(field.text).toBe('one\ntwo\nthree\nfour\nfive\n')
    expect(held.text).toBe('one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n')
  })

  test('opening a CRLF file and typing nothing new writes nothing', async () => {
    const { writes, hands } = disk('one\r\ntwo\r\n')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('one\ntwo\n')
    await field.flush()

    expect(field.dirty).toBe(false)
    expect(writes).toEqual([])
  })

  test('something else writing the file, in CRLF, still merges with the typing', async () => {
    const { held, hands } = disk('one\r\ntwo\r\n')
    const field = new InstructionsField(PATH, hands)
    await field.load()

    field.type('one\ntwo\nmine\n')
    held.text = 'theirs\r\none\r\ntwo\r\n'
    await field.flush()

    expect(field.text).toBe('theirs\none\ntwo\nmine\n')
  })
})
