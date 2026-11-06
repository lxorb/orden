import type { Field } from './preferences'

interface Resettable {
  initial?: boolean | number | string
  get(): boolean | number | string
  set(value: boolean | number | string): void
}

export function resetFields(fields: Iterable<Field>): void {
  for (const field of fields) {
    if (field.kind === 'value') continue
    const one: Resettable = field
    if (one.initial !== undefined && one.get() !== one.initial) one.set(one.initial)
  }
}
