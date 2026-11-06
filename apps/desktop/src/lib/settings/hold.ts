export interface Store {
  on: object
  name: string
  take?: (whole: unknown) => unknown
  put?: (whole: unknown, part: unknown) => unknown
  shared?: string
}

interface Pin {
  put: (whole: unknown) => unknown
  written?: (whole: unknown) => void
  part: unknown
  take?: (whole: unknown) => unknown
}

interface Held {
  pins: Pin[]
  before: PropertyDescriptor | undefined
  read: () => unknown
}

const stores = new Map<object, Map<string, Held>>()

let bared = false

export function bare<T>(read: () => T): T {
  bared = true
  try {
    return read()
  } finally {
    bared = false
  }
}

function descriptorOf(on: object, name: string): PropertyDescriptor | undefined {
  for (let one: object | null = on; one; one = Object.getPrototypeOf(one) as object | null) {
    const found = Object.getOwnPropertyDescriptor(one, name)
    if (found) return found
  }
  return undefined
}

export function hold(store: Store, written?: (whole: unknown) => void): void {
  const { on, name, take, put } = store
  const whole: unknown = Reflect.get(on, name)
  const part = frozen(take ? take(whole) : whole)
  const pin: Pin = {
    put: put ? (current) => put(current, part) : () => part,
    part,
    ...(take ? { take } : {}),
    ...(written ? { written } : {}),
  }

  let names = stores.get(on)
  if (!names) stores.set(on, (names = new Map<string, Held>()))
  const held = names.get(name)
  if (held) {
    held.pins.push(pin)
    return
  }

  const before = Object.getOwnPropertyDescriptor(on, name)
  const found = descriptorOf(on, name)
  let inner: unknown = before && 'value' in before ? before.value : undefined
  const read = found?.get ? (): unknown => found.get?.call(on) : (): unknown => inner
  const through = found?.set
    ? (value: unknown) => found.set?.call(on, value)
    : (value: unknown) => {
        inner = value
      }
  const pins = [pin]
  const write = (value: unknown) => {
    through(value)
    for (const one of pins) {
      const said = one.take ? one.take(value) : value
      if (one.written && JSON.stringify(said) !== JSON.stringify(one.part)) one.written(value)
    }
  }
  names.set(name, { pins, before, read })
  Object.defineProperty(on, name, {
    configurable: true,
    enumerable: true,
    get: () => (bared ? read() : pins.reduce<unknown>((current, one) => one.put(current), read())),
    set: write,
  })
}

function frozen(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze([...(value as unknown[])])
  if (value && typeof value === 'object') return Object.freeze({ ...value })
  return value
}

export function releaseAll(): void {
  for (const [on, names] of stores) {
    for (const [name, held] of names) {
      const beneath = held.read()
      if (held.before) Object.defineProperty(on, name, held.before)
      else Reflect.deleteProperty(on, name)
      if (held.before && 'value' in held.before) Reflect.set(on, name, beneath)
    }
  }
  stores.clear()
}

export function part(on: object, name: string, key: string): Store {
  return {
    on,
    name,
    take: (whole) => (whole as Record<string, unknown> | undefined)?.[key],
    put: (whole, value) => ({ ...(whole as Record<string, unknown>), [key]: value }),
  }
}

export function among(on: object, name: string, value: string): Store {
  return {
    on,
    name,
    take: (whole) => ((whole ?? []) as readonly string[]).includes(value),
    put: (whole, there) => {
      const rest = ((whole ?? []) as readonly string[]).filter((one) => one !== value)
      return there ? [...rest, value] : rest
    },
  }
}
