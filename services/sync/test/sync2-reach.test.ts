import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Op, OpContext, TreeEntry } from '@orden/sync-core'
import { hash32 } from '@orden/sync-core/seed'
import { type ByPath, creatingAt, movingTo } from '../src/sync2/ops'
import { changeTree, reachOf, readReach, readTree, type Tree } from '../src/sync2/tree'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { live } from './sync2'

let env: TestEnv
let space: string

beforeEach(async () => {
  env = testEnv()
  live(env)
  const token = await signIn(env, 'reach@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Reach' } })).json.space.id
})

afterEach(() => env.close())

const NAMES = ['a.md', 'A.md', 'a 2.md', 'b.md', 'Plan.md', 'x/y.md', `${'l'.repeat(250)}.md`]
const FOLDERS = ['F', 'f', 'G', 'F 2', 'Ω', 'd'.repeat(253)]

class Dice {
  private at = 0
  constructor(private readonly seed: number) {}

  next(below: number): number {
    this.at += 1
    return hash32(`${String(this.seed)}:${String(this.at)}`) % below
  }

  pick<T>(from: readonly T[]): T {
    return from[this.next(from.length)] as T
  }
}

let made = 0
const fresh = (what: string) => `${what}-${String((made += 1))}`

function anOp(dice: Dice, entries: readonly TreeEntry[], cursor: number): Op {
  const folders = entries.filter((one) => one.kind === 'folder')
  const some = () => dice.pick(entries).id
  const place = () => (folders.length && dice.next(3) ? dice.pick(folders).id : null)
  const seen = dice.pick([0, cursor, Number.MAX_SAFE_INTEGER])
  const op = fresh('op')
  const roll = entries.length < 4 ? dice.next(2) : dice.next(9)
  if (roll === 0) {
    return {
      op,
      t: 'create',
      id: fresh('n'),
      kind: 'note',
      parent: place(),
      name: dice.pick(NAMES),
      seen,
    }
  }
  if (roll === 1)
    return { op, t: 'mkdir', id: fresh('f'), parent: place(), name: dice.pick(FOLDERS), seen }
  if (roll === 2)
    return { op, t: 'rename', id: some(), name: dice.pick([...NAMES, ...FOLDERS]), seen }
  if (roll === 3 || roll === 4) {
    return dice.next(2)
      ? { op, t: 'move', id: some(), parent: place(), seen }
      : { op, t: 'move', id: some(), parent: place(), name: dice.pick(NAMES), seen }
  }
  if (roll === 5 || roll === 6) return { op, t: 'delete', id: some(), seen }
  if (roll === 7) return { op, t: 'restore', id: some(), seen }
  return { op, t: 'place', id: some(), pos: dice.pick(['a', 'b', 'c']), seen }
}

function changed(before: Tree, after: Tree): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of after.state.entries.values()) {
    const said = JSON.stringify({ ...entry, path: after.pathOf(entry.id) })
    const was = before.state.entries.get(entry.id)
    const had = was ? JSON.stringify({ ...was, path: before.pathOf(entry.id) }) : null
    if (said !== had) out.set(entry.id, said)
  }
  return out
}

function paths(): Map<string, string> {
  const rows = env.db
    .prepare('select id, path from notes where space_id = ? and deleted = 0')
    .all(space) as { id: string; path: string }[]
  return new Map(rows.map((row) => [row.id, row.path]))
}

async function oneStep(ops: readonly Op[], device: string | undefined) {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const base = await readTree(env, space, device)
  const whole = await readTree(env, space, device)
  const part = await readReach(env, space, device, reachOf(ops))
  const op = JSON.stringify(ops)

  for (const one of ops) expect(part.apply(one, context), op).toEqual(whole.apply(one, context))
  whole.statements(env)
  part.statements(env)

  const wholeChanged = changed(base, whole)
  const partChanged = changed(base, part)
  expect(JSON.stringify([...partChanged].sort(), null, 1), op).toBe(
    JSON.stringify([...wholeChanged].sort(), null, 1),
  )
  expect(part.state.cursor).toBe(whole.state.cursor)

  await changeTree(
    env,
    space,
    device,
    (tree) => ops.map((one) => tree.apply(one, context)),
    ops.map((one) => one.op),
    reachOf(ops),
  )
  const stored = await readTree(env, space, device)
  for (const [id, entry] of whole.state.entries) {
    const kept = stored.state.entries.get(id)
    expect(kept && { ...kept }, id).toEqual({ ...entry })
  }
  const written = paths()
  for (const [id, path] of written) expect(path, id).toBe(whole.pathOf(id))
}

describe('a tree op that reads only what it reaches', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test(`changes the space exactly as one that reads the whole space (seed ${String(seed)})`, async () => {
      const dice = new Dice(seed)
      for (let step = 0; step < 60; step++) {
        const tree = await readTree(env, space)
        const ops: Op[] = []
        for (let count = dice.next(4); count >= 0; count--) {
          ops.push(anOp(dice, [...tree.state.entries.values()], tree.state.cursor))
        }
        await oneStep(ops, dice.pick(['d1', 'd2', undefined]))
      }
    })
  }

  test('reads a few rows of a large space for one rename', async () => {
    const context: OpContext = { role: 'write', device: 'd1' }
    const ops: Op[] = []
    for (let at = 0; at < 300; at++) {
      ops.push({
        op: fresh('op'),
        t: 'create',
        id: `bulk-${String(at)}`,
        kind: 'note',
        parent: null,
        name: `n${String(at)}.md`,
        seen: 0,
      })
    }
    await changeTree(
      env,
      space,
      'd1',
      (tree) => ops.map((op) => tree.apply(op, context)),
      [],
      reachOf(ops),
    )

    const rename: Op = {
      op: fresh('op'),
      t: 'rename',
      id: 'bulk-7',
      name: 'n70.md',
      seen: Number.MAX_SAFE_INTEGER,
    }
    const part = await readReach(env, space, 'd1', reachOf([rename]))
    expect(part.state.entries.size).toBeLessThan(20)
    expect(part.apply(rename, context)).toMatchObject({ ok: true, name: 'n70 2.md' })
  })
})

const SEGMENTS = ['F', 'f', 'G', 'F 2', 'Ω', 'ω', 'Plan.md']

function aPath(dice: Dice): string {
  const folders = Array.from({ length: dice.next(3) }, () => dice.pick(SEGMENTS))
  return [...folders, dice.pick(NAMES.filter((one) => !one.includes('/')))].join('/')
}

function counter(step: number) {
  let at = 0
  return () => `p${String(step)}-${String((at += 1))}`
}

async function byPathStep<T>(step: number, made: ByPath<T>, device: string | undefined) {
  const base = await readTree(env, space, device)
  const whole = await readTree(env, space, device)
  const part = await readReach(env, space, device, made.reach)
  expect(made.work(part, counter(step))).toEqual(made.work(whole, counter(step)))
  whole.statements(env)
  part.statements(env)
  expect(JSON.stringify([...changed(base, part)].sort(), null, 1)).toBe(
    JSON.stringify([...changed(base, whole)].sort(), null, 1),
  )

  await changeTree(env, space, device, (tree) => made.work(tree, counter(step)), [], made.reach)
  const stored = await readTree(env, space, device)
  for (const [id, entry] of whole.state.entries) {
    const kept = stored.state.entries.get(id)
    expect(kept && { ...kept }, id).toEqual({ ...entry })
  }
  for (const [id, path] of paths()) expect(path, id).toBe(whole.pathOf(id))
}

const CONTENT = { hash: 'a'.repeat(64), size: 1, front: null, epoch: 1, epochBase: 'a'.repeat(64) }

describe('a note made or moved by its path, reading only what the path reaches', () => {
  for (const seed of [1, 2, 3, 4]) {
    test(`changes the space exactly as one that reads the whole space (seed ${String(seed)})`, async () => {
      const dice = new Dice(seed + 100)
      for (let step = 0; step < 50; step++) {
        const device = dice.pick(['d1', 'd2', undefined])
        const tree = await readTree(env, space)
        const entries = [...tree.state.entries.values()]
        const notes = entries.filter((one) => one.kind !== 'folder' && !one.deleted)
        const roll = dice.next(4)
        if (roll === 0) {
          await oneStep([anOp(dice, entries, tree.state.cursor)], device)
        } else if (roll === 1 && notes.length) {
          await byPathStep(step, movingTo(dice.pick(notes).id, aPath(dice), device), device)
        } else {
          await byPathStep(step, creatingAt(aPath(dice), device, CONTENT), device)
        }
      }
    })
  }

  test('reads a few rows of a large space to make a note in a folder', async () => {
    const context: OpContext = { role: 'write', device: 'd1' }
    const ops: Op[] = [
      { op: fresh('op'), t: 'mkdir', id: 'deep', parent: null, name: 'Deep', seen: 0 },
    ]
    for (let at = 0; at < 300; at++) {
      ops.push({
        op: fresh('op'),
        t: 'create',
        id: `bulk-${String(at)}`,
        kind: 'note',
        parent: at % 2 ? 'deep' : null,
        name: `n${String(at)}.md`,
        seen: 0,
      })
    }
    await changeTree(
      env,
      space,
      'd1',
      (tree) => ops.map((op) => tree.apply(op, context)),
      [],
      reachOf(ops),
    )

    const making = creatingAt('Deep/n7.md', 'd1', CONTENT)
    const part = await readReach(env, space, 'd1', making.reach)
    expect(part.state.entries.size).toBeLessThan(20)
    expect(making.work(part)).toEqual({ taken: 'bulk-7' })

    const moving = movingTo('bulk-8', 'Deep/n71.md', 'd1')
    const moved = await readReach(env, space, 'd1', moving.reach)
    expect(moved.state.entries.size).toBeLessThan(20)
    expect(moving.work(moved)).toBe('Deep/n71 2.md')
  })
})
