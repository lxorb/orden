import { Hono } from 'hono'
import {
  readBody,
  mayAsk,
  mayTranscribe,
  EFFORTS,
  forgetKey,
  keyFor,
  mayStore,
  setKey,
  type Env,
  type Variables,
  type Effort,
} from '../../../sync-server/src/api'
import { askAbout } from './asking'
import { heard, PIECE_SECONDS, shortEnough } from './heard'
import { forgetModels, modelsFor } from './models'

const MOST_QUESTION = 500

const MOST_MODEL = 100

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

  await forgetModels(context.env, user.id)
  return context.json(state)
})

ask.delete('/key', async (context) => {
  const user = context.get('user')
  await forgetModels(context.env, user.id)
  return context.json(await forgetKey(context.env, user.id))
})

ask.get('/models', async (context) => {
  const user = context.get('user')
  const key = await keyFor(context.env, user.id)
  if (!key) return context.json({ models: [] })

  return context.json({ models: await modelsFor(context.env, user.id, key) })
})

ask.post('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const question = body.text('question', MOST_QUESTION)
  const model = body.text('model', MOST_MODEL)
  const effort = body.text('effort', 20)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!question?.trim()) return context.json({ error: 'ask something' }, 400)
  if (!model) return context.json({ error: 'choose a model first' }, 400)
  if (effort !== undefined && !(EFFORTS as readonly string[]).includes(effort)) {
    return context.json({ error: `effort must be one of ${EFFORTS.join(', ')}` }, 400)
  }

  const key = await keyFor(context.env, user.id)
  if (!key) return context.json({ error: 'set an OpenAI key in Orden’s settings first' }, 400)

  if (!(await mayAsk(context.env, user.id))) {
    return context.json({ error: 'that is a lot of questions - try again later' }, 429)
  }

  try {
    const answer = await askAbout(context.env, user.id, question, {
      key,
      model,
      effort: (effort ?? 'low') as Effort,
    })
    return context.json({ answer })
  } catch (error) {
    return context.json(
      { error: error instanceof Error ? error.message : 'the model refused' },
      502,
    )
  }
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

  const ofRecording = context.req.query('piece') === '1'
  if (!shortEnough(wav, ofRecording ? PIECE_SECONDS : undefined)) {
    return context.json(
      { error: ofRecording ? 'that piece is too long' : 'that is more than a spoken command' },
      413,
    )
  }

  if (!(await mayTranscribe(context.env, user.id))) {
    return context.json({ error: 'that is a lot of listening - try again later' }, 429)
  }

  const like = (context.req.query('like') ?? '').slice(0, MOST_LIKE)

  const key = await keyFor(context.env, user.id)
  return context.json(await heard(context.env, wav, key, like))
})
