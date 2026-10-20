/** A row of the file list let go of anywhere on a chat is a link in its composer (#416),
 *  the words a drop on a note writes. Against the chats' store in memory; the transfer
 *  is the type a drag out of the list carries (drag-paths.ts), since jsdom has none. */

import { EditorView } from '@nib/editor'
import { mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

// jsdom lays nothing out, so nothing it watches ever moves.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

const { FixtureChats } = await import('../../src/lib/chats/view/fixture.svelte')
const { useStore } = await import('../../src/lib/chats/view/source.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const ChatTab = (await import('../../src/lib/chats/view/ChatTab.svelte')).default

test('a note dropped on a chat is linked in the composer', async () => {
  const chats = new FixtureChats('user:me')
  chats.add('General', [{ who: 'user:me', role: 'owner' }] as never)
  useStore(chats)
  workspace.spaces = [{ id: 'team', name: 'Team', root: '/spaces/Team' }]
  workspace.activeSpaceId = 'team'
  const tab = { path: '/spaces/Team/General.chat', note: { shared: null, text: '' } } as never
  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(ChatTab, { target, props: { tab } })
  await vi.waitFor(() => expect(target.querySelector('.cm-editor')).not.toBeNull())

  const drop = new Event('drop', { bubbles: true, cancelable: true })
  const transfer = { types: ['text/nib-path'], files: [], getData: () => '/spaces/Team/Plan.md' }
  Object.defineProperty(drop, 'dataTransfer', { value: transfer })
  target.querySelector('.chat-tab')?.dispatchEvent(drop)

  expect(drop.defaultPrevented).toBe(true)
  const field = target.querySelector<HTMLElement>('.cm-editor')
  const words = () => (field ? EditorView.findFromDOM(field)?.state.doc.toString() : null)
  await vi.waitFor(() => expect(words()).toBe('[[Plan]] '))

  // And a web tab let go of on it, as its page's address (tab-strip/chat-drop.ts).
  workspace.tabs = [{ id: 'w', kind: 'web', address: 'https://svelte.dev/' }] as never
  const web = new Event('drop', { bubbles: true, cancelable: true })
  const getData = (one: string) => (one === 'text/nib-tab' ? 'w' : '')
  Object.defineProperty(web, 'dataTransfer', { value: { types: [], files: [], getData } })
  target.querySelector('.chat-tab')?.dispatchEvent(web)
  expect(words()).toBe('[[Plan]] https://svelte.dev/ ')
  void unmount(drawn)
})
