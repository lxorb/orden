import { Hono } from 'hono'
import {
  readBody,
  mayTranscribe,
  forgetKey,
  keyFor,
  mayStore,
  setKey,
  type Env,
  type Variables,
} from '../../../sync-server/src/api'
import { heard, PIECE_SECONDS, shortEnough } from './heard'

const MOST_WAV = 4 * 1024 * 1024
const MOST_KEY = 200
const MOST_LIKE = 300
export const ask = new Hono<{ Bindings: Env; Variables: Variables }>()
ask.put('/key', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const given = body.text('key', MOST_KEY)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (given === undefined) return context.json({ error: 'send a key' }, 400)
  const state = await setKey(context.env, user.id, given)
  if (typeof state === 'string') {
    return context.json({ error: state }, mayStore(context.env) ? 400 : 503)
  }
  return context.json(state)
})
ask.delete('/key', async (context) => {
  return context.json(await forgetKey(context.env, context.get('user').id))
})
ask.post('/heard', async (context) => {
  const user = context.get('user')
  const declared = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MOST_WAV) {
    return context.json({ error: 'that is too much audio' }, 413)
  }
  const wav = await context.req.arrayBuffer()
  if (!wav.byteLength) return context.json({ error: 'send some audio' }, 400)
  if (wav.byteLength > MOST_WAV) return context.json({ error: 'that is too much audio' }, 413)
  if (!shortEnough(wav, PIECE_SECONDS)) return context.json({ error: 'that piece is too long' }, 413)
  if (!(await mayTranscribe(context.env, user.id))) {
    return context.json({ error: 'that is a lot of listening - try again later' }, 429)
  }
  const like = (context.req.query('like') ?? '').slice(0, MOST_LIKE)
  const key = await keyFor(context.env, user.id)
  return context.json(await heard(context.env, wav, key, like))
})
