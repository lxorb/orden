import { describe, expect, test } from 'vitest'
import { canvasIconEdit, readCanvas, writeCanvas } from './canvas'
import { extrasRead, extrasText } from './canvas-extras'

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
  test('keeps every field it does not know when it is read and written, under the new key and the new names', () => {
    const old = JSON.stringify({
      nodes: [],
      edges: [],
      future: { a: 1 },
      nib: {
        version: 1,
        icon: 'star',
        later: [1, 2],
        outside: { 'nib:later': 'zz.3', 'top:future': 'zz.2' },
      },
    })
    const written = JSON.parse(writeCanvas(readCanvas(old))) as {
      nib?: unknown
      future?: unknown
      orden: { icon?: string; later?: unknown; outside: Record<string, string> }
    }
    expect(written.nib).toBeUndefined()
    expect(written.future).toEqual({ a: 1 })
    expect(written.orden.icon).toBe('star')
    expect(written.orden.later).toEqual([1, 2])
    expect(Object.keys(written.orden.outside).sort()).toEqual(['orden:later', 'top:future'])
    expect(written.orden.outside['orden:later']).toMatch(/\.4$/)
  })
  test('reads what a room kept of it under the old names, and keeps it under the new ones', () => {
    const kept = JSON.stringify({
      top: {},
      nib: { later: 1 },
      nodes: [],
      edges: [],
      ink: [],
      shapes: [],
      fields: [],
      generations: [
        ['nib:later', 2],
        ['top:future', 1],
      ],
      buried: [['nib:gone', 5]],
    })
    const extras = extrasRead(kept)
    expect(extras.orden).toEqual({ later: 1 })
    expect([...extras.generations]).toEqual([
      ['orden:later', 2],
      ['top:future', 1],
    ])
    expect([...extras.buried]).toEqual([['orden:gone', 5]])
    expect(extrasText(extras)).not.toContain('nib')
    expect(extrasRead(extrasText(extras))).toEqual(extras)
  })
})
