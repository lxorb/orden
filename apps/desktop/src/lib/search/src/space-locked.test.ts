import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const asked = vi.hoisted(() => ({
  excluded: null as string[] | null,
  hits: [] as Hit[],
  query: null as object | null,
}))
let told: ((event: { payload: { id: number; hits: Hit[] } }) => void) | null = null
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  isNative: true,
  internal: { routed: false },
  invoke: (command: string, args: { id: number; excluded: string[]; query: object }) => {
    if (command !== 'search_space') return Promise.resolve(null)
    asked.excluded = args.excluded
    asked.query = args.query
    told?.({ payload: { id: args.id, hits: asked.hits } })
    return Promise.resolve(null)
  },
}))
vi.mock('../../windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../windows/src/api')>()),
  hearHere: (_event: string, then: typeof told) => {
    told = then
    return Promise.resolve(() => (told = null))
  },
}))
vi.mock('../../pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pdf/src/api')>()),
  papers: () => Promise.resolve({ papersFor: () => Promise.resolve(), searchPapers: () => [] }),
}))
const { workspace } = await import('../../workspace/src/api')
const { unlocks } = await import('../../protect/src/api')
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
describe('a pattern the web search refuses as too costly', () => {
  test('is refused on desktop too, so its rows and replace-all agree', async () => {
    const wild = { kind: 'regex', source: '(\\d+\\.?)+', fold: false }
    const plain = { kind: 'regex', source: '\\d+', fold: false }
    const query = { kind: 'all', of: [{ kind: 'not', of: wild }, plain] } as never
    await searchSpace(ROOT, query, [], 50, () => undefined)
    expect(asked.query).toEqual({
      kind: 'all',
      of: [{ kind: 'not', of: { ...wild, refused: true } }, plain],
    })
  })
  test('judged in the Unicode mode it runs in', async () => {
    const wild = { kind: 'regex', source: '(\\p{L}+)+;', fold: false }
    await searchSpace(ROOT, wild as never, [], 50, () => undefined)
    expect(asked.query).toEqual({ ...wild, refused: true })
  })
  test('judged with the case it ignores', async () => {
    const wild = { kind: 'regex', source: '(a|A)*b', fold: true }
    await searchSpace(ROOT, wild as never, [], 50, () => undefined)
    expect(asked.query).toEqual({ ...wild, refused: true })
  })
})
