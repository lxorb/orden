import { afterEach, describe, expect, test, vi } from 'vitest'
import { UNDO_LINGER, undoToast } from '../src/api'

type FileAction = Parameters<typeof undoToast.heard>[0][number]
const deleted = (path: string): FileAction => ({ kind: 'delete', path, content: '' })
afterEach(() => {
  undoToast.dismiss()
  vi.useRealTimers()
})
describe('the undo toast', () => {
  test('offers a fresh delete, then goes after it lingers', () => {
    vi.useFakeTimers()
    const one = deleted('/a.md')
    undoToast.heard([one])
    expect(undoToast.kind).toBe('delete')
    expect(undoToast.batch).toEqual([one])
    vi.advanceTimersByTime(UNDO_LINGER + 1)
    expect(undoToast.batch).toEqual([])
  })
  test('undoes its batch newest first through what holds the actions', async () => {
    const first = deleted('/a.md')
    const second = deleted('/b.md')
    const stack = [first, second]
    undoToast.heard([first])
    undoToast.heard(stack)
    const undone: FileAction[] = []
    await undoToast.undo({
      undone: {
        get stack() {
          return stack
        },
        get last() {
          return stack.at(-1)
        },
      },
      undoFileAction: (action) => {
        if (action) undone.push(action)
        stack.pop()
        return Promise.resolve()
      },
    })
    expect(undone).toEqual([second, first])
    expect(undoToast.batch).toEqual([])
  })
})
