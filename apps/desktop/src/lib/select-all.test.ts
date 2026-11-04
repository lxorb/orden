import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { selectAll } from './select-all'

/** The page around a name field: a frame that comes when told, and what the reader does
 *  told to whoever listens on the window. */
function page() {
  const frames: FrameRequestCallback[] = []
  const heard = new Map<string, Set<() => void>>()
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => undefined
  })
  vi.stubGlobal('window', {
    addEventListener: (kind: string, run: () => void) => {
      heard.set(kind, (heard.get(kind) ?? new Set()).add(run))
    },
    removeEventListener: (kind: string, run: () => void) => heard.get(kind)?.delete(run),
  })
  return {
    frame: () => {
      for (const run of frames.splice(0)) run(0)
    },
    does: (kind: string) => {
      for (const run of heard.get(kind) ?? []) run()
    },
    listening: () => [...heard.values()].reduce((all, runs) => all + runs.size, 0),
  }
}

function field() {
  return { focus: vi.fn(), select: vi.fn() } as unknown as HTMLInputElement & {
    focus: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
  }
}

describe('a name field as it arrives', () => {
  let around: ReturnType<typeof page>

  beforeEach(() => {
    around = page()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('takes the focus at once and again a frame later, for a value filled in after', () => {
    const name = field()
    selectAll(name)
    expect(name.focus).toHaveBeenCalledTimes(1)

    around.frame()

    expect(name.focus).toHaveBeenCalledTimes(2)
    expect(name.select).toHaveBeenCalledTimes(2)
  })

  /** Tab pressed inside that frame went to the hint, and the field took it straight back. */
  test.each(['keydown', 'pointerdown'])('leaves it alone after a %s inside the frame', (kind) => {
    const name = field()
    selectAll(name)

    around.does(kind)
    around.frame()

    expect(name.focus).toHaveBeenCalledTimes(1)
  })

  test('listens no longer once the frame is past, or the field has gone', () => {
    const passed = selectAll(field())
    expect(around.listening()).toBeGreaterThan(0)
    around.frame()
    expect(around.listening()).toBe(0)
    passed.destroy()

    const gone = selectAll(field())
    gone.destroy()
    expect(around.listening()).toBe(0)
  })
})
