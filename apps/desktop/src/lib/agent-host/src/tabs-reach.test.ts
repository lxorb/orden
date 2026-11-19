import { describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const spaceA = { id: 'a', root: '/s/A', name: 'A' }
const spaceB = { id: 'b', root: '/s/B', name: 'B' }

const note = (path: string | null, home: string) => ({
  path,
  home,
  shared: null,
  live: { readerAt: null },
  kind: 'note',
})

const tabs = [
  {
    id: 'ta',
    kind: 'note',
    shown: 'Plan',
    path: '/s/A/Plan.md',
    paneId: 'p1',
    note: note('/s/A/Plan.md', 'a'),
  },
  {
    id: 'tb',
    kind: 'note',
    shown: 'Divorce lawyer',
    path: '/s/B/Divorce lawyer.md',
    paneId: 'aside',
    note: note('/s/B/Divorce lawyer.md', 'b'),
  },
  {
    id: 'tw',
    kind: 'web',
    shown: 'Bank',
    path: null,
    address: 'https://bank.example/reset?token=s3cret',
    paneId: 'aside',
    note: note(null, 'b'),
  },
]
const moved: string[] = []

vi.mock('../../workspace/src/api', () => ({
  agentMarks: { opened: {}, on: {} },
  openAgentSession: () => undefined,
  workspace: {
    spaces: [spaceA, spaceB],
    activeSpace: spaceA,
    tabs,
    activeTabId: 'ta',
    previewTabId: null,
    spaceOf: (doc: { home: string }) => doc.home,
    showing: (pane: string) => (pane === 'p1' ? tabs[0] : null),
    outside: () => false,
    webAddressOf: (tab: { address?: string }) => tab.address ?? null,
    panes: { at: (id: string) => (id === 'p1' ? { id } : null), focusedId: 'p1', frame: {} },
    moveTab: (id: string) => moved.push(id),
    split: () => undefined,
  },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  webPages: () => ({ addressOf: () => null }),
  agentTabKindParts: () => ({}),
}))

vi.mock('../../panes/src/api', () => ({
  views: { of: () => undefined },
  panesIn: () => [{ id: 'p1' }],
  paneToward: () => null,
}))
vi.mock('./docs', () => ({ notes: {} }))
vi.mock('./tree', () => ({ entryIn: vi.fn(), moveFile: vi.fn() }))

const { workspaceTabs } = await import('./tabs')

const caller = () =>
  callerOf({
    id: 'claude',
    name: 'Claude',
    scopes: ['workspace', 'workspace.focus'],
    spaces: ['A'],
    mode: 'unsupervised',
  })

const run = (args: Record<string, unknown>) => workspaceTabs({ verb: 'workspace_tabs', caller: caller(), args })

describe('an agent given space A only', () => {
  test('list shows its own space’s tabs alone', async () => {
    const listed = (await run({ op: 'list' })) as { result: { id: string }[] }
    expect(listed.result.map((one) => one.id)).toEqual(['ta'])
  })

  test('move answers with its own space’s tabs alone', async () => {
    const answer = (await run({ op: 'move', tab: 'ta', pane: 'p1' })) as {
      result: { id: string }[]
    }
    expect(answer.result.map((one) => one.id)).toEqual(['ta'])
  })

  test('arrange single leaves the tabs set aside where they are, and names only its own', async () => {
    moved.length = 0
    const answer = (await run({ op: 'arrange', layout: 'single' })) as {
      result: { id: string }[]
    }
    expect(moved).toEqual([])
    expect(answer.result.map((one) => one.id)).toEqual(['ta'])
  })
})
