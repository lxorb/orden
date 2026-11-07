import { type Row, todayOf } from '@orden/bases'
import { taskDay } from '@orden/markdown/task-reminders'

export interface Pressed {
  act: 'done' | 'open'
  space: string
  path: string
  hash: string
  line: number
}

export interface Host {
  rootOf(space: string): string | null
  rowsAt(path: string): readonly Row[]
  ready(): Promise<void>
  tick(row: Row): Promise<boolean>
  open(root: string, path: string, line: number): Promise<void>
  inside(root: string, path: string): string
  today?(): string
}

export async function respond(press: Pressed, host: Host): Promise<boolean> {
  const root = host.rootOf(press.space)
  if (root === null) return false

  await host.ready()
  const full = host.inside(root, press.path)
  const named = host
    .rowsAt(full)
    .filter((one) => one.kind === 'task' && one.anchor?.hash === press.hash)

  if (press.act === 'open') {
    await host.open(root, full, named[0]?.anchor?.line ?? press.line)
    return true
  }
  const today = host.today?.() ?? todayOf()
  const due = named.find((one) => {
    const task = one.task
    if (!task || task.done || task.cancelled) return false
    const day = taskDay(task, task.dueReads)
    return day === undefined || day <= today
  })
  return due ? host.tick(due) : false
}

export function pressOf(value: unknown): Pressed | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const { act, space, path, hash, line } = one
  if (act !== 'done' && act !== 'open') return null
  if (typeof space !== 'string' || typeof path !== 'string' || typeof hash !== 'string') {
    return null
  }
  return { act, space, path, hash, line: typeof line === 'number' ? line : 0 }
}
