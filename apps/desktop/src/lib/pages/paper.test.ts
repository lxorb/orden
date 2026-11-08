import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  drawn: [] as string[],
  opened: 0,
  closed: 0,
  release: [] as (() => void)[],
  views: [] as { width: number; offsetX: number; offsetY: number }[],
  cancelled: 0,
}))

vi.mock('../pdf/document', () => ({
  openBytes: () => Promise.reject(new Error('no bytes here')),
  openDocument: () => {
    held.opened++
    return Promise.resolve({
      hash: 'hash',
      close: () => {
        held.closed++
        return Promise.resolve()
      },
      doc: {
        numPages: 1000,
        getPage: (number: number) =>
          Promise.resolve({
            getViewport: ({
              scale,
              offsetX = 0,
              offsetY = 0,
            }: {
              scale: number
              offsetX?: number
              offsetY?: number
            }) => ({ width: 600 * scale, height: 800 * scale, offsetX, offsetY }),
            render: ({
              canvas,
              viewport,
            }: {
              canvas: { width: number; height: number }
              viewport: { width: number; offsetX: number; offsetY: number }
            }) => {
              let fail: (why: Error) => void = () => undefined
              const promise = new Promise<void>((done, failed) => {
                fail = failed
                held.drawn.push(`${String(number)} at ${String(Math.round(viewport.width))}`)
                held.views.push({
                  width: canvas.width,
                  offsetX: viewport.offsetX,
                  offsetY: viewport.offsetY,
                })
                held.release.push(done)
              })
              return {
                promise,
                cancel: () => {
                  held.cancelled++
                  fail(new Error('cancelled'))
                },
              }
            },
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

const {
  closeUpOf,
  densityFor,
  forgetPaper,
  holdPaper,
  PapersHeld,
  paperEdition,
  paperOf,
  paperRewritten,
} = await import('./paper')

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
  held.views = []
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

  test('zoomed in past twice its size, a page is drawn sharper still', () => {
    expect(densityFor(3)).toBeGreaterThan(densityFor(2))
    expect(densityFor(8)).toBe(densityFor(4))
  })

  test('sharp pages are kept only as many as fit in the memory a paper may hold', async () => {
    const sharp = densityFor(4)
    for (let number = 1; number <= 8; number++) void paperOf(AT, number, undefined, false, sharp)
    for (let number = 1; number <= 8; number++) await drawNext()
    const drawn = held.drawn.length

    void paperOf(AT, 8, undefined, false, sharp)
    await drawNext()
    expect(held.drawn.length).toBe(drawn)

    void paperOf(AT, 1, undefined, false, sharp)
    await drawNext()
    expect(held.drawn.length).toBe(drawn + 1)
  })

  test('the paper is read once for all its pages', async () => {
    const before = held.opened
    for (let number = 1; number <= 5; number++)
      void paperOf(AT, number, new AbortController().signal)
    for (let number = 1; number <= 5; number++) await drawNext()

    expect(held.opened - before).toBe(1)
  })
})

describe('a close-up of a page', () => {
  test('draws only the part of the page asked for, at the pixels asked for', async () => {
    const part = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }
    const asked = closeUpOf(AT, 3, part, 6000, new AbortController().signal)
    await drawNext()

    const image = await asked
    expect(image?.width).toBe(3000)
    expect(image?.height).toBe(2000)
    expect(held.views).toEqual([{ width: 3000, offsetX: -1500, offsetY: -4000 }])
  })

  test('is never larger than the largest screen needs', async () => {
    const asked = closeUpOf(
      AT,
      3,
      { x: 0, y: 0, width: 1, height: 1 },
      60_000,
      new AbortController().signal,
    )
    await drawNext()

    const image = await asked
    expect((image?.width ?? 0) * (image?.height ?? 0)).toBeLessThanOrEqual(64 * 1024 * 1024)
  })

  test('let go of while drawing, stops drawing and gives nothing', async () => {
    const leaving = new AbortController()
    const cancelled = held.cancelled
    const asked = closeUpOf(AT, 3, { x: 0, y: 0, width: 0.5, height: 0.5 }, 6000, leaving.signal)
    await settle()
    leaving.abort()

    expect(await asked).toBeNull()
    expect(held.cancelled).toBe(cancelled + 1)
    held.release = []
  })
})

describe('a paper shown on cards', () => {
  const CARD = { file: 'Scan.pdf', note: '/s/Board.canvas', root: '/s' }

  test('stays open while a card shows it, and is let go with the last of them', async () => {
    const one = holdPaper(CARD)
    const other = holdPaper(CARD)
    const first = paperOf(CARD, 1, new AbortController().signal)
    await drawNext()
    expect(await first).not.toBeNull()
    const opened = held.opened
    const closed = held.closed

    one()
    one()
    await settle()
    expect(held.closed).toBe(closed)
    const again = paperOf(CARD, 1, new AbortController().signal)
    await settle()
    expect(held.release).toHaveLength(0)
    expect(await again).toBe(await first)

    other()
    await settle()
    expect(held.closed).toBe(closed + 1)

    const anew = paperOf(CARD, 1, new AbortController().signal)
    await drawNext()
    expect(await anew).not.toBeNull()
    expect(held.opened).toBe(opened + 1)
    forgetPaper(CARD)
  })
})

describe('a paper a page note shows', () => {
  const NOTE = { file: 'Scan.pdf', note: '/s/Scan.pages', root: '/s' }

  test('stays open while another pane shows it, and closes with the last of them', async () => {
    const one = new PapersHeld()
    const other = new PapersHeld()
    one.keep([NOTE])
    other.keep([NOTE])
    const first = paperOf(NOTE, 1, new AbortController().signal)
    await drawNext()
    expect(await first).not.toBeNull()
    const closed = held.closed

    one.release()
    await settle()
    expect(held.closed).toBe(closed)
    expect(await paperOf(NOTE, 1, new AbortController().signal)).toBe(await first)

    other.release()
    await settle()
    expect(held.closed).toBe(closed + 1)
  })

  test('shared from the account is closed once its page note lets go', async () => {
    const shared = { ...NOTE, shared: 'from-account' }
    const papers = new PapersHeld()
    papers.keep([shared])
    const first = paperOf(shared, 1, new AbortController().signal)
    await drawNext()
    expect(await first).not.toBeNull()
    const closed = held.closed

    papers.release()
    await settle()
    expect(held.closed).toBe(closed + 1)
  })

  test('is held once however often it is asked, and let go when it is shown no more', async () => {
    const papers = new PapersHeld()
    const card = holdPaper(NOTE)
    papers.keep([NOTE, NOTE])
    papers.keep([NOTE])
    const first = paperOf(NOTE, 1, new AbortController().signal)
    await drawNext()
    await first
    const closed = held.closed

    papers.keep([])
    await settle()
    expect(held.closed).toBe(closed)
    card()
    await settle()
    expect(held.closed).toBe(closed + 1)
  })
})

describe('a paper written again on disk', () => {
  test('is read again, its pages drawn from the new file', async () => {
    const opened = held.opened
    const first = paperOf(AT, 1, new AbortController().signal)
    await drawNext()
    await first
    expect(held.opened).toBe(opened + 1)

    const edition = paperEdition(AT)
    paperRewritten('/s/Thick.pages.pdf')
    expect(paperEdition(AT)).toBe(edition + 1)

    const again = paperOf(AT, 1, new AbortController().signal)
    await drawNext()
    await again
    expect(held.opened).toBe(opened + 2)
  })

  test('another file written leaves it as it was', async () => {
    const opened = held.opened
    const first = paperOf(AT, 1, new AbortController().signal)
    await drawNext()
    await first
    const edition = paperEdition(AT)

    paperRewritten('/s/Other.pdf')
    const again = paperOf(AT, 1, new AbortController().signal)
    await settle()

    expect(paperEdition(AT)).toBe(edition)
    expect(held.opened).toBe(opened + 1)
    expect(await again).not.toBeNull()
  })
})
