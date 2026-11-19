import { isRecord } from '../../platform/src/api'

export type View = 'day' | 'week' | 'reports'
const VIEWS: readonly View[] = ['day', 'week', 'reports']
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
  return { view: VIEWS.find((one) => one === value.view) ?? 'day' }
}
export const writeSpec = (spec: Spec): string => JSON.stringify(spec)
