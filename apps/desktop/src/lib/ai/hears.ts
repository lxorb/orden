import { account } from '../account.svelte'
import type { Provider } from './providers'

let asking: (() => Provider | null) | null = null

export function transcribersAre(answer: () => Provider | null): void {
  asking = answer
}

export function transcriberNow(): Provider | null {
  return asking?.() ?? null
}

export function canTranscribe(): boolean {
  return !!transcriberNow() || !!account.accountToken
}
