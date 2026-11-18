import { describe, expect, test, vi } from 'vitest'
import { registerSettingsPart } from '@orden/contracts'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())

const { places } = await import('./places')
const { sectionGroups } = await import('./sections')

describe('the places settings search can land on', () => {
  test('are only in sections the window shows, signed out and outside coder mode', () => {
    const stop = registerSettingsPart({
      section: 'remote',
      card: true,
      shown: () => true,
      places: () => [{ label: 'Add host', text: ['SSH'] }],
      load: () => Promise.reject(new Error('not drawn here')),
    })
    const shown = new Set(sectionGroups().flatMap((group) => group.map((one) => one.id)))
    const found = places()
    stop()
    expect(found.length).toBeGreaterThan(5)
    expect(found.filter((place) => !shown.has(place.section)).map((place) => place.label)).toEqual(
      [],
    )
  })
})
