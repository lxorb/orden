import { conversationUrl } from '../../../ai-providers/src/api'
import { ANTHROPIC_COMPACT_BETA } from './catalogue'
import { wireEffort } from './effort'
import type { Call, Step } from './transcript'
import { anthropicUsage } from './usage'
import {
  type Answer,
  argsOf,
  type Ask,
  type Ending,
  type Heard,
  type Reader,
  record,
  text,
  type Wire,
} from './wire'
import type { Part, ToolOutput, Usage } from '../../../ai-providers/src/api'

export const PER_MESSAGE_BETA = 'mid-conversation-output-config-2026-07-01'
const FAST_BETA = 'fast-mode-2026-02-01'

const MOST_TOKENS = 32_000

type Block = Record<string, unknown>
interface Message {
  role: string
  content: unknown
  output_config?: unknown
}

function userBlocks(step: Extract<Step, { role: 'user' }>): Block[] {
  return [
    ...step.images.map((one) => ({
      type: 'image',
      source: { type: 'base64', media_type: one.mime, data: one.data },
    })),
    ...(step.text ? [{ type: 'text', text: step.text }] : []),
  ]
}

function resultBlock(id: string, output: ToolOutput): Block {
  return {
    type: 'tool_result',
    tool_use_id: id,
    ...(output.error ? { is_error: true } : {}),
    content: [
      { type: 'text', text: output.text || ' ' },
      ...output.images.map((one) => ({
        type: 'image',
        source: { type: 'base64', media_type: one.mime, data: one.data },
      })),
    ],
  }
}

export function messagesOf(steps: readonly Step[]): Message[] {
  const out: Message[] = []
  for (const step of steps) {
    switch (step.role) {
      case 'user':
        out.push({ role: 'user', content: userBlocks(step) })
        break
      case 'assistant':
        out.push({
          role: 'assistant',
          content: [
            ...(step.text ? [{ type: 'text', text: step.text }] : []),
            ...step.calls.map((one) => ({
              type: 'tool_use',
              id: one.id,
              name: one.name,
              input: typeof one.args === 'object' && one.args !== null ? one.args : {},
            })),
          ],
        })
        break
      case 'tool':
        out.push({
          role: 'user',
          content: step.results.map((one) => resultBlock(one.id, one.output)),
        })
        break
      case 'native':
        out.push(...(step.messages as Message[]))
        break
      case 'compacted':
        out.push({ role: 'assistant', content: [step.block] })
        break
      case 'effort': {
        const effort = wireEffort('anthropic', step.effort)
        if (effort) out.push({ role: 'system', content: [], output_config: { effort } })
        break
      }
    }
  }
  return out.filter(
    (one) => !Array.isArray(one.content) || one.content.length || one.role === 'system',
  )
}

function carriesCompaction(messages: readonly Message[]): boolean {
  return messages.some(
    (one) =>
      Array.isArray(one.content) &&
      one.content.some((block) => record(block).type === 'compaction'),
  )
}

export const anthropic: Wire = {
  request(ask: Ask) {
    const messages = [...messagesOf(ask.steps), ...(ask.added as Message[])]
    const betas: string[] = []
    if (carriesCompaction(messages)) betas.push(ANTHROPIC_COMPACT_BETA)
    if (messages.some((one) => one.role === 'system')) betas.push(PER_MESSAGE_BETA)
    const fast = ask.fast && ask.model.fast
    if (fast) betas.push(FAST_BETA)

    const effort = wireEffort('anthropic', ask.perMessage && ask.base ? ask.base : ask.effort)
    const tools = [
      ...ask.tools.map((one) => ({
        name: one.name,
        description: one.description,
        input_schema: one.inputSchema,
      })),
      ...(ask.web ? [{ type: 'web_search_20260209', name: 'web_search' }] : []),
    ]
    const body = {
      model: ask.model.id,
      max_tokens: Math.min(MOST_TOKENS, ask.model.output ?? MOST_TOKENS),
      stream: true,
      cache_control: { type: 'ephemeral' },
      ...(ask.system ? { system: ask.system } : {}),
      messages,
      ...(tools.length ? { tools } : {}),
      ...(ask.model.thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
      ...(effort ? { output_config: { effort } } : {}),
      ...(fast ? { speed: 'fast' } : {}),
    }
    return {
      url: conversationUrl(ask.provider),
      body,
      headers: betas.length ? { 'anthropic-beta': betas.join(',') } : {},
    }
  },

  reader(window) {
    return new AnthropicReader(window)
  },

  results(results) {
    return [{ role: 'user', content: results.map((one) => resultBlock(one.call.id, one.output)) }]
  },
}

interface Open {
  block: Block
  part: number | null
  json: string
  started: number
}

class AnthropicReader implements Reader {
  readonly parts: Part[] = []
  private readonly blocks: Block[] = []
  private readonly open = new Map<number, Open>()
  private usage: Usage
  private stop = ''
  private over = false
  private category = ''

  constructor(private readonly window: number | null) {
    this.usage = anthropicUsage({}, window)
  }

  heard(event: unknown): Heard {
    const said = record(event)
    switch (said.type) {
      case 'message_start': {
        const message = record(said.message)
        this.usage = anthropicUsage(message.usage, this.window)
        return { changed: [], model: text(message.model), usage: this.usage }
      }
      case 'message_stop':
        this.over = true
        return { changed: [] }
      case 'content_block_start':
        return this.started(Number(said.index), record(said.content_block))
      case 'content_block_delta':
        return this.grew(Number(said.index), record(said.delta))
      case 'content_block_stop':
        return this.stopped(Number(said.index))
      case 'message_delta': {
        const delta = record(said.delta)
        this.stop = text(delta.stop_reason) || this.stop
        this.category = text(record(delta.stop_details).category) || this.category
        const usage = record(said.usage)
        this.usage = anthropicUsage(
          {
            input_tokens: usage.input_tokens ?? this.usage.input - this.usage.cached,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? this.usage.cached,
            output_tokens: usage.output_tokens,
          },
          this.window,
        )
        return { changed: [], usage: this.usage }
      }
      case 'error':
        return { changed: [], trouble: said }
      default:
        return { changed: [] }
    }
  }

  private started(index: number, block: Block): Heard {
    const open: Open = { block: { ...block }, part: null, json: '', started: Date.now() }
    this.open.set(index, open)
    const kind = text(block.type)
    if (kind === 'text') open.part = this.add({ kind: 'text', text: text(block.text) })
    else if (kind === 'thinking')
      open.part = this.add({ kind: 'thinking', text: text(block.thinking), ms: 0 })
    else if (kind === 'tool_use' || kind === 'server_tool_use') {
      open.part = this.add({
        kind: 'tool',
        id: text(block.id),
        verb: text(block.name),
        args: {},
        state: 'running',
      })
    }
    return { changed: open.part === null ? [] : [open.part] }
  }

  private grew(index: number, delta: Block): Heard {
    const open = this.open.get(index)
    if (!open) return { changed: [] }
    const { block } = open
    switch (delta.type) {
      case 'text_delta':
        block.text = text(block.text) + text(delta.text)
        break
      case 'thinking_delta':
        block.thinking = text(block.thinking) + text(delta.thinking)
        break
      case 'signature_delta':
        block.signature = text(delta.signature)
        return { changed: [] }
      case 'input_json_delta':
        open.json += text(delta.partial_json)
        return { changed: [] }
      case 'citations_delta':
        {
          const before: unknown[] = Array.isArray(block.citations) ? block.citations : []
          block.citations = [...before, delta.citation]
        }
        return { changed: [] }
      case 'compaction_delta':
        block.content = text(delta.content)
        return { changed: [] }
      default:
        return { changed: [] }
    }
    if (open.part === null) return { changed: [] }
    const part = this.parts[open.part]
    if (part?.kind === 'text') part.text = text(block.text)
    if (part?.kind === 'thinking') part.text = text(block.thinking)
    return { changed: [open.part] }
  }

  private stopped(index: number): Heard {
    const open = this.open.get(index)
    if (!open) return { changed: [] }
    this.open.delete(index)
    const { block } = open
    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      block.input = argsOf(open.json)
    }
    this.blocks.push(block)
    if (open.part === null) return { changed: [] }
    const part = this.parts[open.part]
    if (part?.kind === 'thinking') part.ms = Date.now() - open.started
    if (part?.kind === 'tool') {
      part.args = block.input
      if (block.type === 'server_tool_use') part.state = 'ok'
    }
    return { changed: [open.part] }
  }

  private add(part: Part): number {
    this.parts.push(part)
    return this.parts.length - 1
  }

  finished(saidDone: boolean): boolean {
    return saidDone || this.over || this.stop !== ''
  }

  answer(): Answer {
    for (const open of this.open.values()) {
      if (open.block.type !== 'tool_use' && open.block.type !== 'server_tool_use') {
        this.blocks.push(open.block)
      }
    }
    this.open.clear()
    const calls: Call[] = this.blocks
      .filter((one) => one.type === 'tool_use')
      .map((one) => ({ id: text(one.id), name: text(one.name), args: one.input ?? {} }))
    const content = this.blocks.filter((one) => one.type !== 'text' || text(one.text))
    return {
      messages: content.length ? [{ role: 'assistant', content }] : [],
      calls,
      ending: endingOf(this.stop, calls.length > 0),
      ...(this.category ? { refusal: this.category } : {}),
    }
  }
}

function endingOf(stop: string, calls: boolean): Ending {
  if (stop === 'tool_use' && calls) return 'tool'
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return 'max_tokens'
  if (stop === 'refusal') return 'refusal'
  if (stop === 'pause_turn') return 'pause'
  return 'end'
}
