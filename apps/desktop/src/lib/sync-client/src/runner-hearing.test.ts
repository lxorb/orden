import '../../sync-ports'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { providePort, type SyncWriteHearing } from '@orden/contracts'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { runner } = await import('./runner.svelte')
const open = runner as unknown as { current: unknown; hearsWrites(): () => void }
function engineHearing() {
  const told: string[] = []
  open.current = {
    core: { spaces: new Map(), world: { disk: { read: () => Promise.resolve(null) } } },
    waiting: () => false,
    entryAt: () => null,
    created: (path: string, folder: boolean, text?: string) => {
      told.push(`created ${path} ${String(folder)} ${String(text)}`)
      return Promise.resolve('id')
    },
    saved: (path: string, text: string) => Promise.resolve(void told.push(`saved ${path} ${text}`)),
    foreign: (path: string) => Promise.resolve(void told.push(`foreign ${path}`)),
  }
  let hearing: (SyncWriteHearing & { changed?: (path: string) => Promise<void> }) | null = null
  const came: string[] = []
  const unbind = providePort('sync.workspace', {
    hearWrites: (one: SyncWriteHearing & { changed?: (path: string) => Promise<void> }) => {
      hearing = one
      return () => undefined
    },
    fileCame: (path: string, kind: string) => Promise.resolve(void came.push(`${kind} ${path}`)),
    openNotes: [],
    documents: [],
  } as never)
  const stop = open.hearsWrites()
  const done = () => {
    stop()
    unbind()
  }
  return { told, came, hearing: () => hearing, done }
}
afterEach(() => {
  open.current = null
})
describe('every file the app writes in a space (#2301)', () => {
  test('reaches the engine: a new file through the workspace as made, and words as saved', async () => {
    const { told, came, hearing, done } = engineHearing()
    await hearing()?.made('/s/assets/minutes.pdf')
    expect(came).toEqual(['file /s/assets/minutes.pdf'])
    hearing()?.wrote('/s/Plan.md', 'words')
    await runner.follow({ op: 'created', kind: 'file', path: '/s/assets/minutes.pdf', root: '/s' })
    await vi.waitFor(() =>
      expect(told).toEqual(['saved /s/Plan.md words', 'created /s/assets/minutes.pdf false undefined']),
    )
    done()
  })
  test('a file rewritten by its bytes reaches the engine as changed, to be read again and sent (#2301)', async () => {
    const { told, hearing, done } = engineHearing()
    await hearing()?.changed?.('/s/assets/minutes.pdf')
    expect(told).toEqual(['foreign /s/assets/minutes.pdf'])
    done()
  })
  test('one told to a window without the engine is passed to the window that has it', async () => {
    const { takeOwed } = await import('./owed')
    const told: string[] = []
    const engine = {
      saved: () => Promise.resolve(),
      foreign: (path: string) => Promise.resolve(void told.push(`foreign ${path}`)),
      entryAt: () => null,
    }
    await takeOwed(engine, { id: '1', what: { kind: 'changed', path: '/s/assets/minutes.pdf' } }, () => undefined)
    expect(told).toEqual(['foreign /s/assets/minutes.pdf'])
  })
})
