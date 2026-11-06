export function formatRunValues(values: unknown[], quoteStrings = false): string {
  const MAX_DEPTH = 3
  const MAX_ITEMS = 100
  const MAX_KEYS = 40
  const MAX_TEXT = 400

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

    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return quote(value)
    if (typeof value === 'bigint') return String(value) + 'n'
    if (typeof value === 'symbol') return String(value)
    if (typeof value === 'boolean') return String(value)
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)

    if (typeof value === 'function') {
      const named = (value as { name?: unknown }).name
      const name = typeof named === 'string' ? named : ''
      if (/^\s*class[\s{]/.test(String(value))) {
        return name ? '[class ' + name + ']' : '[class (anonymous)]'
      }
      return name ? '[Function: ' + name + ']' : '[Function (anonymous)]'
    }

    const object = value
    if (seen.has(object)) return '[Circular]'

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

  return values
    .map((value) => (typeof value === 'string' && !quoteStrings ? value : describe(value, 0)))
    .join(' ')
}
