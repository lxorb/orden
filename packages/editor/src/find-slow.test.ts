import { Worker as Thread } from 'node:worker_threads'
import { getSearchQuery } from '@codemirror/search'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  findExtensions,
  findNext,
  findReady,
  findTally,
  loadFind,
  NO_FIND,
  replaceEverywhere,
  setFind,
} from './find'
import { quickEnough, scanPattern, TRIAL_SCRIPT } from './find-trial'

class ThreadWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { preventDefault: () => void }) => void) | null = null
  private readonly thread: Thread

  constructor() {
    this.thread = new Thread(
      `const { parentPort } = require('node:worker_threads')
const self = { postMessage: (data) => parentPort.postMessage(data) }
parentPort.on('message', (data) => self.onmessage({ data }))
${TRIAL_SCRIPT}`,
      { eval: true },
    )
    this.thread.on('message', (data: unknown) => this.onmessage?.({ data }))
  }

  postMessage(data: unknown) {
    this.thread.postMessage(data)
  }

  terminate() {
    void this.thread.terminate()
  }
}

beforeAll(async () => {
  vi.stubGlobal('Worker', ThreadWorker)
  await loadFind()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const WILD = '(a+)+b'

const RUN = `${'a'.repeat(40)}!`

function viewOf(doc: string, onSlow?: (view: EditorView) => void) {
  let state = EditorState.create({ doc, extensions: [findExtensions(undefined, onSlow)] })
  const view = {
    get state() {
      return state
    },
    plugin: () => null,
    dispatch: (...specs: TransactionSpec[]) => {
      const transaction = state.update(...specs)
      const startState = state
      state = transaction.state
      const update = {
        view,
        state,
        startState,
        transactions: [transaction],
      } as unknown as ViewUpdate
      for (const listen of state.facet(EditorView.updateListener)) listen(update)
    },
  } as unknown as EditorView
  return view
}

describe('trying a pattern away from the page', () => {
  test('counts what the editor would find', () => {
    expect(scanPattern('w[a-z]+d', 'gmui', 'wind, Wind\nwound', true)).toBe(3)
    expect(scanPattern('x*', 'gmu', 'ab', true)).toBe(3)
  })

  test('answers for a pattern that takes no time', async () => {
    expect(await quickEnough('a+', 'gmu', RUN, true)).toBe(true)
  })

  test('gives up on a pattern that backtracks without end, and the next one still runs', async () => {
    const started = Date.now()
    expect(await quickEnough(WILD, 'gmu', RUN, true)).toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(await quickEnough('a+!', 'gmu', RUN, true)).toBe(true)
  })
})

describe('finding with a pattern that would hang the page', () => {
  test('looks for nothing and says the pattern is too slow', async () => {
    const view = viewOf(`a short line\n${RUN}\n`)
    await setFind(view, { ...NO_FIND, query: WILD, regexp: true })

    expect(getSearchQuery(view.state).valid).toBe(false)
    expect(findTally(view.state)).toMatchObject({ count: 0, slow: true })
  })

  test('still looks for a pattern that runs in time', async () => {
    const view = viewOf(`a short line\n${RUN}\n`)
    await setFind(view, { ...NO_FIND, query: WILD, regexp: true })
    await setFind(view, { ...NO_FIND, query: 'a+!', regexp: true })

    expect(findTally(view.state)).toEqual({ count: 1, current: -1, capped: false })
  })

  test('keeps the last thing asked for when an earlier pattern answers after it', async () => {
    const view = viewOf(`a short line\n${RUN}\n`)
    const first = setFind(view, { ...NO_FIND, query: WILD, regexp: true })
    await setFind(view, { ...NO_FIND, query: 'short' })
    await first

    expect(getSearchQuery(view.state).search).toBe('short')
    expect(findTally(view.state).count).toBe(1)
  })

  test('stops looking once the note is written into something the pattern hangs on', async () => {
    const slowed: EditorView[] = []
    const view = viewOf('ab', (one) => slowed.push(one))
    await setFind(view, { ...NO_FIND, query: WILD, regexp: true })
    expect(findTally(view.state).count).toBe(1)

    view.dispatch({ changes: { from: 2, insert: `\n${RUN}` } })
    expect(findTally(view.state).count).toBe(0)

    expect(await findReady(view)).toBe(false)
    expect(findTally(view.state)).toMatchObject({ slow: true })
    expect(slowed).toEqual([view])
  })

  test('steps and replaces only once the edited note has been tried', async () => {
    const view = viewOf('ab ab')
    await setFind(view, { ...NO_FIND, query: '(a+)+b', replace: 'x', regexp: true })
    view.dispatch({ changes: { from: 0, insert: 'ab ' } })

    expect(findNext(view)).toBe(true)
    expect(replaceEverywhere(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('ab ab ab')

    await findReady(view)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(view.state.doc.toString()).toBe('x x x')
  })
})

describe('finding in a note that is being written into', () => {
  async function whileWriting(view: EditorView, run: () => Promise<unknown>): Promise<boolean> {
    let writing = true
    const pen = setInterval(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'and a little more\n' } })
    }, 2)
    const stop = setTimeout(() => (writing = false), 10_000)
    try {
      await run()
      return writing
    } finally {
      clearInterval(pen)
      clearTimeout(stop)
    }
  }

  const LONG = 'a line of the note that is long enough to take a while\n'.repeat(150_000)

  test('sets a pattern before the writing stops', async () => {
    const view = viewOf(LONG)
    const answered = await whileWriting(view, () =>
      setFind(view, { ...NO_FIND, query: 'no+te', regexp: true }),
    )

    expect(answered).toBe(true)
    expect(getSearchQuery(view.state).search).toBe('no+te')
  }, 30_000)

  test('is ready to step before the writing stops', async () => {
    const view = viewOf(LONG)
    await setFind(view, { ...NO_FIND, query: 'no+te', regexp: true })
    const answered = await whileWriting(view, () => findReady(view))

    expect(answered).toBe(true)
  }, 30_000)

  test('still refuses a pattern that hangs on what is written', async () => {
    const view = viewOf(LONG)
    await setFind(view, { ...NO_FIND, query: WILD, regexp: true })
    expect(findTally(view.state).slow).toBeUndefined()

    view.dispatch({ changes: { from: 0, insert: `${RUN}\n` } })
    const answered = await whileWriting(view, () => findReady(view))

    expect(answered).toBe(true)
    expect(findTally(view.state)).toMatchObject({ slow: true })
  }, 30_000)
})
