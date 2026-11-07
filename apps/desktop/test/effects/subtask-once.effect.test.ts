import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const PLAN = 'Plan.md'

const { taskRow } = await import('../../src/lib/views/fixture')
const row = taskRow(PLAN, '- [ ] water the plants', 3, { space: 'Mine' })

vi.mock('../../src/lib/rows/rows.svelte', () => ({
  rows: { of: () => [row], watch: () => () => undefined, settled: () => () => undefined },
}))

const subtasks: string[] = []
let answer: ((ok: boolean) => void) | null = null
vi.mock('../../src/lib/views/act', async (original) => ({
  ...(await original<typeof import('../../src/lib/views/act')>()),
  addSubtask: (_row: unknown, line: string) => {
    subtasks.push(line)
    return new Promise<boolean>((resolve) => (answer = resolve))
  },
}))

const { default: TaskSheet } = await import('../../src/lib/views/task-view/TaskSheet.svelte')

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) {
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

test('a sub-task is written once however often Enter is pressed', async () => {
  const ref = { space: 'Mine', path: PLAN, line: 3, hash: row.anchor?.hash ?? '' }
  const kit = {
    writes: () => true,
    live: { today: '2026-10-24' },
    tick: () => Promise.resolve(),
    open: () => undefined,
  }
  shown = mount(TaskSheet, {
    target: document.body,
    props: { shown: { ref, list: [ref], kit: kit as never } },
  })
  await settled()

  const adder = [...document.querySelectorAll<HTMLButtonElement>('button.adder')][0]
  if (!adder) throw new Error('no Add sub-task')
  adder.click()
  await settled()
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Add sub-task"]')
  if (!field) throw new Error('no sub-task field')
  field.value = 'buy soil'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settled()
  answer?.(true)
  await settled()

  expect(subtasks).toHaveLength(1)
  expect(field.value).toBe('')
})
