import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseQuery } from '@orden/scan/search/query'

describe('a worker that cannot be started', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  test('warms nothing and says nothing where there is no Worker at all', async () => {
    vi.stubGlobal('Worker', undefined)
    const { warmSpace } = await import('./search-client')
    expect(() => warmSpace('/space', () => undefined)).not.toThrow()
  })
  test('answers a search with nothing, and finishes it', async () => {
    vi.stubGlobal('Worker', undefined)
    const { searchInWorker } = await import('./search-client')
    const found = vi.fn()
    await searchInWorker('/space', parseQuery('alpha'), ['alpha'], 10, found)
    expect(found).not.toHaveBeenCalled()
  })
  test('is tried again on the next question', async () => {
    const posted: unknown[] = []
    let refuse = true
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          if (refuse) throw new Error('refused by the page')
        }
        postMessage(message: unknown) {
          posted.push(message)
        }
        terminate = vi.fn()
      },
    )
    const { warmSpace } = await import('./search-client')
    warmSpace('/space', () => undefined)
    refuse = false
    warmSpace('/space', () => undefined)
    expect(posted).toEqual([{ kind: 'warm', root: '/space' }])
  })
})
describe('a search that sticks on one note', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  test('goes on without that note, keeping what it already found', async () => {
    vi.useFakeTimers()
    const made: { posted: unknown[]; terminate: unknown; tell: (data: unknown) => void }[] = []
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: (() => void) | null = null
        posted: unknown[] = []
        terminate = vi.fn()
        constructor() {
          made.push({
            posted: this.posted,
            terminate: this.terminate,
            tell: (data) => this.onmessage?.({ data } as MessageEvent<unknown>),
          })
        }
        postMessage(message: unknown) {
          this.posted.push(message)
        }
      },
    )
    const { searchInWorker, warmSpace } = await import('./search-client')
    const hit = (path: string) => ({ path, name: path, line: 1, text: 'alpha', ranges: [] })
    const found: string[] = []
    warmSpace('/space', () => undefined)
    const done = searchInWorker('/space', parseQuery('/a.*b/'), [], 10, (batch) => {
      found.push(...batch.hits.map((one) => one.path))
    })
    const first = made[0]
    if (!first) throw new Error('no worker was made')
    first.tell({ kind: 'at', id: 1, relative: 'one.md' })
    first.tell({ kind: 'found', id: 1, hits: [hit('/space/one.md')], loose: [] })
    first.tell({ kind: 'at', id: 1, relative: 'blob.md' })
    await vi.advanceTimersByTimeAsync(10_000)
    const second = made[1]
    if (!second) throw new Error('no second worker was made')
    expect(first.terminate).toHaveBeenCalled()
    expect(second.posted[0]).toEqual({ kind: 'warm', root: '/space' })
    expect(second.posted[1]).toMatchObject({ kind: 'ask', excluded: ['blob.md'], limit: 10 })
    const again = (second.posted[1] as { id: number }).id
    second.tell({
      kind: 'found',
      id: again,
      hits: [hit('/space/one.md'), hit('/space/two.md')],
      loose: [],
    })
    second.tell({ kind: 'done', id: again })
    await done
    expect(found).toEqual(['/space/one.md', '/space/two.md'])
  })
  test('is left alone while the worker fills its space before the first note', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null
        onerror = null
        terminate = terminate
        postMessage = vi.fn()
      },
    )
    const { searchInWorker } = await import('./search-client')
    void searchInWorker('/space', parseQuery('alpha'), ['alpha'], 10, () => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(terminate).not.toHaveBeenCalled()
  })
  test('is left alone while the worker keeps going', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    let tell: (data: unknown) => void = () => undefined
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: (() => void) | null = null
        terminate = terminate
        constructor() {
          tell = (data) => this.onmessage?.({ data } as MessageEvent<unknown>)
        }
        postMessage = vi.fn()
      },
    )
    const { searchInWorker } = await import('./search-client')
    void searchInWorker('/space', parseQuery('alpha'), ['alpha'], 10, () => undefined)
    for (let note = 0; note < 20; note++) {
      tell({ kind: 'at', id: 1, relative: `${note}.md` })
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(terminate).not.toHaveBeenCalled()
  })
})
