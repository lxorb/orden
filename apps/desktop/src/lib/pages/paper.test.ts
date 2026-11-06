import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  drawn: [] as string[],
  opened: 0,
  release: [] as (() => void)[],
}))

vi.mock('../pdf/document', () => ({
  openBytes: () => Promise.reject(new Error('no bytes here')),
  openDocument: () => {
    held.opened++
    return Promise.resolve({
      hash: 'hash',
      close: () => Promise.resolve(),
      doc: {
        numPages: 1000,
        getPage: (number: number) =>
          Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({
              width: 600 * scale,
              height: 800 * scale,
            }),
            render: ({ viewport }: { viewport: { width: number } }) => ({
              promise: new Promise<void>((done) => {
                held.drawn.push(`${String(number)} at ${String(Math.round(viewport.width))}`)
                held.release.push(done)
              }),
            }),
            cleanup: () => undefined,
          }),
      },
    })
  },
}))

class Sheet {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext() {
    return {}
  }

  transferToImageBitmap() {
    return { width: this.width, height: this.height, close: () => undefined }
  }
}

const { densityFor, forgetPaper, paperOf } = await import('./paper')

const AT = { file: 'Thick.pages.pdf', note: '/s/Thick.pages', root: '/s' }

async function settle() {
  for (let round = 0; round < 20; round++) await Promise.resolve()
}

async function drawNext() {
  await settle()
  held.release.shift()?.()
  await settle()
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', Sheet)
  held.drawn = []
  held.release = []
})

afterEach(async () => {
  forgetPaper(AT)
  while (held.release.length) await drawNext()
  vi.unstubAllGlobals()
})

describe('the pages of a paper', () => {
  test('are drawn one at a time, in the order they were asked for', async () => {
    const first = paperOf(AT, 1, new AbortController().signal)
    const second = paperOf(AT, 2, new AbortController().signal)
    await settle()

    expect(held.drawn).toEqual(['1 at 1600'])

    await drawNext()
    expect((await first)?.width).toBe(800)
    expect(held.drawn).toEqual(['1 at 1600', '2 at 1600'])

    await drawNext()
    expect((await second)?.width).toBe(800)
  })

  test('a page let go of before its turn is never drawn', async () => {
    void paperOf(AT, 1, new AbortController().signal)
    const leaving = new AbortController()
    const gone = paperOf(AT, 2, leaving.signal)
    void paperOf(AT, 3, new AbortController().signal)
    leaving.abort()

    expect(await gone).toBeNull()
    await drawNext()
    await drawNext()

    expect(held.drawn).toEqual(['1 at 1600', '3 at 1600'])
  })

  test('a page still wanted by another stays in line when one lets go', async () => {
    void paperOf(AT, 1, new AbortController().signal)
    const leaving = new AbortController()
    void paperOf(AT, 2, leaving.signal)
    const staying = paperOf(AT, 2, new AbortController().signal)
    leaving.abort()

    await drawNext()
    await drawNext()

    expect(held.drawn).toEqual(['1 at 1600', '2 at 1600'])
    expect(await staying).not.toBeNull()
  })

  test('the pages the reader looks at go before the small ones of the page list', async () => {
    void paperOf(AT, 1, new AbortController().signal)
    void paperOf(AT, 7, new AbortController().signal, true, densityFor(0.2))
    void paperOf(AT, 2, new AbortController().signal)

    await drawNext()
    await drawNext()
    await drawNext()

    expect(held.drawn).toEqual(['1 at 1600', '2 at 1600', '7 at 400'])
  })

  test('far out, a page is drawn small; close up, sharp', () => {
    expect(densityFor(0.1)).toBeLessThan(densityFor(1))
    expect(densityFor(2)).toBe(densityFor(1))
  })

  test('the paper is read once for all its pages', async () => {
    const before = held.opened
    for (let number = 1; number <= 5; number++)
      void paperOf(AT, number, new AbortController().signal)
    for (let number = 1; number <= 5; number++) await drawNext()

    expect(held.opened - before).toBe(1)
  })
})
