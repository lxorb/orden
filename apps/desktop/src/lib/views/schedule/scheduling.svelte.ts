/** Which scheduler is up, and where: a date chip, a row's calendar, the task view's
 *  date, the bulk bar and the T key all open one beside what asked, with what the task
 *  says now, and hear back what was picked (schedule.ts says what a pick changes).
 *
 *  One at a time, put on the page the first time it is asked for, the way a person's
 *  card is (people/card.svelte.ts): nothing of it is fetched before somebody schedules. */

import { mount } from 'svelte'
import type { Scheduled } from './schedule'

/** Where the press was: the box of what was pressed, in the window's pixels. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** What a task says about its day now. */
interface Current {
  due?: string | undefined
  time?: string | undefined
  /** How long it takes. */
  minutes?: number | undefined
  recurrence?: string | undefined
}

export interface Asked {
  at: Box
  current: Current
  today: string
  /** How many open tasks each day holds already, for the calendar's dots. */
  load: ReadonlyMap<string, number>
  pick: (picked: Scheduled) => void
  /** Told when it closes, picked or not, so a key's focus can go back where it was. */
  closed?: () => void
}

class Scheduling {
  shown = $state.raw<Asked | null>(null)

  close(): void {
    const was = this.shown
    this.shown = null
    was?.closed?.()
  }
}

export const scheduling = new Scheduling()

let mounted = false

/** Opens the scheduler beside an element, or beside a box. */
export function showScheduler(from: Element | Box, asked: Omit<Asked, 'at'>): void {
  const box = 'getBoundingClientRect' in from ? from.getBoundingClientRect() : from
  scheduling.shown = {
    ...asked,
    at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
  }
  if (mounted) return
  mounted = true
  void import('./Scheduler.svelte').then((one) => mount(one.default, { target: document.body }))
}

/** Where a layer of this size stands beside a box: under it where it fits, else over
 *  it, and held inside the window by a margin. */
export function besideBox(
  at: Box,
  size: { width: number; height: number },
  room: { width: number; height: number },
  gap = 4,
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(at.left, room.width - size.width - margin))
  const below = at.bottom + gap
  const top =
    below + size.height + margin <= room.height
      ? below
      : Math.max(margin, Math.min(at.top - gap - size.height, room.height - size.height - margin))
  return { left, top }
}
