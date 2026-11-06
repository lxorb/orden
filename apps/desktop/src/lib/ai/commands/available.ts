import { t } from '../../i18n.svelte'
import type { ProviderKind } from '../providers'

const FAST: readonly ProviderKind[] = ['anthropic', 'openai', 'codex']

export function availability(
  name: string,
  kind: ProviderKind,
  ready: { review: boolean },
): true | string {
  if (name === 'fast' && !FAST.includes(kind)) return t('No faster tier here')
  if ((name === 'rewind' || name === 'diff') && !ready.review) return t('Not here yet')
  return true
}
