import { describe, expect, test } from 'vitest'
import { providePort, settingsPartsIn } from '@orden/contracts'
import { publishSpace, spaceMenu } from '../src/api'

const SPACE = { id: 's', name: 'Notes', root: '/s' }
describe('the spaces', () => {
  test('offer to rename and delete a space of one’s own', () => {
    const labels = spaceMenu(SPACE).flatMap((one) => (one && 'label' in one ? [one.label] : []))
    expect(labels).toContain('Rename')
    expect(labels).toContain('Delete space')
    expect(labels).not.toContain('Leave space')
  })
  test('publish a space through the publishing port, and do nothing without one', async () => {
    await publishSpace(SPACE)
    const shown: string[] = []
    const stop = providePort('publishing', {
      show: (space) => {
        shown.push(space.root)
        return Promise.resolve()
      },
    })
    await publishSpace(SPACE)
    stop()
    expect(shown).toEqual(['/s'])
  })
  test('hold the archived spaces in a Settings section of their own', () => {
    const [part, ...more] = settingsPartsIn('archived')
    expect(more).toEqual([])
    expect(part?.shown()).toBe(true)
    expect(part?.places?.().map((one) => one.label)).toEqual(['Unarchive'])
  })
})
