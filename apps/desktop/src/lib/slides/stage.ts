import { FIT_STEPS } from '@orden/markdown/deck'

export { FIT_STEPS } from '@orden/markdown/deck'

export const STAGE_WIDTH = 1280
export const STAGE_HEIGHT = 720

export function stageScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0

  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT)
}

export function fitStep(fits: (step: number) => boolean): number {
  let low = 0
  let high = FIT_STEPS.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (fits(FIT_STEPS[middle] ?? 1)) high = middle
    else low = middle + 1
  }

  return FIT_STEPS[low] ?? 1
}

export interface Place {
  slide: number
  step: number
}

export const START: Place = { slide: 0, step: 0 }

export function stepsOf(slides: readonly { fragments: readonly number[] }[]): number[] {
  return slides.map((slide) => slide.fragments.length)
}

export function axesOf(slides: readonly { vertical: boolean }[]): boolean[] {
  return slides.map((slide) => slide.vertical)
}

function stepsAt(steps: readonly number[], slide: number): number {
  return steps[slide] ?? 0
}

export function forward(steps: readonly number[], at: Place): Place {
  if (at.step < stepsAt(steps, at.slide)) return { slide: at.slide, step: at.step + 1 }
  if (at.slide + 1 < steps.length) return { slide: at.slide + 1, step: 0 }

  return at
}

export function back(steps: readonly number[], at: Place): Place {
  if (at.step > 0) return { slide: at.slide, step: at.step - 1 }
  if (at.slide > 0) return { slide: at.slide - 1, step: stepsAt(steps, at.slide - 1) }

  return at
}

export function toSlide(steps: readonly number[], slide: number): Place {
  const found = Math.max(0, Math.min(slide, steps.length - 1))
  return { slide: found, step: 0 }
}

export function toEnd(steps: readonly number[]): Place {
  const last = Math.max(0, steps.length - 1)
  return { slide: last, step: stepsAt(steps, last) }
}

export function clamp(steps: readonly number[], at: Place): Place {
  if (!steps.length) return START

  const slide = Math.max(0, Math.min(at.slide, steps.length - 1))
  return { slide, step: Math.max(0, Math.min(at.step, stepsAt(steps, slide))) }
}

export type Move = 'forward' | 'back' | 'down' | 'up' | null

export function moveBetween(axes: readonly boolean[], from: number, to: number): Move {
  if (from === to) return null
  if (to > from) return axes[to] === true ? 'down' : 'forward'

  return axes[from] === true ? 'up' : 'back'
}

export function typedSlide(typed: string, count: number): number | null {
  if (!/^\d{1,4}$/.test(typed)) return null

  const wanted = Number(typed)
  return wanted >= 1 && wanted <= count ? wanted - 1 : null
}

export function shownFragments(fragments: readonly number[], step: number): number[] {
  return fragments.slice(0, step)
}
