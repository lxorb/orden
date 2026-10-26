/** A setting held where it is kept (#673): the store's own property, so that whatever
 *  writes it - its row in Settings, a key, the palette, a menu, another device's value
 *  arriving through the account - writes beneath what the settings file declared, and
 *  everything that reads it reads the file's.
 *
 *  Held once a file's value is in force: `hold` puts an accessor on the store object in
 *  place of the property, which reads what the store holds with the declared part laid
 *  over it, and writes on through. A whole property is laid over whole; a part of one -
 *  one face among the three fonts, one kind among those hidden - is laid over with the
 *  store's `take` and `put`. Nothing in a store has to know: a Svelte `$state` field is an
 *  accessor on its class, and an own accessor on the instance stands in front of it. */

/** Where a setting's value is kept: a property of a store, or a part of one. */
export interface Store {
  on: object
  name: string
  /** The part a setting is, out of the property's whole value. */
  take?: (whole: unknown) => unknown
  /** The whole value with the part put back in it. */
  put?: (whole: unknown, part: unknown) => unknown
  /** The account's name for the property, where the store sends it there: what goes up
   *  in its place while it is held is the reader's own (see held.ts). */
  shared?: string
}

interface Pin {
  put: (whole: unknown) => unknown
  /** Told of a write beneath that says something else for the part. */
  written?: (whole: unknown) => void
  part: unknown
  take?: (whole: unknown) => unknown
}

interface Held {
  pins: Pin[]
  /** How the property was before, to put it back. */
  before: PropertyDescriptor | undefined
  /** What the store holds beneath the pins. */
  read: () => unknown
}

/** Every property held, by store. */
const stores = new Map<object, Map<string, Held>>()

/** While true, a held property reads what is beneath it: see `bare`. */
let bared = false

/** What `read` says of the stores as they are beneath what is held: the reader's own,
 *  which is what a hold that ends gives back (see file.ts). */
export function bare<T>(read: () => T): T {
  bared = true
  try {
    return read()
  } finally {
    bared = false
  }
}

/** The descriptor `name` has on `on` or the nearest prototype that has it. */
function descriptorOf(on: object, name: string): PropertyDescriptor | undefined {
  for (let one: object | null = on; one; one = Object.getPrototypeOf(one) as object | null) {
    const found = Object.getOwnPropertyDescriptor(one, name)
    if (found) return found
  }
  return undefined
}

/** Holds the value `store` has now, from now on. `written` hears of every write beneath
 *  that says something else for it: a key pressed, another device's value arriving. */
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
  // A write that only carries a held part through - the whole of `fonts` written again
  // with one face changed, the held one as it was read - says nothing about that part.
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

/** A copy nothing else holds, so a store changing an array in place changes nothing. */
function frozen(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze([...(value as unknown[])])
  if (value && typeof value === 'object') return Object.freeze({ ...value })
  return value
}

/** Every property let go again, as it was: a launch's file is the next launch's to say. */
export function releaseAll(): void {
  for (const [on, names] of stores) {
    for (const [name, held] of names) {
      // What was written beneath is what the store holds again.
      const beneath = held.read()
      if (held.before) Object.defineProperty(on, name, held.before)
      else Reflect.deleteProperty(on, name)
      if (held.before && 'value' in held.before) Reflect.set(on, name, beneath)
    }
  }
  stores.clear()
}

/** One entry of a record a store keeps: a face of `fonts`, a field of the page setup. */
export function part(on: object, name: string, key: string): Store {
  return {
    on,
    name,
    take: (whole) => (whole as Record<string, unknown> | undefined)?.[key],
    put: (whole, value) => ({ ...(whole as Record<string, unknown>), [key]: value }),
  }
}

/** Whether one value is in a list a store keeps: a kind among those hidden, a language
 *  among those spelling is checked in. */
export function among(on: object, name: string, value: string): Store {
  return {
    on,
    name,
    take: (whole) => ((whole ?? []) as readonly string[]).includes(value),
    put: (whole, there) => {
      // Null where the account is told every kind is offered.
      const rest = ((whole ?? []) as readonly string[]).filter((one) => one !== value)
      return there ? [...rest, value] : rest
    },
  }
}
