import { describe, expect, test } from 'vitest'
import {
  dayOf,
  deadlineField,
  deadlineOf,
  hasStarted,
  isLate,
  startField,
  startOf,
} from './task-dates'
import { readTask } from './task-line'

/** A task's start date and deadline, as each kind of space reads them (#371). */

const TODAY = '2026-10-18'
const line = (text: string) => {
  const task = readTask(`- [ ] ${text}`)
  if (!task) throw new Error(`not a task: ${text}`)
  return task
}

describe("in a space of nib's own", () => {
  test('a 📅 is the start date nib wrote before it said start dates', () => {
    const task = line('Call the bank 📅 2026-10-06')

    expect(startOf(task)).toBe('2026-10-06')
    expect(deadlineOf(task)).toBeUndefined()
    // Past, and no deadline: started, and not late.
    expect(hasStarted(task, TODAY)).toBe(true)
    expect(isLate(task, TODAY)).toBe(false)
  })

  test('a start date still to come keeps the task out of sight', () => {
    expect(hasStarted(line('Book the trip 🛫 2026-11-02'), TODAY)).toBe(false)
    expect(hasStarted(line('Book the trip 📅 2026-11-02'), TODAY)).toBe(false)
  })

  test('only a deadline makes a task late', () => {
    const task = line('Hand in the essay [deadline:: 2026-10-17] 🛫 2026-10-01')

    expect(isLate(task, TODAY)).toBe(true)
    expect(dayOf(task)).toBe('2026-10-01')
  })

  test('beside a 🛫 of its own, a 📅 is the deadline, as the plugin writes them', () => {
    const task = line('Draft 🛫 2026-10-01 📅 2026-10-15')

    expect(startOf(task)).toBe('2026-10-01')
    expect(deadlineOf(task)).toBe('2026-10-15')
    expect(deadlineField(task)).toBe('due')
  })

  test('a date set again is written where the date already is', () => {
    expect(startField(line('A 📅 2026-10-06'))).toBe('due')
    expect(startField(line('A 🛫 2026-10-06'))).toBe('start')
    expect(startField(line('A ⏳ 2026-10-06'))).toBe('scheduled')
    expect(startField(line('A'))).toBe('start')
    expect(deadlineField(line('A 📅 2026-10-06'))).toBe('deadline')
  })
})

describe('in an Obsidian vault', () => {
  test("a 📅 is the Tasks plugin's due date: a deadline, late once past", () => {
    const task = line('Call the bank 📅 2026-10-06')

    expect(startOf(task, 'deadline')).toBeUndefined()
    expect(deadlineOf(task, 'deadline')).toBe('2026-10-06')
    expect(isLate(task, TODAY, 'deadline')).toBe(true)
    expect(dayOf(task, 'deadline')).toBe('2026-10-06')
  })

  test('a 🛫 is its start, and a deadline set on a 📅 stays a 📅', () => {
    const task = line('Draft 🛫 2026-11-01 📅 2026-11-20')

    expect(hasStarted(task, TODAY, 'deadline')).toBe(false)
    expect(startField(task, 'deadline')).toBe('start')
    expect(deadlineField(task, 'deadline')).toBe('due')
    expect(startField(line('A 📅 2026-10-06'), 'deadline')).toBe('start')
  })
})

describe('a scheduled date', () => {
  test('places a task on its day and never makes it late', () => {
    const task = line('Water the plants ⏳ 2026-10-01')

    expect(dayOf(task)).toBe('2026-10-01')
    expect(hasStarted(task, TODAY)).toBe(true)
    expect(isLate(task, TODAY)).toBe(false)
  })
})
