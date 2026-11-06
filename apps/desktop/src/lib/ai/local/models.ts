import type { Effort, ModelInfo } from '../chat/types'
import type { LocalKind } from '../providers'

const SCALE: readonly Effort[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function levelOf(word: unknown): Effort | null {
  if (word === 'none') return 'off'
  return SCALE.find((one) => one === word) ?? null
}

function effortsOf(words: readonly unknown[]): Effort[] {
  const listed = new Set(words.map(levelOf).filter((one): one is Effort => one !== null))
  return ['auto', ...SCALE.filter((one) => listed.has(one))]
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function claudeWindow(...names: unknown[]): number | null {
  return names.some((name) => typeof name === 'string' && name.endsWith('[1m]')) ? 1_000_000 : null
}

export function modelsIn(kind: LocalKind, listed: unknown): ModelInfo[] {
  if (kind === 'claude-code') {
    return list(record(listed).models)
      .map(record)
      .filter((one) => typeof one.value === 'string' && one.value)
      .map((one) => ({
        id: String(one.value),
        name:
          typeof one.displayName === 'string' && one.displayName
            ? one.displayName
            : String(one.value),
        window: claudeWindow(one.value, one.resolvedModel),
        efforts: effortsOf(list(one.supportedEffortLevels)),
        images: true,
        fast: false,
      }))
  }
  return list(record(listed).data)
    .map(record)
    .filter((one) => one.hidden !== true && typeof (one.model ?? one.id) === 'string')
    .map((one) => {
      const id = String(one.model ?? one.id)
      return {
        id,
        name: typeof one.displayName === 'string' && one.displayName ? one.displayName : id,
        window: null,
        efforts: effortsOf(
          list(one.supportedReasoningEfforts).map((row) => record(row).reasoningEffort),
        ),
        images: list(one.inputModalities).includes('image'),
        fast: list(one.serviceTiers).some((tier) => record(tier).id === 'priority'),
      }
    })
}
