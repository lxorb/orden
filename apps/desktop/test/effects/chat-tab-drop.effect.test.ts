/** A tab let go of over a chat is handed to it as the drop of its file's row (#416), and
 *  a web tab as itself; the chat's own tab, let go of over it, is handed nothing. See tab-strip/chat-drop.ts;
 *  jsdom has no drag events and lays nothing out, so the test says what is under the
 *  pointer and gives the transfer its two calls. */

import { expect, test, vi } from 'vitest'

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: {
    tabs: [
      { id: 'note', path: '/s/Plan.md' },
      { id: 'chat', path: '/s/General.chat' },
      { id: 'web', kind: 'web', path: '/s/Svelte.url' },
    ],
  },
}))
vi.stubGlobal(
  'DataTransfer',
  class extends Map<string, string> {
    setData = (type: string, words: string) => void this.set(type, words)
    getData = (type: string) => this.get(type) ?? ''
  },
)
vi.stubGlobal(
  'DragEvent',
  class extends Event {
    dataTransfer: DataTransfer
    constructor(type: string, init: EventInit & { dataTransfer: DataTransfer }) {
      super(type, init)
      this.dataTransfer = init.dataTransfer
    }
  },
)

const { droppedOnChat, overChat } = await import('../../src/lib/tab-strip/chat-drop')

test('a tab let go of on a chat is dropped on it as its file, and the chat itself is not', () => {
  document.body.innerHTML = '<div data-chat-drop="chat"><p id="words"></p></div><p id="away"></p>'
  const taken: string[] = []
  document.querySelector('[data-chat-drop]')?.addEventListener('drop', (event) => {
    const carried = (event as DragEvent).dataTransfer
    taken.push(`${carried?.getData('text/nib-path')}${carried?.getData('text/nib-tab')}`)
  })
  let under = document.getElementById('words')
  document.elementFromPoint = () => under

  overChat({ x: 1, y: 1 })
  expect(droppedOnChat('note')).toBe(true)
  overChat({ x: 1, y: 1 })
  expect(droppedOnChat('web')).toBe(true)
  overChat({ x: 1, y: 1 })
  expect(droppedOnChat('chat')).toBe(false)
  under = document.getElementById('away')
  overChat({ x: 1, y: 1 })
  expect(droppedOnChat('note')).toBe(false)
  expect(taken).toEqual(['/s/Plan.md', 'web'])
})
