import { siteBrand } from '../ui-kit/src/api'
import type { Provider, ProviderKind } from './providers'

const MAKERS: readonly [RegExp, string][] = [
  [/claude|anthropic|opus|sonnet|haiku/i, 'claude'],
  [/\bgpt|chatgpt|codex|\bo[1-9](?:\b|-)|openai/i, 'openai'],
  [/gemini|gemma/i, 'googlegemini'],
  [/mistral|mixtral|codestral|magistral|devstral/i, 'mistralai'],
  [/deepseek/i, 'deepseek'],
  [/llama/i, 'meta'],
  [/qwen/i, 'qwen'],
  [/kimi|moonshot/i, 'moonshotai'],
  [/minimax/i, 'minimax'],
  [/sonar|perplexity/i, 'perplexity'],
]

const KINDS: Partial<Record<ProviderKind, string>> = {
  anthropic: 'claude',
  'claude-code': 'claude',
  openai: 'openai',
  chatgpt: 'openai',
  codex: 'openai',
  gemini: 'googlegemini',
  'gemini-cli': 'googlegemini',
}

export function providerBrand(kind: ProviderKind | null | undefined, model: string): string | null {
  const name = model.split('/').at(-1) ?? model
  for (const [words, brand] of MAKERS) if (words.test(name)) return brand
  return kind ? (KINDS[kind] ?? null) : null
}

const HOSTS: Readonly<Record<string, string>> = {
  googleapis: 'googlegemini',
  mistral: 'mistralai',
  moonshot: 'moonshotai',
  anthropic: 'claude',
}

const PORTS: Readonly<Record<string, string>> = {
  '11434': 'ollama',
  '1234': 'lmstudio',
}

const SERVERS: readonly [RegExp, string][] = [
  [/ollama/i, 'ollama'],
  [/lm ?studio/i, 'lmstudio'],
  [/open ?router/i, 'openrouter'],
  [/vllm/i, 'vllm'],
  [/hugging ?face/i, 'huggingface'],
  [/google/i, 'googlegemini'],
  ...MAKERS,
]

const KNOWN: ReadonlySet<string> = new Set([
  ...Object.values(HOSTS),
  ...Object.values(PORTS),
  ...SERVERS.map(([, brand]) => brand),
  'nvidia',
])

export function accountBrand(account: Pick<Provider, 'kind' | 'baseUrl' | 'name'>): string | null {
  if (account.kind !== 'compatible') return KINDS[account.kind] ?? null

  const port = portOf(account.baseUrl)
  const site = siteBrand(account.baseUrl)
  const host = site === null ? null : (HOSTS[site] ?? site)
  if (host !== null && KNOWN.has(host)) return host
  if (PORTS[port]) return PORTS[port]
  for (const [words, brand] of SERVERS) if (words.test(account.name)) return brand
  return host
}

function portOf(address: string | undefined): string {
  try {
    return new URL(address ?? '').port
  } catch {
    return ''
  }
}
