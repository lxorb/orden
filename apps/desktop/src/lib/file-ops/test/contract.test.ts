import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncFileOp } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { carried, FileOps, inFlight, keeping, landing, moving, onLanded } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('reaches no app module but the platform', () => {
    const reached = ['api.ts', 'landing.ts'].flatMap((name) =>
      [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.\.[^']*)'/g)].map(
        (found) => found[1],
      ),
    )
    expect([...new Set(reached)]).toEqual(['../../platform/src/api'])
  })
})

describe('telling the stores what happened to a file', () => {
  test('every follower hears it, even after one of them fails', async () => {
    const ops = new FileOps()
    const heard: string[] = []
    ops.follow(() => {
      throw new Error('broken store')
    })
    ops.follow(() => Promise.reject(new Error('broken later')))
    const stop = ops.follow((op) => void heard.push(op.op))
    await ops.tell({ op: 'removed', path: '/s/Plan.md', kind: 'file', root: '/s' })
    stop()
    await ops.tell({ op: 'removed', path: '/s/Idea.md', kind: 'file', root: '/s' })
    expect(heard).toEqual(['removed'])
  })

  test('a doer runs the change while it is set, and the change runs alone once it is gone', async () => {
    const ops = new FileOps()
    const done: string[] = []
    const op: SyncFileOp = { op: 'created', path: '/s/New.md', kind: 'file', root: '/s' }
    const stop = ops.doneBy(async (seen, run) => {
      done.push(`before ${seen.op}`)
      await run()
    })
    await ops.doing(op, async () => done.push('ran'))
    stop()
    await ops.doing(op, async () => done.push('alone'))
    expect(done).toEqual(['before created', 'ran', 'alone'])
  })
})

describe('a move under way', () => {
  test('keeps its target landing until it is done, then says so', async () => {
    let heard = 0
    const stop = onLanded(() => (heard += 1))
    const seen = await inFlight('/s/Done', async () => landing('/s/Done/Plan.md'))
    stop()
    expect(seen).toBe(true)
    expect(landing('/s/Done/Plan.md')).toBe(false)
    expect(heard).toBe(1)
  })
})

describe('a store kept by path', () => {
  test('hears a move, a removal, a put back and what happened to a whole space', () => {
    const said: string[] = []
    const follow = keeping({
      moved: (from, to, root, into) => said.push(`moved ${from} ${to} ${root} ${into}`),
      gone: (path, root, back) => said.push(`gone ${path} ${root} ${back}`),
      cameBack: (path, root, back) => said.push(`back ${path} ${root} ${back}`),
      spaceMoved: (from, to) => said.push(`space ${from} ${to}`),
      forget: (root) => said.push(`forget ${root}`),
    })
    follow({ op: 'moved', from: '/s/A.md', to: '/s/B.md', kind: 'file', root: '/s' })
    follow({ op: 'removed', path: '/s/B.md', kind: 'file', root: '/s', back: 'k' })
    follow({ op: 'created', path: '/s/B.md', kind: 'file', root: '/s', back: 'k', putBack: true })
    follow({ op: 'moved', from: '/s', to: '/t', kind: 'space', root: null })
    follow({ op: 'removed', path: '/t', kind: 'space', root: null })
    expect(said).toEqual([
      'moved /s/A.md /s/B.md /s /s',
      'gone /s/B.md /s k',
      'back /s/B.md /s k',
      'space /s /t',
      'forget /t',
    ])
  })

  test('what sat under a moved folder goes with it, and the rest stays', () => {
    const move = moving('/s/Work', '/s/Done/Work', '/s')
    expect(move.across).toBe(false)
    const { left, went } = carried(
      ['Work/Plan.md', 'Idea.md'],
      move,
      (one) => one,
      (_, path) => path,
    )
    expect(left).toEqual(['Idea.md'])
    expect(went).toEqual(['Done/Work/Plan.md'])
    expect(moving('/s/Work', '/t/Work', '/s', '/t').across).toBe(true)
  })
})
