import { mount } from 'svelte'
import type { Scheduled } from './schedule'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

interface Current {
  due?: string | undefined
  time?: string | undefined
  minutes?: number | undefined
  recurrence?: string | undefined
}

export interface Asked {
  at: Box
  current: Current
  today: string
  load: ReadonlyMap<string, number>
  pick: (picked: Scheduled) => void
  closed?: () => void
  skip?: () => void
  dateOnly?: boolean
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
