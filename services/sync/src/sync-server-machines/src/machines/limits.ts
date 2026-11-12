import { within, type Env } from '../../../sync-server/src/api'
const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

const STARTS_AN_HOUR = 6
const SESSIONS_A_DAY = 30

export function mayStart(env: Env, userId: string): Promise<boolean> {
  return within(env, 'machine-start', userId, STARTS_AN_HOUR, AN_HOUR)
}

export function mayMakeSession(env: Env, userId: string): Promise<boolean> {
  return within(env, 'machine-session', userId, SESSIONS_A_DAY, A_DAY)
}
