import { budgetLeft as left, spend } from '@orden/online'
import type { Env } from '../../../sync-server/src/api'
import { serviceMonth } from './meter'

const DOLLARS_A_EURO = 1.25
function dollars(amount: number, currency: string): number {
  return currency === 'USD' ? amount : amount * DOLLARS_A_EURO
}
async function fixedMonth(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `select price_month as price, price_currency as currency from machines
      where host = 'hetzner' and server_id is not null and price_month is not null`,
  ).all<{ price: number; currency: string | null }>()
  return results.reduce((total, one) => total + dollars(one.price, one.currency ?? 'EUR'), 0)
}
export async function spentThisMonth(env: Env, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return spend(usage, storedBytes) + (await fixedMonth(env))
}
export async function budgetLeft(env: Env, ceiling: number, at: number): Promise<number> {
  const { usage, storedBytes } = await serviceMonth(env, at)
  return left(ceiling, usage, storedBytes) - (await fixedMonth(env))
}
export async function mayCost(
  env: Env,
  ceiling: number,
  at: number,
  monthly: number,
  currency: string,
): Promise<boolean> {
  return (await budgetLeft(env, ceiling, at)) - dollars(monthly, currency) >= 0
}
const AN_HOUR = 3_600_000
const HOURS_A_MONTH = 730
interface Billed {
  price_month: number | null
  price_hour: number | null
  priced_at: number | null
  spent: number
}
export function spentOn(row: Billed, at: number): number | null {
  if (row.price_month === null) return null
  const day = new Date(at)
  const month = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)
  const since = Math.max(row.priced_at ?? month, month)
  const carried = (row.priced_at ?? 0) >= month ? row.spent : 0
  const hourly = row.price_hour ?? row.price_month / HOURS_A_MONTH
  const hours = Math.ceil(Math.max(0, at - since) / AN_HOUR)
  return Math.round((carried + Math.min(row.price_month, hourly * hours)) * 100) / 100
}
