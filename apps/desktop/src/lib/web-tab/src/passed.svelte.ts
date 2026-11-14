import type { Modifier } from '../../double-tap'
import { fullscreen } from '../../fullscreen.svelte'
import { isRecord } from '../../platform/src/api'
import { heard } from '../../tapped'
import type { Page } from './pages.svelte'
import { sought } from './seek'

const TAPS: Record<string, Modifier> = {
  'shift-shift': 'Shift',
  'ctrl-ctrl': 'Control',
  'alt-alt': 'Alt',
}

const PASSED = [
  'find',
  'next',
  'previous',
  'address',
  'shift-shift',
  'ctrl-ctrl',
  'alt-alt',
  'install',
  'escape',
] as const

export type Passed = (typeof PASSED)[number]

export interface Ask {
  tab: string
  key: Passed
}

export function readAsk(value: unknown): Ask | null {
  if (!isRecord(value) || typeof value.tab !== 'string') return null

  const key = PASSED.find((one) => one === value.key)
  return key ? { tab: value.tab, key } : null
}

export const addressing = $state<{ asked: { page: Page } | null }>({ asked: null })

export function answer(tab: string, page: Page, key: Passed): void {
  const tapped = TAPS[key]
  if (tapped) heard(tapped)
  else if (key === 'address') addressing.asked = { page }
  else if (key === 'escape') void fullscreen.leave()
  else if (key === 'find' || key === 'next' || key === 'previous') sought(tab, page, key)
  else if (key === 'install' && page.url)
    void import('./extensions.svelte').then(({ extensions }) => extensions.install(page.url ?? ''))
}
