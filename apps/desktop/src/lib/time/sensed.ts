import { isRecord } from '../stored'

export interface Sensed {
  idleMs: number | null
  front: boolean | null
  app: string | null
  cpu: number | null
  memory: number | null
  battery: number | null
  charging: boolean | null
  lid: boolean | null
  locked: boolean | null
}

const LONGEST_APP = 80

const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const flagOr = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

function appOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\.(exe|app)$/i, '')
    .trim()
    .slice(0, LONGEST_APP)
  return name || null
}

export function sensedOf(value: unknown): Sensed | null {
  if (!isRecord(value)) return null
  return {
    idleMs: numberOr(value.idleMs),
    front: flagOr(value.front),
    app: appOf(value.app),
    cpu: numberOr(value.cpu),
    memory: numberOr(value.memory),
    battery: numberOr(value.battery),
    charging: flagOr(value.charging),
    lid: flagOr(value.lid),
    locked: flagOr(value.locked),
  }
}

export const withIdle = (said: Sensed, idleMs: number): Sensed =>
  said.idleMs === null ? { ...said, idleMs } : said
