import type { Canvas } from '@orden/markdown/canvas'
import { seedExtras, seedPlane as planted } from '@orden/rooms/plane'
import { TEXT } from '@orden/rooms'
import * as Y from 'yjs'

const OFFSET = 0x811c9dc5
const PRIME = 0x01000193

function spelled(parts: readonly (string | number)[]): Uint8Array {
  const words = parts.map((part) =>
    typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`,
  )
  return new TextEncoder().encode(words.join('\u0000'))
}

export function hash32(...parts: readonly (string | number)[]): number {
  let hash = OFFSET
  for (const byte of spelled(parts)) {
    hash ^= byte
    hash = Math.imul(hash, PRIME)
  }

  return hash >>> 0
}

function unixLines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function seedDoc(noteId: string, epoch: number): Y.Doc {
  const doc = new Y.Doc()
  doc.clientID = hash32(noteId, epoch)
  return doc
}

export function seedUpdate(noteId: string, epoch: number, text: string): Uint8Array {
  const doc = seedDoc(noteId, epoch)
  const words = unixLines(text)
  if (words) doc.getText(TEXT).insert(0, words)

  const update = Y.encodeStateAsUpdateV2(doc)
  doc.destroy()
  return update
}

function sortedFields<T extends object>(thing: T): T {
  const entries = Object.entries(thing).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries) as T
}

function canonical(canvas: Canvas): Canvas {
  const byId = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : 1)
  return {
    ...canvas,
    nodes: canvas.nodes.map(sortedFields),
    edges: canvas.edges.map(sortedFields),
    ink: canvas.ink.map(sortedFields),
    gone: Object.fromEntries(Object.entries(canvas.gone).sort(byId)),
  }
}

export function seedPlane(noteId: string, epoch: number, canvas: Canvas): Uint8Array {
  const doc = seedDoc(noteId, epoch)
  const content = canonical(canvas)
  doc.transact(() => {
    planted(doc, content)
  })

  if (canvas.extras) {
    doc.clientID = hash32(noteId, epoch, 'extras')
    doc.transact(() => {
      seedExtras(doc, canvas)
    })
  }

  const update = Y.encodeStateAsUpdateV2(doc)
  doc.destroy()
  return update
}
