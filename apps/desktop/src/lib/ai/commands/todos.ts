import type { Thread } from '../chat/types'
import type { Host } from './host'
import { sendHere } from './host'

const PLAN = [
  'Plan my day.',
  "Read today's todos and what is overdue with list_tasks.",
  'Weigh priorities, deadlines, durations and what is overdue, and propose an order that fits one day, with a time for each task that has to happen at one.',
  'Then write it: for each todo you scheduled, update_task with its start date, and move what does not fit today to a later day.',
  'Change nothing else. End with the plan as a short list, earliest first.',
].join(' ')

export function planDay(host: Host, thread: Thread | null, args: string): void {
  sendHere(host, thread, args.trim() ? `${PLAN}\n\n${args.trim()}` : PLAN, { mode: 'auto' })
}

export interface Listed {
  filter?: string
  total: number
  tasks: {
    at: string
    space: string
    text: string
    status?: string
    due?: string
    time?: string
    priority?: number
  }[]
}

export async function showTasks(host: Host, thread: Thread, args: string): Promise<void> {
  const { listed } = await import('../../task-actions')
  const asked = args.trim()
  const answer: Listed = { ...(asked ? { filter: asked } : {}), ...listed() }
  host.line(thread, JSON.stringify(answer), 'tasks')
}
