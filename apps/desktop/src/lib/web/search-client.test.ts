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

    expect(() => warmSpace('/space')).not.toThrow()
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

    warmSpace('/space')
    refuse = false
    warmSpace('/space')

    expect(posted).toEqual([{ kind: 'warm', root: '/space' }])
  })
})
