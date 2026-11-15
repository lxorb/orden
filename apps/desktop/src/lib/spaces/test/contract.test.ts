import { describe, expect, test } from 'vitest'
import { providePort } from '@orden/contracts'
import {
  loadSpaceMenu,
  loadSpacePicker,
  publishSpace,
  SpaceBadge,
  soundMark,
  spaceMenu,
  spaceSound,
  toggleSpacePicker,
} from '../src/api'

const SPACE = { id: 's', name: 'Notes', root: '/s' }

describe('the spaces', () => {
  test('draw their menu, their picker, their badge and their sound behind doors', () => {
    for (const one of [
      loadSpaceMenu,
      loadSpacePicker,
      soundMark,
      spaceSound.ask,
      toggleSpacePicker,
    ]) {
      expect(typeof one).toBe('function')
    }
    expect(typeof SpaceBadge).toBe('function')
  })

  test('offer a menu for a space', () => {
    expect(spaceMenu(SPACE).length).toBeGreaterThan(0)
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
})
