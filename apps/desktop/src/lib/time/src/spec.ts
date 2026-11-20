import { isRecord } from '../../platform/src/api'

export type View = 'day' | 'week'
const VIEWS: readonly View[] = ['day', 'week']
export interface Spec {
  view: View
}
export function readSpec(text: string): Spec {
  let value: unknown = null
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (!isRecord(value)) return { view: 'day' }
  return { view: value.view === 'reports' ? 'week' : (VIEWS.find((one) => one === value.view) ?? 'day') }
}
export const writeSpec = (spec: Spec): string => JSON.stringify(spec)
