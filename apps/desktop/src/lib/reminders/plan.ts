import type { Row } from '@orden/bases'
import { momentOf, plainWords, reminderId, remindTimes } from '@orden/markdown/task-reminders'

export const MOST = 64

export interface Reminder {
  id: string
  at: number
  title: string
  body: string
  space: string
  path: string
  hash: string
  line: number
}

export function plan(
  rows: readonly Row[],
  now: number,
  auto: number | null,
  most = MOST,
): Reminder[] {
  const found: Reminder[] = []
  for (const row of rows) {
    const task = row.task
    if (row.kind !== 'task' || !task || !row.anchor) continue

    for (const wall of remindTimes(task, auto, task.dueReads)) {
      const at = momentOf(wall)
      if (!(at > now)) continue
      found.push({
        id: reminderId(row.space, row.path, row.anchor.hash, wall),
        at,
        title: plainWords(task.text),
        body: row.file.basename,
        space: row.space,
        path: row.path,
        hash: row.anchor.hash,
        line: row.anchor.line,
      })
    }
  }

  found.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  return found.slice(0, most)
}

export function samePlan(a: readonly Reminder[], b: readonly Reminder[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, at) => one.id === b[at]?.id && one.at === b[at].at && one.title === b[at].title)
  )
}
