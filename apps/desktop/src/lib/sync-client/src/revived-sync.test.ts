import { expect, test, vi } from 'vitest'
import { CALM, simulate, type Step } from '@orden/sync-core/sim'
import { EngineDevice } from '../test/sim-device'
import { memoryStorage } from '../test/memory-storage'

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: async () => 0,
}))

vi.stubGlobal('localStorage', memoryStorage())

const { protection } = await import('../../protect/src/api')
const { calledAlso, revived } = await import('./revived')

const settle: Step = { t: 'wait', ticks: 40 }

interface Seeing {
  entryAt(path: string): { id: string; seq: number | null } | null
  removing(path: string, run: () => Promise<unknown>): Promise<void>
}

test('a locked note deleted here and brought back by an edit elsewhere is locked again', async () => {
  const root = '/sim/d1'
  const note = `${root}/Plan.md`
  protection.set(root, note, 'password')
  const pending: Promise<void>[] = []
  const gone: string[] = []
  await simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script: [
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: 0, at: 0.5, words: 'mk301z' } },
      { t: 'act', device: 1, action: { t: 'delete', target: 0 } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ],
    device: (id, clock, random, seeded) => {
      const device = new EngineDevice(id, clock, random, seeded)
      if (id !== 'd1') return device
      const reach = device as unknown as { engine: Seeing; starting: Promise<void> }
      const tracked = (path: string) => {
        const entry = reach.engine.entryAt(path)
        return entry?.seq == null ? undefined : entry.id
      }
      void reach.starting.then(() => {
        const live = reach.engine
        const removing = live.removing.bind(live)
        live.removing = async (path, run) => {
          let back = ''
          await removing(path, async () => {
            const known = tracked(path)
            await run()
            back = 'trash-1'
            if (known) await calledAlso(back, known)
            return back
          })
          await protection.gone(path, root, back)
          gone.push(path)
        }
      })
      const write = device.disk.write.bind(device.disk)
      device.disk.write = async (path, text) => {
        const fresh = !device.disk.files.has(path)
        await write(path, text)
        if (fresh) pending.push(revived(path, tracked, [root]))
      }
      return device
    },
  })
  await Promise.all(pending)
  expect(gone).toEqual([note])
  expect(protection.locked(note)).toBe(true)
  await protection.cameBack(`${root}/Plan 2.md`, root, 'trash-1')
  expect(protection.locked(`${root}/Plan 2.md`)).toBe(true)
})
