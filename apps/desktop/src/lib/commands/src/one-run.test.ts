import { describe, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'
import { DIVIDER, isSubmenu, type MenuItem, type MenuRow } from '../../ui-kit/src/api'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())

const { workspace } = await import('../../workspace/src/api')
const { appCommands } = await import('./api')
const { appMenu } = await import('../../native-menu/src/app-menu')

const searched: unknown[] = []
providePort('search', {
  panel: {
    running: false,
    hits: [],
    ordering: { sort: 'relevance', descending: false },
    ask: () => undefined,
    setSort: () => undefined,
  },
  show: () => undefined,
  fromView: (view) => searched.push(view ?? 'nothing chosen'),
})

describe('an action the palette, the menu bar and a key all offer', () => {
  test('does the one thing its key does from each of them', () => {
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'

    appCommands()
      .find((one) => one.id === 'search-space')
      ?.run()
    const rows = (all: readonly MenuRow[]): MenuItem[] =>
      all.flatMap((one) => (one === DIVIDER ? [] : isSubmenu(one) ? rows(one.rows) : [one]))
    const menu = appMenu({ onpalette: () => undefined, onhistory: () => undefined })
    rows(menu.flatMap((group) => group.rows))
      .find((one) => one.label === 'Search')
      ?.run()

    expect(searched).toEqual(['nothing chosen', 'nothing chosen'])
  })
})
