import { t } from '../../i18n.svelte'
import { sseEvents } from '../stream'
import {
  nearest,
  ordered,
  refusesEffort,
  refusesReasoning,
  SCALE,
  supportedIn,
  takesNoEffort,
} from './effort'
import { learn } from './learned'
import { Refused, refusalIn, request } from './request'
import type { Effort, Part, Usage } from './types'
import { type Answer, type Ask, record, type Wire } from './wire'

export interface Round {
  answer: Answer
  parts: Part[]
  usage: Usage | null
  model: string
}

export interface Adjusted {
  effort?: Effort
  efforts?: Effort[]
  toolsRefused?: boolean
}

function without(refused: Refused, ask: Ask): { ask: Ask; adjusted: Adjusted } | null {
  if (refused.status !== 400) return null
  const said = refused.message
  const provider = ask.provider.id
  const model = ask.model.id

  if (ask.perMessage && /per-turn effort|per-message effort|mid-conversation/i.test(said)) {
    learn(provider, model, { perMessage: false })
    return { ask: { ...ask, perMessage: false, base: ask.effort }, adjusted: {} }
  }
  const aboutEffort = refusesEffort(said, refused.param)
  if (refusesReasoning(said, refused.param) || (aboutEffort && takesNoEffort(said, refused.code))) {
    learn(provider, model, { reasons: false })
    const efforts: Effort[] = ['auto']
    return {
      ask: { ...ask, effort: 'auto', base: 'auto', model: { ...ask.model, efforts } },
      adjusted: { effort: 'auto', efforts },
    }
  }
  if (ask.effort !== 'auto' && aboutEffort) {
    const listed = supportedIn(said)
    const offered = listed ?? ask.model.efforts.filter((one) => one !== ask.effort)
    const refusedNow = SCALE.filter((one) => one !== 'auto' && !offered.includes(one))
    learn(provider, model, { refused: listed ? refusedNow : [ask.effort] })
    const efforts = ordered(offered)
    const effort = nearest(ask.effort, efforts)
    return {
      ask: { ...ask, effort, base: effort, model: { ...ask.model, efforts } },
      adjusted: { effort, efforts },
    }
  }
  if (ask.tools.length && ask.provider.kind === 'compatible' && /\btools?\b|function/i.test(said)) {
    learn(provider, model, { tools: false })
    return { ask: { ...ask, tools: [] }, adjusted: { toolsRefused: true } }
  }
  return null
}

export async function round(
  wire: Wire,
  first: Ask,
  heard: (parts: readonly Part[], changed: number[], model: string) => void,
  adjusted: (change: Adjusted) => void,
  signal: AbortSignal,
): Promise<Round> {
  let ask = first
  let response: Response | null = null
  for (let tries = 0; !response; tries++) {
    const { url, body, headers } = wire.request(ask)
    try {
      response = await request(ask.provider, url, { body: JSON.stringify(body), headers }, signal)
    } catch (error) {
      const next = error instanceof Refused && tries < 4 ? without(error, ask) : null
      if (!next) throw error
      ask = next.ask
      adjusted(next.adjusted)
    }
  }
  if (!response.body)
    throw new Error(t('The provider answered {status}.', { status: response.status }))

  const reader = wire.reader(ask.model.window)
  let usage: Usage | null = null
  let model = ''
  let saidDone = false
  const done = () => {
    saidDone = true
  }
  for await (const event of sseEvents(response.body, done)) {
    const said = reader.heard(event)
    if (said.trouble) {
      throw await refusalIn(record(said.trouble).response ?? said.trouble, 0, ask.provider)
    }
    if (said.model) model = said.model
    if (said.usage) usage = said.usage
    if (said.changed.length) heard(reader.parts, said.changed, model)
  }
  if (!reader.finished(saidDone)) {
    throw new Error(t('The connection closed before the answer was finished.'))
  }
  return { answer: reader.answer(), parts: reader.parts, usage, model }
}
