import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { reactive } from '../../../../test/effects/runes.svelte'
import type { Todo } from '../../tasks-model/src/api'

const TodoEditor = (await import('../src/TodoEditor.svelte')).default
const todo = (over: Partial<Todo>): Todo => ({
  id: 't1',
  title: 'Call Ann',
  description: 'about the trip',
  labels: [],
  space: null,
  start: null,
  deadline: null,
  priority: 0,
  done: false,
  doneAt: null,
  subtasks: [],
  order: 1,
  created: 1,
  ...over,
})
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})
function editor(first: Todo) {
  const target = document.createElement('div')
  document.body.append(target)
  const onchange = vi.fn(() => Promise.resolve(null))
  const props = reactive({ todo: first })
  const made = mount(TodoEditor, {
    target,
    props: {
      get todo() {
        return props.todo
      },
      spaces: [],
      knownLabels: [],
      onchange,
      onremove: () => undefined,
      onclose: () => undefined,
    },
  })
  close = () => void unmount(made)
  flushSync()
  const field = (name: string) => {
    const found = target.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)
    if (!found) throw new Error(`no ${name}`)
    return found
  }
  return { props, onchange, field }
}
describe('the todo editor, while the todo changes elsewhere', () => {
  test('shows the new title and description and does not write the old ones back on blur', () => {
    const { props, onchange, field } = editor(todo({}))
    props.todo = todo({ title: 'Call Ann at noon', description: 'about the trip, and the car' })
    flushSync()
    expect(field('Title').value).toBe('Call Ann at noon')
    expect(field('Description').value).toBe('about the trip, and the car')
    for (const name of ['Title', 'Description']) {
      field(name).focus()
      field(name).blur()
    }
    flushSync()
    expect(onchange).not.toHaveBeenCalled()
  })
  test('keeps what is being typed when the todo changes elsewhere', () => {
    const { props, onchange, field } = editor(todo({}))
    const title = field('Title')
    title.focus()
    title.value = 'Call Ann today'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    props.todo = todo({ title: 'Call Ann at noon', priority: 2 })
    flushSync()
    expect(title.value).toBe('Call Ann today')
    title.blur()
    flushSync()
    expect(onchange).toHaveBeenCalledWith({ title: 'Call Ann today' })
  })
  test('follows a change elsewhere after a blur that only trimmed what was typed', () => {
    const { props, onchange, field } = editor(todo({}))
    const title = field('Title')
    title.focus()
    title.value = 'Call Ann '
    title.dispatchEvent(new Event('input', { bubbles: true }))
    title.blur()
    flushSync()
    props.todo = todo({ title: 'Call Ann at noon' })
    flushSync()
    expect(title.value).toBe('Call Ann at noon')
    expect(onchange).not.toHaveBeenCalled()
  })
})
describe('the todo editor draws its fields with the app controls', () => {
  test('no field is a native dropdown or date input', () => {
    editor(todo({}))
    expect(
      document.querySelector('select, input[type="date"], input[type="time"], input[type="datetime-local"]'),
    ).toBeNull()
    expect(document.querySelectorAll('[role="combobox"]')).toHaveLength(2)
  })
  test('a start date typed into its field is written as a day', () => {
    const { onchange, field } = editor(todo({}))
    const start = field('Start date')
    start.focus()
    start.value = '2099-01-01'
    start.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(onchange).toHaveBeenCalledWith({ start: '2099-01-01' })
  })
  test('a day picked from the calendar is written as the deadline', () => {
    const { onchange } = editor(todo({ deadline: '2099-01-10' }))
    document.querySelectorAll<HTMLButtonElement>('[aria-label="Choose a date"]')[1]?.click()
    flushSync()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Deadline"]')
    expect(dialog).not.toBeNull()
    dialog?.querySelector<HTMLButtonElement>('[data-day="2099-01-12"]')?.click()
    flushSync()
    expect(onchange).toHaveBeenCalledWith({ deadline: '2099-01-12' })
    expect(document.querySelectorAll('[aria-label="Choose a date"]')[1]?.getAttribute('aria-expanded')).toBe('false')
  })
  test('the space is chosen from the app dropdown', () => {
    const target = document.createElement('div')
    document.body.append(target)
    const onchange = vi.fn(() => Promise.resolve(null))
    const made = mount(TodoEditor, {
      target,
      props: {
        todo: todo({}),
        spaces: [{ id: 'orga', name: 'Orga' }],
        knownLabels: [],
        onchange,
        onremove: () => undefined,
        onclose: () => undefined,
      },
    })
    close = () => void unmount(made)
    flushSync()
    target.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Space"]')?.click()
    flushSync()
    const orga = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) =>
      one.textContent.includes('Orga'),
    )
    orga?.click()
    flushSync()
    expect(onchange).toHaveBeenCalledWith({ space: 'orga' })
  })
})
