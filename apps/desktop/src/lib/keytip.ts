import type { TransitionConfig } from 'svelte/transition'
import { dur, fade } from './motion'

export function keytipIn(_: Element): TransitionConfig {
  return { duration: dur(70), css: (t) => `opacity: ${0.5 + 0.5 * t}` }
}

export function keytipOut(node: Element): TransitionConfig {
  return fade(node, { duration: dur(70) })
}
