import type { SettingField } from '@orden/contracts'
import { autoTidy, TIDY_HOURS } from './choice.svelte'
import { AUTO_TIDY } from './name'

const CHOICES = [
  { value: '1', label: '1 hour' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
]
export function tidyFields(): SettingField[] {
  return [
    {
      kind: 'switch',
      key: 'general.autoTidy',
      label: AUTO_TIDY,
      hint: 'Closes tabs in the top bar you haven’t looked at for a while. Only saved notes, files and pages close; open them again from the sidebar or with Reopen closed tab.',
      words: ['archive', 'close', 'tidy', 'clean', 'old', 'idle', 'unused', 'tabs'],
      initial: false,
      get: () => autoTidy.on,
      set: (on) => autoTidy.set(on),
    },
    {
      kind: 'select',
      key: 'general.autoTidyAfter',
      label: 'Close tabs I haven’t looked at for',
      hint: `How long a tab may stay out of sight before ${AUTO_TIDY} closes it.`,
      words: ['archive', 'hours', 'days', 'idle', 'time'],
      shown: () => autoTidy.on,
      options: CHOICES,
      initial: String(TIDY_HOURS),
      get: () => String(autoTidy.hours),
      set: (value) => autoTidy.setHours(Number(value)),
    },
  ]
}
