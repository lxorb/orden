import { addDays, weekday } from '@orden/bases'
import type { Priority, Remind } from '@orden/markdown/task-line'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { dayWords, durationLabel, remindLabel } from './labels'

export interface When {
  due?: string | undefined
  time?: string | undefined
}

const weekendOf = (today: string) => addDays(today, (6 - weekday(today) + 7) % 7)

function askNative(
  type: 'date' | 'time',
  value: string | undefined,
  anchor: DOMRect,
): Promise<string | null> {
  return new Promise((resolve) => {
    const field = document.createElement('input')
    field.type = type
    field.value = value ?? ''
    field.tabIndex = -1
    field.setAttribute('aria-hidden', 'true')
    Object.assign(field.style, {
      position: 'fixed',
      left: `${anchor.left}px`,
      top: `${anchor.bottom}px`,
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.append(field)
    let settled = false
    const done = (answer: string | null) => {
      if (settled) return
      settled = true
      field.remove()
      resolve(answer)
    }
    field.addEventListener('change', () => done(field.value || null))
    field.addEventListener('blur', () => done(null))
    field.addEventListener('cancel', () => done(null))
    try {
      field.showPicker()
    } catch {
      done(null)
    }
  })
}

export function dayRows(
  current: When,
  today: string,
  set: (when: { due: string | null; time?: string | null }) => void,
  anchor: () => DOMRect,
  timed = true,
): MenuEntry[] {
  const day = (due: string) => ({
    label: dayWords(due, today),
    checked: current.due === due,
    run: () => set({ due }),
  })
  const weekend = weekendOf(today)
  return [
    day(today),
    day(addDays(today, 1)),
    ...(weekend > addDays(today, 1) ? [day(weekend)] : []),
    { ...day(addDays(today, (8 - weekday(today)) % 7 || 7)), label: 'Next week' },
    DIVIDER,
    {
      label: 'Pick a date…',
      asks: true,
      run: () => void askNative('date', current.due, anchor()).then((due) => due && set({ due })),
    },
    ...(timed
      ? [
          {
            label: 'Set a time…',
            asks: true,
            run: () =>
              void askNative('time', current.time, anchor()).then(
                (time) => time && set({ due: current.due ?? today, time }),
              ),
          },
        ]
      : []),
    ...(current.due
      ? [DIVIDER, { label: 'No date', run: () => set({ due: null, time: null }) }]
      : []),
  ]
}

export function priorityRows(current: Priority, set: (priority: Priority) => void): MenuEntry[] {
  return ([1, 2, 3, 4] as const).map((level) => ({
    label: `Priority ${level}`,
    checked: current === level,
    run: () => set(level),
  }))
}

export function remindRows(
  current: readonly Remind[],
  when: When,
  today: string,
  set: (remind: Remind[]) => void,
): MenuEntry[] {
  const has = (one: Remind) => current.some((held) => JSON.stringify(held) === JSON.stringify(one))
  const toggle = (one: Remind) => ({
    label: remindLabel(one, today),
    checked: has(one),
    run: () =>
      set(
        has(one)
          ? current.filter((held) => JSON.stringify(held) !== JSON.stringify(one))
          : [...current, one],
      ),
  })
  const timed: Remind[] = when.time
    ? [{ before: 0 }, { before: 15 }, { before: 30 }, { before: 60 }]
    : [{ time: '09:00' }]
  const morning: Remind = { at: addDays(when.due ?? today, when.due ? -1 : 1), time: '09:00' }
  return [
    ...timed.map(toggle),
    toggle(morning),
    ...(current.length ? [DIVIDER, { label: 'Remove', run: () => set([]) }] : []),
  ]
}

export function durationRows(
  current: number | undefined,
  set: (minutes: number | null) => void,
): MenuEntry[] {
  return [
    ...[15, 30, 45, 60, 90, 120].map((minutes) => ({
      label: durationLabel(minutes),
      checked: current === minutes,
      run: () => set(minutes),
    })),
    ...(current === undefined ? [] : [DIVIDER, { label: 'Remove', run: () => set(null) }]),
  ]
}

export function tagRows(
  current: readonly string[],
  known: readonly string[],
  set: (tags: string[]) => void,
): MenuEntry[] {
  const all = [...new Set([...current, ...known])].sort((a, b) => a.localeCompare(b))
  return all.map((tag) => ({
    label: `#${tag}`,
    checked: current.includes(tag),
    run: () =>
      set(current.includes(tag) ? current.filter((one) => one !== tag) : [...current, tag]),
  }))
}
