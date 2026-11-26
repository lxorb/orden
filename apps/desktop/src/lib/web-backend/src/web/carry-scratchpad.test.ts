import { describe, expect, test } from 'vitest'
import { recentLog } from '../../../platform/src/api'
import { carryScratchpad, type ScratchpadFiles } from './carry-scratchpad'

const OLD = '/.nib/Scratchpad.md'
const NEW = '/.orden/Scratchpad.md'
function held(start: Record<string, string>, refusing = false): ScratchpadFiles & { all: Map<string, string> } {
  const all = new Map(Object.entries(start))
  return {
    all,
    read: (path) => Promise.resolve(all.get(path) ?? null),
    write: (path, content) => {
      if (refusing) return Promise.reject(new Error('full'))
      all.set(path, content)
      return Promise.resolve()
    },
    remove: (path) => Promise.resolve(all.delete(path)),
  }
}
describe('the scratchpad an older version kept', () => {
  test('moves to the new place whole, and the old one goes once the new one reads the same', async () => {
    const files = held({ [OLD]: 'kept words' })
    expect(await carryScratchpad(NEW, files)).toBe(NEW)
    expect(Object.fromEntries(files.all)).toEqual({ [NEW]: 'kept words' })
  })
  test('is nothing to move where there never was one', async () => {
    const files = held({})
    expect(await carryScratchpad(NEW, files)).toBe(NEW)
    expect(files.all.size).toBe(0)
  })
  test('stays where it was, and is the one in use, when the new place would not take it', async () => {
    const files = held({ [OLD]: 'kept words' }, true)
    expect(await carryScratchpad(NEW, files)).toBe(OLD)
    expect(Object.fromEntries(files.all)).toEqual({ [OLD]: 'kept words' })
    expect(recentLog().at(-1)).toContain(OLD)
  })
  test('stays too when the new place reads back other words', async () => {
    const files = held({ [OLD]: 'kept words' })
    files.write = (path) => {
      files.all.set(path, 'kept')
      return Promise.resolve()
    }
    expect(await carryScratchpad(NEW, files)).toBe(OLD)
    expect(files.all.get(OLD)).toBe('kept words')
  })
})
