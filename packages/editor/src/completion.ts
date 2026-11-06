import { Compartment, type StateEffect } from '@codemirror/state'
import { door } from '@orden/markdown/door'
import { enrolled, openViews } from './open-views'

const completions = new Compartment()

let loaded: typeof import('./completing') | null = null

let pairs = true

export const loadCompletion: () => Promise<void> = door(async () => {
  loaded = await import('./completing')
  for (const view of openViews()) view.dispatch({ effects: completionEffect(pairs) })
})

export function completionExtensions() {
  if (!loaded) void loadCompletion()

  return [completions.of(loaded ? loaded.completing(pairs) : []), enrolled]
}

export function completionEffect(closeBrackets: boolean): StateEffect<unknown> {
  pairs = closeBrackets
  if (!loaded) void loadCompletion()

  return completions.reconfigure(loaded ? loaded.completing(closeBrackets) : [])
}
