/** The font families on this machine, for the font pickers in Settings (#772).
 *
 *  A face is chosen by its name, and a name typed from memory is a name typed wrong as
 *  often as not; so a picker lists what is installed. The desktop app asks the crate,
 *  which reads the platform's font folders (src-tauri/src/fonts.rs); a browser that has
 *  the Local Font Access API asks it, once somebody opens a picker, since it asks the
 *  reader first; and any other browser lists nothing, and the name is typed.
 *
 *  Whether a name is a face this machine draws is measured rather than looked up: the
 *  same words set in the face and in a fallback come out the same width only where the
 *  face is not there. That holds in every engine, for a name typed and for a name
 *  picked, and it is what lets a picker say a name is not installed rather than draw the
 *  app's own face under it without a word. */

import { invoke, isDesktop } from './tauri'

export interface Family {
  name: string
  /** Every letter as wide as every other, which is what a face for code has to be. */
  mono: boolean
}

/** What the Local Font Access API hands back, as far as it is read here. */
interface LocalFont {
  family: string
}

let asked: Promise<Family[]> | null = null

/** Every family installed, once each, by name; asked once a launch. */
export function installedFamilies(): Promise<Family[]> {
  asked ??= listed().catch(() => [])
  return asked
}

async function listed(): Promise<Family[]> {
  if (isDesktop) return await invoke<Family[]>('font_families')

  const query = (globalThis as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
  if (!query) return []

  const names = [...new Set((await query()).map((one) => one.family.trim()).filter(Boolean))]
  return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ name, mono: monospaced(name) }))
}

/** The families in the order a picker offers them: the monospaced ones first where a
 *  face for code is being chosen, and those whose name has what was typed in it. */
export function offered(families: readonly Family[], typed: string, mono: boolean): Family[] {
  const wanted = typed.trim().toLowerCase()
  const matching = families.filter((one) => !wanted || one.name.toLowerCase().includes(wanted))
  if (!mono) return matching
  return [...matching.filter((one) => one.mono), ...matching.filter((one) => !one.mono)]
}

/** A line set in a face, and its width; null where there is no canvas to set it on. */
function width(font: string, text: string): number | null {
  if (typeof document === 'undefined') return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.font = `40px ${font}`
  return context.measureText(text).width
}

/** Letters whose widths differ in nearly every face, so two faces that set them the
 *  same are the same face. */
const SAMPLE = 'mmmmmmmmmmlli WWW 0123 Ɐ'

/** Whether this machine draws a family by that name. Measured against each of the
 *  three generic families: a face that is installed sets the line differently from at
 *  least one of them, and one that is not falls back and sets it exactly as they do.
 *  True where nothing can be measured, so a picker never cries wolf. */
export function isInstalled(name: string): boolean {
  if (!name.trim()) return true
  const quoted = `"${name.replace(/["\\]/g, '')}"`
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    const own = width(generic, SAMPLE)
    const tried = width(`${quoted}, ${generic}`, SAMPLE)
    if (own === null || tried === null) return true
    if (own !== tried) return true
  }
  return false
}

/** Whether a family sets a narrow letter and a wide one the same width. */
function monospaced(name: string): boolean {
  const font = `"${name.replace(/["\\]/g, '')}", serif`
  const narrow = width(font, 'iiiiiiiiii')
  const wide = width(font, 'WWWWWWWWWW')
  return narrow !== null && narrow === wide
}
