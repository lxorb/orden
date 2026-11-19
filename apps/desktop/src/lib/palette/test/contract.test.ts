import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { paletteKind } from '@orden/contracts'

describe('the kinds it reads from the registry', () => {
  test('offer nothing while no feature has registered them', async () => {
    expect(paletteKind('visits').list()).toEqual([])
    expect(paletteKind('hosts').wanted('ssh pi@example.com')).toBeNull()
    expect(await paletteKind('hosts').list()).toEqual([])
    expect(await paletteKind('messages').hits('plans')).toEqual({ rows: [], only: false })
    expect(paletteKind('settings').rows()).toEqual([])
  })
})
describe('the open tabs it lists', () => {
  test('are the ones the workspace shows, so a tab of an archived space is not listed', () => {
    const src = join(import.meta.dirname, '..', 'src')
    const reading = readdirSync(src)
      .filter((name) => !name.includes('.test.') && !name.includes('.fixture.'))
      .filter((name) => /\bworkspace\.tabs\b/.test(readFileSync(join(src, name), 'utf8')))
    expect(reading).toEqual([])
  })
})
