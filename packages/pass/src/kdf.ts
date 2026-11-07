export interface KdfParams {
  m: number
  t: number
  p: number
}

export const PASSWORD_KDF: KdfParams = { m: 65536, t: 3, p: 1 }
export const PIN_KDF: KdfParams = { m: 19456, t: 2, p: 1 }
export const MOST_KDF_MEMORY = 262144
export const MOST_KDF_PASSES = 10

const WRITTEN_MEMORY = 4194304
const WRITTEN_PASSES = 1000

function within(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high
}

function paramsWithin(value: unknown, memory: number, passes: number): KdfParams | null {
  if (typeof value !== 'object' || value === null) return null
  const { m, t, p } = value as Record<string, unknown>
  if (!within(m, 8, memory) || !within(t, 1, passes) || !within(p, 1, 4) || m < 8 * p) return null
  return { m, t, p }
}

export function kdfParamsIn(value: unknown): KdfParams | null {
  return paramsWithin(value, MOST_KDF_MEMORY, MOST_KDF_PASSES)
}

export function writtenKdfIn(value: unknown): KdfParams | null {
  return paramsWithin(value, WRITTEN_MEMORY, WRITTEN_PASSES)
}

export class KdfTooCostly extends Error {
  constructor() {
    super('This Pass asks for more memory or time to open than Pass allows.')
    this.name = 'KdfTooCostly'
  }
}
