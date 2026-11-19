import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'
import { providePort, workspaceView } from '@orden/contracts'
import { serveSyncStore } from '../../../../test/sync-store'

const store = vi.hoisted(() => ({
  remoteIdFor: (root: string) => (root === '/spaces/Team' ? 'remote-team' : null),
  roleKept: () => null,
}))
vi.mock('../../sync-store/src/api', () => ({ sync: store }))
serveSyncStore(store)
vi.mock('../../workspace/src/api', () => {
  const spaces = [{ id: 'team', name: 'Team', root: '/spaces/Team' }]
  return {
    workspace: {
      spaces,
      shownSpaces: spaces,
      archivedSpaces: new Set<string>(),
      activeSpaceId: 'team',
      activeSpace: spaces[0],
      iconFor: () => null,
      tintFor: () => null,
      tabs: [],
      fileOps: { follow: () => undefined },
    },
  }
})
const { account } = await import('../../accounts/src/account.svelte')
const { workspace } = await import('../../workspace/src/api')
providePort('workspace.view', { ...workspaceView(), spaces: workspace.spaces })
const SpaceGeneral = (await import('./SpaceGeneral.svelte')).default
function drawn(role: string, admin: boolean) {
  account.listed = true
  account.spaces = [
    { id: 'remote-team', name: 'Team', role, admin, shared: true, sharedItems: [] },
  ] as unknown as typeof account.spaces
  const body = render(SpaceGeneral, { props: {} }).body
  const name = /<input[^>]*aria-label="Space name"[^>]*>/.exec(body)?.[0] ?? ''
  const icon = /<button[^>]*aria-label="Choose an icon"[^>]*>/.exec(body)?.[0] ?? ''
  return { body, names: name !== '' && !/\sreadonly/.test(name), icons: icon !== '' && !/\sdisabled/.test(icon) }
}
describe('the General part of a space in Settings', () => {
  test('shows the name and the icon of the space it is about', () => {
    const { body } = drawn('owner', false)
    expect(body).toContain('value="Team"')
    expect(body).toContain('aria-label="Choose an icon"')
  })
  test('lets the owner and an admin rename, a writer only choose the icon, and a reader neither', () => {
    expect(drawn('owner', false)).toMatchObject({ names: true, icons: true })
    expect(drawn('write', true)).toMatchObject({ names: true, icons: true })
    expect(drawn('write', false)).toMatchObject({ names: false, icons: true })
    expect(drawn('read', false)).toMatchObject({ names: false, icons: false })
  })
})
