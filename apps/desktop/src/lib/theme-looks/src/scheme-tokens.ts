import type { Scheme } from '@orden/contracts'
import { type Rgb, rgbOf } from '../../legibility'

function painted(said: string): Rgb | null {
  const probe = document.createElement('span')
  probe.style.color = said
  probe.hidden = true
  document.documentElement.append(probe)
  const resolved = rgbOf(getComputedStyle(probe).color)
  probe.remove()
  return resolved
}

function askable(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement.append === 'function' &&
    typeof getComputedStyle === 'function'
  )
}

export function schemeTokens(scheme: Scheme, names: string[]): Record<string, Rgb | null> {
  if (!askable()) return Object.fromEntries(names.map((name) => [name, null]))
  const probe = document.createElement('span')
  probe.dataset.theme = scheme
  probe.hidden = true
  document.documentElement.append(probe)
  const style = getComputedStyle(probe)
  const found = Object.fromEntries(
    names.map((name) => {
      const said = style.getPropertyValue(name).trim()
      return [name, said ? (rgbOf(said) ?? painted(said)) : null]
    }),
  )
  probe.remove()
  return found
}

export const PAPER: Record<Scheme, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
