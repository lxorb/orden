import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { selectAll } from './select-all'

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
  const focus = vi.fn()
  const select = vi.fn()
  return { node: { focus, select } as unknown as HTMLInputElement, focus, select }
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
    const { node, focus, select } = field()
    selectAll(node)
    expect(focus).toHaveBeenCalledTimes(1)

    around.frame()

    expect(focus).toHaveBeenCalledTimes(2)
    expect(select).toHaveBeenCalledTimes(2)
  })

  test.each(['keydown', 'pointerdown'])('leaves it alone after a %s inside the frame', (kind) => {
    const { node, focus } = field()
    selectAll(node)

    around.does(kind)
    around.frame()

    expect(focus).toHaveBeenCalledTimes(1)
  })

  test('listens no longer once the frame is past, or the field has gone', () => {
    const passed = selectAll(field().node)
    expect(around.listening()).toBeGreaterThan(0)
    around.frame()
    expect(around.listening()).toBe(0)
    passed.destroy()

    const gone = selectAll(field().node)
    gone.destroy()
    expect(around.listening()).toBe(0)
  })
})
