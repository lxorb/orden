import { isLocal, modelsUrl, NOT_CHAT, type Provider, talkable } from '../providers'
import { sseJson } from '../stream'
import { ordered, SCALE } from './effort'
import { learnt } from './learned'
import { request } from './request'
import type { Effort, ModelInfo } from './types'

export const ANTHROPIC_COMPACT_BETA = 'compact-2026-09-04'

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function supported(tree: unknown, ...path: string[]): boolean {
  let at: unknown = tree
  for (const key of path) at = record(at)?.[key]
  return record(at)?.supported === true
}

function rows(body: unknown, key: 'data' | 'models'): Json[] {
  const list = record(body)?.[key]
  return Array.isArray(list) ? list.map(record).filter((one): one is Json => one !== null) : []
}

export function anthropicModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id) return []
    const caps = row.capabilities
    const efforts = (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter((level) =>
      supported(caps, 'effort', level),
    )
    const output = count(row.max_tokens)
    return [
      {
        id,
        name: text(row.display_name) || id,
        window: count(row.max_input_tokens),
        efforts: ordered(efforts),
        images: supported(caps, 'image_input'),
        fast: supported(caps, 'fast_mode') || supported(caps, 'speed', 'fast'),
        ...(output ? { output } : {}),
        thinking: supported(caps, 'thinking', 'types', 'adaptive'),
        compaction: supported(caps, 'compaction'),
      },
    ]
  })
}

export function openaiModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id || NOT_CHAT.test(id)) return []
    return [{ id, name: id, window: null, efforts: [...SCALE], images: true, fast: true }]
  })
}

function planEfforts(row: Json): Effort[] {
  const listed =
    row.supported_reasoning_levels ?? row.supported_reasoning_efforts ?? row.reasoning_efforts
  if (!Array.isArray(listed)) return [...SCALE]
  const words = listed.map((one) => text(record(one)?.effort) || text(one))
  return ordered(
    words
      .map((word) => (word === 'none' ? 'off' : word))
      .filter((word): word is Effort => (SCALE as readonly string[]).includes(word)),
  )
}

export function planModels(body: unknown): ModelInfo[] {
  return rows(body, 'models').flatMap((row) => {
    const id = text(row.slug) || text(row.id)
    if (!id || (row.visibility !== undefined && row.visibility !== 'list')) return []
    const modalities = row.input_modalities
    return [
      {
        id,
        name: text(row.display_name) || id,
        window: count(row.context_window) ?? count(row.max_context_window),
        efforts: planEfforts(row),
        images: Array.isArray(modalities) ? modalities.includes('image') : true,
        fast: false,
      },
    ]
  })
}

const LEVELS: readonly Effort[] = ['minimal', 'low', 'medium', 'high']

function geminiEfforts(id: string, thinks: boolean): Effort[] {
  const major = Number(/^gemini-(\d+)/.exec(id)?.[1] ?? 0)
  return thinks && major >= 3 ? ordered(LEVELS) : ['auto']
}

function geminiModels(body: unknown): ModelInfo[] {
  return rows(body, 'models').flatMap((row) => {
    const id = text(row.name).replace(/^models\//, '')
    const methods = row.supportedGenerationMethods
    if (!id || !Array.isArray(methods) || !methods.includes('generateContent')) return []
    if (!talkable('gemini', [id]).length) return []
    const thinks = row.thinking === true
    const output = count(row.outputTokenLimit)
    return [
      {
        id,
        name: text(row.displayName) || id,
        window: count(row.inputTokenLimit),
        efforts: geminiEfforts(id, thinks),
        images: true,
        fast: false,
        ...(output ? { output } : {}),
        thinking: thinks,
      },
    ]
  })
}

export function compatibleModels(body: unknown): ModelInfo[] {
  return rows(body, 'data').flatMap((row) => {
    const id = text(row.id)
    if (!id) return []
    const top = record(row.top_provider)
    const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : []
    const reasons = params.includes('reasoning') || params.includes('reasoning_effort')
    const modalities = record(row.architecture)?.input_modalities
    return [
      {
        id,
        name: text(row.name) || id,
        window:
          count(row.context_length) ??
          count(top?.context_length) ??
          count(row.max_context_length) ??
          count(row.context_window),
        efforts: reasons ? ordered(['minimal', 'low', 'medium', 'high']) : ['auto'],
        images: Array.isArray(modalities) ? modalities.includes('image') : false,
        fast: false,
      },
    ]
  })
}

export function withLearnt(provider: string, model: ModelInfo): ModelInfo {
  const known = learnt(provider, model.id)
  const refused = new Set(known.refused ?? [])
  const efforts =
    known.reasons === false ? ['auto' as const] : model.efforts.filter((one) => !refused.has(one))
  return { ...model, efforts: ordered(efforts), window: model.window ?? known.window ?? null }
}

async function anthropicList(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  const found: ModelInfo[] = []
  let after = ''
  for (let page = 0; page < 10; page++) {
    const url = `${modelsUrl(provider)}?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
    const response = await request(
      provider,
      url,
      { method: 'GET', headers: { 'anthropic-beta': ANTHROPIC_COMPACT_BETA } },
      signal,
    )
    const body = sseJson(await response.text())
    found.push(...anthropicModels(body))
    const more = record(body)
    if (more?.has_more !== true || !text(more.last_id)) break
    after = text(more.last_id)
  }
  return found
}

async function geminiList(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  const found: ModelInfo[] = []
  let token = ''
  for (let page = 0; page < 10; page++) {
    const url = `${modelsUrl(provider)}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
    const response = await request(provider, url, { method: 'GET' }, signal)
    const body = sseJson(await response.text())
    found.push(...geminiModels(body))
    token = text(record(body)?.nextPageToken)
    if (!token) break
  }
  return found
}

export async function catalogue(provider: Provider, signal?: AbortSignal): Promise<ModelInfo[]> {
  if (isLocal(provider.kind)) return []
  if (provider.kind === 'gemini') {
    return (await geminiList(provider, signal)).map((one) => withLearnt(provider.id, one))
  }
  if (provider.kind === 'anthropic') {
    return (await anthropicList(provider, signal)).map((one) => withLearnt(provider.id, one))
  }
  const response = await request(provider, modelsUrl(provider), { method: 'GET' }, signal)
  const body = sseJson(await response.text())
  const read =
    provider.kind === 'chatgpt'
      ? planModels(body)
      : provider.kind === 'openai'
        ? openaiModels(body)
        : compatibleModels(body)
  const listed = provider.kind === 'chatgpt' ? read : read.sort((a, b) => a.id.localeCompare(b.id))
  return listed.map((one) => withLearnt(provider.id, one))
}

export function unlisted(provider: Provider, id: string): ModelInfo {
  const keyed = provider.kind === 'openai' || provider.kind === 'chatgpt'
  return withLearnt(provider.id, {
    id,
    name: id,
    window: null,
    efforts: keyed ? [...SCALE] : provider.kind === 'gemini' ? geminiEfforts(id, true) : ['auto'],
    images: provider.kind !== 'compatible',
    fast: false,
  })
}

export function windowIn(said: string): number | null {
  const over = /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i.exec(said)
  const named = /context (?:length|window)[^\d]{0,40}(\d[\d,]*)/i.exec(said)
  const found = over?.[2] ?? named?.[1]
  return found ? count(Number(found.replace(/,/g, ''))) : null
}
