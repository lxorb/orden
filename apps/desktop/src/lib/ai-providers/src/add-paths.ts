import { KIND_NAMES, type ProviderKind } from './providers'

export interface Adding {
  kind: ProviderKind
  key: string
  name: string
  baseUrl: string
}

export type Maker = 'anthropic' | 'openai' | 'google' | 'compatible'

interface MakerTile {
  id: Maker
  name: string
  mark: ProviderKind
}

const MAKERS: readonly MakerTile[] = [
  { id: 'anthropic', name: 'Anthropic', mark: 'anthropic' },
  { id: 'openai', name: 'OpenAI', mark: 'openai' },
  { id: 'google', name: 'Google', mark: 'gemini' },
  { id: 'compatible', name: KIND_NAMES.compatible, mark: 'compatible' },
]

const ROADS: Record<Maker, readonly ProviderKind[]> = {
  anthropic: ['claude-code', 'anthropic'],
  openai: ['chatgpt', 'codex', 'openai'],
  google: ['gemini-cli', 'gemini'],
  compatible: ['compatible'],
}

const KEYED = 'API key'

export const ROAD_NAMES: Record<ProviderKind, string> = {
  'claude-code': KIND_NAMES['claude-code'],
  chatgpt: KIND_NAMES.chatgpt,
  codex: KIND_NAMES.codex,
  'gemini-cli': KIND_NAMES['gemini-cli'],
  anthropic: KEYED,
  openai: KEYED,
  gemini: KEYED,
  compatible: KIND_NAMES.compatible,
}

export const ROAD_HINTS: Record<ProviderKind, string> = {
  'claude-code': 'Uses your Claude plan through Claude Code on this computer.',
  chatgpt: 'Sign in with your ChatGPT plan.',
  codex: 'Uses your ChatGPT plan through Codex on this computer.',
  'gemini-cli': 'Uses your Google account through Gemini CLI on this computer.',
  anthropic: 'Paid by use on your API account.',
  openai: 'Paid by use on your API account.',
  gemini: 'Paid by use on your API account.',
  compatible: '',
}

export function roadsOf(maker: Maker, offered: readonly ProviderKind[]): ProviderKind[] {
  return ROADS[maker].filter((kind) => offered.includes(kind))
}

export function makersOf(offered: readonly ProviderKind[]): MakerTile[] {
  return MAKERS.filter((one) => roadsOf(one.id, offered).length > 0)
}

export function keyed(kind: ProviderKind): boolean {
  return kind === 'anthropic' || kind === 'openai' || kind === 'gemini' || kind === 'compatible'
}
