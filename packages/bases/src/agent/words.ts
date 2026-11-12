import { readTask, type TaskFields } from '@orden/markdown/task-line'
import { parseQuickAdd } from '../language/parse'
import { taskOf } from './entry'
import type { ReadWords } from './tasks'

const MARKED = [
  'due',
  'scheduled',
  'start',
  'created',
  'time',
  'zone',
  'duration',
  'deadline',
  'recurrence',
  'onCompletion',
  'assignee',
  'id',
  'block',
] as const

const SPOKEN = ['en', 'de']

export function quickWords(langs: readonly string[], now: Date): ReadWords {
  return (said) => {
    const written = readTask(`- [ ] ${said}`)
    const words = written?.text ?? said.trim()
    const quick = parseQuickAdd(words, [...langs, ...SPOKEN], now)
    const fields: TaskFields = taskOf({ text: quick.text, fields: quick.fields })
    if (written) {
      for (const key of MARKED) {
        if (written[key] !== undefined) Object.assign(fields, { [key]: written[key] })
      }
      if (written.priority !== fields.priority && written.priority !== 4)
        fields.priority = written.priority
      fields.tags = [...new Set([...fields.tags, ...written.tags])]
      if (written.remind.length) fields.remind = [...fields.remind, ...written.remind]
      fields.dependsOn = written.dependsOn
      fields.fields = written.fields
    }
    return { fields }
  }
}
