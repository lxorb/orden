import { key } from '../i18n.svelte'

export type LocalKind = 'claude-code' | 'codex' | 'gemini-cli'

export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'compatible' | 'chatgpt' | LocalKind

export function isLocal(kind: ProviderKind): kind is LocalKind {
  return kind === 'claude-code' || kind === 'codex' || kind === 'gemini-cli'
}

export function offeredKinds(desktop: boolean, claudeCode: boolean): ProviderKind[] {
  const keyed: ProviderKind[] = ['anthropic', 'openai', 'gemini', 'compatible']
  if (!desktop) return keyed
  const plans: ProviderKind[] = claudeCode
    ? ['claude-code', 'chatgpt', 'codex', 'gemini-cli']
    : ['chatgpt', 'codex', 'gemini-cli']
  return [...plans, ...keyed]
}

export interface Provider {
  id: string
  kind: ProviderKind
  name: string
  baseUrl?: string
  model: string
}

export const KIND_NAMES: Record<ProviderKind, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  compatible: key('OpenAI-compatible'),
  chatgpt: 'ChatGPT',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
}

const ROOTS: Record<Exclude<ProviderKind, 'compatible' | LocalKind>, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  chatgpt: 'https://api.openai.com/v1',
}

const ANTHROPIC_VERSION = '2023-06-01'

const MOST_TOKENS = 4096

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?=[:/]|$)/i

export function apiRoot(provider: Provider): string {
  if (isLocal(provider.kind)) return ''
  if (provider.kind !== 'compatible') return ROOTS[provider.kind]

  const typed = (provider.baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(LOOPBACK, 'http://localhost')
  if (!typed) return ''
  return /\/v\d+$/.test(typed) ? typed : `${typed}/v1`
}

export function usable(provider: Provider): boolean {
  if (isLocal(provider.kind)) return true
  return !!provider.model && !!apiRoot(provider)
}

export function reachable(provider: Provider, keyed: boolean): boolean {
  if (isLocal(provider.kind)) return true
  return !!apiRoot(provider) && (provider.kind === 'compatible' || keyed)
}

export function modelsUrl(provider: Provider): string {
  if (provider.kind === 'gemini') return `${apiRoot(provider)}/models?pageSize=1000`
  return `${apiRoot(provider)}/models`
}

export function geminiUrl(provider: Provider, model: string): string {
  return `${apiRoot(provider)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
}

export function askUrl(provider: Provider): string {
  if (provider.kind === 'gemini') return geminiUrl(provider, provider.model)
  if (provider.kind === 'anthropic') return `${apiRoot(provider)}/messages`
  if (provider.kind === 'chatgpt') return `${apiRoot(provider)}/responses`
  return `${apiRoot(provider)}/chat/completions`
}

export function conversationUrl(provider: Provider): string {
  if (provider.kind === 'gemini') return geminiUrl(provider, provider.model)
  if (provider.kind === 'anthropic') return `${apiRoot(provider)}/messages`
  if (provider.kind === 'openai' || provider.kind === 'chatgpt') {
    return `${apiRoot(provider)}/responses`
  }
  return `${apiRoot(provider)}/chat/completions`
}

export function compactUrl(provider: Provider): string {
  return `${apiRoot(provider)}/responses/compact`
}

export function heardUrl(provider: Provider): string {
  return `${apiRoot(provider)}/audio/transcriptions`
}

export function transcribes(provider: Provider): boolean {
  return (provider.kind === 'openai' || provider.kind === 'compatible') && !!apiRoot(provider)
}

export function headersFor(provider: Provider, apiKey: string): Record<string, string> {
  if (provider.kind === 'anthropic') {
    return {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': apiKey,
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  if (provider.kind === 'gemini') {
    return { 'content-type': 'application/json', ...(apiKey ? { 'x-goog-api-key': apiKey } : {}) }
  }

  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }
}

export function headersWithoutType(provider: Provider, apiKey: string): Record<string, string> {
  const headers = { ...headersFor(provider, apiKey) }
  delete headers['content-type']

  return headers
}

export function modelsIn(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return []
  const { data, models } = body as { data?: unknown; models?: unknown }
  const listed: unknown[] = Array.isArray(data) ? data : Array.isArray(models) ? models : []

  const names = listed
    .map((one) => {
      if (typeof one !== 'object' || one === null) return null
      const { id, slug, visibility, name, supportedGenerationMethods } = one as {
        id?: unknown
        slug?: unknown
        visibility?: unknown
        name?: unknown
        supportedGenerationMethods?: unknown
      }
      if (visibility !== undefined && visibility !== 'list') return null
      if (Array.isArray(supportedGenerationMethods)) {
        if (!supportedGenerationMethods.includes('generateContent')) return null
        return typeof name === 'string' ? name.replace(/^models\//, '') : null
      }
      return slug ?? id
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

export const NOT_CHAT =
  /embedding|whisper|tts|dall-e|moderation|transcribe|audio|realtime|image|search|babbage|davinci/i

const NOT_GEMINI_CHAT =
  /embedding|imagen|veo|lyria|tts|image|live|native-audio|transcribe|translate|robotics|aqa|deep-research|antigravity|computer-use/i

export function talkable(kind: ProviderKind, ids: readonly string[]): string[] {
  if (kind === 'gemini') return ids.filter((id) => !NOT_GEMINI_CHAT.test(id))
  if (kind !== 'openai' && kind !== 'chatgpt') return [...ids]
  return ids.filter((id) => !NOT_CHAT.test(id))
}

function rankOf(kind: ProviderKind, id: string): number[] | null {
  if (kind === 'openai' || kind === 'chatgpt') {
    const gpt = /^gpt-(\d+)(?:\.(\d+))?(-mini)?$/.exec(id)
    if (!gpt) return null
    return [-Number(gpt[1]), -Number(gpt[2] ?? 0), gpt[3] ? 1 : 0]
  }
  if (kind === 'anthropic') {
    const claude = /^claude-(sonnet|opus|haiku)-(\d+)(?:-(\d{1,2}))?(-\d{8})?$/.exec(id)
    if (!claude) return null
    const family = ['sonnet', 'opus', 'haiku'].indexOf(claude[1] ?? '')
    return [family, -Number(claude[2]), -Number(claude[3] ?? 0), claude[4] ? 1 : 0]
  }
  if (kind === 'gemini') {
    const gemini = /^gemini-(\d+)(?:\.(\d+))?-(pro|flash|flash-lite|argon)(-preview)?$/.exec(id)
    if (gemini) {
      const family = ['pro', 'argon', 'flash', 'flash-lite'].indexOf(gemini[3] ?? '')
      return [-Number(gemini[1]), -Number(gemini[2] ?? 0), family, gemini[4] ? 1 : 0]
    }
    const named = /^gemini-(\d+)(?:\.(\d+))?-([a-z]+)$/.exec(id)
    if (!named) return null
    return [-Number(named[1]), -Number(named[2] ?? 0), 1, 0]
  }
  return null
}

export function firstModel(kind: ProviderKind, ids: readonly string[]): string | null {
  const offered = talkable(kind, ids)
  const known = offered
    .map((id) => ({ id, rank: rankOf(kind, id) }))
    .filter((one): one is { id: string; rank: number[] } => one.rank !== null)
    .sort((a, b) => {
      for (let at = 0; at < Math.max(a.rank.length, b.rank.length); at++) {
        const by = (a.rank[at] ?? 0) - (b.rank[at] ?? 0)
        if (by !== 0) return by
      }
      return 0
    })
  return known[0]?.id ?? offered[0] ?? null
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function bodyFor(provider: Provider, messages: readonly Message[], stream: boolean): string {
  if (provider.kind === 'chatgpt') return responsesBody(provider.model, messages)
  if (provider.kind === 'gemini') return geminiBody(messages)

  if (provider.kind === 'anthropic') {
    const system = messages
      .filter((one) => one.role === 'system')
      .map((one) => one.content)
      .join('\n\n')

    return JSON.stringify({
      model: provider.model,
      max_tokens: MOST_TOKENS,
      stream,
      ...(system ? { system } : {}),
      messages: messages.filter((one) => one.role !== 'system'),
    })
  }

  return JSON.stringify({ model: provider.model, stream, messages })
}

function geminiBody(messages: readonly Message[]): string {
  const system = messages
    .filter((one) => one.role === 'system')
    .map((one) => one.content)
    .join('\n\n')

  return JSON.stringify({
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages
      .filter((one) => one.role !== 'system')
      .map((one) => ({
        role: one.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: one.content }],
      })),
  })
}

function geminiText(event: unknown): string {
  const candidates = (event as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return ''
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((one) => {
      const part = one as { text?: unknown; thought?: unknown } | null
      return part && part.thought !== true && typeof part.text === 'string' ? part.text : ''
    })
    .join('')
}

function responsesBody(model: string, messages: readonly Message[]): string {
  const instructions = messages
    .filter((one) => one.role === 'system')
    .map((one) => one.content)
    .join('\n\n')

  return JSON.stringify({
    model,
    ...(instructions ? { instructions } : {}),
    input: messages
      .filter((one) => one.role !== 'system')
      .map((one) => ({ role: one.role, content: one.content })),
    store: false,
    stream: true,
  })
}

export function deltaIn(kind: ProviderKind, event: unknown): string {
  if (typeof event !== 'object' || event === null) return ''

  if (kind === 'chatgpt') {
    const { type, delta } = event as { type?: unknown; delta?: unknown }
    return type === 'response.output_text.delta' && typeof delta === 'string' ? delta : ''
  }

  if (kind === 'gemini') return geminiText(event)

  if (kind === 'anthropic') {
    const { type, delta } = event as { type?: unknown; delta?: { text?: unknown } }
    if (type !== 'content_block_delta') return ''
    return typeof delta?.text === 'string' ? delta.text : ''
  }

  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const content = (choices[0] as { delta?: { content?: unknown } } | undefined)?.delta?.content
  return typeof content === 'string' ? content : ''
}

export function troubleIn(body: unknown): string | null {
  if (Array.isArray(body)) return troubleIn(body[0])
  if (typeof body !== 'object' || body === null) return null

  const event = body as { type?: unknown; response?: unknown; message?: unknown }
  if (event.type === 'response.failed') return troubleIn(event.response) ?? 'response.failed'
  if (event.type === 'error' && typeof event.message === 'string' && event.message) {
    return event.message
  }

  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return null

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message ? message : null
}
