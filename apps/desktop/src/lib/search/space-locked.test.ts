import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const asked = vi.hoisted(() => ({ excluded: null as string[] | null, hits: [] as Hit[] }))
let told: ((event: { payload: { id: number; hits: Hit[] } }) => void) | null = null

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isNative: true,
  internal: { routed: false },
  invoke: (command: string, args: { id: number; excluded: string[] }) => {
    if (command !== 'search_space') return Promise.resolve(null)
    asked.excluded = args.excluded
    told?.({ payload: { id: args.id, hits: asked.hits } })
    return Promise.resolve(null)
  },
}))
vi.mock('../own-window', () => ({
  hearHere: (_event: string, then: typeof told) => {
    told = then
    return Promise.resolve(() => (told = null))
  },
}))
vi.mock('../pdf/papers', () => ({ papersFor: () => Promise.resolve(), searchPapers: () => [] }))
vi.mock('./inbox', () => ({ inboxHits: () => Promise.resolve([]) }))

const { workspace } = await import('../workspace.svelte')
const { unlocks } = await import('../protect/unlocked.svelte')
const { searchSpace } = await import('./space')

const ROOT = '/space'
const hit = (path: string): Hit => ({ path, name: path, line: 1, text: 'tulip', ranges: [] })

async function found(): Promise<string[]> {
  const out: string[] = []
  const query = { kind: 'term', text: 'tulip' } as never
  await searchSpace(ROOT, query, [], 50, (batch) => out.push(...batch.hits.map((one) => one.path)))
  return out
}

beforeEach(() => {
  asked.excluded = null
  asked.hits = [hit(`${ROOT}/Diary/a.md`), hit(`${ROOT}/Plans.md`)]
  workspace.protection.set(ROOT, `${ROOT}/Diary`, null)
  workspace.protection.set(ROOT, ROOT, null)
  unlocks.lockAll()
})

describe('a search', () => {
  test('neither reads nor shows what is protected and shut', async () => {
    workspace.protection.set(ROOT, `${ROOT}/Diary`, 'password')
    expect(await found()).toEqual([`${ROOT}/Plans.md`])
    expect(asked.excluded).toContain('Diary')
  })

  test('finds it again once it is open', async () => {
    workspace.protection.set(ROOT, `${ROOT}/Diary`, 'password')
    unlocks.unlock(workspace.protection.covering(`${ROOT}/Diary/a.md`))
    expect(await found()).toEqual([`${ROOT}/Diary/a.md`, `${ROOT}/Plans.md`])
  })

  test('of a space that is protected and shut answers nothing', async () => {
    workspace.protection.set(ROOT, ROOT, 'password')
    expect(await found()).toEqual([])
    expect(asked.excluded).toBeNull()
  })
})
