import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const Canvas = (await import('../../src/lib/canvas/src/Canvas.svelte')).default
const { emptyCanvas, writeCanvas } = await import('@orden/markdown/canvas')
const { NoteDoc, Tab } = await import('../../src/lib/documents/src/api')
let close: (() => void) | undefined
afterEach(() => {
  vi.restoreAllMocks()
  close?.()
  close = undefined
  document.body.replaceChildren()
})
let boards = 0
function opened(file: string) {
  boards += 1
  const name = `Board ${String(boards)}.canvas`
  const nodes = [
    { id: 'clip', type: 'file' as const, file, x: 0, y: 0, width: 320, height: 180 },
    { id: 'words', type: 'text' as const, text: 'beside', x: 400, y: 0, width: 200, height: 80 },
    ...Array.from({ length: 400 }, (_, at) => ({
      id: `far${String(at)}`,
      type: 'text' as const,
      text: 'away',
      x: 3000 + (at % 20) * 40,
      y: Math.floor(at / 20) * 30,
      width: 30,
      height: 20,
    })),
  ]
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: `/space/${name}`,
      name,
      text: writeCanvas({ ...emptyCanvas(), nodes }),
      dirty: false,
    },
    () => undefined,
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
  const tab = new Tab(note, 'pane')
  tab.camera = { x: 0, y: 0, scale: 1 }
  const target = document.body.appendChild(document.createElement('div'))
  const shown = mount(Canvas, { target, props: { tab, focused: true } })
  close = () => void unmount(shown, { outro: false })
  flushSync()
  const host = target.querySelector<HTMLElement>('.canvas')
  if (!host) throw new Error('no plane')
  return { target, host }
}
function zoomedFarOut(host: HTMLElement) {
  for (let step = 0; step < 16; step += 1) {
    host.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '-',
        code: 'Minus',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    flushSync()
  }
}
for (const [kind, file, tag] of [
  ['film', 'clip.webm', 'video'],
  ['sound', 'talk.mp3', 'audio'],
] as const) {
  test(`a ${kind} that plays keeps playing when the canvas is zoomed far out`, () => {
    const { target, host } = opened(file)
    const player = target.querySelector(tag)
    if (!player) throw new Error(`no ${tag}`)
    player.dispatchEvent(new Event('play'))
    flushSync()
    zoomedFarOut(host)
    expect(target.querySelector('canvas[data-far]')).not.toBeNull()
    expect(player.isConnected).toBe(true)
    expect(target.querySelector(tag)).toBe(player)
    player.dispatchEvent(new Event('pause'))
    flushSync()
    expect(player.isConnected).toBe(false)
  })
}
test('a film that is not playing goes with the other cards when zoomed far out', () => {
  const { target, host } = opened('clip.webm')
  expect(target.querySelector('video')).not.toBeNull()
  zoomedFarOut(host)
  expect(target.querySelector('canvas[data-far]')).not.toBeNull()
  expect(target.querySelector('video')).toBeNull()
})
