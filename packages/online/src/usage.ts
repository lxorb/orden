import type { Allowance } from './types'

const GB = 1_000_000_000
const HOUR = 3600

export interface MachineSize {
  vcpu: number
  memGib: number
  diskGb: number
}

export const SMALL: MachineSize = { vcpu: 0.5, memGib: 2, diskGb: 8 }

export const FREE: Allowance = {
  awakeS: 20 * HOUR,
  cpuS: 10 * HOUR,
  homeBytes: 5 * GB,
  egressBytes: 20 * GB,
}

export const ALLOWANCE: Allowance = {
  ...FREE,
  awakeS: Number.MAX_SAFE_INTEGER,
  cpuS: Number.MAX_SAFE_INTEGER,
}

export interface Usage {
  awakeS: number
  cpuS: number
  memGibS: number
  diskGbS: number
  egressBytes: number
}

export const NONE: Usage = { awakeS: 0, cpuS: 0, memGibS: 0, diskGbS: 0, egressBytes: 0 }

export const PRICES = {
  vcpuS: 0.072 / HOUR,
  memGibS: 0.009 / HOUR,
  diskGbS: 0.18 / (30 * 24 * HOUR),
  egressGb: 0.025,
  objectGbS: 12.5 / 1_000_000,
  objectGb: 0.128,
  storedGbMonth: 0.015,
} as const

export function accrue(
  usage: Usage,
  seconds: number,
  size: MachineSize,
  cpuS: number,
  egressBytes: number,
): Usage {
  const awake = Math.max(0, seconds)
  return {
    awakeS: usage.awakeS + awake,
    cpuS: usage.cpuS + Math.max(0, cpuS),
    memGibS: usage.memGibS + awake * size.memGib,
    diskGbS: usage.diskGbS + awake * size.diskGb,
    egressBytes: usage.egressBytes + Math.max(0, egressBytes),
  }
}

export function sum(usages: readonly Usage[]): Usage {
  return usages.reduce(
    (total, one) => ({
      awakeS: total.awakeS + one.awakeS,
      cpuS: total.cpuS + one.cpuS,
      memGibS: total.memGibS + one.memGibS,
      diskGbS: total.diskGbS + one.diskGbS,
      egressBytes: total.egressBytes + one.egressBytes,
    }),
    NONE,
  )
}

export function spend(usage: Usage, storedBytes = 0): number {
  return (
    usage.cpuS * PRICES.vcpuS +
    usage.memGibS * PRICES.memGibS +
    usage.diskGbS * PRICES.diskGbS +
    (usage.egressBytes / GB) * PRICES.egressGb +
    usage.awakeS * PRICES.objectGb * PRICES.objectGbS +
    (storedBytes / GB) * PRICES.storedGbMonth
  )
}

export function budgetLeft(ceiling: number, usage: Usage, storedBytes = 0): number {
  return ceiling - spend(usage, storedBytes)
}

export function usedOf(usage: Usage, homeBytes: number): Allowance {
  return {
    awakeS: usage.awakeS,
    cpuS: usage.cpuS,
    homeBytes,
    egressBytes: usage.egressBytes,
  }
}

export function shares(used: Allowance, limit: Allowance): Allowance {
  const share = (one: number, of: number) => (of > 0 ? Math.min(1, Math.max(0, one / of)) : 1)
  return {
    awakeS: share(used.awakeS, limit.awakeS),
    cpuS: share(used.cpuS, limit.cpuS),
    homeBytes: share(used.homeBytes, limit.homeBytes),
    egressBytes: share(used.egressBytes, limit.egressBytes),
  }
}

const NEAR = 0.8

export function near(used: Allowance, limit: Allowance): boolean {
  return shares(used, limit).awakeS >= NEAR
}

export function monthOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function resetAt(at: number): number {
  const date = new Date(at)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}
