const STILL = '(prefers-reduced-motion: reduce)'

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(STILL)
    : null

export function stillness(): boolean {
  return query?.matches ?? false
}

export function dur(ms: number): number {
  return stillness() ? 0 : ms
}

export function calm(ms: number): number {
  return ms
}

export const LAYER = {
  get fade(): number {
    return dur(130)
  },
  get rise(): number {
    return dur(190)
  },
  start: 0.97,
} as const
