import { addTask, tickTask, todos } from '../../tasks-model/src/api'
import { baseOpening } from '../../views/src/api'
import { endOf, fill, frame, nudged, phone, rest, shown, stepper, until, type LoopScene } from './kit'
import { keysOf, type Move, PAUSE, typedAt } from './motion'
import { boxOf, type Pointer } from './pointer'

const KEPT = [
  'Frame samples from the shop #launch p1',
  'Ride test with Mara #launch p2',
  'Photos of all three colours #press p2',
  'Quotes from Mara and Jonas #press p3',
  'Shop window sketch #shop p3',
  'Order lights for the window #shop',
]
const TITLE = 'Send the kit to three city blogs'
const TYPED = `${TITLE} #press`
const TYPED_PHONE = `${TITLE} #press p1`
const MORE = ' on Monday'
const LABEL = 'blogs'
const adder = () => document.querySelector<HTMLInputElement>('[data-todos-add]')
const card =
  (id: string | null, part = '.title') =>
  () =>
    id ? boxOf(`[data-todo="${id}"] ${part}`) : null
const column = (key: string) => () => {
  const box = document.querySelector(`[data-todos-column][data-key="${key}"] h2`)?.getBoundingClientRect()
  return box ? { x: box.left + box.width / 2, y: box.bottom + 36 } : null
}
export function todosScene(you: () => Pointer): LoopScene {
  const typedHere = phone() ? TYPED_PHONE : TYPED
  const add = keysOf(typedHere, 41)
  const more = keysOf(MORE, 42)
  const label = keysOf(LABEL, 43)
  const at = {
    field: 2200,
    typing: 2500,
    entered: 0,
    opened: 0,
    title: 0,
    titled: 0,
    labelField: 0,
    labelled: 0,
    closed: 0,
    lifted: 0,
    dropped: 0,
    ticked: 0,
    end: 0,
  }
  at.entered = at.typing + add.took + 450
  at.opened = at.entered + 1500
  at.title = at.opened + 1300
  at.titled = at.title + PAUSE + 300 + more.took + 400
  at.labelField = at.titled + 1100
  at.labelled = at.labelField + PAUSE + 300 + label.took + 450
  at.closed = at.labelled + 1100
  at.lifted = at.closed + 1300
  at.dropped = at.lifted + PAUSE + 1500
  at.ticked = at.dropped + 1500
  at.end = at.ticked + 2600
  let made: string | null = null
  let ghost: HTMLElement | null = null
  const lifted = () => (made ? document.querySelector<HTMLElement>(`[data-todo="${made}"]`) : null)
  const drop = () => {
    ghost?.remove()
    ghost = null
    const row = lifted()
    if (row) row.style.opacity = ''
  }
  const editor = (selector: string) => document.querySelector<HTMLInputElement>(`[data-todo-editor] ${selector}`)
  const press = (selector: string) => document.querySelector<HTMLElement>(selector)?.click()
  const steps = [
    at.entered,
    at.opened,
    at.titled,
    at.labelled,
    at.closed,
    at.lifted,
    at.dropped,
    at.ticked,
    at.end - 400,
  ]
  let done = 0
  const go = stepper(async (to) => {
    if (to < done) {
      drop()
      if (made) await todos.remove(made)
      made = null
      done = 0
      fill(adder(), '')
    }
    while (done < to) {
      done++
      if (done === 1) {
        fill(adder(), '')
        made = (await addTask(typedHere))?.id ?? null
      } else if (done === 2) {
        await until(() => lifted())
        press(`[data-todo="${made}"] .body`)
        await frame()
      } else if (done === 3 && made) await todos.update(made, { title: TITLE + MORE })
      else if (done === 4 && made) {
        await todos.update(made, { labels: ['press', LABEL] })
        fill(editor('input[aria-label="Add label"]'), '')
      } else if (done === 5) press('[data-todo-editor] button[aria-label="Close"]')
      else if (done === 6) {
        const row = lifted()
        if (row && !phone()) {
          ghost = row.cloneNode(true) as HTMLElement
          const box = row.getBoundingClientRect()
          Object.assign(ghost.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: `${box.width}px`,
            margin: '0',
            zIndex: '2147483646',
            pointerEvents: 'none',
            background: 'var(--orden-surface, Canvas)',
            borderRadius: '10px',
            boxShadow: '0 14px 34px rgb(0 0 0 / 0.3)',
            transform: `translate(${box.left}px, ${box.top}px) rotate(-1.5deg)`,
          })
          document.body.append(ghost)
          row.style.opacity = '0.25'
        }
      } else if (done === 7) {
        drop()
        if (made) await todos.update(made, { priority: 3 })
      } else if (done === 8 && made) await tickTask(made, true)
      else if (done === 9) {
        if (made) await todos.remove(made)
        made = null
      }
    }
  })
  const grip = () => (ghost ? ghost.getBoundingClientRect() : null)
  return {
    period: at.end,
    still: 0,
    ready: async () => {
      for (const one of KEPT) await addTask(one)
      await todos.arrange({ ...todos.board, grouping: 'priority' })
      ;(await baseOpening()).openTodos()
      await until(() => document.querySelector('[data-todos-column]'))
    },
    tick: (phase) => {
      const ms = phase * at.end
      const step = steps.filter((one) => ms >= one).length
      go(step)
      if (step === 0) fill(adder(), typedAt(add, ms - at.typing))
      if (step === 2) fill(editor('input[aria-label="Title"]'), TITLE + typedAt(more, ms - at.title - PAUSE - 300))
      if (step === 3) fill(editor('input[aria-label="Add label"]'), typedAt(label, ms - at.labelField - PAUSE - 300))
      const moves: Move[] = [
        { at: 0, to: rest },
        { at: 1200, to: rest },
        { at: at.field, to: nudged(() => boxOf('[data-todos-add]'), -40, 0), press: true },
        { at: at.entered - 200, to: nudged(() => boxOf('[data-todos-add]'), 20, 22) },
        { at: at.opened - PAUSE, to: card(made), press: true },
        { at: at.title, to: endOf('[data-todo-editor] input[aria-label="Title"]', 30), press: true },
        { at: at.labelField, to: () => boxOf('[data-todo-editor] input[aria-label="Add label"]'), press: true },
        { at: at.closed - PAUSE, to: () => boxOf('[data-todo-editor] button[aria-label="Close"]'), press: true },
        { at: at.lifted - PAUSE, to: card(made), press: true },
        { at: at.dropped, to: column('3'), drag: true },
        { at: at.ticked - PAUSE, to: card(made, 'input.tick'), press: true },
        { at: at.ticked + 1500, to: rest },
      ]
      shown(you(), ms, moves)
      if (ghost) {
        const point = you().where()
        const box = grip()
        if (point && box)
          ghost.style.transform = `translate(${point.x - 40}px, ${point.y - box.height / 2}px) rotate(-1.5deg)`
      }
    },
  }
}
