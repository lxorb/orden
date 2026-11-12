import type { TaskHelp } from '@orden/editor'
import { dayWords, todayHere } from '@orden/editor/task-days'
import { tick, todayOf } from '@orden/bases'
import { parseQuickAdd } from '@orden/bases/language'
import { region } from '../region'
import { quickAdd } from './asked.svelte'
import { pickField } from './task-pick'

export const TASK_HELP: TaskHelp = {
  tick: (note, line) => Promise.resolve(tick(note, line, todayOf())),

  pick: pickField,

  dayAtEnd(text) {
    if (!quickAdd.smart) return null
    const read = parseQuickAdd(text, [region()], new Date())
    const end = text.trimEnd().length
    const chip = read.chips.find((one) => one.kind === 'when' && one.to === end)
    const { due, time } = read.fields
    if (!chip || due === undefined) return null
    return {
      from: chip.from,
      due,
      ...(time === undefined ? {} : { time }),
      label: dayWords(due, todayHere(), time),
    }
  },
}
