import { expect, test, vi } from 'vitest'

type Workspace = (typeof import('../../workspace/src/api'))['workspace']
type Remote = import('../../accounts/src/api').RemoteSpace
const ROOT = '/space'
interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}
const file = (name: string, children?: Entry[]): Entry => ({
  name,
  path: `${ROOT}/${name}`,
  is_dir: !!children,
  modified: 0,
  created: 0,
  children: children ?? [],
})
const TREE = {
  ...file('space', [
    file('Google Docs', []),
    file('Important Links', []),
    file('License Agreements', []),
    file('ETHCC.md'),
    file('advertisement ideas.md'),
    file('Expenses.md'),
    file('Google Docs.url'),
    file('Infra-Architektur.canvas'),
    file('Old Branding.pages'),
    file('Proton Mail.url'),
    file('Sponsors.md'),
    file('Board.base'),
  ]),
  path: ROOT,
}
const remote = (role: Remote['role'], said: Partial<Remote> = {}): Remote =>
  ({
    id: 'r1',
    name: 'ETH CodeClash',
    role,
    bookmarks: [{ kind: 'note', path: 'Proton Mail.url', text: '' }],
    icons: { 'ETHCC.md': 'sparkles' },
    graph: null,
    excluded: [],
    sort: 'manual',
    arranged: {
      '': ['ETHCC.md', 'Important Links', 'advertisement ideas.md', 'Expenses.md', 'Google Docs', 'Sponsors.md'],
    },
    archived: { 'Old Branding.pages': 1_700_000_000_000 },
    ...said,
  }) as Remote
const OTHER: Partial<Remote> = {
  bookmarks: [{ kind: 'note', path: 'Sponsors.md', text: '' }],
  icons: { 'Expenses.md': 'bag' },
  sort: 'name',
  arranged: { '': ['Sponsors.md', 'Expenses.md'] },
  archived: { 'Expenses.md': 1_600_000_000_000 },
}
const SENT: Partial<Remote> = { ...OTHER, archived: { 'Old Branding.pages': 1_700_000_000_000 } }
async function client(
  who: string,
  role: Remote['role'],
  before: (
    workspace: Workspace,
    adoptKept: (root: string, remote: Remote, who: string) => Promise<void>,
  ) => Promise<void> = async () => undefined,
) {
  vi.resetModules()
  localStorage.clear()
  const { workspace } = await import('../../workspace/src/api')
  const { adoptKept } = await import('./kept')
  workspace.spaces = [{ id: 's', name: 'ETH CodeClash', root: ROOT }]
  workspace.activeSpaceId = 's'
  workspace.tree = TREE
  await before(workspace, adoptKept)
  const said = remote(role)
  await adoptKept(ROOT, said, who)
  workspace.bookmarks.adopt(ROOT, said.bookmarks, who, role === 'read')
  return {
    rows: workspace.shownTree?.children.map((one) => one.name),
    archived: [...workspace.archive.keysOf(ROOT)],
    icons: workspace.folderIcons.of(ROOT),
    pinned: workspace.bookmarks.of(ROOT).map((one) => one.path),
    sort: workspace.sorting.of(ROOT),
  }
}
test('clients with the same synced data show the same tree: an account, a guest, a reader with another account behind it, and a device whose old order was already sent (#2556)', async () => {
  const account = await client('u1', 'owner')
  expect(account.pinned).toEqual(['Proton Mail.url'])
  expect(account.archived).toEqual(['Old Branding.pages'])
  expect(account.rows?.[0]).toBe('ETHCC.md')
  expect(account.rows).toContain('Board.base')
  expect(await client('guest:g1', 'write')).toEqual(account)
  expect(
    await client('u2', 'read', async (workspace, adoptKept) => {
      const other = remote('owner', OTHER)
      await adoptKept(ROOT, other, 'other')
      workspace.bookmarks.adopt(ROOT, other.bookmarks, 'other')
    }),
  ).toEqual(account)
  expect(
    await client('u1', 'owner', async (workspace, adoptKept) => {
      const old = remote('owner', SENT)
      await adoptKept(ROOT, old, 'u1')
      workspace.bookmarks.adopt(ROOT, old.bookmarks, 'u1')
    }),
  ).toEqual(account)
})
