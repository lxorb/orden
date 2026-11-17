import { describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'

const spaceA = { id: 'a', root: '/s/A', name: 'A' }
const lockedWeb = '/s/A/Finance/Bank.url'
const doc = '[InternetShortcut]\nURL=https://bank.example/account\nOrden-Data=own-bank\n'

const tabs = [
  {
    id: 'tw',
    kind: 'web',
    shown: 'Bank',
    path: lockedWeb,
    doc,
    address: 'https://bank.example/account?session=s3cret',
    paneId: 'p1',
    note: { path: lockedWeb, home: 'a', shared: null, live: { readerAt: null }, kind: 'web' },
  },
]

const lent: unknown[] = []

vi.mock('../../workspace/src/api', () => ({
  agentMarks: { opened: {}, on: {} },
  openAgentSession: () => undefined,
  workspace: {
    spaces: [spaceA],
    activeSpace: spaceA,
    tabs,
    activeTabId: 'tw',
    previewTabId: null,
    spaceOf: (note: { home: string }) => note.home,
    showing: (pane: string) => (pane === 'p1' ? tabs[0] : null),
    outside: () => false,
    webAddressOf: (tab: { address?: string }) => tab.address ?? null,
    panes: { at: (id: string) => (id === 'p1' ? { id } : null), focusedId: 'p1', frame: {} },
  },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  webPages: () => ({ addressOf: () => null }),
  agentTabKindParts: () => ({}),
  portOf: (name: string) =>
    name === 'web.lending'
      ? {
          ok: true,
          value: {
            lend: (tab: string, as: unknown) => {
              lent.push({ tab, as })
              return Promise.resolve()
            },
            unlend: () => undefined,
            readerStore: () => Promise.resolve(null),
          },
        }
      : { ok: false },
}))

vi.mock('../../panes/src/api', () => ({
  views: { of: () => undefined },
  panesIn: () => [{ id: 'p1' }],
  paneToward: () => null,
}))
vi.mock('./docs', () => ({ notes: {} }))
vi.mock('./tree', () => ({ entryIn: vi.fn(), moveFile: vi.fn() }))

const { protection } = await import('../../protect/src/api')
vi.spyOn(protection, 'agentsMay').mockImplementation((path) => path !== lockedWeb)
const { answerTheCrate } = await import('./crate')
const { workspaceTabs } = await import('./tabs')
const { captureToNote } = await import('./capture')

describe('a web note behind a lock shut to agents', () => {
  test('is not among the reader tabs an agent may drive', async () => {
    expect(await answerTheCrate('agent.reader_tabs', {})).toEqual([])
  })

  test('is never lent to an agent', async () => {
    await answerTheCrate('agent.lend', { tab: 'tw' })
    expect(lent).toEqual([])
  })

  test('is listed without its address', async () => {
    const caller = callerOf({ id: 'x', name: 'X', scopes: ['workspace'], spaces: ['A'] })
    const answer = (await workspaceTabs({
      verb: 'workspace_tabs',
      caller,
      args: { op: 'list' },
    })) as {
      result: unknown
    }
    expect(JSON.stringify(answer.result)).not.toContain('bank.example')
  })

  test('is not captured into a note', async () => {
    const caller = callerOf({
      id: 'x',
      name: 'X',
      scopes: ['notes.write', 'browser.reader'],
      spaces: ['A'],
      mode: 'unsupervised',
    })
    await expect(
      captureToNote({ verb: 'capture_to_note', caller, args: { tab: 'tw', as: 'link' } }),
    ).rejects.toMatchObject({ code: 'protected' })
  })
})
