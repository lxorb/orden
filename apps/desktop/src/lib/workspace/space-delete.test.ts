import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A space deleted while signed in. The account keeps a deleted space of its own
 *  for 14 days, but only what sync handed it: a space never pushed, a note written
 *  since the last pass, and a dotfile like `.git/` are on this disk alone. Removed
 *  outright, they were gone for good, so only a space the account holds whole may
 *  leave its folder to the account's Recently deleted. */

const sent: string[] = []
let trees = new Map<string, unknown>()

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push(command)
    if (command === 'read_tree') return Promise.resolve(trees.get(String(args?.root)) ?? null)
    if (command === 'trash_item') return Promise.resolve({ id: 't1' })
    return Promise.resolve('')
  },
}))

const account = vi.hoisted(() => ({
  signedIn: true,
  spaces: [] as { id: string; role: string }[],
}))
vi.mock('../account.svelte', () => ({ account }))

/** Which spaces sync knows the account's id of, and which notes it holds as written. */
const remote = new Map<string, string>()
let unpushed = new Set<string>()
vi.mock('../sync.svelte', () => ({
  sync: {
    remoteIdFor: (root: string) => remote.get(root) ?? null,
    holds: (path: string) => Promise.resolve(!unpushed.has(path)),
  },
}))

const { deleteSpace } = await import('./space-changes')
type HoldsSpaces = import('./spaces').HoldsSpaces

const at = (path: string, children: unknown[] = []) => ({
  name: path.split('/').pop(),
  path,
  is_dir: children.length > 0,
  modified: 0,
  created: 0,
  children,
})

function store() {
  return {
    spaces: [{ id: 'w', name: 'Work', root: '/s/Work' }],
    activeSpaceId: 'h',
    tree: null,
    fileGone: () => Promise.resolve(),
    persist: () => undefined,
  } as unknown as HoldsSpaces
}

beforeEach(() => {
  sent.length = 0
  trees = new Map([['/s/Work', at('/s/Work', [at('/s/Work/a.md')])]])
  remote.clear()
  remote.set('/s/Work', 'r1')
  unpushed = new Set()
  account.signedIn = true
  account.spaces = [{ id: 'r1', role: 'owner' }]
})

describe('a space of your own deleted signed in', () => {
  test('that the account holds whole is left to the account', async () => {
    await deleteSpace(store(), 'w')

    expect(sent).toContain('delete_space')
    expect(sent).not.toContain('trash_item')
  })

  test('with a note not pushed yet goes to this device’s trash', async () => {
    unpushed.add('/s/Work/a.md')
    await deleteSpace(store(), 'w')

    expect(sent).toContain('trash_item')
    expect(sent).not.toContain('delete_space')
  })

  test('with a dotfile in it goes to this device’s trash', async () => {
    trees.set(
      '/s/Work',
      at('/s/Work', [at('/s/Work/a.md'), at('/s/Work/.git', [at('/s/Work/.git/HEAD')])]),
    )
    await deleteSpace(store(), 'w')

    expect(sent).toContain('trash_item')
    expect(sent).not.toContain('delete_space')
  })

  test('never pushed, so the account has no id for it, goes to this device’s trash', async () => {
    remote.clear()
    await deleteSpace(store(), 'w')

    expect(sent).toContain('trash_item')
    expect(sent).not.toContain('delete_space')
  })
})

test('a space somebody else owns goes to this device’s trash', async () => {
  account.spaces = [{ id: 'r1', role: 'writer' }]
  await deleteSpace(store(), 'w')

  expect(sent).toContain('trash_item')
  expect(sent).not.toContain('delete_space')
})
