import { describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../../automation/src/api'

const spaceA = { id: 'a', root: '/s/A', name: 'A' }
const lockedTerm = '/s/A/Servers/Prod.term'

const tab = {
  id: 'tt',
  kind: 'terminal',
  shown: 'Prod',
  path: lockedTerm,
  doc: '',
  paneId: 'p1',
  note: { path: lockedTerm, home: 'a', shared: null, live: { readerAt: null }, kind: 'terminal' },
}

vi.mock('../../../workspace/src/api', () => ({
  agentMarks: { opened: {}, on: {} },
  workspace: {
    spaces: [spaceA],
    activeSpace: spaceA,
    tabs: [tab],
    spaceOf: (note: { home: string }) => note.home,
  },
}))

vi.mock('../../../online-terms/src/api', () => ({ isOnlineTab: () => true }))
vi.mock('../running', () => ({ shellRunning: () => true }))

const row = (text: string) => ({ isWrapped: false, translateToString: () => text })
const screen = [row('$ cat ~/.aws/credentials'), row('aws_secret_access_key = AKIA-s3cret')]

vi.mock('../sessions.svelte', () => ({
  sessionOf: () => ({
    host: { isConnected: true },
    agentBlocked: () => null,
    current: true,
    term: {
      buffer: {
        active: { type: 'normal', length: screen.length, getLine: (at: number) => screen[at] },
      },
    },
  }),
}))

const { protection } = await import('../../../protect/src/api')
vi.spyOn(protection, 'agentsMay').mockImplementation((path) => path !== lockedTerm)
const { readTerminal, typeTerminal } = await import('./tab')

describe('a terminal note behind a lock shut to agents', () => {
  test('is not read by an agent of its space', async () => {
    const caller = callerOf({ id: 'x', name: 'X', scopes: ['context'], spaces: ['A'] })
    await expect(
      readTerminal({ verb: 'read_terminal', caller, args: { tab: 'tt' } }),
    ).rejects.toMatchObject({ code: 'protected' })
  })

  test('is not typed into by an agent of its space', async () => {
    const caller = callerOf({
      id: 'x',
      name: 'X',
      scopes: ['terminal'],
      spaces: ['A'],
      mode: 'unsupervised',
    })
    await expect(
      typeTerminal({ verb: 'type_terminal', caller, args: { tab: 'tt', text: 'ls' } }),
    ).rejects.toMatchObject({ code: 'protected' })
  })
})
