import { registerSettingFields, type SettingField } from '@orden/contracts'
import { isDesktop, isMobile } from '../../platform/src/api'
import { quickAdd } from './asked.svelte'

const fields: SettingField[] = [
  {
    kind: 'switch',
    key: 'general.smartDates',
    label: 'Smart dates',
    hint: 'Reads dates, times and fields out of what you type into Add task, such as “tomorrow 9am”.',
    words: ['tasks', 'quick add', 'natural language', 'parse', 'todoist'],
    initial: true,
    get: () => quickAdd.smart,
    set: (on) => quickAdd.setSmart(on),
  },
  ...(isDesktop && !isMobile
    ? ([
        {
          kind: 'switch',
          key: 'general.addTaskFromAnyApp',
          label: 'From any app',
          hint: 'The Add task shortcut works even while another app is in front.',
          words: ['tasks', 'quick add', 'global', 'hotkey', 'shortcut', 'system'],
          initial: true,
          get: () => quickAdd.anywhere,
          set: (on) => quickAdd.setAnywhere(on),
        },
      ] satisfies SettingField[])
    : []),
]

registerSettingFields({
  section: 'general',
  group: 'Add task',
  load: () => Promise.resolve(() => fields),
})
