import type { Term } from './types'

export const TERM_EXTENSION = '.term'

const LONGEST_ID = 200

const LONGEST_ICON = 120

function iconField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ICON
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID && !/\s/.test(value)
  )
}

export function termOf(text: string): Term | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const { v, machine, session } = value
  if (v !== 1 || !isId(machine) || !isId(session)) return null
  const icon = iconField(value.icon)
  const iconColor = icon === null ? null : iconField(value.iconColor)
  return {
    v,
    machine,
    session,
    ...(icon === null ? {} : { icon }),
    ...(iconColor === null ? {} : { iconColor }),
  }
}

export function termText(term: Term): string {
  const { v, machine, session, icon, iconColor } = term
  return `${JSON.stringify({
    v,
    machine,
    session,
    ...(icon ? { icon } : {}),
    ...(icon && iconColor ? { iconColor } : {}),
  })}\n`
}
