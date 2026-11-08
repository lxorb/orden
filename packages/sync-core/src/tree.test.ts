import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { linearly } from '../../../scripts/growth'
import { applyOp, contentChanged, kindOfName, nameKey, type TreeState, treeState } from './tree'
import type { Op, OpResult } from './wire'

const OWNER = { role: 'owner' as const, device: 'laptop' }
const PHONE = { role: 'owner' as const, device: 'phone' }

let counter = 0
function opId(): string {
  counter += 1
  return `op${String(counter)}`
}

function mkdir(state: TreeState, id: string, name: string, parent: string | null = null) {
  return applyOp(state, { op: opId(), t: 'mkdir', id, parent, name, seen: state.cursor }, OWNER)
}

function create(state: TreeState, id: string, name: string, parent: string | null = null) {
  return applyOp(
    state,
    { op: opId(), t: 'create', id, kind: 'note', parent, name, seen: state.cursor },
    OWNER,
  )
}

function live(state: TreeState, id: string): boolean {
  return state.entries.get(id)?.deleted === false
}

describe('tree', () => {
  test('a name already numbered is counted on, never numbered again (#1630)', () => {
    const state = treeState()
    create(state, 'a', 'App.application')
    create(state, 'b', 'App 2.application')
    const third = create(state, 'c', 'App 2.application')
    expect('name' in third ? third.name : '').toBe('App 3.application')
    mkdir(state, 'f', 'Work')
    mkdir(state, 'g', 'Work 2')
    const folder = mkdir(state, 'h', 'Work 2')
    expect('name' in folder ? folder.name : '').toBe('Work 3')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'rename', id: 'b', name: 'App 2.application', seen }, OWNER)
    expect(state.entries.get('b')?.name).toBe('App 2.application')
  })

  test('the number of a name that is taken still leaves a name', () => {
    const state = treeState()
    const long = `${'x'.repeat(252)}.md`
    create(state, 'n1', long)
    const second = create(state, 'n2', long)
    const name = 'name' in second ? second.name : ''
    expect(name.length).toBeLessThanOrEqual(255)
    expect(name).not.toBe(long)
    expect(name.endsWith('.md')).toBe(true)
    const third = create(state, 'n3', long)
    expect('name' in third && third.name.length <= 255).toBe(true)
    expect(state.entries.get('n3')?.name).not.toBe(name)

    const folder = 'y'.repeat(255)
    mkdir(state, 'f1', folder)
    const again = mkdir(state, 'f2', folder)
    expect('name' in again && again.name.length <= 255).toBe(true)
    expect('name' in again && again.name).not.toBe(folder)

    const emoji = `${'😀'.repeat(127)}.md`
    create(state, 'n4', emoji)
    const cut = create(state, 'n5', emoji)
    expect('name' in cut && cut.name.length <= 255).toBe(true)
    expect('name' in cut && /[\uD800-\uDBFF]\./.test(cut.name)).toBe(false)
  })

  test('a name let go of by a rename, a move or a delete is free again, and one taken since is not', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'a', 'Plan.md')
    create(state, 'b', 'Plan.md', 'f')
    applyOp(state, { op: opId(), t: 'rename', id: 'a', name: 'Old.md', seen: state.cursor }, OWNER)
    expect(create(state, 'c', 'plan.md')).toMatchObject({ name: 'plan.md' })
    applyOp(state, { op: opId(), t: 'move', id: 'b', parent: null, seen: state.cursor }, OWNER)
    expect(state.entries.get('b')?.name).toBe('Plan 2.md')
    expect(create(state, 'd', 'Plan.md', 'f')).toMatchObject({ name: 'Plan.md' })
    applyOp(state, { op: opId(), t: 'delete', id: 'c', seen: state.cursor }, OWNER)
    expect(create(state, 'e', 'Plan.md')).toMatchObject({ name: 'Plan.md' })
    applyOp(state, { op: opId(), t: 'rename', id: 'a', name: 'Plan.md', seen: state.cursor }, OWNER)
    expect(state.entries.get('a')?.name).toBe('Plan 3.md')
    applyOp(state, { op: opId(), t: 'restore', id: 'c', seen: state.cursor }, OWNER)
    expect(state.entries.get('c')?.name).toBe('plan 4.md')
  })

  test('a folder of many takes each new name in time that grows with the folder, not its square', () => {
    linearly((size) => {
      const state = treeState()
      for (let at = 0; at < size; at++) create(state, `n${String(at)}`, `Note ${String(at)}.md`)
      return state
    }, 2000)
  })

  test('nameKey is NFC and without case', () => {
    expect(nameKey('Café.md')).toBe(nameKey('café.MD'))
  })

  test('two creates of one name are two names, the second numbered before the extension', () => {
    const state = treeState()
    create(state, 'a', 'Untitled.md')
    const second = create(state, 'b', 'untitled.md')

    expect(second).toMatchObject({ ok: true, id: 'b', name: 'untitled 2.md' })
  })

  test('a folder is numbered at the end, its dots kept', () => {
    const state = treeState()
    mkdir(state, 'a', 'v1.2')
    expect(mkdir(state, 'b', 'v1.2')).toMatchObject({ name: 'v1.2 2' })
  })

  test('a mergeable create onto a live note of that name is merged, and changes nothing', () => {
    const state = treeState()
    create(state, 'day', '2026-09-30.md')
    const cursor = state.cursor
    const result = applyOp(
      state,
      {
        op: opId(),
        t: 'create',
        id: 'mine',
        kind: 'note',
        parent: null,
        name: '2026-09-30.md',
        mergeable: { text: '' },
        seen: 0,
      },
      PHONE,
    )

    expect(result).toEqual({ op: expect.any(String), merged: 'day' })
    expect(state.entries.has('mine')).toBe(false)
    expect(state.cursor).toBe(cursor)
  })

  test('an edit beats a delete that had not seen it', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    contentChanged(state, 'n', 'phone')

    const result = applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)
    expect(result).toMatchObject({ refused: 'edited' })
    expect(live(state, 'n')).toBe(true)
  })

  test('a device may delete what it wrote itself, whatever its cursor says', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    contentChanged(state, 'n', 'laptop')

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)).toMatchObject({
      ok: true,
    })
    expect(live(state, 'n')).toBe(false)
  })

  test('an edit landing on a deleted note brings it back, with its folder', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'n', 'Plan.md', 'f')
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 'n')).toBe(false)

    contentChanged(state, 'n', 'phone')
    expect(live(state, 'n')).toBe(true)
    expect(live(state, 'f')).toBe(true)
  })

  test('a folder delete leaves what is in a folder another device moved into it unseen', () => {
    const state = treeState()
    mkdir(state, 'f', 'Old')
    mkdir(state, 'w', 'Work')
    create(state, 'n', 'Plan.md', 'w')
    contentChanged(state, 'n', OWNER.device)
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'move', id: 'w', parent: 'f', seen }, PHONE)

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, OWNER)).toMatchObject({
      refused: 'edited',
    })
    expect([live(state, 'f'), live(state, 'w'), live(state, 'n')]).toEqual([true, true, true])
  })

  test('a folder delete leaves a note its own words brought back that it never saw come back', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'n', 'Plan.md', 'f')
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen: state.cursor }, OWNER)
    const seen = state.cursor
    contentChanged(state, 'n', PHONE.device)

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, PHONE)).toMatchObject({
      refused: 'edited',
    })
    expect([live(state, 'f'), live(state, 'n')]).toEqual([true, true])

    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, PHONE)
    expect([live(state, 'f'), live(state, 'n')]).toEqual([false, false])
  })

  test('a folder delete keeps what was made in it since, and the folder with it', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'old', 'Old.md', 'f')
    const seen = state.cursor
    applyOp(
      state,
      { op: opId(), t: 'create', id: 'new', kind: 'note', parent: 'f', name: 'New.md', seen },
      PHONE,
    )

    const result = applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, OWNER)
    expect(result).toMatchObject({ refused: 'edited' })
    expect(live(state, 'f')).toBe(true)
    expect(live(state, 'new')).toBe(true)
    expect(live(state, 'old')).toBe(false)
  })

  test('a folder delete keeps what another device moved in, even renamed since by one that never saw it there (#514)', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'move', id: 'n', parent: 'f', seen }, PHONE)

    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'Untitled.md', seen }, OWNER)
    const result = applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, OWNER)
    expect(result).toMatchObject({ refused: 'edited' })
    expect(live(state, 'n')).toBe(true)
    expect(live(state, 'f')).toBe(true)
    expect(state.entries.get('n')?.name).toBe('Untitled.md')
  })

  test("a rename made having seen the last change is the renaming device's own", () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    applyOp(
      state,
      {
        op: opId(),
        t: 'create',
        id: 'n',
        kind: 'note',
        parent: 'f',
        name: 'Plan.md',
        seen: state.cursor,
      },
      PHONE,
    )

    applyOp(
      state,
      { op: opId(), t: 'rename', id: 'n', name: 'Notes.md', seen: state.cursor },
      OWNER,
    )
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 'n')).toBe(false)
    expect(live(state, 'f')).toBe(false)
  })

  test('a folder delete that saw everything takes everything, and a restore brings it back', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    mkdir(state, 'g', 'Inner', 'f')
    create(state, 'n', 'Plan.md', 'g')
    create(state, 'gone-before', 'Old.md', 'f')
    applyOp(state, { op: opId(), t: 'delete', id: 'gone-before', seen: state.cursor }, OWNER)

    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, OWNER)
    expect(['f', 'g', 'n'].map((id) => live(state, id))).toEqual([false, false, false])

    applyOp(state, { op: opId(), t: 'restore', id: 'f', seen: state.cursor }, OWNER)
    expect(['f', 'g', 'n'].map((id) => live(state, id))).toEqual([true, true, true])
    expect(live(state, 'gone-before')).toBe(false)
  })

  test('a restore stands against a delete that had not seen it', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    mkdir(state, 'f', 'Work')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'restore', id: 'n', seen: state.cursor }, OWNER)
    applyOp(state, { op: opId(), t: 'restore', id: 'f', seen: state.cursor }, OWNER)

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, PHONE)).toMatchObject({
      refused: 'edited',
    })
    expect(applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, PHONE)).toMatchObject({
      refused: 'edited',
    })
    expect([live(state, 'n'), live(state, 'f')]).toEqual([true, true])

    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen: state.cursor }, PHONE)
    expect(live(state, 'n')).toBe(false)
  })

  test('a restore of something already back still stands against a stale delete', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'restore', id: 'n', seen: state.cursor }, OWNER)
    const restored = state.cursor
    applyOp(state, { op: opId(), t: 'restore', id: 'n', seen }, PHONE)

    expect(
      applyOp(state, { op: opId(), t: 'delete', id: 'n', seen: restored }, OWNER),
    ).toMatchObject({ refused: 'edited' })
    expect(live(state, 'n')).toBe(true)
  })

  test("a device's own restore since does not hide another's from its delete", () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    mkdir(state, 'f', 'Work')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, PHONE)
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, PHONE)
    applyOp(state, { op: opId(), t: 'restore', id: 'n', seen: state.cursor }, PHONE)
    applyOp(state, { op: opId(), t: 'restore', id: 'f', seen: state.cursor }, PHONE)

    for (const id of ['n', 'f']) {
      applyOp(state, { op: opId(), t: 'delete', id, seen }, OWNER)
      applyOp(state, { op: opId(), t: 'restore', id, seen }, OWNER)
      expect(applyOp(state, { op: opId(), t: 'delete', id, seen }, OWNER)).toMatchObject({
        refused: 'edited',
      })
    }
    expect([live(state, 'n'), live(state, 'f')]).toEqual([true, true])
  })

  test("nor do its own words since hide another device's from its delete", () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    contentChanged(state, 'n', PHONE.device)
    contentChanged(state, 'n', OWNER.device)

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)).toMatchObject({
      refused: 'edited',
    })
    expect(live(state, 'n')).toBe(true)
  })

  test('a delete that stood leaves nothing it had seen to stand against the next', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'Notes.md', seen }, PHONE)
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen: state.cursor }, PHONE)

    applyOp(state, { op: opId(), t: 'restore', id: 'n', seen }, OWNER)
    expect(applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)).toMatchObject({
      ok: true,
    })
    expect(live(state, 'n')).toBe(false)
  })

  test('a delete of a note another device renamed or moved unseen leaves it', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    mkdir(state, 'f', 'Work')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'move', id: 'n', parent: 'f', seen }, PHONE)
    expect(applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)).toMatchObject({
      refused: 'edited',
    })
    expect(live(state, 'n')).toBe(true)
  })

  test('a folder delete leaves a note its device wrote in but never saw there', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'move', id: 'n', parent: 'f', seen }, PHONE)
    contentChanged(state, 'n', OWNER.device)
    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'Plan 1.md', seen }, OWNER)

    expect(applyOp(state, { op: opId(), t: 'delete', id: 'f', seen }, OWNER)).toMatchObject({
      refused: 'edited',
    })
    expect([live(state, 'f'), live(state, 'n')]).toEqual([true, true])
  })

  test('and its own writing in a note it placed itself never stands against its delete', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    create(state, 'n', 'Plan.md', 'f')
    contentChanged(state, 'n', OWNER.device)
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor - 1 }, OWNER)
    expect([live(state, 'f'), live(state, 'n')]).toEqual([false, false])
  })

  test('the account’s own bookkeeping is nobody’s word against a delete', () => {
    const state = treeState([
      { id: 'f', kind: 'folder', parent: null, name: 'Before', deleted: false, seq: 5, docSeq: 0 },
    ])
    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: 1 }, OWNER)
    expect(live(state, 'f')).toBe(false)
  })

  test('a create or a move into a deleted folder brings it back with its ancestors', () => {
    const state = treeState()
    mkdir(state, 'a', 'A')
    mkdir(state, 'b', 'B', 'a')
    applyOp(state, { op: opId(), t: 'delete', id: 'a', seen: state.cursor }, OWNER)

    create(state, 'n', 'Plan.md', 'b')
    expect(live(state, 'a')).toBe(true)
    expect(live(state, 'b')).toBe(true)
  })

  test('two crossing folder moves: the second is refused as a cycle', () => {
    const state = treeState()
    mkdir(state, 'a', 'A')
    mkdir(state, 'b', 'B')
    const seen = state.cursor

    expect(
      applyOp(state, { op: opId(), t: 'move', id: 'a', parent: 'b', seen }, OWNER),
    ).toMatchObject({
      ok: true,
    })
    expect(
      applyOp(state, { op: opId(), t: 'move', id: 'b', parent: 'a', seen }, PHONE),
    ).toMatchObject({
      refused: 'cycle',
    })
    expect(
      applyOp(state, { op: opId(), t: 'move', id: 'a', parent: 'a', seen }, PHONE),
    ).toMatchObject({
      refused: 'cycle',
    })
  })

  test('positions: each drag moves only its row, and stays with it through a rename', () => {
    const state = treeState()
    create(state, 'a', 'A.md')
    create(state, 'b', 'B.md')
    mkdir(state, 'f', 'Work')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'place', id: 'a', pos: 'k', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'place', id: 'b', pos: 'G', seen }, PHONE)
    applyOp(state, { op: opId(), t: 'place', id: 'b', pos: 'K', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'rename', id: 'a', name: 'Z.md', seen }, PHONE)
    expect([state.entries.get('a')?.pos, state.entries.get('b')?.pos]).toEqual(['k', 'K'])

    applyOp(state, { op: opId(), t: 'move', id: 'a', parent: 'f', seen }, OWNER)
    expect(state.entries.get('a')?.pos).toBeUndefined()
    applyOp(state, { op: opId(), t: 'move', id: 'b', parent: 'f', pos: 'V', seen }, OWNER)
    expect(state.entries.get('b')?.pos).toBe('V')

    applyOp(state, { op: opId(), t: 'delete', id: 'b', seen: state.cursor }, OWNER)
    expect(
      applyOp(state, { op: opId(), t: 'place', id: 'b', pos: 'W', seen: state.cursor }, OWNER),
    ).toMatchObject({ refused: 'gone' })
  })

  test("an item's metadata: two devices setting different keys both keep theirs", () => {
    const state = treeState()
    create(state, 'a', 'A.md')
    mkdir(state, 'f', 'Work')
    const seen = state.cursor
    const meta = (id: string, patch: Record<string, string | null>, as = OWNER) =>
      applyOp(state, { op: opId(), t: 'meta', id, meta: patch, seen }, as)
    meta('a', { icon: 'rocket', 'icon-color': 'red' })
    meta('a', { cover: 'sea.png' }, PHONE)
    meta('a', { icon: 'star' }, PHONE)
    applyOp(state, { op: opId(), t: 'rename', id: 'a', name: 'Z.md', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'move', id: 'a', parent: 'f', seen }, OWNER)
    expect(state.entries.get('a')?.meta).toEqual({
      icon: 'star',
      'icon-color': 'red',
      cover: 'sea.png',
    })

    meta('a', { icon: null, 'icon-color': null, cover: null })
    expect(state.entries.get('a')?.meta).toBeUndefined()

    const before = state.cursor
    meta('a', { icon: null })
    expect(state.cursor).toBe(before)

    meta('a', { icon: 'leaf' }, PHONE)
    expect(applyOp(state, { op: opId(), t: 'delete', id: 'a', seen: before }, OWNER)).toMatchObject(
      { refused: 'edited' },
    )
    applyOp(state, { op: opId(), t: 'delete', id: 'a', seen: state.cursor }, OWNER)
    expect(meta('a', { icon: 'x' })).toMatchObject({ refused: 'gone' })
  })

  test('rename against rename: the later wins', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'One.md', seen }, OWNER)
    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'Two.md', seen }, PHONE)
    expect(state.entries.get('n')?.name).toBe('Two.md')
  })

  test('a rename of something deleted after its device looked brings it back', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    const seen = state.cursor
    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen }, OWNER)

    applyOp(state, { op: opId(), t: 'rename', id: 'n', name: 'Kept.md', seen }, PHONE)
    expect(state.entries.get('n')).toMatchObject({ deleted: false, name: 'Kept.md' })

    applyOp(state, { op: opId(), t: 'delete', id: 'n', seen: state.cursor }, OWNER)
    const stale = applyOp(
      state,
      { op: opId(), t: 'rename', id: 'n', name: 'X.md', seen: state.cursor },
      PHONE,
    )
    expect(stale).toMatchObject({ refused: 'gone' })
  })

  test('an op id seen before answers its first answer and changes nothing', () => {
    const state = treeState()
    const op: Op = {
      op: 'same',
      t: 'create',
      id: 'n',
      kind: 'note',
      parent: null,
      name: 'A.md',
      seen: 0,
    }
    const first = applyOp(state, op, OWNER)
    const cursor = state.cursor
    expect(applyOp(state, { ...op, name: 'B.md' }, OWNER)).toBe(first)
    expect(state.cursor).toBe(cursor)
  })

  test('a reader changes nothing', () => {
    const state = treeState()
    const result = applyOp(
      state,
      { op: opId(), t: 'mkdir', id: 'f', parent: null, name: 'F', seen: 0 },
      { role: 'read' },
    )
    expect(result).toMatchObject({ refused: 'role' })
    expect(state.entries.size).toBe(0)
  })

  test('an unknown id or a parent that is not a folder is gone', () => {
    const state = treeState()
    create(state, 'n', 'Plan.md')
    expect(
      applyOp(state, { op: opId(), t: 'rename', id: 'x', name: 'Y', seen: 0 }, OWNER),
    ).toMatchObject({
      refused: 'gone',
    })
    expect(create(state, 'm', 'Inside.md', 'n')).toMatchObject({ refused: 'gone' })
  })
})

const IDS = ['f1', 'f2', 'f3', 'n1', 'n2', 'n3', 'n4']
const NAMES = ['Plan.md', 'plan.md', 'PLAN.md', 'Café.md', 'café.md', 'Work', 'v1.2', 'Untitled.md']
const DEVICES = ['laptop', 'phone', 'tablet']

type Step = { kind: 'op'; op: Op; device: string } | { kind: 'edit'; id: string; device: string }

const parent = fc.constantFrom<string | null>(null, 'f1', 'f2', 'f3')
const note = fc.constantFrom('n1', 'n2', 'n3', 'n4')
const folder = fc.constantFrom('f1', 'f2', 'f3')
const anyId = fc.constantFrom(...IDS)
const name = fc.constantFrom(...NAMES)
const seen = fc.integer({ min: 0, max: 40 })
const device = fc.constantFrom(...DEVICES)

const opArb: fc.Arbitrary<Op> = fc
  .oneof(
    fc.record({ t: fc.constant('mkdir' as const), id: folder, parent, name, seen }),
    fc.record({
      t: fc.constant('create' as const),
      id: note,
      kind: fc.constant('note' as const),
      parent,
      name,
      seen,
    }),
    fc.record({
      t: fc.constant('create' as const),
      id: note,
      kind: fc.constant('note' as const),
      parent,
      name,
      seen,
      mergeable: fc.constant({ text: '' }),
    }),
    fc.record({ t: fc.constant('rename' as const), id: anyId, name, seen }),
    fc.record({ t: fc.constant('move' as const), id: anyId, parent, seen }),
    fc.record({ t: fc.constant('delete' as const), id: anyId, seen }),
    fc.record({ t: fc.constant('restore' as const), id: anyId, seen }),
  )
  .map((op) => ({ ...op, op: '' }))

const steps = fc
  .array(
    fc.oneof(
      { weight: 5, arbitrary: fc.record({ kind: fc.constant('op' as const), op: opArb, device }) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant('edit' as const), id: note, device }) },
    ),
    { maxLength: 40 },
  )
  .map((list) =>
    list.map((step, index): Step =>
      step.kind === 'op' ? { ...step, op: { ...step.op, op: `op${String(index)}` } } : step,
    ),
  )

function holdsTogether(state: TreeState) {
  const names = new Set<string>()
  for (const entry of state.entries.values()) {
    if (entry.deleted) continue
    const key = `${entry.parent ?? ''}/${nameKey(entry.name)}`
    expect(names.has(key)).toBe(false)
    names.add(key)

    const seenIds = new Set<string>()
    for (let at = entry.parent; at !== null;) {
      expect(seenIds.has(at)).toBe(false)
      seenIds.add(at)
      const above = state.entries.get(at)
      expect(above?.kind).toBe('folder')
      expect(above?.deleted).toBe(false)
      at = above?.parent ?? null
    }
  }
}

function run(list: readonly Step[]): { state: TreeState; results: OpResult[] } {
  const state = treeState()
  const results: OpResult[] = []
  for (const step of list) {
    if (step.kind === 'edit') {
      contentChanged(state, step.id, step.device)
      continue
    }

    const before = state.entries.get('id' in step.op ? step.op.id : '')
    const editedSince =
      before !== undefined &&
      !before.deleted &&
      before.kind !== 'folder' &&
      before.docSeq > step.op.seen &&
      before.docBy !== step.device
    const result = applyOp(state, step.op, { role: 'owner', device: step.device })
    results.push(result)

    if (step.op.t === 'delete' && editedSince) {
      expect(state.entries.get(step.op.id)?.deleted).toBe(false)
    }
    holdsTogether(state)
  }
  return { state, results }
}

describe('tree properties', () => {
  test('property: any ops in any order keep the tree whole, named and acyclic', () => {
    fc.assert(
      fc.property(steps, (list) => {
        run(list)
      }),
      { numRuns: 3000 },
    )
  })

  test('property: the same arrival order gives the same tree on every replica', () => {
    fc.assert(
      fc.property(steps, (list) => {
        const one = run(list)
        const other = run(list)
        expect([...other.state.entries.entries()]).toEqual([...one.state.entries.entries()])
        expect(other.results).toEqual(one.results)
      }),
      { numRuns: 1000 },
    )
  })

  test('property: every order of one set of ops keeps the tree whole', () => {
    fc.assert(
      fc.property(
        steps.chain((list) =>
          fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length })),
        ),
        ([list, shuffled]) => {
          run(list)
          run(shuffled)
        },
      ),
      { numRuns: 1000 },
    )
  })
})

describe('an online terminal in the tree', () => {
  function term(state: TreeState, id: string, name: string, parent: string | null = null) {
    return applyOp(
      state,
      { op: opId(), t: 'create', id, kind: 'term', parent, name, seen: state.cursor },
      OWNER,
    )
  }

  test('is named by its file, read off the extension', () => {
    expect(kindOfName('Build.term')).toBe('term')
    expect(kindOfName('BUILD.TERM')).toBe('term')
    expect(kindOfName('Build.term.md')).toBe('note')
    expect(kindOfName('term')).toBe('file')
    expect(kindOfName('Web.url')).toBe('url')
  })

  test('a second Terminal is numbered before its extension, as the Ctrl+T card names it', () => {
    const state = treeState()
    term(state, 'a', 'Terminal.term')
    expect(term(state, 'b', 'Terminal.term')).toMatchObject({ ok: true, name: 'Terminal 2.term' })
    expect(state.entries.get('b')?.kind).toBe('term')
  })

  test('renamed, it keeps its id and its kind, so the session stays the one it named', () => {
    const state = treeState()
    term(state, 't', 'Terminal.term')
    applyOp(
      state,
      { op: opId(), t: 'rename', id: 't', name: 'Build.term', seen: state.cursor },
      OWNER,
    )
    expect(state.entries.get('t')).toMatchObject({
      name: 'Build.term',
      kind: 'term',
      deleted: false,
    })
  })

  test('moved into another folder, it is the same entry there', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    term(state, 't', 'Build.term')
    applyOp(state, { op: opId(), t: 'move', id: 't', parent: 'f', seen: state.cursor }, OWNER)
    expect(state.entries.get('t')).toMatchObject({ parent: 'f', kind: 'term' })
  })

  test('moved beside a terminal of the same name, it steps aside', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    term(state, 'there', 'Build.term', 'f')
    term(state, 't', 'Build.term')
    applyOp(state, { op: opId(), t: 'move', id: 't', parent: 'f', seen: state.cursor }, OWNER)
    expect(state.entries.get('t')).toMatchObject({ parent: 'f', name: 'Build 2.term' })
  })

  test('trashed and restored, and trashed with its folder', () => {
    const state = treeState()
    mkdir(state, 'f', 'Work')
    term(state, 't', 'Build.term', 'f')
    applyOp(state, { op: opId(), t: 'delete', id: 't', seen: state.cursor }, OWNER)
    expect(live(state, 't')).toBe(false)
    applyOp(state, { op: opId(), t: 'restore', id: 't', seen: state.cursor }, OWNER)
    expect(live(state, 't')).toBe(true)

    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 't')).toBe(false)
    applyOp(state, { op: opId(), t: 'restore', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 't')).toBe(true)
  })

  test('a note and a terminal of one name cannot share a folder', () => {
    const state = treeState()
    term(state, 't', 'Build.term')
    expect(create(state, 'n', 'build.term')).toMatchObject({ name: 'build 2.term' })
  })
})

describe('a chat in the tree', () => {
  function chat(state: TreeState, id: string, name: string, parent: string | null = null) {
    return applyOp(
      state,
      { op: opId(), t: 'create', id, kind: 'chat', parent, name, seen: state.cursor },
      OWNER,
    )
  }

  test('is named by its pointer file, read off the extension', () => {
    expect(kindOfName('thesis.chat')).toBe('chat')
    expect(kindOfName('THESIS.CHAT')).toBe('chat')
    expect(kindOfName('thesis.chat.md')).toBe('note')
    expect(kindOfName('chat')).toBe('file')
  })

  test('a second Chat is numbered before its extension, as the Ctrl+T card names it', () => {
    const state = treeState()
    chat(state, 'a', 'Chat.chat')
    expect(chat(state, 'b', 'Chat.chat')).toMatchObject({ ok: true, name: 'Chat 2.chat' })
    expect(state.entries.get('b')?.kind).toBe('chat')
  })

  test('renamed, it keeps its id and its kind', () => {
    const state = treeState()
    chat(state, 'c', 'Chat.chat')
    applyOp(
      state,
      { op: opId(), t: 'rename', id: 'c', name: 'thesis.chat', seen: state.cursor },
      OWNER,
    )
    expect(state.entries.get('c')).toMatchObject({
      name: 'thesis.chat',
      kind: 'chat',
      deleted: false,
    })
  })

  test('moved into another folder, and beside a chat of its name, it steps aside', () => {
    const state = treeState()
    mkdir(state, 'f', 'Thesis')
    chat(state, 'there', 'thesis.chat', 'f')
    chat(state, 'c', 'thesis.chat')
    applyOp(state, { op: opId(), t: 'move', id: 'c', parent: 'f', seen: state.cursor }, OWNER)
    expect(state.entries.get('c')).toMatchObject({
      parent: 'f',
      name: 'thesis 2.chat',
      kind: 'chat',
    })
  })

  test('trashed and restored, and trashed with its folder', () => {
    const state = treeState()
    mkdir(state, 'f', 'Thesis')
    chat(state, 'c', 'thesis.chat', 'f')
    applyOp(state, { op: opId(), t: 'delete', id: 'c', seen: state.cursor }, OWNER)
    expect(live(state, 'c')).toBe(false)
    applyOp(state, { op: opId(), t: 'restore', id: 'c', seen: state.cursor }, OWNER)
    expect(live(state, 'c')).toBe(true)

    applyOp(state, { op: opId(), t: 'delete', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 'c')).toBe(false)
    applyOp(state, { op: opId(), t: 'restore', id: 'f', seen: state.cursor }, OWNER)
    expect(live(state, 'c')).toBe(true)
  })

  test('a reader can neither make nor move one', () => {
    const state = treeState()
    expect(
      applyOp(
        state,
        { op: opId(), t: 'create', id: 'c', kind: 'chat', parent: null, name: 'x.chat', seen: 0 },
        { role: 'read' },
      ),
    ).toMatchObject({ refused: 'role' })
  })
})
