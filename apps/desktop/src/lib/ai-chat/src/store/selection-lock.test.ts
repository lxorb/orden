import { expect, test, vi } from 'vitest'

const WORK = { id: 'work', name: 'Work', root: '/notes/Work' }
const DIARY = '/notes/Work/Private/Diary.md'

const disk = vi.hoisted(
  () => new Map<string, string>([['/notes/Work/Private/Diary.md', 'secret words']]),
)

vi.mock('../../../protect/src/api', async (original) => ({
  ...(await original<typeof import('../../../protect/src/api')>()),
  protection: {
    any: true,
    agentsMay: (path: string) => !path.startsWith('/notes/Work/Private'),
  },
}))

vi.mock('@orden/contracts', async (original) => ({
  ...(await original<typeof import('@orden/contracts')>()),
  webPages: () => ({
    clip: (tab: string) =>
      Promise.resolve({ url: 'https://x.example/', title: `page of ${tab}`, html: '<p>words</p>' }),
  }),
}))

vi.mock('../../../sharing/src/api', () => ({
  reachedByOthers: () => false,
  reachedByOthersIn: () => false,
}))

vi.mock('../../../workspace/src/api', () => ({
  workspace: {
    spaces: [WORK],
    activeSpace: WORK,
    activeSpaceId: WORK.id,
    active: { kind: 'chat', path: null, note: { shared: null } },
    notes: [],
    panelTab: { kind: 'chat', path: null },
    leftOutOf: () => [],
    noteText: (path: string) => Promise.resolve(disk.get(path) ?? null),
    tabs: [{ id: 'tab-bank', kind: 'web', path: '/notes/Work/Private/Bank.url' }],
  },
}))

vi.mock('../../../link-index/src/api', () => ({ links: {} }))
vi.mock('../../../scratchpad/src/api', () => ({
  pad: () => Promise.resolve({ where: () => Promise.resolve('') }),
}))
vi.mock('../chat/threads', () => ({ readThread: () => Promise.resolve(null) }))

const { draftOf } = await import('./gather')

test('a selection in a note shut to agents is not sent while the chat beside it has focus', async () => {
  const draft = await draftOf(
    'what is this',
    [{ kind: 'selection', id: 'selection', label: 'Selection' }],
    'auto',
    null,
    'secret words',
    WORK,
    { path: DIARY, shared: null },
  )
  expect(draft.attachments).toEqual([])
})
