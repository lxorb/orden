import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const written: string[] = []

const spaceA = { id: 'a', root: '/s/A', name: 'A' }
const spaceB = { id: 'b', root: '/s/B', name: 'B' }

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [spaceA, spaceB],
    activeSpace: spaceA,
    tabs: [],
    noteText: async () => null,
    loadTree: async () => undefined,
    spaceOf: () => 'a',
    webAddressOf: () => null,
    showing: () => null,
  },
}))

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: async (command: string) => {
    if (command === 'agents_state') {
      return { tabs: [['claude', { id: 't1', url: 'https://evil.example/', title: 'Planted' }]] }
    }
    return null
  },
}))

vi.mock('../../file-writes/src/api', () => ({
  writeIfAbsent: async (path: string) => {
    written.push(path)
    return true
  },
}))

vi.mock('./docs', () => ({ notes: { editNote: vi.fn() } }))
vi.mock('./tree', () => ({ treeOf: async () => null }))
vi.mock('../../sync-store/src/api', () => ({ sync: { nudge: () => undefined } }))

const { captureToNote } = await import('./capture')

const caller = () =>
  callerOf({
    id: 'claude',
    name: 'Claude',
    scopes: ['notes.write', 'browser'],
    spaces: ['A'],
    mode: 'unsupervised',
  })

beforeEach(() => {
  written.length = 0
})

const capture = (args: Record<string, string>) => captureToNote({ verb: 'capture_to_note', caller: caller(), args })

describe('an agent capturing a page into a folder', () => {
  test('cannot walk out of the space it was given', async () => {
    for (const folder of ['../B', '..', '../NewSpace', 'Notes/../../B']) {
      await expect(capture({ tab: 't1', as: 'link', folder })).rejects.toMatchObject({
        code: 'bad_arguments',
      })
    }
    expect(written).toEqual([])
  })

  test('cannot write into a hidden folder', async () => {
    await expect(capture({ tab: 't1', as: 'link', folder: '.orden' })).rejects.toMatchObject({
      code: 'bad_arguments',
    })
    expect(written).toEqual([])
  })

  test('captures into a folder inside it', async () => {
    await capture({ tab: 't1', as: 'link', folder: 'Clips' })
    expect(written).toEqual(['/s/A/Clips/Planted.md'])
  })
})
