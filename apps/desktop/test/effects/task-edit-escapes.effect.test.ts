/** A task saved unchanged from the field that edits it (Ctrl+E) keeps its words.
 *
 *  The field reads its words the way it reads anything typed, so a task's own words
 *  were read again on every Save: `Prep Monday standup notes` lost `Monday` to a start
 *  date, `Fix p1 bug` gained a priority (B434). Only words typed into the field are
 *  read now; the task's own stay words, and an untouched Save writes the line as it was.
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
import { changedTask } from '@nib/markdown/task-edits'
import { changeOf, prefillFor } from '../../src/lib/views/task-edit'

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

/** What the field saves for the task the line holds, with `typed` added at its end. */
async function saved(line: string, typed = '') {
  const task = taskRowsOfText('Notes', 'A.md', line)[0]?.task
  if (!task) throw new Error('no task')
  const got: { entry?: Entry } = {}
  shown = mount(QuickAdd, {
    target: document.body,
    props: {
      langs: ['en'],
      mode: 'edit',
      prefill: prefillFor(task, null),
      onsubmit: (entry: Entry) => {
        got.entry = entry
      },
      onclose: () => undefined,
    },
  })
  flushSync()
  const field = document.querySelector<HTMLInputElement>('input.field')
  if (!field) throw new Error('no field')
  if (typed) {
    field.value += typed
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await Promise.resolve()
  flushSync()
  if (!got.entry) throw new Error('not saved')
  return { task, entry: got.entry }
}

/** What a Save with nothing touched changes in the task the line holds. */
async function savedUnchanged(line: string) {
  const { task, entry } = await saved(line)
  return { task, change: changeOf(task, entry) }
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

for (const line of [
  '- [ ] Prep Monday standup notes',
  '- [ ] Buy milk tomorrow 📅 2026-11-01',
  '- [ ] Buy #milk now',
  '- [ ] Read chapter 5 every day',
  '- [ ] Fix p1 bug',
  '- [ ] Email @bob about it',
  '- [ ] a  b',
  '- [ ] Tip the waiter \\#tips #money',
]) {
  test(`an untouched Save writes \`${line}\` as it was`, async () => {
    const { change } = await savedUnchanged(line)
    expect(changedTask(line, change)).toBe(line)
  })
}

test('a word typed into the field is still read', async () => {
  const { entry } = await saved('- [ ] Prep Monday standup notes', ' p1')
  expect(entry.text).toBe('Prep Monday standup notes')
  expect(entry.fields.priority).toBe(1)
  expect(entry.fields.due).toBeUndefined()
})
