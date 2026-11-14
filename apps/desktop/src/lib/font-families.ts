import { invoke, isDesktop } from './platform/src/api'

export interface Family {
  name: string
  mono: boolean
}

interface LocalFont {
  family: string
}

let asked: Promise<Family[]> | null = null

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

export function offered(families: readonly Family[], typed: string, mono: boolean): Family[] {
  const wanted = typed.trim().toLowerCase()
  const matching = families.filter((one) => !wanted || one.name.toLowerCase().includes(wanted))
  if (!mono) return matching
  return [...matching.filter((one) => one.mono), ...matching.filter((one) => !one.mono)]
}

function width(font: string, text: string): number | null {
  if (typeof document === 'undefined') return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.font = `40px ${font}`
  return context.measureText(text).width
}

const SAMPLE = 'mmmmmmmmmmlli WWW 0123 Ɐ'

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

function monospaced(name: string): boolean {
  const font = `"${name.replace(/["\\]/g, '')}", serif`
  const narrow = width(font, 'iiiiiiiiii')
  const wide = width(font, 'WWWWWWWWWW')
  return narrow !== null && narrow === wide
}
