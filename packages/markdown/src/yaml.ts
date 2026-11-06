const QUOTED = /^(["'])([\s\S]*)\1$/

export function isQuoted(value: string): boolean {
  return QUOTED.test(value.trim())
}

export function unquoted(value: string): string {
  const trimmed = value.trim()
  const found = QUOTED.exec(trimmed)
  if (!found) return trimmed

  const [, quote, inside = ''] = found
  if (quote === "'") return inside.replaceAll("''", "'")

  try {
    const read: unknown = JSON.parse(trimmed)
    return typeof read === 'string' ? read : inside
  } catch {
    return inside
  }
}

export function uncommented(value: string): string {
  let quote: string | null = null

  for (let at = 0; at < value.length; at++) {
    const char = value.charAt(at)

    if (quote !== null) {
      if (quote === '"' && char === '\\') at++
      else if (quote === "'" && char === "'" && value.charAt(at + 1) === "'") at++
      else if (char === quote) quote = null
    } else if (char === '#' && !value.charAt(at - 1).trim()) {
      return value.slice(0, at).trimEnd()
    } else if ((char === '"' || char === "'") && /(?:^|[[,])\s*$/.test(value.slice(0, at))) {
      quote = char
    }
  }

  return value
}

const FLOW = /^\[([\s\S]*)\]$/

export function flowItems(value: string): string[] | null {
  return writtenFlowItems(value)?.map(unquoted) ?? null
}

export function writtenFlowItems(value: string): string[] | null {
  const found = FLOW.exec(value.trim())
  if (!found) return null

  const inside = (found[1] ?? '').trim()
  return inside === '' ? [] : members(inside).map((one) => one.trim())
}

function members(inside: string): string[] {
  const out: string[] = []
  let start = 0
  let quote: string | null = null

  for (let at = 0; at < inside.length; at++) {
    const char = inside.charAt(at)

    if (quote === '"') {
      if (char === '\\') at++
      else if (char === '"') quote = null
      continue
    }

    if (quote === "'") {
      if (char === "'" && inside.charAt(at + 1) === "'") at++
      else if (char === "'") quote = null
      continue
    }

    if (char === ',') {
      out.push(inside.slice(start, at))
      start = at + 1
    } else if ((char === '"' || char === "'") && inside.slice(start, at).trim() === '') {
      quote = char
    }
  }

  if (out.length === 0 || inside.slice(start).trim() !== '') out.push(inside.slice(start))
  return out
}

const ITEM = /^[ \t]*-(?=[ \t]|$)[ \t]*(.*)$/

export function listItem(line: string): string | null {
  const written = writtenListItem(line)
  return written === null ? null : unquoted(written)
}

export function writtenListItem(line: string): string | null {
  const found = ITEM.exec(line)
  return found === null ? null : (found[1] ?? '').trim()
}

export function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function ambiguous(value: string): boolean {
  return (
    !value ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s|:$|\s#/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^[-+]?[\d._]+([eE][-+]?\d+)?$/.test(value) ||
    /^0x[\da-f_]+$|^0o[0-7_]+$|^0b[01_]+$|^[-+]?\.(inf|nan)$/i.test(value)
  )
}

function quoted(value: string): string {
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`
}

export function scalar(value: string): string {
  const said = oneLine(value)
  return ambiguous(said) || /\s\S+\s.*[.!?…]$/u.test(said) ? quoted(said) : said
}

export function flowItem(value: string): string {
  const said = oneLine(value)
  return /[,[\]{}]/.test(said) || ambiguous(said) ? quoted(said) : said
}
