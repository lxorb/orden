/** The faces the panel draws with.
 *
 *  The same three the app names, read from the theme's own tokens where there is
 *  a document to read them from, so a note on the glasses is set in whatever the
 *  app is set in - including a face the theme store puts there later. Written
 *  out as a fallback for the case where there is no stylesheet yet, and because
 *  the stacks have to exist for a test to measure against.
 *
 *  None of these is loaded from anywhere: the app names its faces and takes
 *  whatever the machine has, and so does this. On a phone that has neither iA
 *  Writer face the stack falls through to the system's own, which is the same
 *  thing the app does in a browser. */

import type { Family } from './style'

/** The token each family is kept in, so this file and `tokens.css` cannot
 *  drift apart without the drift being visible. */
const TOKENS: Readonly<Record<Family, string>> = {
  ui: '--font-ui',
  content: '--font-content',
  mono: '--font-mono',
}

const WRITTEN: Readonly<Record<Family, string>> = {
  ui: "'Geist', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
  content: "'iA Writer Quattro', ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
  mono: "'iA Writer Mono S', ui-monospace, 'Cascadia Code', 'Consolas', monospace",
}

/** The stack for one family, from the page when there is one. */
function fontStack(family: Family): string {
  if (typeof document === 'undefined') return WRITTEN[family]

  const token = getComputedStyle(document.documentElement).getPropertyValue(TOKENS[family]).trim()
  return token || WRITTEN[family]
}

/** What a canvas wants in its `font` property. */
export function fontOf(
  family: Family,
  size: number,
  weight: 'normal' | 'bold',
  slant: 'normal' | 'italic',
): string {
  return `${slant} ${weight} ${size}px ${fontStack(family)}`
}

/** The first named face in a stack, which is the one that has to arrive before
 *  a measurement means anything. */
function firstFace(stack: string): string | null {
  const first = stack.split(',')[0]?.trim() ?? ''
  return first.startsWith("'") || first.startsWith('"') ? first : null
}

/** Waits for the faces the panel needs, and answers even when nothing is
 *  waiting: a page measured against a fallback face and drawn against the real
 *  one would break its lines in the wrong places, so this is awaited before the
 *  first page is laid out.
 *
 *  A face nobody has is not an error - the stack falls through to the system's
 *  own, which is what the app does too. */
export async function fontsReady(families: Iterable<Family>): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return

  const wanted = [...new Set(families)]
    .map((family) => firstFace(fontStack(family)))
    .filter((face): face is string => face !== null)

  await Promise.all(wanted.map((face) => document.fonts.load(`16px ${face}`).catch(() => [])))
  await document.fonts.ready
}
