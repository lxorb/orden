import { budgetLeft as left, spend } from '@orden/online'
import type { Env } from '../types'
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
