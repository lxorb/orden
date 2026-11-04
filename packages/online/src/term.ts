/** A `.term` file's text: the machine and the session the document names (4.5).
 *
 *  Never edited by hand, so it is read strictly: anything but the three fields with
 *  the right shapes is not a terminal, and the tab says the file is damaged rather
 *  than opening a session nobody asked for. Extra fields are dropped, so a later
 *  version may add one an older Orden ignores; a version it does not know is refused.
 *  The icon the reader chose, and its colour, are the two it keeps besides: optional,
 *  and dropped where they are not a short string. */

import type { Term } from './types'

/** The extension an online terminal's file has. */
export const TERM_EXTENSION = '.term'

/** The longest machine or session id a file may name. */
const LONGEST_ID = 200

/** The longest icon or colour a file may say: a set's name and an icon's, or an emoji. */
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

/** A `.term` file's text as its fields, or null for text that is not one. */
export function termOf(text: string): Term | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Not JSON: a damaged or hand-made file, not a terminal.
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

/** The text a `.term` file is written with: one line of JSON, the fields in the
 *  documented order, and a newline, as a text file ends. */
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
