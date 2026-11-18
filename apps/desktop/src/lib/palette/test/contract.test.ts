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
