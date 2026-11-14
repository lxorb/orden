import { registerSettingFields, type SettingField } from '@orden/contracts'
import { crashReports } from './choice.svelte'

const fields: SettingField[] = [
  {
    kind: 'switch',
    key: 'general.crashReports',
    label: 'Send crash and freeze reports',
    hint: 'Sends what Orden was doing when it crashed or froze; never notes, names, paths or passwords.',
    words: ['crash', 'freeze', 'hang', 'report', 'diagnostics', 'telemetry', 'privacy'],
    initial: true,
    get: () => crashReports.on,
    set: (on) => crashReports.set(on),
  },
]

if (!__EVEN_PLUGIN__) {
  registerSettingFields({
    section: 'general',
    group: 'Privacy',
    load: () => Promise.resolve(() => fields),
  })
}
