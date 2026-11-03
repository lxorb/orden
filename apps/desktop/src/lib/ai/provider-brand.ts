/** Whose model a chat talks to, as a brand's logo (#1089): the mark on the left of its
 *  row, out of the shared brand set (#1082, `brandIcon` in icons.ts).
 *
 *  The model first, because it says whose it is even through somebody else's door - a
 *  Claude model on OpenRouter is Claude's, a Llama on a server of the reader's own is
 *  Meta's - and the provider's kind where the model's name says nothing: Claude Code is
 *  Claude's, Codex and Sign in with ChatGPT are OpenAI's. Null for a model and a provider
 *  that name no one, which wears no logo rather than a wrong one. */

import type { ProviderKind } from './providers'

/** A model's name to the brand it is, by the words its maker puts in it. */
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

/** A provider's kind to its brand, where the model's name did not say. */
const KINDS: Partial<Record<ProviderKind, string>> = {
  anthropic: 'claude',
  'claude-code': 'claude',
  openai: 'openai',
  chatgpt: 'openai',
  codex: 'openai',
}

/** The Simple Icons slug for a chat's model, or null for none. */
export function providerBrand(kind: ProviderKind | null | undefined, model: string): string | null {
  const name = model.split('/').at(-1) ?? model
  for (const [words, brand] of MAKERS) if (words.test(name)) return brand
  return kind ? (KINDS[kind] ?? null) : null
}
