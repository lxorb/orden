import { describe, expect, it } from 'vitest'
import {
  applyOp,
  between,
  byPosition,
  ENTRY_KINDS,
  isEntryId,
  isPosition,
  metaOf,
  type Op,
  type OpContext,
  opOf,
  patched,
  sameMeta,
  spread,
  type TreeEntry,
  type TreeState,
  treeState,
} from '../src/api'

describe('order', () => {
  it('always finds a position between two others', () => {
    const first = between(null, null)
    const after = between(first, null)
    const before = between(null, first)
    const middle = between(before, after)
    expect(before < first && first < after).toBe(true)
    expect(before < middle && middle < after).toBe(true)
    for (const one of [first, after, before, middle]) expect(isPosition(one)).toBe(true)
  })
  it('spreads a count of positions in order', () => {
    const positions = spread(null, null, 5)
    expect(positions).toHaveLength(5)
    expect([...positions].sort()).toEqual(positions)
    expect(new Set(positions).size).toBe(5)
  })
  it('sorts by position and leaves equal rows where they were', () => {
    const [a, b, c] = spread(null, null, 3)
    const rows = [
      { id: 'two', pos: b },
      { id: 'three', pos: c },
      { id: 'one', pos: a },
    ]
    expect([...rows].sort(byPosition).map((one) => one.id)).toEqual(['one', 'two', 'three'])
  })
})
describe('item meta', () => {
  it('reads only string-to-string records', () => {
    expect(metaOf({ colour: 'red' })).toEqual({ colour: 'red' })
    expect(metaOf({ colour: 3 })).toBeNull()
    expect(metaOf('red')).toBeNull()
  })
  it('patches with null meaning removed and compares by value', () => {
    const had = { colour: 'red', icon: 'star' }
    const next = patched(had, { icon: null, size: 'big' })
    expect(next).toEqual({ colour: 'red', size: 'big' })
    expect(sameMeta(had, { icon: 'star', colour: 'red' })).toBe(true)
    expect(sameMeta(had, next)).toBe(false)
    expect(patched(undefined, { icon: null })).toBeUndefined()
  })
})
describe('wire', () => {
  it('names the entry kinds and refuses ids that could be paths', () => {
    expect(ENTRY_KINDS).toEqual(['note', 'canvas', 'pages', 'url', 'term', 'chat', 'file', 'folder'])
    expect(isEntryId('abc')).toBe(true)
    expect(isEntryId('a/b')).toBe(false)
    expect(isEntryId('')).toBe(false)
  })
})
describe('two devices make a folder of one name apart (#2254)', () => {
  const HERE: OpContext = { role: 'owner', device: 'here' }
  const AWAY: OpContext = { role: 'owner', device: 'away' }
  let count = 0
  const opId = () => {
    count += 1
    return `fold${String(count)}`
  }
  const mkdir = (id: string, name: string, parent: string | null = null): Op => ({
    op: opId(),
    t: 'mkdir',
    id,
    parent,
    name,
    mergeable: true,
    seen: 0,
  })
  const plainMkdir = (id: string, name: string, parent: string | null = null): Op => ({
    op: opId(),
    t: 'mkdir',
    id,
    parent,
    name,
    seen: 0,
  })
  const note = (id: string, name: string, parent: string | null): Op => ({
    op: opId(),
    t: 'create',
    id,
    kind: 'note',
    parent,
    name,
    seen: 0,
  })
  const run = (state: TreeState, ops: Op[], context: OpContext) => ops.map((op) => applyOp(state, op, context))
  const paths = (state: TreeState): string[] => {
    const path = (entry: TreeEntry): string => {
      const up = entry.parent === null ? undefined : state.entries.get(entry.parent)
      return up ? `${path(up)}/${entry.name}` : entry.name
    }
    return [...state.entries.values()]
      .filter((entry) => !entry.deleted)
      .map(path)
      .sort()
  }
  it('folds the later folder into the live one, and its notes land inside', () => {
    const state = treeState()
    run(state, [mkdir('here', 'Ideas'), note('h1', 'Here idea.md', 'here')], HERE)
    const [folder, made] = run(state, [mkdir('away', 'ideas'), note('a1', 'Away idea.md', 'away')], AWAY)
    expect(folder).toEqual({ op: expect.any(String), merged: 'here' })
    expect(made).toMatchObject({ ok: true, id: 'a1', parent: 'here', name: 'Away idea.md' })
    expect(state.entries.has('away')).toBe(false)
    expect(paths(state)).toEqual(['Ideas', 'Ideas/Away idea.md', 'Ideas/Here idea.md'])
  })
  it('numbers only the children whose names collide, by the note rule', () => {
    const state = treeState()
    run(state, [mkdir('here', 'Ideas'), note('h1', 'Plan.md', 'here')], HERE)
    run(state, [mkdir('away', 'Ideas'), note('a1', 'Plan.md', 'away'), note('a2', 'Trip.md', 'away')], AWAY)
    expect(paths(state)).toEqual(['Ideas', 'Ideas/Plan 2.md', 'Ideas/Plan.md', 'Ideas/Trip.md'])
  })
  it('folds nested folders level by level and points later ops at the folders kept', () => {
    const state = treeState()
    run(state, [mkdir('here', 'Ideas'), mkdir('hereSub', 'Sub', 'here'), note('h1', 'a.md', 'hereSub')], HERE)
    const results = run(
      state,
      [
        mkdir('away', 'Ideas'),
        mkdir('awaySub', 'Sub', 'away'),
        note('a1', 'b.md', 'awaySub'),
        { op: opId(), t: 'move', id: 'a1', parent: 'away', seen: 0 },
        { op: opId(), t: 'place', id: 'awaySub', pos: between(null, null), seen: 0 },
      ],
      AWAY,
    )
    expect(results[1]).toEqual({ op: expect.any(String), merged: 'hereSub' })
    expect(results[3]).toMatchObject({ ok: true, id: 'a1', parent: 'here' })
    expect(results[4]).toMatchObject({ ok: true, id: 'hereSub' })
    expect(paths(state)).toEqual(['Ideas', 'Ideas/Sub', 'Ideas/Sub/a.md', 'Ideas/b.md'])
  })
  it('numbers a folder made without the flag as before', () => {
    const state = treeState()
    run(state, [plainMkdir('here', 'Ideas')], HERE)
    const [folder] = run(state, [plainMkdir('away', 'Ideas'), note('a1', 'Away idea.md', 'away')], AWAY)
    expect(folder).toMatchObject({ ok: true, id: 'away', name: 'Ideas 2' })
    expect(paths(state)).toEqual(['Ideas', 'Ideas 2', 'Ideas 2/Away idea.md'])
  })
  it('never folds into a file of that name or a deleted folder', () => {
    const state = treeState()
    run(state, [{ op: opId(), t: 'create', id: 'f', kind: 'file', parent: null, name: 'Ideas', seen: 0 }], HERE)
    expect(run(state, [mkdir('away', 'Ideas')], AWAY)[0]).toMatchObject({ ok: true, id: 'away', name: 'Ideas 2' })
    run(state, [mkdir('gone', 'Old')], HERE)
    run(state, [{ op: opId(), t: 'delete', id: 'gone', seen: state.cursor }], HERE)
    expect(run(state, [mkdir('later', 'Old')], AWAY)[0]).toMatchObject({ ok: true, id: 'later', name: 'Old' })
  })
  it('lands a batch sent again after part of it was taken inside the live folder', () => {
    const state = treeState()
    run(state, [mkdir('here', 'Ideas')], HERE)
    const batch = [mkdir('away', 'Ideas'), note('a1', 'Away idea.md', 'away')]
    run(state, batch.slice(0, 1), AWAY)
    const reloaded = treeState(state.entries.values(), state.cursor)
    for (const [op, result] of state.done) reloaded.done.set(op, result)
    const [folder, made] = run(reloaded, batch, AWAY)
    expect(folder).toEqual({ op: expect.any(String), merged: 'here' })
    expect(made).toMatchObject({ ok: true, id: 'a1', parent: 'here' })
    expect(paths(reloaded)).toEqual(['Ideas', 'Ideas/Away idea.md'])
  })
  it('reads the folder flag only as true', () => {
    const op = { op: 'o1', t: 'mkdir', id: 'f', parent: null, name: 'Ideas', seen: 0 }
    expect(opOf({ ...op, mergeable: true })).toEqual({ ...op, mergeable: true })
    expect(opOf(op)).toEqual(op)
    expect(opOf({ ...op, mergeable: 'yes' })).toBeNull()
    expect(opOf({ ...op, mergeable: false })).toBeNull()
  })
})
