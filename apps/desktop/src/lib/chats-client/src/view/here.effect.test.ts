import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { settle } from '../../../../../test/effects/settle'

const { workspace } = await import('../../../workspace/src/api')
const { FixtureChats } = await import('./fixture.svelte')
const { useStore } = await import('./source.svelte')
const { chats } = await import('../store.svelte')
const { chatsView } = await import('./chats-view.svelte')
const ChatsPanel = (await import('./ChatsPanel.svelte')).default

afterEach(() => {
  useStore(chats)
  chatsView.query = ''
})
test('the Chats list holds the chats of the space worked in alone, and its search finds messages there alone (#2364)', async () => {
  workspace.spaces = [
    { id: 'lab', name: 'Lab', root: '/spaces/Lab' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
  ]
  workspace.activeSpaceId = 'lab'
  const store = new FixtureChats('user:me')
  const me = [{ who: 'user:me' as const, name: 'Me', role: 'owner' as const }]
  const lab = store.add('Lab talk', me, { root: '/spaces/Lab', path: '/spaces/Lab/Lab talk.chat' })
  const home = store.add('Home talk', me, { root: '/spaces/Home', path: '/spaces/Home/Home talk.chat' })
  store.speak(lab, 'user:me', 'the launch plan for the lab')
  store.speak(home, 'user:me', 'the launch plan for home')
  useStore(store)
  const target = document.createElement('div')
  document.body.append(target)
  const panel = mount(ChatsPanel, { target })
  await settle()
  const rows = () => [...target.querySelectorAll('.entry .orden-row-label')].map((one) => one.textContent)
  expect(rows()).toEqual(['Lab talk'])
  expect(target.querySelector('.space')).toBe(null)
  workspace.activeSpaceId = 'home'
  await settle()
  expect(rows()).toEqual(['Home talk'])
  chatsView.query = 'launch'
  const found = () =>
    [...target.querySelectorAll('.orden-row-label')]
      .map((one) => one.textContent)
      .filter((line) => line.includes('launch plan'))
  await vi.waitFor(() => expect(found()).toEqual(['the launch plan for home']))
  await unmount(panel)
  target.remove()
})
