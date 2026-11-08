import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { blankCanvas, readCanvas } from '../../src/lib/canvas/format'
import { tools } from '../../src/lib/canvas/tools.svelte'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

const stored = vi.hoisted(() => ({ pictures: 0 }))

vi.mock('../../src/lib/assets', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/assets')>()),
  storeImage: () => {
    stored.pictures += 1
    return Promise.resolve('/space/assets/shot.png')
  },
}))

Element.prototype.hasPointerCapture = () => false
globalThis.ResizeObserver = class {
  observe() {
    // jsdom does no layout: nothing is measured here.
  }
  unobserve() {
    // Said above.
  }
  disconnect() {
    // Said above.
  }
}

let host: HTMLElement
let note: NoteDoc
let close: () => void

beforeEach(() => {
  stored.pictures = 0
  vi.useFakeTimers()
  tools.choose('select')
  note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: blankCanvas(),
      dirty: false,
    },
    () => undefined,
  )
  host = document.createElement('div')
  document.body.append(host)
  const shown = mount(Canvas, {
    target: host,
    props: { tab: new Tab(note, 'pane'), focused: true },
  })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close()
  host.remove()
  vi.useRealTimers()
})

function pasted(said: Record<string, string>, files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [...Object.keys(said), ...(files.length ? ['Files'] : [])],
      files,
      items: [],
      getData: (type: string) => said[type] ?? '',
    },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
  flushSync()
}

const settled = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
  flushSync()
  vi.advanceTimersByTime(2000)
}

const shot = () => new File(['png'], 'image.png', { type: 'image/png' })

test('cells copied from a spreadsheet, which carry a picture of themselves, paste as words', async () => {
  pasted(
    {
      'text/plain': 'Name\tCount\nApples\t3',
      'text/html': '<table><tr><td>Name</td><td>Count</td></tr></table>',
    },
    [shot()],
  )
  await settled()

  const nodes = readCanvas(note.text).nodes
  expect(stored.pictures).toBe(0)
  expect(nodes.map((node) => node.type)).toEqual(['text'])
})

test('a picture alone, or with no words beside it, still pastes as a picture', async () => {
  pasted({ 'text/html': '<img src="x.png">' }, [shot()])
  await settled()

  expect(stored.pictures).toBe(1)
})
