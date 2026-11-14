import {
  fade as fading,
  type FadeParams,
  fly as flying,
  type FlyParams,
  scale as scaling,
  type ScaleParams,
  slide as sliding,
  type SlideParams,
  type TransitionConfig,
} from 'svelte/transition'

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

function moving<Params extends { delay?: number; duration?: number }>(
  move: (node: Element, params?: Params) => TransitionConfig,
): (node: Element, params?: Params) => TransitionConfig {
  return (node, params) => {
    const { delay = 0, duration } = params ?? {}
    return duration === 0 ? { delay, duration } : move(node, params)
  }
}

export const fade = moving<FadeParams>(fading)
export const fly = moving<FlyParams>(flying)
export const scale = moving<ScaleParams>(scaling)
export const slide = moving<SlideParams>(sliding)
