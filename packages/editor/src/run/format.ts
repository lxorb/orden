/** Turns the values a console call or a result carries into the one line the
 *  output panel shows.
 *
 *  This function is special: its source text is embedded verbatim into the
 *  sandbox document (see protocol.ts), because the values it describes only
 *  exist inside the sandbox. Nothing else can cross the boundary anyway, since
 *  postMessage refuses functions, symbols and DOM nodes, and a note that logs
 *  an object expects to read the object, not `[object Object]`.
 *
 *  So it has to stand alone: everything it needs is declared inside it, and it
 *  refers to nothing in this module or any other. A bundler renaming the
 *  outside world cannot reach in, and a test evaluates the embedded copy in an
 *  empty scope to make sure that stays true.
 *
 *  It also joins its strings with `+` rather than interpolating them, and turns
 *  numbers into strings by name. The document it goes into is built as a
 *  template literal, so one backtick in here would end that literal and take
 *  the rest of the runner with it. */
export function formatRunValues(values: unknown[], quoteStrings = false): string {
  // A console line is read, not parsed, so the caps are about keeping one line
  // legible rather than about safety. The sandbox is what keeps things safe.
  const MAX_DEPTH = 3
  const MAX_ITEMS = 100
  const MAX_KEYS = 40
  const MAX_TEXT = 400

  // Added on the way down and taken off on the way back up, so a value that
  // appears twice side by side reads twice and only a real cycle is a cycle.
  const seen = new Set<object>()

  const clip = (text: string): string =>
    text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text

  const quote = (text: string): string =>
    "'" + clip(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"

  const className = (value: object): string => {
    const holder = value as { constructor?: { name?: unknown } }
    const name = holder.constructor?.name
    return typeof name === 'string' && name !== 'Object' ? name : ''
  }

  const key = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name))

  const describe = (value: unknown, depth: number): string => {
    if (value === null) return 'null'

    // Narrowed on `typeof value` itself rather than on a saved copy of it, so
    // each branch knows what it is holding and can say so without a cast.
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return quote(value)
    if (typeof value === 'bigint') return String(value) + 'n'
    if (typeof value === 'symbol') return String(value)
    if (typeof value === 'boolean') return String(value)
    // Only -0 needs saying out loud; String() spells it as 0.
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)

    if (typeof value === 'function') {
      const named = (value as { name?: unknown }).name
      const name = typeof named === 'string' ? named : ''
      if (/^\s*class[\s{]/.test(String(value))) {
        return name ? '[class ' + name + ']' : '[class (anonymous)]'
      }
      return name ? '[Function: ' + name + ']' : '[Function (anonymous)]'
    }

    // Everything else has been answered for above, so this is an object.
    const object = value
    if (seen.has(object)) return '[Circular]'

    // An error is worth reading as a sentence rather than as an object with a
    // stack in it.
    if (object instanceof Error) {
      const name = object.name || 'Error'
      return object.message ? name + ': ' + clip(object.message) : name
    }
    if (object instanceof RegExp) return String(object)
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString()
    }

    if (depth >= MAX_DEPTH) {
      if (Array.isArray(object)) return '[Array]'
      return '[' + (className(object) || 'Object') + ']'
    }

    seen.add(object)
    try {
      if (Array.isArray(object)) {
        const parts = object.slice(0, MAX_ITEMS).map((item) => describe(item, depth + 1))
        if (object.length > MAX_ITEMS) {
          parts.push('… ' + String(object.length - MAX_ITEMS) + ' more')
        }
        return '[' + parts.join(', ') + ']'
      }

      if (object instanceof Map) {
        const parts: string[] = []
        for (const [name, held] of object) {
          if (parts.length === MAX_ITEMS) break
          parts.push(describe(name, depth + 1) + ' => ' + describe(held, depth + 1))
        }
        if (object.size > parts.length) {
          parts.push('… ' + String(object.size - parts.length) + ' more')
        }
        const size = String(object.size)
        return 'Map(' + size + ')' + (parts.length ? ' { ' + parts.join(', ') + ' }' : ' {}')
      }

      if (object instanceof Set) {
        const parts: string[] = []
        for (const held of object) {
          if (parts.length === MAX_ITEMS) break
          parts.push(describe(held, depth + 1))
        }
        if (object.size > parts.length) {
          parts.push('… ' + String(object.size - parts.length) + ' more')
        }
        const size = String(object.size)
        return 'Set(' + size + ')' + (parts.length ? ' { ' + parts.join(', ') + ' }' : ' {}')
      }

      const names = Object.keys(object)
      const parts = names
        .slice(0, MAX_KEYS)
        .map(
          (name) =>
            key(name) + ': ' + describe((object as Record<string, unknown>)[name], depth + 1),
        )
      if (names.length > MAX_KEYS) parts.push('… ' + String(names.length - MAX_KEYS) + ' more')

      const prefix = className(object) ? className(object) + ' ' : ''
      return prefix + (parts.length ? '{ ' + parts.join(', ') + ' }' : '{}')
    } finally {
      seen.delete(object)
    }
  }

  // `console.log('a', 'b')` means the words a and b, not two quoted strings.
  // A result value is a value, so there the quotes say what it is.
  return values
    .map((value) => (typeof value === 'string' && !quoteStrings ? value : describe(value, 0)))
    .join(' ')
}
