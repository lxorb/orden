// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

/** The space around the plane and the save, stood in for. What a picture of a
 *  plane has to get right is the question the plane on screen already asks of
 *  every card: whose words these are. An SVG opened on its own is a document,
 *  and a PDF of one is printed from a window of the app's own, so a
 *  collaborator's `<img onerror>` in a card is their markup in both. */
const world = vi.hoisted(() => ({ saved: [] as string[] }))

vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
  },
}))
vi.mock('../export/save', () => ({
  chooseTarget: () => Promise.resolve(null),
  download: (_name: string, payload: { text: string }) => world.saved.push(payload.text),
}))

const { readCanvas } = await import('./format')
const { canvasSvg, exportCanvasSvg } = await import('./picture')

const HOSTILE = '<img src=x onerror="alert(1)">'

const plane = () =>
  readCanvas(
    JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: `Card ${HOSTILE}`, x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
      // A shape is the app's own, and is kept beside the nodes; see readCanvas.
      nib: {
        shapes: [
          {
            id: 'b',
            shape: 'rect',
            text: `Shape ${HOSTILE}`,
            x: 300,
            y: 0,
            width: 200,
            height: 100,
          },
        ],
      },
    }),
  )

describe('a picture of somebody else’s plane', () => {
  test('shows the HTML in its cards and shapes as the characters it is made of', () => {
    const svg = canvasSvg(plane(), {}, null, null, false, false)

    expect(svg).not.toContain('<img src=x')
    expect(svg).not.toContain('<img src="x"')
    expect(svg.match(/&lt;img src=x onerror=/g)).toHaveLength(2)
  })

  test('and the reader’s own plane keeps its markup', () => {
    const svg = canvasSvg(plane(), {}, null, null, false, true)
    expect(svg).toMatch(/<img src="?x"?/)
  })

  test('the file saved is the one the trust answer was asked of', async () => {
    world.saved = []
    await exportCanvasSvg({
      canvas: plane(),
      palette: {},
      path: null,
      root: null,
      name: 'Board.canvas',
      trusted: false,
    })

    expect(world.saved).toHaveLength(1)
    expect(world.saved[0]).not.toMatch(/<im(g|age) [^>]*onerror/)
  })
})
