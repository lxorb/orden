import type { Thread } from '../chat/types'
import type { Host } from './host'
import { sendHere } from './host'

const PLAN = [
  'Plan my day.',
  "Read today's list and what is overdue with list_tasks (view today), then the next seven days (filter: 7 days), and the inbox.",
  'Weigh priorities, deadlines, durations and what is overdue, and propose an order that fits one day, with a time for each task that has to happen at one.',
  'Then write it: for each task you scheduled, update_task with time (HH:MM) and scheduled (today), and move what does not fit today to a later day with scheduled.',
  'Change nothing else. End with the plan as a short list, earliest first.',
].join(' ')

export function planDay(host: Host, thread: Thread | null, args: string): void {
  sendHere(host, thread, args.trim() ? `${PLAN}\n\n${args.trim()}` : PLAN, { mode: 'auto' })
}

const ASSIST = [
  "Write one filter in Todoist's filter language for the request below and answer with the filter alone, nothing else.",
  'Operators: & (and), | (or), ! (not), parentheses, and a comma between lists.',
  'Queries: today, tomorrow, overdue, no date, 7 days, next 3 days, date before: <date>, date after: <date>, p1 p2 p3 p4, #<note or tag>, ##<folder>, /<heading>, @<tag>, recurring, subtask, assigned to: me, search: <words>, deadline before: <date>.',
].join(' ')

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

async function listed(filter: string | undefined): Promise<Listed> {
  const { listed: rowsOf } = await import('../../task-actions')
  return { ...(filter ? { filter } : {}), ...(await rowsOf(filter)) }
}

export async function showTasks(host: Host, thread: Thread, args: string): Promise<void> {
  const asked = args.trim()
  const { AgentError } = await import('@orden/bases/agent')
  let answer: Listed
  try {
    answer = await listed(asked || undefined)
  } catch (error) {
    if (!(error instanceof AgentError)) throw error
    const filter = (
      await host.ask(thread, [
        { role: 'system', content: ASSIST },
        { role: 'user', content: asked },
      ])
    )
      .trim()
      .replace(/^`+|`+$/g, '')
      .split('\n')[0]
      ?.trim()
    answer = await listed(filter?.length ? filter : asked)
  }
  host.line(thread, JSON.stringify(answer), 'tasks')
}
