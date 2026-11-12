import type { ProviderKind } from '../providers'

const FAST: readonly ProviderKind[] = ['anthropic', 'openai', 'codex']

export function availability(
  name: string,
  kind: ProviderKind,
  ready: { review: boolean },
): true | string {
  if (name === 'fast' && !FAST.includes(kind)) return 'No faster tier here'
  if ((name === 'rewind' || name === 'diff') && !ready.review) return 'Not here yet'
  return true
}
