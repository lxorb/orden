import { describe, expect, it } from 'vitest'
import { randomBytes } from './bytes'
import { newKey, WrongSecret } from './crypto'
import {
  FILE_PART,
  MOST_FILE_BYTES,
  MOST_SEALED_PART,
  openFile,
  openFileKey,
  partsOf,
  rewrappedFileKey,
  sealFile,
} from './files'

const ITEM = 'item-1'
const FILE = 'file-1'

describe('a sealed file', () => {
  it('opens to the same bytes under the item key it was sealed for', async () => {
    const itemKey = newKey()
    const bytes = randomBytes(1000)
    const sealed = await sealFile(itemKey, ITEM, FILE, bytes)
    expect(sealed.parts).toHaveLength(1)
    expect(await openFile(itemKey, ITEM, FILE, sealed.key, sealed.parts, 1000)).toEqual(bytes)
  })

  it('is one part when empty', async () => {
    const itemKey = newKey()
    const sealed = await sealFile(itemKey, ITEM, FILE, new Uint8Array(0))
    expect(sealed.parts).toHaveLength(1)
    expect(await openFile(itemKey, ITEM, FILE, sealed.key, sealed.parts, 0)).toEqual(
      new Uint8Array(0),
    )
  })

  it('is cut into parts of 4 MiB, each no bigger than the account takes', async () => {
    const itemKey = newKey()
    const bytes = new Uint8Array(FILE_PART * 2 + 5).fill(3)
    bytes.set([1, 2], FILE_PART - 1)
    bytes.set([9], FILE_PART * 2 + 4)
    const sealed = await sealFile(itemKey, ITEM, FILE, bytes)
    expect(sealed.parts.map((part) => part.length)).toEqual([
      MOST_SEALED_PART,
      MOST_SEALED_PART,
      5 + MOST_SEALED_PART - FILE_PART,
    ])
    const opened = await openFile(itemKey, ITEM, FILE, sealed.key, sealed.parts, bytes.length)
    expect(Buffer.from(opened).equals(Buffer.from(bytes))).toBe(true)
  })

  it('refuses parts swapped, dropped or another item’s', async () => {
    const itemKey = newKey()
    const bytes = new Uint8Array(FILE_PART + 10).fill(7)
    const sealed = await sealFile(itemKey, ITEM, FILE, bytes)
    const [first, second] = sealed.parts
    if (!first || !second) throw new Error('two parts')
    const size = bytes.length
    await expect(openFile(itemKey, ITEM, FILE, sealed.key, [second, first], size)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openFile(itemKey, ITEM, FILE, sealed.key, [first], size)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openFile(itemKey, ITEM, FILE, sealed.key, [first], FILE_PART)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openFile(itemKey, 'item-2', FILE, sealed.key, sealed.parts, size)).rejects.toThrow(
      WrongSecret,
    )
    await expect(openFile(newKey(), ITEM, FILE, sealed.key, sealed.parts, size)).rejects.toThrow(
      WrongSecret,
    )
  })

  it('is refused over 100 MiB', async () => {
    const huge = { length: MOST_FILE_BYTES + 1 } as unknown as Uint8Array
    await expect(sealFile(newKey(), ITEM, FILE, huge)).rejects.toThrow('100 MiB')
  })

  it('keeps its key across a new item key', async () => {
    const from = newKey()
    const to = newKey()
    const bytes = randomBytes(64)
    const sealed = await sealFile(from, ITEM, FILE, bytes)
    const key = await rewrappedFileKey(from, to, ITEM, FILE, sealed.key)
    expect(await openFile(to, ITEM, FILE, key, sealed.parts, 64)).toEqual(bytes)
    await expect(openFileKey(from, ITEM, FILE, key)).rejects.toThrow(WrongSecret)
  })

  it('counts its parts', () => {
    expect([0, 1, FILE_PART, FILE_PART + 1, MOST_FILE_BYTES].map(partsOf)).toEqual([1, 1, 1, 2, 25])
  })
})
