import { describe, expect, test } from 'vitest'
import { retargetCanvas, rewriteCanvasLinks } from './canvas-rewrite'

/** A note renamed, and a canvas another app wrote that links it (B416). The rename
 *  changes the paths that named the note and nothing else: the canvas was read as
 *  Orden reads a plane and written back the way Orden writes one, which left out the
 *  nodes, edges and keys this build does not know, rounded a position and reordered
 *  every key - in canvases nobody had open (#501). */

const move = { from: 'Old.md', to: 'New.md' }
/** Whether a link names the note that moved, as the index answers it. */
const namesOld = (link: { target: string }) => link.target === 'Old' || link.target === 'Old.md'

/** An Obsidian canvas with what Orden does not read in it. */
const obsidian = JSON.stringify(
  {
    nodes: [
      {
        id: 'a',
        type: 'file',
        file: 'Old.md',
        x: 10.5,
        y: 20,
        width: 400,
        height: 300,
        styleAttributes: { shape: 'pill' },
      },
      {
        id: 'b',
        type: 'text',
        text: 'see [[Old]] and [[Other]]',
        x: 0,
        y: 0,
        width: 250,
        height: 60,
        color: '3',
      },
      { id: 'c', type: 'mindmap', x: 0, y: 0, width: 10, height: 10 },
      { id: 'd', type: 'text', text: 'hi', x: 0, y: 0, width: 250, height: 60 },
    ],
    edges: [
      { id: 'e1', fromNode: 'a', toNode: 'c', fromSide: 'right', toSide: 'left' },
      { id: 'e2', fromNode: 'a', toNode: 'd', label: 'x', styleAttributes: { path: 'dotted' } },
    ],
    metadata: { version: '1.0-1.0', frontmatter: { tags: ['x'] } },
  },
  null,
  '\t',
)

describe('a canvas linking a renamed note', () => {
  test('changes the paths to it and not one other character', () => {
    const out = rewriteCanvasLinks(obsidian, 'Board.canvas', move, namesOld)

    const expected = obsidian
      .replace('"file": "Old.md"', '"file": "New.md"')
      .replace('[[Old]]', '[[New]]')
    expect(out).toBe(expected)
  })

  test('is written as it is when nothing on it names the note', () => {
    const other = { from: 'Elsewhere.md', to: 'There.md' }
    expect(rewriteCanvasLinks(obsidian, 'Board.canvas', other, () => false)).toBeNull()
  })

  test('takes a new name that JSON has to escape', () => {
    const quoted = { from: 'Old.md', to: 'A "quoted" name.md' }
    const out = rewriteCanvasLinks(obsidian, 'Board.canvas', quoted, namesOld)

    expect(out).not.toBeNull()
    const nodes = (JSON.parse(out ?? '{}') as { nodes: { id: string; file?: string }[] }).nodes
    expect(nodes.find((one) => one.id === 'a')?.file).toBe('A "quoted" name.md')
  })

  test('leaves a file that is not JSON alone', () => {
    expect(rewriteCanvasLinks('{"nodes": [', 'Board.canvas', move, namesOld)).toBeNull()
  })
})

describe('a plane that keeps times, linking a renamed note', () => {
  const plane = (at: string) =>
    `{"nodes":[{"id":"a","type":"file","file":"Old.md","x":0,"y":0,"width":1,"height":1},` +
    `{"id":"b","type":"text","text":"see [[Old]]","x":0,"y":0,"width":1,"height":1},` +
    `{"id":"c","type":"text","text":"hi","x":0,"y":0,"width":1,"height":1}],` +
    `"edges":[],"nib":{"version":1,"at":${at}}}`
  const times = (text: string | null) =>
    (JSON.parse(text ?? '{}') as { nib: { at: Record<string, number> } }).nib.at
  const rewrite = (text: string) =>
    retargetCanvas(
      text,
      'Board.canvas',
      (file) => (file === 'Old.md' ? 'New.md' : null),
      (link) => (namesOld(link) ? 'New.md' : null),
      500,
    )

  test('stamps the cards it changed as changed now, and no other', () => {
    expect(times(rewrite(plane('{"a": 1, "b": 2, "c": 3}')))).toEqual({ a: 500, b: 500, c: 3 })
  })

  test('gives a card that had no time one', () => {
    expect(times(rewrite(plane('{"c": 3}')))).toEqual({ a: 500, b: 500, c: 3 })
    expect(times(rewrite(plane('{}')))).toEqual({ a: 500, b: 500 })
  })
})
