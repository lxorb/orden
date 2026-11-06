import { type Answer, type Base, cellValue, type Context, dayNumber, type View } from '@orden/bases'
import { everyRow } from './list-items'
import { dayIn } from './values'

export type ChartKind = 'bar' | 'hbar' | 'line' | 'donut' | 'number'
export const CHART_KINDS: readonly ChartKind[] = ['bar', 'hbar', 'line', 'donut', 'number']

export type Measure = 'count' | 'sum' | 'average' | 'earliest' | 'latest'
export const MEASURES: readonly Measure[] = ['count', 'sum', 'average', 'earliest', 'latest']

export interface ChartSettings {
  kind: ChartKind
  measure: Measure
  of?: string
  cumulative: boolean
}

export interface Point {
  key: Answer['groups'][number]['key']
  value: number
  day?: string
}

export function settingsOf(view: View): ChartSettings {
  const kept = view.nib.kept
  const kind = CHART_KINDS.find((one) => one === kept.chart) ?? 'bar'
  const measure = MEASURES.find((one) => one === kept.measure) ?? 'count'
  const settings: ChartSettings = { kind, measure, cumulative: kept.cumulative === true }
  if (typeof kept.of === 'string') settings.of = kept.of
  return settings
}

function measured(
  rows: Answer['groups'][number]['rows'],
  settings: ChartSettings,
  base: Base,
  context: Context,
): { value: number; day?: string } {
  if (settings.measure === 'count' || !settings.of) return { value: rows.length }
  const property = settings.of
  const values = rows.map((row) => cellValue(base, property, row, context))

  if (settings.measure === 'earliest' || settings.measure === 'latest') {
    const days = values
      .map((one) => dayIn(one))
      .filter((one): one is string => one !== null)
      .sort()
    const day = settings.measure === 'earliest' ? days[0] : days.at(-1)
    return day === undefined ? { value: 0 } : { value: dayNumber(day), day }
  }

  const numbers = values.filter((one): one is number => typeof one === 'number')
  const sum = numbers.reduce((total, one) => total + one, 0)
  if (settings.measure === 'sum') return { value: sum }
  return { value: numbers.length ? sum / numbers.length : 0 }
}

export function seriesOf(
  answer: Answer,
  settings: ChartSettings,
  base: Base,
  context: Context,
): Point[] {
  let running = 0
  return answer.groups.map((group) => {
    const one = measured(group.rows, settings, base, context)
    running += one.value
    const value = settings.cumulative && one.day === undefined ? running : one.value
    return { key: group.key, value, ...(one.day === undefined ? {} : { day: one.day }) }
  })
}

export function totalOf(
  answer: Answer,
  settings: ChartSettings,
  base: Base,
  context: Context,
): Point {
  const rows = everyRow(answer.groups)
  const one = measured(rows, settings, base, context)
  return { key: null, value: one.value, ...(one.day === undefined ? {} : { day: one.day }) }
}

export function heights(points: readonly Point[]): number[] {
  const dated = points.some((one) => one.day !== undefined)
  const values = points.map((one) => one.value)
  const floor = dated ? Math.min(...values) - 1 : 0
  const top = Math.max(...values.map((one) => one - floor), 0)
  return values.map((one) => (top > 0 ? (one - floor) / top : 0))
}

export function linePath(fractions: readonly number[], width: number, height: number): string {
  if (!fractions.length) return ''
  const step = fractions.length > 1 ? width / (fractions.length - 1) : 0
  return fractions
    .map(
      (one, at) =>
        `${at ? 'L' : 'M'}${(at * step).toFixed(1)} ${(height - one * height).toFixed(1)}`,
    )
    .join(' ')
}

export function donutPaths(values: readonly number[], r: number, inner: number): string[] {
  const total = values.reduce((sum, one) => sum + Math.max(0, one), 0)
  if (total <= 0) return []
  let angle = -Math.PI / 2
  return values.map((one) => {
    const share = Math.max(0, one) / total
    const sweep = Math.min(share, 0.9999) * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle += share * Math.PI * 2
    const large = sweep > Math.PI ? 1 : 0
    const point = (radius: number, at: number) =>
      `${(Math.cos(at) * radius).toFixed(2)} ${(Math.sin(at) * radius).toFixed(2)}`
    return [
      `M${point(r, start)}`,
      `A${r} ${r} 0 ${large} 1 ${point(r, end)}`,
      `L${point(inner, end)}`,
      `A${inner} ${inner} 0 ${large} 0 ${point(inner, start)}`,
      'Z',
    ].join(' ')
  })
}
