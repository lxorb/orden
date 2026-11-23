import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, expect, test, vi } from 'vitest'

const you = (id: string, text: string) => ({ id, role: 'you', at: 1, parts: [], draft: { text, attachments: [] } })
const panel = vi.hoisted(() => ({
  turns: [] as unknown[],
  head: { id: 't' },
  thread: { id: 't', turns: [] as unknown[] },
  heads: [] as unknown[],
  every: [] as unknown[],
  unread: new Set<string>(),
  states: new Map<string, string>(),
  saw: vi.fn((_id: string) => Promise.resolve()),
  threadOf: (_id: string) => null,
  running: [] as string[],
  pending: {},
  steering: {},
  trouble: null,
  editing: null as string | null,
  text: 'a draft of my own',
  startEdit: vi.fn(),
  cancelEdit: vi.fn(),
  resend: vi.fn(),
  rewind: vi.fn(),
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))
vi.mock('./review/Branches.svelte', () => ({ default: () => undefined }))
vi.mock('./review/ChangesCard.svelte', () => ({ default: () => undefined }))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)
Element.prototype.scrollIntoView = () => undefined
const Conversation = (await import('./Conversation.svelte')).default
function draw() {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Conversation, { target, props: { ready: true } })
  flushSync()
  return { target, close: () => void unmount(shown) }
}
beforeEach(() => {
  for (const one of [panel.startEdit, panel.cancelEdit, panel.resend]) one.mockClear()
  panel.turns = [you('u1', 'old question'), you('u2', 'later question')]
  panel.thread.turns = panel.turns
  panel.running = []
  panel.editing = null
})
const press = (field: Element, key: string, more: KeyboardEventInit = {}) =>
  field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more }))
function typed(target: HTMLElement, words: string) {
  const field = target.querySelector<HTMLTextAreaElement>('.said textarea')
  if (!field) throw new Error('no field')
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  return field
}
const button = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll<HTMLButtonElement>('.said button')].find((one) => one.textContent === label)
test('Edit on a sent message asks for it to be edited in place', () => {
  const shown = draw()
  shown.target.querySelector<HTMLButtonElement>('.said button[title="Edit"]')?.click()
  expect(panel.startEdit).toHaveBeenCalledWith('u1')
  shown.close()
})
test('a message edited in place turns into a field with its words, focused at their end', () => {
  panel.editing = 'u1'
  const shown = draw()
  const field = shown.target.querySelector<HTMLTextAreaElement>('.said textarea')
  expect(field?.value).toBe('old question')
  expect(document.activeElement).toBe(field)
  expect([field?.selectionStart, field?.selectionEnd]).toEqual([12, 12])
  const bubbles = [...shown.target.querySelectorAll('.said .bubble')].map((one) => one.textContent)
  expect(bubbles).toEqual(['later question'])
  expect(panel.text).toBe('a draft of my own')
  shown.close()
})
test('Enter sends the edited words, Shift+Enter does not, Escape and Cancel cancel', () => {
  panel.editing = 'u1'
  const shown = draw()
  const field = typed(shown.target, 'old question, fixed')
  press(field, 'Enter', { shiftKey: true })
  expect(panel.resend).not.toHaveBeenCalled()
  press(field, 'Enter')
  expect(panel.resend).toHaveBeenCalledWith('old question, fixed')
  press(field, 'Escape')
  button(shown.target, 'Cancel')?.click()
  expect(panel.cancelEdit).toHaveBeenCalledTimes(2)
  shown.close()
})
test('a message edited down to nothing cannot be sent', () => {
  panel.editing = 'u1'
  const shown = draw()
  const field = typed(shown.target, '  ')
  expect(button(shown.target, 'Send')?.disabled).toBe(true)
  press(field, 'Enter')
  expect(panel.resend).not.toHaveBeenCalled()
  shown.close()
})
test('a message is not edited in place while the chat answers', () => {
  panel.editing = 'u1'
  panel.running = ['t']
  const shown = draw()
  expect(shown.target.querySelector('.said textarea')).toBeNull()
  shown.close()
})
