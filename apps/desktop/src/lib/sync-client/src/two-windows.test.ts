import { CALM, simulate } from '@orden/sync-core/sim'
import { describe, expect, test, vi } from 'vitest'
import type { Engine } from './engine'
import { Owed, type Owing, takeOwed } from './owed'
import { EngineDevice } from '../test/sim-device'

interface Private {
  ready(): Promise<Engine | null>
  disk: {
    read(path: string): Promise<string | null>
    write(path: string, text: string): Promise<void>
  }
  root: string
}

class TwoWindows extends EngineDevice {
  private unheard: Owing[] = []
  private readonly owed = new Owed((item) => this.unheard.push(item))

  private get self(): Private {
    return this as unknown as Private
  }

  private async hear(engine: Engine) {
    for (const item of this.unheard.splice(0)) {
      await takeOwed(engine, item, async (op) => {
        if (op.op === 'created') {
          await engine.created(op.path, false, (await this.self.disk.read(op.path)) ?? '')
        }
      })
      this.owed.done(item.id)
    }
  }

  override async act(action: Parameters<EngineDevice['act']>[0]) {
    const engine = await this.self.ready()
    if (action.t === 'type' && action.words.startsWith('B-')) {
      const name = action.note === 0 ? 'Plan.md' : 'Log.md'
      const path = `${this.self.root}/${name}`
      const text = `${(await this.self.disk.read(path)) ?? ''}\n${action.words}`
      await this.self.disk.write(path, text)
      this.owed.add({ kind: 'wrote', path, text })
      if (engine && !action.words.startsWith('B-unheard')) await this.hear(engine)
      return
    }
    if (action.t === 'create' && action.name.startsWith('B-') && engine) {
      const path = `${this.self.root}/${action.name}`
      await this.self.disk.write(path, action.words)
      this.owed.add({
        kind: 'op',
        op: { op: 'created', path, kind: 'file', root: this.self.root },
      })
      await this.hear(engine)
      this.owed.add({
        kind: 'op',
        op: { op: 'created', path, kind: 'file', root: this.self.root },
      })
      await this.hear(engine)
      return
    }
    await super.act(action)
  }

  override async pass(link: Parameters<EngineDevice['pass']>[0]) {
    const engine = await this.self.ready()
    if (engine) await this.hear(engine)
    await super.pass(link)
  }
}

let made = 0
const run = (script: NonNullable<Parameters<typeof simulate>[0]['script']>) => {
  made = 0
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    device: (id, clock, random, seeded) => {
      made += 1
      return made === 1
        ? new TwoWindows(id, clock, random, seeded)
        : new EngineDevice(id, clock, random, seeded)
    },
  })
}

const SETTLE = { t: 'wait', ticks: 40 } as const

describe('one engine across two windows', () => {
  test('a note made in the window with no engine is one note', async () => {
    const report = await run([
      {
        t: 'act',
        device: 0,
        action: { t: 'create', folder: null, name: 'B-New.md', words: 'fresh mk201z' },
      },
      { t: 'pass', device: 0 },
      SETTLE,
      { t: 'pass', device: 1 },
      SETTLE,
    ])

    const named = report.account.entries.map((one) => one.name)
    expect(named.filter((name) => name.startsWith('B-New'))).toEqual(['B-New.md'])
    expect(report.failures).toEqual([])
  })

  test('both windows typing in one note lose nothing and mangle nothing', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 0, words: 'A-first mk101z' } },
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 1, words: 'B-second mk102z' } },
      { t: 'pass', device: 0 },
      SETTLE,
      { t: 'pass', device: 1 },
      SETTLE,
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 0, words: 'A-third mk103z' } },
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 1, words: 'B-fourth mk104z' } },
      { t: 'pass', device: 0 },
      SETTLE,
      { t: 'pass', device: 1 },
      SETTLE,
      { t: 'pass', device: 0 },
      SETTLE,
    ])

    const note = report.account.entries.find((one) => one.name === 'Plan.md')
    const text = note ? (report.account.texts[note.id] ?? '') : ''
    for (const words of ['A-first mk101z', 'B-second mk102z', 'A-third mk103z', 'B-fourth mk104z'])
      expect(text).toContain(words)
    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
  })

  test('a crash of the engine’s window: the next one holds it, and what it owed still lands', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 0, words: 'A-before mk301z' } },
      { t: 'pass', device: 0 },
      SETTLE,
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 1, words: 'B-unheard mk302z' } },
      { t: 'crash', device: 0 },
      { t: 'launch', device: 0 },
      { t: 'pass', device: 0 },
      SETTLE,
      { t: 'pass', device: 1 },
      SETTLE,
    ])

    const note = report.account.entries.find((one) => one.name === 'Plan.md')
    const text = note ? (report.account.texts[note.id] ?? '') : ''
    expect(text).toContain('A-before mk301z')
    expect(text).toContain('B-unheard mk302z')
    expect(report.failures).toEqual([])
  })
})

describe('what a window with no engine owes', () => {
  test('is kept until answered, said again to the next, and run where the engine lands', () => {
    const said: string[] = []
    const owed = new Owed((item) => said.push(item.id))
    owed.add({ kind: 'wrote', path: '/a', text: 'one' })
    owed.add({ kind: 'wrote', path: '/b', text: 'two' })
    expect(said).toEqual(['0', '1'])
    owed.done('0')
    owed.resend()
    expect(said).toEqual(['0', '1', '1'])
    expect(owed.drain().map((one) => one.what)).toEqual([
      { kind: 'wrote', path: '/b', text: 'two' },
    ])
    expect(owed.size).toBe(0)
  })
})

describe('a thing said again', () => {
  const engine = (id: string | null) => ({
    saved: () => Promise.resolve(),
    entryAt: () => (id === null ? null : { id }),
  })
  const removed = (id?: string): Owing => ({
    id: '0',
    what: {
      kind: 'op',
      op: { op: 'removed', path: '/s/a.md', kind: 'file', root: '/s' },
      ...(id ? { entry: id } : {}),
    },
  })

  test('takes away the note it was said of, and not a new one at that path', async () => {
    const follow = vi.fn()
    await takeOwed(engine('new'), removed('old'), follow)
    expect(follow).not.toHaveBeenCalled()
    await takeOwed(engine('old'), removed('old'), follow)
    expect(follow).toHaveBeenCalledTimes(1)
  })
})
