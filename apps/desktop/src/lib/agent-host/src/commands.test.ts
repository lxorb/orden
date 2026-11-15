import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const ran: string[] = []
let dialog: ((write: boolean) => Promise<string | null>) | null = null
const row = (id: string) => ({
  id,
  label: id,
  run: () => {
    ran.push(id)
    void dialog?.(true)
  },
})

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  answerNextDialog: (answer: typeof dialog) => {
    dialog = answer
  },
  invoke: async (_command: string, args: { path: string }) => ({
    status: 'ok',
    result: { path: args.path },
  }),
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  commandRowsLoaded: async () => undefined,
}))

vi.mock('../../commands/src/api', () => ({
  appCommands: () => [row('export-space'), row('export-pdf')],
}))

vi.mock('../../agent-verbs/src/api', async (original) => ({
  ...(await original<typeof import('../../agent-verbs/src/api')>()),
  placeFor: () => undefined,
}))

vi.mock('../../panes/src/api', () => ({ views: { of: () => undefined } }))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    panes: { focusedId: 'p1' },
    activeSpace: { root: '/s/Work' },
    active: { path: '/s/Work/Plan.md' },
  },
}))

const shut = new Set<string>()
vi.mock('../../protect/src/api', () => ({
  protection: {
    agentsMay: (path: string) => !shut.has(path),
    ways: () => ({ 'Diary.md': 'password' }),
  },
}))

const { runCommand } = await import('./commands')

function call(id: string) {
  return {
    verb: 'run_command',
    args: { id, path: '/tmp/out' },
    caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['workspace'], mode: 'unsupervised' }),
  }
}

beforeEach(() => {
  ran.length = 0
  shut.clear()
})

describe('an agent exporting', () => {
  test('cannot carry a note locked to agents out of the space', async () => {
    shut.add('/s/Work/Diary.md')
    await expect(runCommand(call('export-space'))).rejects.toMatchObject({ code: 'protected' })
    expect(ran).toEqual([])
  })

  test('cannot export the note in front when it is locked to agents', async () => {
    shut.add('/s/Work/Plan.md')
    await expect(runCommand(call('export-pdf'))).rejects.toMatchObject({ code: 'protected' })
    expect(ran).toEqual([])
  })

  test('exports what agents may read', async () => {
    await runCommand(call('export-space'))
    await runCommand(call('export-pdf'))
    expect(ran).toEqual(['export-space', 'export-pdf'])
  })
})
