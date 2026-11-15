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
  appCommands: () => [
    row('export-space'),
    row('export-pdf'),
    row('reformat'),
    row('protect.let-agents'),
    row('undo-file'),
  ],
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
    spaces: [{ root: '/s/Work' }, { root: '/s/Home' }],
    active: { path: '/s/Work/Plan.md' },
  },
}))

const shut = new Set<string>()
let waiting = false
vi.mock('../../protect/src/api', () => ({
  buried: async () => ({ waits: () => waiting }),
  protection: {
    agentsMay: (path: string) => !shut.has(path),
    ways: (root: string) =>
      root === '/s/Home' ? { Journal: 'device' } : { 'Diary.md': 'password' },
  },
}))

const { runCommand } = await import('./commands')

function call(id: string, path: string | null = '/tmp/out') {
  return {
    verb: 'run_command',
    args: path === null ? { id } : { id, path },
    caller: callerOf({
      id: 'claude',
      name: 'Claude',
      scopes: ['workspace', 'notes.write', 'tree'],
      mode: 'unsupervised',
    }),
  }
}

beforeEach(() => {
  ran.length = 0
  shut.clear()
  waiting = false
})

describe('an agent running a command that writes the note in front', () => {
  test('cannot when that note is locked to agents', async () => {
    shut.add('/s/Work/Plan.md')
    await expect(runCommand(call('reformat', null))).rejects.toMatchObject({ code: 'protected' })
    expect(ran).toEqual([])
  })
})

describe('an agent asking to open a lock to agents', () => {
  test('is refused, even with every permission', async () => {
    const all = {
      ...call('protect.let-agents', null),
      caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['workspace'], mode: 'autonomous' }),
    }
    await expect(runCommand(all)).rejects.toMatchObject({ code: 'by_hand' })
    expect(ran).toEqual([])
  })
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

  test('cannot export a note that could embed one locked to agents in another space', async () => {
    shut.add('/s/Home/Journal')
    await expect(runCommand(call('export-pdf'))).rejects.toMatchObject({ code: 'protected' })
    expect(ran).toEqual([])
  })

  test('exports what agents may read', async () => {
    await runCommand(call('export-space'))
    await runCommand(call('export-pdf'))
    expect(ran).toEqual(['export-space', 'export-pdf'])
  })
})

describe('an agent undoing a file change', () => {
  test('cannot while a lock waits to come back with what it would put back', async () => {
    waiting = true
    await expect(runCommand(call('undo-file', null))).rejects.toMatchObject({ code: 'protected' })
    expect(ran).toEqual([])
  })

  test('can when no lock waits', async () => {
    await runCommand(call('undo-file', null))
    expect(ran).toEqual(['undo-file'])
  })
})
