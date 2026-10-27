import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

/** A plane with more cards in view than a page of elements carries is drawn from far
 *  away (#535): its cards boxes on one canvas, no card an element and none of their
 *  markdown made into HTML, which was seconds for eight thousand. And near, an undo
 *  gives back the cards it changed without making the others again.
 *
 *  In the jsdom project because it mounts the plane. */

const made: string[] = []
vi.mock('../../src/lib/canvas/render', async (actual) => {
  const real = await actual<typeof import('../../src/lib/canvas/render')>()
  return {
    ...real,
    cardHtml: (...args: Parameters<typeof real.cardHtml>) => {
      made.push(args[0])
      return real.cardHtml(...args)
    },
  }
})

const Canvas = (await import('../../src/lib/Canvas.svelte')).default
const { emptyCanvas, writeCanvas } = await import('../../src/lib/canvas/format')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
  made.length = 0
})

/** The plane mounted on cards of `count`, laid out small and close so every one is in
 *  view, joined each to the next. */
function opened(count: number) {
  const nodes = Array.from({ length: count }, (_, at) => ({
    id: `n${String(at)}`,
    type: 'text' as const,
    text: `card **${String(at)}**`,
    x: (at % 20) * 40,
    y: Math.floor(at / 20) * 30,
    width: 30,
    height: 20,
  }))
  const edges = nodes.slice(1).map((node, at) => ({
    id: `e${String(at)}`,
    fromNode: `n${String(at)}`,
    toNode: node.id,
  }))
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: writeCanvas({ ...emptyCanvas(), nodes, edges }),
      dirty: false,
    },
    () => undefined,
  )
  const target = document.body.appendChild(document.createElement('div'))
  const shown = mount(Canvas, { target, props: { tab: new Tab(note, 'pane'), focused: true } })
  close = () => void unmount(shown, { outro: false })
  flushSync()
  const host = target.querySelector<HTMLElement>('.canvas')
  if (!host) throw new Error('no plane')
  return { target, host }
}

const press = (host: HTMLElement, key: string, ctrlKey = false) => {
  host.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }),
  )
  flushSync()
}

test('far away, draws its cards on one canvas: no card an element, no markdown made', () => {
  const { target, host } = opened(400)

  expect(target.querySelector('canvas[data-far]')).not.toBeNull()
  expect(target.querySelectorAll('.node')).toHaveLength(0)
  expect(target.querySelectorAll('.edge')).toHaveLength(0)
  expect(made).toEqual([])

  // Picked and moved from there, still nothing to make.
  press(host, 'a', true)
  press(host, 'ArrowRight')
  expect(target.querySelectorAll('.node')).toHaveLength(0)
  expect(made).toEqual([])
})

/** #535: the layer comes up in the frame the cards go, zooming out past reading. Its
 *  first paint waited for the next frame, so the frame between showed neither cards nor
 *  boxes: a blink of an empty plane. It paints as it appears. */
test('paints the boxes the moment it comes up, not a frame later', () => {
  const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
  const painted = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  try {
    const { target } = opened(400)
    const far = target.querySelector('canvas[data-far]')
    expect(far).not.toBeNull()
    expect(painted.mock.contexts).toContain(far)
  } finally {
    frames.mockRestore()
    painted.mockRestore()
  }
})

test('near, draws them as cards, and an undo makes none of them again', () => {
  const { target, host } = opened(6)

  expect(target.querySelector('canvas[data-far]')).toBeNull()
  const cards = () => [...target.querySelectorAll<HTMLElement>('.node')]
  const before = cards()
  expect(before).toHaveLength(6)

  const left = () => before[0]?.style.left
  expect(left()).toBe('0px')
  press(host, 'a', true)
  press(host, 'ArrowRight')
  expect(left()).toBe('1px')
  press(host, 'z', true)
  expect(left()).toBe('0px')

  const after = cards()
  expect(after).toHaveLength(6)
  // The very same elements: given new places, not made again.
  for (const [at, card] of after.entries()) expect(card).toBe(before[at])
})
