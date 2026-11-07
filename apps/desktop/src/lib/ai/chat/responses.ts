import { conversationUrl } from '../providers'
import { wireEffort } from './effort'
import { learnt } from './learned'
import type { Call, Step } from './transcript'
import { responsesUsage } from './usage'
import {
  type Answer,
  argsOf,
  type Ask,
  bareName,
  type Heard,
  type Reader,
  record,
  text,
  type ToolDef,
  type Wire,
} from './wire'
import type { Part, ToolOutput, Usage } from './types'

const NAMESPACE = 'orden'

type Item = Record<string, unknown>

function userItem(step: Extract<Step, { role: 'user' }>): Item {
  return {
    role: 'user',
    content: [
      ...(step.text ? [{ type: 'input_text', text: step.text }] : []),
      ...step.images.map((one) => ({
        type: 'input_image',
        image_url: `data:${one.mime};base64,${one.data}`,
      })),
    ],
  }
}

function outputItem(id: string, output: ToolOutput): Item {
  const words = output.text || ' '
  return {
    type: 'function_call_output',
    call_id: id,
    output: output.images.length
      ? [
          { type: 'input_text', text: words },
          ...output.images.map((one) => ({
            type: 'input_image',
            image_url: `data:${one.mime};base64,${one.data}`,
          })),
        ]
      : words,
  }
}

function callItem(call: Call): Item {
  return {
    type: 'function_call',
    call_id: call.id,
    name: call.name,
    arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
  }
}

export function itemsOf(steps: readonly Step[]): unknown[] {
  const out: unknown[] = []
  for (const step of steps) {
    switch (step.role) {
      case 'user':
        out.push(userItem(step))
        break
      case 'assistant':
        if (step.text) {
          out.push({ role: 'assistant', content: [{ type: 'output_text', text: step.text }] })
        }
        out.push(...step.calls.map(callItem))
        break
      case 'tool':
        out.push(...step.results.map((one) => outputItem(one.id, one.output)))
        break
      case 'native':
        out.push(...step.messages)
        break
      case 'compacted':
        {
          const items: unknown[] = Array.isArray(step.block) ? step.block : [step.block]
          out.push(...items)
        }
        break
      case 'effort':
        break
    }
  }
  return out
}

function toolsOf(tools: readonly ToolDef[], plan: boolean, web: boolean): unknown[] {
  const functions = tools.map((one) => ({
    type: 'function',
    name: one.name,
    description: one.description,
    parameters: one.inputSchema,
    strict: false,
  }))
  const search = web ? [{ type: 'web_search' }] : []
  if (!functions.length) return search
  if (!plan) return [...functions, ...search]
  return [
    {
      type: 'namespace',
      name: NAMESPACE,
      description: 'The reader’s Orden: notes, tabs and pages.',
      tools: functions,
    },
    ...search,
  ]
}

export const responses: Wire = {
  request(ask: Ask) {
    const plan = ask.provider.kind === 'chatgpt'
    const effort = wireEffort('responses', ask.effort)
    const reasons = learnt(ask.provider.id, ask.model.id).reasons !== false
    const tools = toolsOf(ask.tools, plan, ask.web)
    const body = {
      model: ask.model.id,
      ...(ask.system ? { instructions: ask.system } : {}),
      input: [...itemsOf(ask.steps), ...ask.added],
      ...(tools.length ? { tools } : {}),
      ...(reasons
        ? {
            reasoning: { ...(effort ? { effort } : {}), summary: 'auto' },
            include: ['reasoning.encrypted_content'],
          }
        : {}),
      ...(ask.fast && ask.model.fast && !plan ? { service_tier: 'priority' } : {}),
      store: false,
      stream: true,
    }
    return { url: conversationUrl(ask.provider), body, headers: {} }
  },

  reader(window) {
    return new ResponsesReader(window)
  },

  results(results) {
    return results.map((one) => outputItem(one.call.id, one.output))
  },
}

class ResponsesReader implements Reader {
  readonly parts: Part[] = []
  private readonly drawn = new Map<number, number>()
  private readonly started = new Map<number, number>()
  private readonly items = new Map<number, Item>()
  private usage: Usage | undefined
  private incomplete = ''
  private over = false

  constructor(private readonly window: number | null) {}

  heard(event: unknown): Heard {
    const said = record(event)
    const index = Number(said.output_index)
    switch (said.type) {
      case 'response.created':
        return { changed: [], model: text(record(said.response).model) }
      case 'response.output_item.added':
        return this.added(index, record(said.item))
      case 'response.output_text.delta':
        return this.grew(index, 'text', text(said.delta))
      case 'response.reasoning_summary_text.delta':
        return this.grew(index, 'thinking', text(said.delta))
      case 'response.reasoning_summary_part.added':
        return this.grew(index, 'thinking', this.drawn.has(index) ? '\n\n' : '')
      case 'response.output_item.done':
        return this.done(index, record(said.item))
      case 'response.completed':
      case 'response.done':
      case 'response.incomplete': {
        this.over = true
        const response = record(said.response)
        this.usage = responsesUsage(response.usage, this.window)
        this.incomplete = text(record(response.incomplete_details).reason)
        const output = Array.isArray(response.output) ? response.output : []
        output.forEach((one, at) => {
          if (!this.items.has(at)) this.items.set(at, record(one))
        })
        return { changed: [], usage: this.usage, model: text(response.model) }
      }
      case 'response.failed':
      case 'error':
        return { changed: [], trouble: said }
      default:
        return { changed: [] }
    }
  }

  private added(index: number, item: Item): Heard {
    this.started.set(index, Date.now())
    let part: Part | null = null
    if (item.type === 'function_call') {
      part = {
        kind: 'tool',
        id: text(item.call_id),
        verb: bareName(text(item.name)),
        args: {},
        state: 'running',
      }
    } else if (item.type === 'web_search_call') {
      part = { kind: 'tool', id: text(item.id), verb: 'web_search', args: {}, state: 'running' }
    }
    if (!part) return { changed: [] }
    this.parts.push(part)
    this.drawn.set(index, this.parts.length - 1)
    return { changed: [this.parts.length - 1] }
  }

  private grew(index: number, kind: 'text' | 'thinking', words: string): Heard {
    let at = this.drawn.get(index)
    if (at === undefined) {
      if (!words) return { changed: [] }
      this.parts.push(
        kind === 'text' ? { kind: 'text', text: '' } : { kind: 'thinking', text: '', ms: 0 },
      )
      at = this.parts.length - 1
      this.drawn.set(index, at)
    }
    const part = this.parts[at]
    if (part?.kind === 'text' || part?.kind === 'thinking') part.text += words
    return { changed: [at] }
  }

  private done(index: number, item: Item): Heard {
    this.items.set(index, item)
    const at = this.drawn.get(index)
    if (at === undefined) return { changed: [] }
    const part = this.parts[at]
    if (part?.kind === 'thinking') part.ms = Date.now() - (this.started.get(index) ?? Date.now())
    if (part?.kind === 'tool') {
      if (item.type === 'function_call') part.args = argsOf(text(item.arguments))
      else {
        part.args = record(item.action)
        part.state = 'ok'
      }
    }
    return { changed: [at] }
  }

  finished(saidDone: boolean): boolean {
    return saidDone || this.over
  }

  answer(): Answer {
    const items = [...this.items.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, one]) => sentBack(one))
    const calls: Call[] = items
      .filter((one) => one.type === 'function_call')
      .map((one) => ({
        id: text(one.call_id),
        name: bareName(text(one.name)),
        args: argsOf(text(one.arguments)),
      }))
    const ending = calls.length
      ? 'tool'
      : this.incomplete === 'max_output_tokens'
        ? 'max_tokens'
        : this.incomplete === 'content_filter'
          ? 'refusal'
          : 'end'
    if (!items.some((one) => one.type === 'message')) {
      const words = this.parts.flatMap((one) => (one.kind === 'text' ? [one.text] : [])).join('')
      if (words) items.push({ role: 'assistant', content: [{ type: 'output_text', text: words }] })
    }
    return { messages: items, calls, ending }
  }
}

function sentBack(item: Item): Item {
  const kept = { ...item }
  delete kept.id
  delete kept.status
  return kept
}
