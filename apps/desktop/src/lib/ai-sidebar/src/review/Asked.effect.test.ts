import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { settle } from '../../../../../test/effects/settle'

const { workspace } = await import('../../../workspace/src/api')
const Asked = (await import('./Asked.svelte')).default
const notes: Record<string, string> = {
  '/home/Diary.md': 'garden plans',
  '/work/Diary.md': 'payroll secrets',
}
const noteText = workspace.noteText.bind(workspace)
beforeEach(() => {
  workspace.spaces = [
    { id: 'home', name: 'Home', root: '/home' },
    { id: 'work', name: 'Work', root: '/work' },
  ]
  workspace.activeSpaceId = 'work'
  workspace.noteText = (path: string) => Promise.resolve(notes[path] ?? null)
})
afterEach(() => {
  workspace.noteText = noteText
})
test('a write asked in a thread of another space shows the note of the thread’s space', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Asked, {
    target,
    props: {
      part: {
        kind: 'tool',
        id: 'w',
        verb: 'write_note',
        args: { path: 'Diary', content: 'new words' },
        state: 'asking',
      } as never,
      thread: { space: 'home' } as never,
    },
  })
  await settle()
  expect(target.textContent).toContain('garden plans')
  expect(target.textContent).not.toContain('payroll')
  void unmount(shown)
  target.remove()
})
test('the note a write asks about is named without its ending (#2310)', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Asked, {
    target,
    props: {
      part: {
        kind: 'tool',
        id: 'w',
        verb: 'write_note',
        args: { path: 'Diary', content: 'new words' },
        state: 'asking',
      } as never,
      thread: { space: 'home' } as never,
    },
  })
  await settle()
  expect(target.querySelector('.name')?.textContent).toBe('Diary')
  void unmount(shown)
  target.remove()
})
