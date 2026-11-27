import { forget, isRecord, keepJson, localDate, stored } from '../../platform/src/api'

const LEAVING = 'orden:leaving'
export interface Leaving {
  email: string
  on: number
}
export function markLeaving(email: string, on: unknown): void {
  if (typeof on === 'number' && on > Date.now()) keepJson(LEAVING, { email, on })
}
export function leavingNow(at = Date.now()): Leaving | null {
  const saved = stored(LEAVING)
  if (!isRecord(saved) || typeof saved.email !== 'string' || typeof saved.on !== 'number') return null
  if (saved.on > at) return { email: saved.email, on: saved.on }
  forget(LEAVING)
  return null
}
export function leavingDay(on: number): string {
  return localDate(on, { dateStyle: 'long' })
}
