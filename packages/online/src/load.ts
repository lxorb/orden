export interface Usage {
  cpu: number
  memory: number
  gpu?: number
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function usageOf(value: unknown): Usage | null {
  if (!isRecord(value)) return null
  const { cpu, memory, gpu } = value
  if (!isAmount(cpu) || !isAmount(memory)) return null
  return { cpu, memory, ...(isAmount(gpu) ? { gpu } : {}) }
}
