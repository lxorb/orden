import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { Images } from './images'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const aDayAgo = () => (Date.now() - 25 * 60 * 60_000) / 1000

test('a picture kept under the old folder stays where its path was said, until it is a day old', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ordend-home-'))
  homes.push(home)
  const former = join(home, '.cache', 'nib', 'images')
  mkdirSync(former, { recursive: true })
  const stale = join(former, 'fedcba9876543210fedc.png')
  const fresh = join(former, 'abcdef0123456789abcd.png')
  writeFileSync(stale, 'x')
  utimesSync(stale, aDayAgo(), aDayAgo())
  writeFileSync(fresh, 'y')

  const path = await new Images(home, null).part(
    '0123456789abcdef0123',
    'png',
    new Uint8Array([1]),
    true,
  )

  expect(path).toBe(join(home, '.cache', 'orden', 'images', '0123456789abcdef0123.png'))
  expect(existsSync(fresh)).toBe(true)
  expect(existsSync(stale)).toBe(false)
})
