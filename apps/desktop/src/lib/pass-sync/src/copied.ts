import { said } from '../../ui-kit/src/api'
import { pass } from './store.svelte'

export async function copyField(label: string, value: string): Promise<void> {
  await pass.copy(value)
  said.say(`${label} copied`)
}
