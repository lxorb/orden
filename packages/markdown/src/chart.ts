import { escape } from './html'
import { flowItems, listItem, uncommented, unquoted } from './yaml'

export type ChartKind = 'bar' | 'line' | 'scatter' | 'pie' | 'donut' | 'radar' | 'polar'

export interface Series {
  title: string
  data: number[]
}

export interface Chart {
  kind: ChartKind
  title: string | null
  labels: string[]
  series: Series[]
}

const KINDS: ReadonlyMap<string, ChartKind> = new Map(
  Object.entries({
    bar: 'bar',
    line: 'line',
    scatter: 'scatter',
    pie: 'pie',
    donut: 'donut',
    doughnut: 'donut',
    radar: 'radar',
    polar: 'polar',
    polararea: 'polar',
  } satisfies Record<string, ChartKind>),
)

const MOST_POINTS = 200
const MOST_SERIES = 12

const INK: readonly (readonly [string, string])[] = [
  ['--accent', '#5b4be0'],
  ['--canvas-4', '#08b94e'],
  ['--canvas-2', '#ec7500'],
  ['--canvas-6', '#7852ee'],
  ['--canvas-5', '#00b3b0'],
  ['--canvas-1', '#e93147'],
  ['--canvas-3', '#d9a600'],
]

function colour(at: number): string {
  const [token, hex] = INK[at % INK.length] ?? ['--accent', '#5b4be0']
  return `var(${token}, ${hex})`
}

function numberOf(written: string): number | null {
  const read = unquoted(written)
  const value = Number(read)
  return read !== '' && Number.isFinite(value) ? value : null
}

function flowsJoined(lines: readonly string[]): string[] {
  const out: string[] = []
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    const close = /^\s*(?:-\s+)?[^\s:#]+\s*:\s*\[[^\]]*$/u.test(line)
      ? lines.findIndex((one, below) => below > at && one.includes(']'))
      : -1
    out.push(close === -1 ? line : [line, ...lines.slice(at + 1, close + 1)].join(' '))
    if (close !== -1) at = close
  }
  return out
}

function valueOf(written: string): string {
  const value = written.trim()
  if (!value.startsWith('[')) return uncommented(written)

  let depth = 0
  let quote = ''
  for (let at = 0; at < value.length; at++) {
    const char = value.charAt(at)
    if (quote) {
      if (char === quote) quote = ''
    } else if ((char === '"' || char === "'") && /[[,]\s*$/u.test(value.slice(0, at))) {
      quote = char
    } else if (char === '[') depth++
    else if (char === ']' && --depth === 0) return value.slice(0, at + 1)
  }
  return value
}

function pair(
  line: string,
): { indent: number; key: string; value: string; written: string } | null {
  const indent = line.length - line.trimStart().length
  const rest = line.trim().replace(/^-\s*/, '')
  const at = rest.indexOf(':')
  if (at <= 0) return null

  const written = rest.slice(at + 1)
  return { indent, key: rest.slice(0, at).trim().toLowerCase(), value: valueOf(written), written }
}

export function readChart(source: string): Chart | null {
  const lines = flowsJoined(source.split('\n'))
  let kind: ChartKind | null = 'bar'
  let title: string | null = null
  let labels: string[] = []
  const series: Series[] = []
  let inSeries = false
  let list: { column: number; into: (item: string) => void } | null = null

  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const item = listItem(line)
    const margin = line.length - line.trimStart().length
    if (list && item !== null && margin >= list.column) {
      list.into(uncommented(item))
      continue
    }
    list = null

    const found = pair(line)
    const listed = line.trimStart().startsWith('-')

    if (found === null && listed && inSeries && item !== null) {
      const one = numberOf(uncommented(item))
      if (one === null) continue
      if (series.at(-1)?.title !== '') series.push({ title: '', data: [] })
      series.at(-1)?.data.push(one)
      continue
    }

    if (found === null) continue

    if (found.indent === 0 && !listed) {
      if (found.key === 'series') {
        const inline = flowItems(found.value)
        inSeries = inline === null
        if (inline) series.push({ title: '', data: numbers(found.value) })
        continue
      }

      inSeries = false
      if (found.key === 'type') kind = KINDS.get(unquoted(found.value).toLowerCase()) ?? null
      else if (found.key === 'title') title = unquoted(found.value || found.written) || null
      else if (found.key === 'labels') {
        if (found.value.trim() === '') {
          labels = []
          list = { column: 0, into: (one) => labels.push(unquoted(one)) }
        } else labels = flowItems(found.value) ?? [unquoted(found.value)]
      }
      continue
    }

    if (!inSeries) continue

    if (listed && series.length < MOST_SERIES) series.push({ title: '', data: [] })
    const current = series.at(-1)
    if (!current) continue

    if (found.key === 'title' || found.key === 'label') current.title = unquoted(found.value)
    else if (found.key === 'data') {
      current.data = numbers(found.value)
      if (found.value.trim() === '') {
        const dash = listed
          ? line.trimStart().length - line.trimStart().slice(1).trimStart().length
          : 0
        list = {
          column: found.indent + dash,
          into: (one) => current.data.push(numberOf(one) ?? 0),
        }
      }
    }
  }

  const drawn = series
    .filter((one) => one.data.length > 0)
    .map((one) => ({ ...one, data: one.data.slice(0, MOST_POINTS) }))
  if (drawn.length === 0 || kind === null) return null

  return { kind, title, labels, series: drawn.slice(0, MOST_SERIES) }
}

function numbers(value: string): number[] {
  const listed = flowItems(value)
  if (listed === null) {
    const one = numberOf(value)
    return one === null ? [] : [one]
  }

  if (listed.some((written) => /^[[{]/u.test(written))) return []

  return listed.slice(0, MOST_POINTS).map((written) => numberOf(written) ?? 0)
}

const WIDTH = 640
const HEIGHT = 340
const PAD = { top: 24, right: 16, bottom: 40, left: 48 }

const PLOT = {
  x: PAD.left,
  y: PAD.top,
  w: WIDTH - PAD.left - PAD.right,
  h: HEIGHT - PAD.top - PAD.bottom,
}

const GRID = 4

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

const ENGLISH = 'en-US'

let tongue = ENGLISH

export function setChartLocale(tag: string): void {
  tongue = tag || ENGLISH
}

export interface ChartOptions {
  locale?: string | undefined
}

function sayer(options?: ChartOptions): (value: number) => string {
  const format = new Intl.NumberFormat(options?.locale ?? tongue)
  return (value) =>
    format.format(Math.abs(value) > 1e15 ? value : Math.round(value * 100) / 100 + 0)
}

type Said = (value: number) => string

const LARGEST = 1e280
const SMALLEST = 1e-300
const SHRUNK = 1e20
const EDGE = Number.MAX_VALUE / SHRUNK

function span(chart: Chart): { low: number; high: number; step: number } {
  const every = chart.series.flatMap((one) => one.data)
  const top = every.reduce((high, one) => Math.max(high, one), 0)
  const bottom = every.reduce((low, one) => Math.min(low, one), 0)
  if (top - bottom < SMALLEST) return { low: 0, high: 1, step: 0.25 }
  const reach = top - bottom

  const rough = reach / (GRID - 1)
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((one) => one * power).find((one) => one >= rough / 1.5) ?? 1

  return {
    low: Math.max(Math.floor(bottom / step) * step, -EDGE),
    high: Math.min(Math.ceil(top / step) * step, EDGE),
    step,
  }
}

function marks(low: number, high: number, step: number): number[] {
  const first = low <= -EDGE ? Math.ceil(low / step) * step : low
  const last = high >= EDGE ? high : high + step / 2
  const out: number[] = []
  for (let value = first; value <= last; value += step) out.push(value)
  return out
}

function text(words: string, x: number, y: number, className: string, anchor = 'middle'): string {
  return `<text class="${className}" x="${round(x)}" y="${round(y)}" text-anchor="${anchor}">${escape(words)}</text>`
}

function frame(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const out: string[] = []

  for (const value of marks(low, high, step)) {
    const y = PLOT.y + PLOT.h * ((high - value) / (high - low))
    out.push(
      `<line class="chart-grid" x1="${PLOT.x}" y1="${round(y)}" x2="${PLOT.x + PLOT.w}" y2="${round(y)}"/>`,
    )
    out.push(text(said(value), PLOT.x - 8, y + 4, 'chart-tick', 'end'))
  }

  const across = PLOT.w / Math.max(1, longest(chart))
  for (const [at, label] of chart.labels.slice(0, longest(chart)).entries()) {
    out.push(text(label, PLOT.x + across * (at + 0.5), HEIGHT - PAD.bottom + 20, 'chart-label'))
  }

  return out.join('')
}

function longest(chart: Chart): number {
  return chart.series.map((one) => one.data.length).reduce((high, one) => Math.max(high, one), 1)
}

function bars(chart: Chart, low: number, high: number, said: Said): string {
  const points = longest(chart)
  const step = PLOT.w / points
  const room = step * 0.72
  const each = room / chart.series.length
  const zero = PLOT.y + PLOT.h * (high / (high - low))
  const out: string[] = []

  for (const [which, series] of chart.series.entries()) {
    for (const [at, value] of series.data.entries()) {
      const top = PLOT.y + PLOT.h * ((high - Math.max(value, 0)) / (high - low))
      const bottom = PLOT.y + PLOT.h * ((high - Math.min(value, 0)) / (high - low))
      const x = PLOT.x + step * at + (step - room) / 2 + each * which
      const height = Math.max(1, bottom - top)
      out.push(
        `<rect class="chart-bar" x="${round(x)}" y="${round(top)}" width="${round(Math.max(1, each - 2))}" height="${round(height)}" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></rect>`,
      )
    }
  }

  out.push(
    `<line class="chart-axis" x1="${PLOT.x}" y1="${round(zero)}" x2="${PLOT.x + PLOT.w}" y2="${round(zero)}"/>`,
  )
  return out.join('')
}

function lines(chart: Chart, low: number, high: number, said: Said, joined = true): string {
  const points = longest(chart)
  const step = PLOT.w / points
  const out: string[] = []

  for (const [which, series] of chart.series.entries()) {
    const drawn = series.data.map((value, at) => {
      const x = PLOT.x + step * (at + 0.5)
      const y = PLOT.y + PLOT.h * ((high - value) / (high - low))
      return `${round(x)},${round(y)}`
    })
    if (drawn.length === 0) continue

    if (joined) {
      out.push(
        `<polyline class="chart-line" points="${drawn.join(' ')}" fill="none" stroke="${colour(which)}"/>`,
      )
    }
    for (const [at, value] of series.data.entries()) {
      const x = PLOT.x + step * (at + 0.5)
      const y = PLOT.y + PLOT.h * ((high - value) / (high - low))
      out.push(
        `<circle class="chart-dot" cx="${round(x)}" cy="${round(y)}" r="3" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></circle>`,
      )
    }
  }

  return out.join('')
}

function pie(chart: Chart, hole: number, said: Said): string {
  const series = chart.series[0]
  if (!series) return ''

  const values = series.data.map((one) => Math.max(0, one))
  const total = values.reduce((sum, one) => sum + one, 0)
  if (total <= 0) return ''

  const middle = { x: WIDTH / 2, y: (HEIGHT - PAD.bottom + PAD.top) / 2 }
  const radius = Math.min(WIDTH, HEIGHT - PAD.bottom) / 2 - PAD.top
  const out: string[] = []
  let turned = -Math.PI / 2

  for (const [at, value] of values.entries()) {
    const sweep = (value / total) * Math.PI * 2
    if (sweep <= 0) continue

    const name = chart.labels[at] ?? ''
    const path =
      sweep >= Math.PI * 2 - 1e-9
        ? ring(middle, radius, hole)
        : slice(middle, radius, hole, turned, turned + sweep)

    out.push(
      `<path class="chart-slice" d="${path}" fill="${colour(at)}"><title>${escape(`${name ? `${name}: ` : ''}${said(value)}`)}</title></path>`,
    )
    turned += sweep
  }

  return out.join('')
}

function round_middle(): { middle: { x: number; y: number }; radius: number } {
  return {
    middle: { x: WIDTH / 2, y: (HEIGHT - PAD.bottom + PAD.top) / 2 },
    radius: Math.min(WIDTH, HEIGHT - PAD.bottom) / 2 - PAD.top,
  }
}

function spoke(count: number, at: number): number {
  return -Math.PI / 2 + (at / Math.max(1, count)) * Math.PI * 2
}

function radar(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const { middle, radius } = round_middle()
  const count = Math.max(3, longest(chart))
  const reach = (value: number) => (radius * (value - low)) / (high - low || 1)
  const out: string[] = []

  for (const value of marks(low, high, step).slice(1)) {
    const ring = Array.from({ length: count }, (_one, one) =>
      at(middle, reach(value), spoke(count, one)),
    )
    out.push(`<polygon class="chart-grid" points="${ring.join(' ')}" fill="none"/>`)
  }

  for (let one = 0; one < count; one++) {
    const angle = spoke(count, one)
    const rim = at(middle, radius, angle).split(',')
    out.push(
      `<line class="chart-grid" x1="${round(middle.x)}" y1="${round(middle.y)}" x2="${rim[0] ?? 0}" y2="${rim[1] ?? 0}"/>`,
    )

    const label = chart.labels[one]
    if (label === undefined) continue

    const away = at(middle, radius + 14, angle).split(',')
    const across = Math.cos(angle)
    const anchor = Math.abs(across) < 0.2 ? 'middle' : across > 0 ? 'start' : 'end'
    out.push(text(label, Number(away[0] ?? 0), Number(away[1] ?? 0) + 4, 'chart-label', anchor))
  }

  for (const [which, series] of chart.series.entries()) {
    const corners = Array.from({ length: count }, (_one, one) =>
      at(middle, reach(series.data[one] ?? low), spoke(count, one)),
    )
    out.push(
      `<polygon class="chart-area" points="${corners.join(' ')}" fill="${colour(which)}" stroke="${colour(which)}"/>`,
    )

    for (const [one, value] of series.data.slice(0, count).entries()) {
      const point = at(middle, reach(value), spoke(count, one)).split(',')
      out.push(
        `<circle class="chart-dot" cx="${point[0] ?? 0}" cy="${point[1] ?? 0}" r="3" fill="${colour(which)}"><title>${escape(`${series.title ? `${series.title}: ` : ''}${said(value)}`)}</title></circle>`,
      )
    }
  }

  return out.join('')
}

function polar(chart: Chart, high: number, said: Said): string {
  const series = chart.series[0]
  if (!series) return ''

  const { middle, radius } = round_middle()
  const values = series.data.map((one) => Math.max(0, one))
  const count = values.length
  if (count === 0) return ''

  const out: string[] = []
  const sweep = (Math.PI * 2) / count

  for (const [one, value] of values.entries()) {
    const reach = high <= 0 ? 0 : (radius * value) / high
    if (reach <= 0) continue

    const from = -Math.PI / 2 + sweep * one
    const name = chart.labels[one] ?? ''
    out.push(
      `<path class="chart-slice" d="${slice(middle, reach, 0, from, from + sweep)}" fill="${colour(one)}"><title>${escape(`${name ? `${name}: ` : ''}${said(value)}`)}</title></path>`,
    )
  }

  return out.join('')
}

function at(middle: { x: number; y: number }, radius: number, angle: number): string {
  return `${round(middle.x + radius * Math.cos(angle))},${round(middle.y + radius * Math.sin(angle))}`
}

function slice(
  middle: { x: number; y: number },
  radius: number,
  hole: number,
  from: number,
  to: number,
): string {
  const big = to - from > Math.PI ? 1 : 0
  const inner = radius * hole

  if (hole === 0) {
    return `M ${middle.x},${middle.y} L ${at(middle, radius, from)} A ${radius},${radius} 0 ${big} 1 ${at(middle, radius, to)} Z`
  }

  return (
    `M ${at(middle, radius, from)} A ${radius},${radius} 0 ${big} 1 ${at(middle, radius, to)}` +
    ` L ${at(middle, inner, to)} A ${inner},${inner} 0 ${big} 0 ${at(middle, inner, from)} Z`
  )
}

function ring(middle: { x: number; y: number }, radius: number, hole: number): string {
  const circle = (r: number, sweep: 0 | 1) =>
    `M ${round(middle.x - r)},${round(middle.y)} A ${r},${r} 0 1 ${sweep} ${round(middle.x + r)},${round(middle.y)} A ${r},${r} 0 1 ${sweep} ${round(middle.x - r)},${round(middle.y)} Z`

  return hole === 0 ? circle(radius, 1) : `${circle(radius, 1)} ${circle(radius * hole, 0)}`
}

function legend(chart: Chart): string {
  const sliced = chart.kind === 'pie' || chart.kind === 'donut'
  const named = sliced
    ? chart.labels.slice(0, chart.series[0]?.data.length ?? 0)
    : chart.series.map((one) => one.title)

  const shown = named.filter((one) => one !== '')
  if (shown.length < 2) return ''

  return `<div class="chart-keys">${shown
    .map(
      (name, at) =>
        `<span class="chart-key"><span class="chart-swatch" style="background: ${colour(at)}"></span>${escape(name)}</span>`,
    )
    .join('')}</div>`
}

export function chartSvg(chart: Chart, options?: ChartOptions): string {
  const huge = chart.series.some((one) => one.data.some((value) => Math.abs(value) > LARGEST))
  const say = sayer(options)
  const back = (value: number) => {
    const whole = Number((value * SHRUNK).toPrecision(15))
    return Number.isFinite(whole) ? whole : Math.sign(value) * Number.MAX_VALUE
  }
  const said = huge ? (value: number) => say(back(value)) : say
  const drawn = huge
    ? {
        ...chart,
        series: chart.series.map((one) => ({
          ...one,
          data: one.data.map((value) => value / SHRUNK),
        })),
      }
    : chart

  const { low, high, step } = span(drawn)
  const body = roundly(drawn, low, high, step, said) ?? squarely(drawn, low, high, step, said)

  return `<svg class="chart-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" preserveAspectRatio="xMidYMid meet">${body}</svg>`
}

function roundly(chart: Chart, low: number, high: number, step: number, said: Said): string | null {
  if (chart.kind === 'pie') return pie(chart, 0, said)
  if (chart.kind === 'donut') return pie(chart, 0.58, said)
  if (chart.kind === 'polar') return polar(chart, high, said)
  if (chart.kind === 'radar') return radar(chart, low, high, step, said)

  return null
}

function squarely(chart: Chart, low: number, high: number, step: number, said: Said): string {
  const marks =
    chart.kind === 'line'
      ? lines(chart, low, high, said)
      : chart.kind === 'scatter'
        ? lines(chart, low, high, said, false)
        : bars(chart, low, high, said)

  return `${frame(chart, low, high, step, said)}${marks}`
}

export function chartFigure(source: string, options?: ChartOptions): string | null {
  const chart = readChart(source)
  if (chart === null) return null

  const title = chart.title === null ? '' : `<figcaption>${escape(chart.title)}</figcaption>`
  return `<figure class="chart" data-kind="${chart.kind}">${chartSvg(chart, options)}${legend(chart)}${title}</figure>\n`
}
