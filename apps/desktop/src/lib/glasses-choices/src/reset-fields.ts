interface Resettable {
  initial?: boolean | number | string
  get(): boolean | number | string
  set(value: boolean | number | string): void
}

type Field = Resettable | { readonly kind: 'value' }

export function resetFields<F extends Field>(fields: Iterable<F>): void {
  const settable = [...fields].filter((field: Field): field is F & Resettable => 'set' in field)
  const turningOn = settable.filter((one) => one.initial === true)
  const rest = settable.filter((one) => one.initial !== true)
  for (const one of [...turningOn, ...rest]) {
    if (one.initial !== undefined && one.get() !== one.initial) one.set(one.initial)
  }
}
