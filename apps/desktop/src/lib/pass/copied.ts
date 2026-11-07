import { t } from '../i18n.svelte'
import { said } from '../said.svelte'
import { pass } from './store.svelte'

export async function copyField(label: string, value: string): Promise<void> {
  await pass.copy(value)
  said.say(t('{field} copied', { field: label }))
}
