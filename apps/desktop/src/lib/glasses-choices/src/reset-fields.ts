interface Resettable {
  initial?: boolean | number | string
  get(): boolean | number | string
  set(value: boolean | number | string): void
}

type Field = Resettable | { readonly kind: 'value' }

export function resetFields<F extends Field>(fields: Iterable<F>): void {
  for (const field of fields) {
    const one: Field = field
    if (!('set' in one)) continue
    if (one.initial !== undefined && one.get() !== one.initial) one.set(one.initial)
  }
}
