import { Hono } from 'hono'
import type { Env } from '../../../sync-server/src/api'
import { authorize } from './authorize'
import { registration } from './clients'
import { tokens } from './tokens'

export { oauthMetadata, challenge } from './metadata'
export { grantForToken } from './tokens'

export const oauth = new Hono<{ Bindings: Env }>()

oauth.route('/', registration)
oauth.route('/', authorize)
oauth.route('/', tokens)
