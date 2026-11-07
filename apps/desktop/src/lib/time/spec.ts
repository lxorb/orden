import { isRecord } from '../stored'

export type View = 'day' | 'week' | 'reports'

const VIEWS: readonly View[] = ['day', 'week', 'reports']

export interface Spec {
  view: View
  day: number | null
}

export function readSpec(text: string): Spec {
  let value: unknown = null
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (!isRecord(value)) return { view: 'day', day: null }
  return {
    view: VIEWS.find((one) => one === value.view) ?? 'day',
    day: typeof value.day === 'number' && Number.isFinite(value.day) ? value.day : null,
  }
}

export function writeSpec(spec: Spec): string {
  return JSON.stringify(spec)
}
