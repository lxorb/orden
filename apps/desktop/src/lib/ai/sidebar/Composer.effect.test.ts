import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The field's words leaving it as a command, typed out or picked from the `/` menu,
 *  end a change of a message there as a send does (B473): the field says so to the
 *  chat, rather than emptying itself and leaving the change open.
 *
 *  In the jsdom project because a field is typed into. */

const panel = vi.hoisted(() => ({
  text: '',
  chips: [] as unknown[],
  dropped: [] as string[],
  popover: null as string | null,
  head: null,
  heads: [],
  busy: false,
  changing: true,
  thread: null,
  provider: { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' },
  model: null,
  root: null,
  queue: [],
  focusAsked: 0,
  taken: vi.fn(() => (panel.text = '')),
  submit: vi.fn(),
  steer: vi.fn(),
  cancelEdit: vi.fn(),
  startEdit: vi.fn(),
  focus: vi.fn(),
}))
vi.mock('./chat.svelte', () => ({ chat: panel }))

const ran = vi.hoisted(() => [] as string[])
vi.mock('./seams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./seams')>()),
  commandsFor: () =>
    Promise.resolve([
      {
        name: 'export',
        synonyms: [],
        available: () => true,
        run: ({ args }: { args: string }) => void ran.push(`export:${args}`),
      },
    ]),
}))

/** jsdom has no animations, and the menu flies in. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const Composer = (await import('./Composer.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  ran.length = 0
  panel.taken.mockClear()
  panel.submit.mockClear()
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function composer() {
  const shown = mount(Composer, { target })
  close = () => void unmount(shown)
  flushSync()
  const field = target.querySelector('textarea')
  if (!field) throw new Error('no field')
  return field
}

const enter = (field: HTMLTextAreaElement) =>
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

test('a command typed out ends the change in the field', async () => {
  panel.text = '/export to the desk'
  const field = composer()

  enter(field)

  await vi.waitFor(() => expect(ran).toEqual(['export:to the desk']))
  expect(panel.taken).toHaveBeenCalled()
  expect(panel.submit).not.toHaveBeenCalled()
})

test('a command picked from the menu ends the change in the field', async () => {
  panel.text = '/exp'
  const field = composer()
  await vi.waitFor(() => {
    flushSync()
    expect(target.textContent).toContain('/export')
  })

  enter(field)

  await vi.waitFor(() => expect(ran).toEqual(['export:']))
  expect(panel.taken).toHaveBeenCalled()
})
