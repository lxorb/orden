import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

export const file = (path: string, body: string): Source => sourceOf(path, new TextEncoder().encode(body))

export function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}
