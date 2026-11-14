import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { unzipped, ZIP_TOO_BIG } from './import-file'

async function zipOf(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(files)) zip.file(name, body)
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const LIMITS = { total: 1000, entries: 3, file: 600 }

describe('a zip to import', () => {
  test('opens into its files', async () => {
    const files = await unzipped(await zipOf({ 'a.csv': 'name\nx\n', 'dir/b.json': '{}' }), LIMITS)
    expect(Object.keys(files).sort()).toEqual(['a.csv', 'dir/b.json'])
    expect(new TextDecoder().decode(files['a.csv'])).toBe('name\nx\n')
  })

  test('is refused with more files than allowed', async () => {
    const many = await zipOf({ a: 'a', b: 'b', c: 'c', d: 'd' })
    await expect(unzipped(many, LIMITS)).rejects.toThrow(ZIP_TOO_BIG)
  })

  test('is refused when one file unpacks too big, however small it is packed', async () => {
    const bomb = await zipOf({ big: new Uint8Array(100_000) })
    expect(bomb.length).toBeLessThan(600)
    await expect(unzipped(bomb, LIMITS)).rejects.toThrow(ZIP_TOO_BIG)
  })

  test('is refused when its files together unpack too big', async () => {
    const two = await zipOf({ a: new Uint8Array(500), b: new Uint8Array(501) })
    await expect(unzipped(two, LIMITS)).rejects.toThrow(ZIP_TOO_BIG)
    expect(Object.keys(await unzipped(await zipOf({ a: new Uint8Array(500) }), LIMITS))).toEqual([
      'a',
    ])
  })
})
