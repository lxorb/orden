import { t } from '../i18n.svelte'
import { type Account, CLAUDE, GEMINI, OPENAI, type Vendor } from './accounts'
import { KIND_NAMES, type ProviderKind } from './providers'

const ROADS: Record<ProviderKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  chatgpt: 'ChatGPT',
  anthropic: 'API key',
  openai: 'API key',
  gemini: 'API key',
  compatible: KIND_NAMES.compatible,
}

export function vendorName(vendor: Vendor, accounts: readonly Account[]): string {
  if (vendor === CLAUDE) return KIND_NAMES.anthropic
  if (vendor === OPENAI) return KIND_NAMES.openai
  if (vendor === GEMINI) return KIND_NAMES.gemini
  const named = accounts.find((one) => one.id === vendor)?.name
  if (named) return named
  return t(KIND_NAMES.compatible)
}

export function accountName(account: Account): string {
  return account.name || t(ROADS[account.kind])
}
