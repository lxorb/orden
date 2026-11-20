import type { UNSEEN } from './places'

type Light = number | typeof UNSEEN | null
const held = $state<Record<string, Light>>({})
export const lightOf = (src: string): Light => held[src] ?? null
export function measured(src: string, light?: Light): boolean {
  if (light === undefined) return Object.hasOwn(held, src)
  held[src] = light
  return true
}
