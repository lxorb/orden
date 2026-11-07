import { describe, expect, test } from 'vitest'
import { canvasIconEdit, readCanvas, writeCanvas } from './canvas'

const applied = (text: string, name: string | null) => {
  const edit = canvasIconEdit(text, name)
  return edit === null ? null : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

describe('a canvas an older version wrote', () => {
  test('is read off its old key, and the new key wins where both are', () => {
    const ink = [{ id: 's', tool: 'pen', color: '1', size: 2, points: [0, 0, 0.5, 0, 0, 0] }]
    const old = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, icon: 'rocket', ink } })
    expect(readCanvas(old).icon).toBe('rocket')
    expect(readCanvas(old).ink.map((one) => one.id)).toEqual(['s'])
    const both = JSON.stringify({ nodes: [], orden: { icon: 'star' }, nib: { icon: 'rocket' } })
    expect(readCanvas(both).icon).toBe('star')
  })

  test('moves the old key to the new one when it changes', () => {
    const old = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, later: [1, 2] } })
    expect(JSON.parse(applied(old, 'rocket') ?? '')).toEqual({
      nodes: [],
      edges: [],
      orden: { version: 1, icon: 'rocket', later: [1, 2] },
    })
    const starred = JSON.stringify({ nodes: [], edges: [], nib: { version: 1, icon: 'star' } })
    const written = writeCanvas(readCanvas(starred))
    expect(JSON.parse(written)).toMatchObject({ orden: { icon: 'star' } })
    expect(written).not.toContain('"nib"')
  })
})
