/** A task saved unchanged from the field that edits it (Ctrl+E) keeps its words.
 *
 *  The field shows a task's words without their escapes, `Tip the waiter #tips` where
 *  the line says `Tip the waiter \#tips`, and reads what it shows the way it reads
 *  anything typed. So the `#tips` the line escaped to keep it a word was read as a
 *  label, and a Save that changed nothing turned it into one (B417). In the jsdom
 *  project because it mounts the field and presses real keys. */

import { taskRowsOfText } from '@nib/bases/tasks'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import type { Entry } from '../../src/lib/quick-add/entry'
import QuickAdd from '../../src/lib/quick-add/QuickAdd.svelte'
import { changeOf, prefillFor } from '../../src/lib/views/task-edit'

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

/** What a Save with nothing touched changes in the task the line holds. */
async function savedUnchanged(line: string) {
  const task = taskRowsOfText('Notes', 'A.md', line)[0]?.task
  if (!task) throw new Error('no task')
  const saved: { entry?: Entry } = {}
  shown = mount(QuickAdd, {
    target: document.body,
    props: {
      langs: ['en'],
      mode: 'edit',
      prefill: prefillFor(task, null),
      onsubmit: (entry: Entry) => {
        saved.entry = entry
      },
      onclose: () => undefined,
    },
  })
  flushSync()
  const field = document.querySelector<HTMLInputElement>('input.field')
  if (!field) throw new Error('no field')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await Promise.resolve()
  flushSync()
  if (!saved.entry) throw new Error('not saved')
  return { task, change: changeOf(task, saved.entry) }
}

test('an escaped label stays words', async () => {
  const { change } = await savedUnchanged('- [ ] Tip the waiter \\#tips #money')
  expect(change.text).toBeUndefined()
  expect(change.tags).toEqual(['money'])
})

test('an escaped name stays words', async () => {
  const { change } = await savedUnchanged('- [ ] Ask \\@bob about it')
  expect(change.text).toBeUndefined()
  expect(change).not.toHaveProperty('assignee')
})
