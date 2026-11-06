import { geminiUrl } from '../providers'
import { wireEffort } from './effort'
import { learnt } from './learned'
import type { Call, Step } from './transcript'
import { geminiUsage } from './usage'
import {
  type Answer,
  type Ask,
  type Ending,
  type Heard,
  type Reader,
  record,
  text,
  type Wire,
} from './wire'
import type { Part, ToolOutput, Usage } from './types'

type Piece = Record<string, unknown>

interface Content {
  role: 'user' | 'model'
  parts: Piece[]
}

export const UNSIGNED = 'skip_thought_signature_validator'

const MADE = 'gemini-call-'

const REFUSED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'LANGUAGE',
])

function picture(one: { mime: string; data: string }): Piece {
  return { inlineData: { mimeType: one.mime, data: one.data } }
}

function userContent(step: Extract<Step, { role: 'user' }>): Content {
  return {
    role: 'user',
    parts: [...(step.text ? [{ text: step.text }] : []), ...step.images.map(picture)],
  }
}

function callPart(call: Call, first: boolean): Piece {
  return {
    functionCall: {
      ...(call.id.startsWith(MADE) ? {} : { id: call.id }),
      name: call.name,
      args: typeof call.args === 'object' && call.args !== null ? call.args : {},
    },
    ...(first ? { thoughtSignature: UNSIGNED } : {}),
  }
}

function resultContent(results: readonly { id: string; name: string; output: ToolOutput }[]) {
  const parts: Piece[] = results.map((one) => ({
    functionResponse: {
      ...(one.id.startsWith(MADE) ? {} : { id: one.id }),
      name: one.name,
      response: one.output.error
        ? { error: one.output.text || ' ' }
        : { output: one.output.text || ' ' },
    },
  }))
  for (const one of results) parts.push(...one.output.images.map(picture))
  return { role: 'user' as const, parts }
}

export function contentsOf(steps: readonly Step[]): Content[] {
  const out: Content[] = []
  for (const step of steps) {
    switch (step.role) {
      case 'user':
        out.push(userContent(step))
        break
      case 'assistant':
        out.push({
          role: 'model',
          parts: [
            ...(step.text ? [{ text: step.text }] : []),
            ...step.calls.map((one, at) => callPart(one, at === 0)),
          ],
        })
        break
      case 'tool':
        out.push(resultContent(step.results))
        break
      case 'native':
        out.push(...(step.messages as Content[]))
        break
      case 'compacted':
      case 'effort':
        break
    }
  }
  return out.filter((one) => one.parts.length)
}

export const gemini: Wire = {
  request(ask: Ask) {
    const thinks =
      ask.model.thinking !== false && learnt(ask.provider.id, ask.model.id).reasons !== false
    const level = thinks ? wireEffort('gemini', ask.effort) : null
    const declared = ask.tools.map((one) => ({
      name: one.name,
      description: one.description,
      parametersJsonSchema: one.inputSchema,
    }))
    const tools = [
      ...(declared.length ? [{ functionDeclarations: declared }] : []),
      ...(ask.web ? [{ googleSearch: {} }] : []),
    ]
    const body = {
      ...(ask.system ? { systemInstruction: { parts: [{ text: ask.system }] } } : {}),
      contents: [...contentsOf(ask.steps), ...(ask.added as Content[])],
      ...(tools.length ? { tools } : {}),
      generationConfig: {
        ...(ask.model.output ? { maxOutputTokens: ask.model.output } : {}),
        ...(thinks
          ? {
              thinkingConfig: { includeThoughts: true, ...(level ? { thinkingLevel: level } : {}) },
            }
          : {}),
      },
    }
    return { url: geminiUrl(ask.provider, ask.model.id), body, headers: {} }
  },

  reader(window) {
    return new GeminiReader(window)
  },

  results(results) {
    return [
      resultContent(
        results.map((one) => ({ id: one.call.id, name: one.call.name, output: one.output })),
      ),
    ]
  },
}

class GeminiReader implements Reader {
  readonly parts: Part[] = []
  private readonly kept: Piece[] = []
  private readonly calls: Call[] = []
  private finish = ''
  private blocked = ''
  private usage: Usage | undefined
  private thinking: { part: number; started: number } | null = null
  private readonly made = crypto.randomUUID()

  constructor(private readonly window: number | null) {}

  heard(event: unknown): Heard {
    const said = record(event)
    if (said.error) return { changed: [], trouble: said }
    const changed: number[] = []
    const model = text(said.modelVersion)
    if (said.usageMetadata) this.usage = geminiUsage(said.usageMetadata, this.window)
    this.blocked = text(record(said.promptFeedback).blockReason) || this.blocked

    const candidate = record(Array.isArray(said.candidates) ? said.candidates[0] : null)
    this.finish = text(candidate.finishReason) || this.finish
    const parts = record(candidate.content).parts
    if (Array.isArray(parts))
      for (const piece of parts.map(record)) changed.push(...this.took(piece))

    return { changed, ...(model ? { model } : {}), ...(this.usage ? { usage: this.usage } : {}) }
  }

  private took(piece: Piece): number[] {
    const signature = text(piece.thoughtSignature)
    const call = record(piece.functionCall)
    if (piece.functionCall) {
      const id = text(call.id) || `${MADE}${this.made}-${String(this.calls.length)}`
      const args = typeof call.args === 'object' && call.args !== null ? call.args : {}
      this.calls.push({ id, name: text(call.name), args })
      this.kept.push({ ...piece })
      this.thinking = null
      this.parts.push({ kind: 'tool', id, verb: text(call.name), args, state: 'running' })
      return [this.parts.length - 1]
    }
    if (typeof piece.text !== 'string') {
      if (Object.keys(piece).length) this.kept.push({ ...piece })
      return []
    }
    const thought = piece.thought === true
    this.keep(piece.text, thought, signature)
    if (!piece.text) return []
    return [thought ? this.think(piece.text) : this.say(piece.text)]
  }

  private keep(words: string, thought: boolean, signature: string): void {
    const last = this.kept.at(-1)
    const same =
      last !== undefined &&
      typeof last.text === 'string' &&
      (last.thought === true) === thought &&
      !last.thoughtSignature
    if (same) {
      last.text = `${text(last.text)}${words}`
      if (signature) last.thoughtSignature = signature
      return
    }
    if (!words && signature && last && !last.thoughtSignature) {
      last.thoughtSignature = signature
      return
    }
    this.kept.push({
      text: words,
      ...(thought ? { thought: true } : {}),
      ...(signature ? { thoughtSignature: signature } : {}),
    })
  }

  private think(words: string): number {
    if (!this.thinking) {
      this.parts.push({ kind: 'thinking', text: '', ms: 0 })
      this.thinking = { part: this.parts.length - 1, started: Date.now() }
    }
    const part = this.parts[this.thinking.part]
    if (part?.kind === 'thinking') {
      part.text += words
      part.ms = Date.now() - this.thinking.started
    }
    return this.thinking.part
  }

  private say(words: string): number {
    this.thinking = null
    const last = this.parts.at(-1)
    if (last?.kind === 'text') {
      last.text += words
      return this.parts.length - 1
    }
    this.parts.push({ kind: 'text', text: words })
    return this.parts.length - 1
  }

  finished(saidDone: boolean): boolean {
    return saidDone || this.finish !== '' || this.blocked !== ''
  }

  answer(): Answer {
    const parts = this.kept.filter(
      (one) => typeof one.text !== 'string' || one.text || one.thoughtSignature,
    )
    const ending = endingOf(this.finish, this.blocked, this.calls.length > 0)
    return {
      messages: parts.length ? [{ role: 'model', parts }] : [],
      calls: [...this.calls],
      ending,
      ...(ending === 'refusal' ? { refusal: this.blocked || this.finish } : {}),
    }
  }
}

function endingOf(finish: string, blocked: string, calls: boolean): Ending {
  if (blocked || REFUSED.has(finish)) return 'refusal'
  if (calls) return 'tool'
  if (finish === 'MAX_TOKENS') return 'max_tokens'
  return 'end'
}
