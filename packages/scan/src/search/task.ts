import { readTask } from '@orden/markdown/task-line'
import { taskAt } from '@orden/markdown/tasks'
import { type Hit, type Range, shownWhole } from './match'

export function taskOf(hit: Hit): { done: boolean; text: string; ranges: Range[] } | null {
  const task = taskAt(hit.text)
  if (!task) return null
  return {
    done: task.done,
    text: hit.text.slice(task.marker),
    ranges: hit.ranges
      .map((range) => ({ from: range.from - task.marker, to: range.to - task.marker }))
      .filter((range) => range.to > 0)
      .map((range) => ({ from: Math.max(range.from, 0), to: range.to })),
  }
}
export const taskWordsOf = (hit: Hit): string | null =>
  shownWhole(hit.text) ? (readTask(hit.text)?.text ?? null) : null
