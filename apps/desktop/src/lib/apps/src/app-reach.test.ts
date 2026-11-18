import { describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const tabs = [
  { id: 'b1', kind: 'application', path: '/s/Home/Banking.application', note: { home: 'b' } },
  {
    id: 'l1',
    kind: 'application',
    path: '/s/Work/Locked/Payroll.application',
    note: { home: 'w' },
  },
]
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [
      { id: 'w', name: 'Work', root: '/s/Work' },
      { id: 'b', name: 'Home', root: '/s/Home' },
    ],
    spaceOf: (note: { home: string }) => note.home,
    get tabs() {
      return tabs
    },
  },
}))

const sent: unknown[] = []
const session = {
  holds: true,
  status: { is: 'here', state: 'running', code: null, why: null },
  hostName: 'Desk',
  picture: {
    status: { is: 'showing' },
    stream: {},
    channel: { readyState: 'open' },
    input: (event: unknown) => sent.push(event),
  },
  run: () => undefined,
}
vi.mock('./session.svelte', () => ({ appSessionIfAny: () => session }))
vi.mock('./frame', () => ({
  frameOf: () => Promise.resolve({ png: 'SCREEN', width: 1, height: 1 }),
}))
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: () => Promise.resolve({ status: 'ok', result: {} }),
}))

const { protection } = await import('../../protect/src/api')
vi.spyOn(protection, 'agentsMay').mockImplementation((path) => !String(path).includes('/Locked/'))
const { applicationTabs } = await import('./agent-verbs')

const caller = callerOf({
  id: 'x',
  name: 'X',
  scopes: ['applications'],
  spaces: ['Work'],
  mode: 'unsupervised',
})
const run = (args: Record<string, unknown>) =>
  applicationTabs({ verb: 'application_tabs', args, caller }).catch((error: unknown) => error)

describe('an agent given the Work space', () => {
  test('lists only the open applications of Work', async () => {
    expect(await run({ op: 'list' })).toMatchObject({ result: { applications: [] } })
  })

  test('neither sees nor drives an application of another space', async () => {
    expect(await run({ op: 'picture', tab: 'b1' })).toMatchObject({ code: 'no_such_tab' })
    expect(
      await run({ op: 'input', tab: 'b1', events: [{ type: 'text', text: 'hi' }] }),
    ).toMatchObject({ code: 'no_such_tab' })
    expect(sent).toEqual([])
  })

  test('neither sees nor drives an application behind a lock shut to agents', async () => {
    expect(await run({ op: 'picture', tab: 'l1' })).toMatchObject({ code: 'protected' })
    expect(
      await run({ op: 'input', tab: 'l1', events: [{ type: 'key', key: 'Enter' }] }),
    ).toMatchObject({ code: 'protected' })
    expect(sent).toEqual([])
  })
})
