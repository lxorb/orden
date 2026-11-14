import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const panel = vi.hoisted(() => ({
  text: '',
  chips: [] as unknown[],
  dropped: [] as string[],
  popover: null as string | null,
  head: null,
  heads: [] as unknown[],
  busy: false,
  changing: true,
  thread: null,
  provider: { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' },
  model: null,
  root: null,
  queue: [],
  focusAsked: 0,
  trouble: null as string | null,
  taken: vi.fn(() => (panel.text = '')),
  submit: vi.fn(),
  steer: vi.fn(),
  cancelEdit: vi.fn(),
  startEdit: vi.fn(),
  focus: vi.fn(),
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))

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

const drawn = vi.hoisted(() => [] as string[])
vi.mock('./picture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./picture')>()),
  chatPicture: (file: File) => {
    drawn.push(file.name)
    return new Promise((resolve) =>
      setTimeout(() => resolve({ mime: 'image/png', data: 'AAAA' }), 5),
    )
  },
}))

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { views } = await import('../../views.svelte')
const Composer = (await import('./Composer.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  ran.length = 0
  panel.taken.mockClear()
  panel.submit.mockClear()
  panel.chips = []
  panel.heads = []
  panel.trouble = null
  panel.steer.mockClear()
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

test('two chips of one name are both drawn', () => {
  panel.text = ''
  panel.chips = [
    { kind: 'words', id: '#Ana', label: '#Ana', text: 'one' },
    { kind: 'words', id: '#Ana', label: '#Ana', text: 'two' },
  ]
  expect(() => composer()).not.toThrow()
  expect(target.querySelectorAll('.chip .name')).toHaveLength(2)
})

test('a chat of another space picked with @ keeps its space', async () => {
  panel.heads = [{ id: 'garden', title: 'Garden', space: 'home', updated: 1, archived: false }]
  panel.text = '@Gar'
  const field = composer()
  field.setSelectionRange(4, 4)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.waitFor(() => {
    flushSync()
    expect(target.textContent).toContain('Garden')
  })

  enter(field)

  expect(panel.chips).toEqual([{ kind: 'thread', id: 'garden', label: 'Garden', space: 'home' }])
})

test('Ctrl+Enter with nothing running sends as Enter does, the selection with it', async () => {
  const chosen = views.chosen
  views.chosen = 5
  const picked = vi.spyOn(views, 'selectedText').mockReturnValue('picked words')
  panel.text = 'explain this'
  panel.chips = []
  const field = composer()

  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

  await vi.waitFor(() => expect(panel.submit).toHaveBeenCalled())
  views.chosen = chosen
  picked.mockRestore()
  expect(panel.steer).not.toHaveBeenCalled()
  expect((panel.chips as { kind: string }[]).map((one) => one.kind)).toEqual(['selection'])
})

test('Ctrl+Enter with nothing running runs a typed command', async () => {
  panel.text = '/export to the desk'
  const field = composer()

  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

  await vi.waitFor(() => expect(ran).toEqual(['export:to the desk']))
  expect(panel.steer).not.toHaveBeenCalled()
  expect(panel.submit).not.toHaveBeenCalled()
})

function pasted(field: HTMLTextAreaElement, files: File[], text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files, getData: (kind: string) => (kind === 'text/plain' ? text : '') },
  })
  field.dispatchEvent(event)
  return event
}

test('a very long paste comes in as text beside the field, not into it', () => {
  const field = composer()
  const long = 'The heron stands still. '.repeat(5_000)

  const event = pasted(field, [], long)

  expect(event.defaultPrevented).toBe(true)
  expect(panel.chips).toEqual([
    { kind: 'words', id: expect.any(String), label: 'Text', text: long },
  ])
  expect(field.value).toBe('')
  pasted(field, [], `${long}again`)
  expect(panel.chips).toHaveLength(2)
  expect(pasted(field, [], 'a short line').defaultPrevented).toBe(false)
})

test('a file too large or not text says why it was not added', async () => {
  const field = composer()

  pasted(field, [new File(['x'.repeat(2_000_001)], 'huge.log', { type: 'text/plain' })])
  expect(panel.trouble).toContain('huge.log was not added')
  expect(panel.chips).toEqual([])

  panel.trouble = null
  pasted(field, [new File(['a\u0000b'], 'tool.bin')])
  await vi.waitFor(() => expect(panel.trouble).toContain('tool.bin was not added'))
  expect(panel.chips).toEqual([])

  panel.trouble = null
  pasted(field, [new File(['plain words'], 'notes.txt', { type: 'text/plain' })])
  await vi.waitFor(() =>
    expect(panel.chips).toEqual([
      { kind: 'words', id: expect.any(String), label: 'notes.txt', text: 'plain words' },
    ]),
  )
  expect(panel.trouble).toBeNull()
})

test('text files dropped all at once stop at as much text as a message takes, and say so', async () => {
  panel.chips = []
  panel.trouble = null
  const field = composer()
  const big = (name: string) => new File(['x'.repeat(1_500_000)], name, { type: 'text/plain' })

  pasted(field, [big('a.log'), big('b.log'), big('c.log')])

  expect(panel.trouble).toContain('c.log was not added')
  await vi.waitFor(() => expect(panel.chips).toHaveLength(2))
  panel.trouble = null
  pasted(field, [], 'y'.repeat(1_200_000))
  expect(panel.trouble).toContain('was not added')
  expect(panel.chips).toHaveLength(2)
})

test('two files of one name are both added, each with its own words', async () => {
  panel.chips = []
  const field = composer()

  pasted(field, [new File(['first'], 'notes.txt', { type: 'text/plain' })])
  await vi.waitFor(() => expect(panel.chips).toHaveLength(1))
  pasted(field, [new File(['second'], 'notes.txt', { type: 'text/plain' })])
  await vi.waitFor(() => expect(panel.chips).toHaveLength(2))
  expect((panel.chips as { text?: string }[]).map((one) => one.text)).toEqual(['first', 'second'])
})

test('pictures pasted all at once stop at as many as a message takes, and say so', async () => {
  const field = composer()
  const shots = Array.from(
    { length: 30 },
    (_, at) => new File(['x'], `shot-${String(at + 1)}.png`, { type: 'image/png' }),
  )

  pasted(field, shots)

  expect(drawn).toHaveLength(20)
  expect(panel.trouble).toContain('shot-30.png was not added')
  await vi.waitFor(() => expect(panel.chips).toHaveLength(20))
  pasted(field, [new File(['x'], 'one-more.png', { type: 'image/png' })])
  expect(drawn).toHaveLength(20)
  expect(panel.trouble).toContain('one-more.png was not added')
})
