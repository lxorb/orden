import { describe, expect, test } from 'vitest'
import { frame, type Op } from '../../src/wire'
import { ReferenceAccount } from './account'
import { judge, ledger } from './checks'
import { CALM, Clock } from './network'
import { act, pass, PLAN, roads, settle } from './roads'
import { type Report, type Step, simulate } from './run'

function run(script: readonly Step[], plant?: 'delete-without-seen'): Promise<Report> {
  return simulate({ seed: 7, devices: 2, faults: CALM, script, ...(plant ? { plant } : {}) })
}
describe('scripted roads', () => roads(run))
describe('the planted bug', () => {
  const script: Step[] = [
    act(0, { t: 'type', note: PLAN, at: 0.5, words: 'mk901z' }),
    pass(0),
    settle,
    act(1, { t: 'delete', target: PLAN }),
    pass(1),
    settle,
  ]
  test('the reference account keeps words a delete never saw', async () => {
    expect((await run(script)).failures).toEqual([])
  })
  test('an account that deletes without the seen check is caught, scripted', async () => {
    const report = await run(script, 'delete-without-seen')
    expect(report.failures).toContain('mk901z was typed and is in no note and no version')
  })
  test('and caught by the random walks, without being told where to look', async () => {
    let caught = 0
    for (let seed = 1; seed <= 200; seed++) {
      const report = await simulate({ seed, plant: 'delete-without-seen' })
      if (report.failures.length) caught += 1
    }
    expect(caught).toBeGreaterThan(0)
  })
})
describe('a folder made apart and folded into one of its name (#2386)', () => {
  async function folded(after: Op[] = []) {
    const account = new ReferenceAccount(new Clock(), [])
    const send = (device: string, ops: Op[]) => account.handle(device, 'ops', frame({ ops }))
    await send('a', [{ op: 'a1', t: 'mkdir', id: 'here', parent: null, name: 'Trip', seen: 0 }])
    await send('b', [
      { op: 'b1', t: 'mkdir', id: 'away', parent: null, name: 'Trip', mergeable: true, seen: 0 },
      { op: 'b2', t: 'delete', id: 'away', seen: 0 },
      { op: 'b3', t: 'restore', id: 'away', seen: 0 },
    ])
    await send('a', after)
    const book = ledger(['here', 'away'])
    book.deleted.set('away', 1)
    book.restored.set('away', 2)
    return { view: await account.view(), book }
  }
  test('the account names the folder an id was folded into', async () => {
    const { view } = await folded()
    expect(view.aliases).toEqual({ away: 'here' })
    expect(view.entries.map((entry) => entry.id)).toEqual(['here'])
  })
  test('a folded id that was restored is found under the folder it was folded into', async () => {
    const { view, book } = await folded()
    expect(judge(book, view, [], [])).toEqual([])
    expect(judge(book, { ...view, aliases: {} }, [], [])).toContain('away was restored and is not there')
  })
  test('the folder it was folded into, deleted after the restore, is not owed', async () => {
    const { view, book } = await folded([{ op: 'a2', t: 'delete', id: 'here', seen: 99 }])
    book.deleted.set('here', 3)
    expect(view.entries).toEqual([])
    expect(judge(book, view, [], [])).toEqual([])
    book.deleted.set('here', 0)
    expect(judge(book, view, [], [])).toContain('here was restored and is not there')
  })
})
