/** What a tab's hover card says of what it uses, in developer mode (issue 1063, step 10;
 *  docs/apps.md): for an application, the computer it runs on, what it uses there and
 *  its stream; for a terminal on this computer, what its shell and everything under it
 *  use. Asked once a second while the card is up, and never otherwise. A number a
 *  platform does not have is left out, never shown as 0; a tab with none says nothing.
 *
 *  Not yet: online terminals (the machine does not say), agents and web tabs, whose
 *  processes are the engine's and its owners' to ask; the plan on the issue has them
 *  last. */

import type { Usage } from '@orden/online/apps'
import type { Tab } from '../workspace.svelte'

/** How often the card's facts are read again. */
export const EVERY = 1000

/** A usage as the card's line: the processor, the memory, and the GPU where known. */
export function usageLine(usage: Usage, size: (bytes: number) => string): string {
  const parts = [`CPU ${Math.round(usage.cpu)}%`, `RAM ${size(usage.memory)}`]
  if (usage.gpu !== undefined) parts.push(`GPU ${Math.round(usage.gpu)}%`)
  return parts.join(' · ')
}

/** An application's stream as the card's line: size, rate, bits, round trip, encoder;
 *  only what is known. */
export function streamLine(stream: {
  width: number | null
  height: number | null
  fps: number | null
  bitrate: number | null
  rtt: number | null
  encoder: string | null
}): string {
  const parts: string[] = []
  if (stream.width !== null && stream.height !== null)
    parts.push(`${stream.width}×${stream.height}`)
  if (stream.fps !== null) parts.push(`${Math.round(stream.fps)} fps`)
  if (stream.bitrate !== null) parts.push(`${(stream.bitrate / 1e6).toFixed(1)} Mb/s`)
  if (stream.rtt !== null) parts.push(`${Math.round(stream.rtt)} ms`)
  if (stream.encoder) parts.push(stream.encoder)
  return parts.join(' · ')
}

/** Reads a tab's facts once a second, handing each reading to `said`, until what this
 *  answers is called. Nothing for a kind that has none. */
export function watchFacts(tab: Tab, said: (lines: string[]) => void): () => void {
  if (tab.kind !== 'application' && tab.kind !== 'terminal') return () => undefined
  let over = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let release: (() => void) | null = null
  const read = async () => {
    const [{ t }, { readableSize }] = await Promise.all([
      import('../i18n.svelte'),
      import('../usage.svelte'),
    ])
    const lines: string[] = []
    if (tab.kind === 'application') {
      const { appSessionIfAny } = await import('../apps/session.svelte')
      const session = appSessionIfAny(tab)
      if (session) {
        release ??= session.picture.hold()
        if (session.hostName) lines.push(t('Running on {device}', { device: session.hostName }))
        const usage = session.picture.usage
        if (usage) lines.push(usageLine(usage, readableSize))
        const stats = session.picture.stats
        if (stats) {
          const line = streamLine({ ...stats, encoder: session.picture.encoder?.name ?? null })
          if (line) lines.push(line)
        }
      }
    } else {
      const { usageOfTab } = await import('../terminal/sessions.svelte')
      const usage = await usageOfTab(tab)
      if (usage) lines.push(usageLine(usage, readableSize))
    }
    if (over) {
      release?.()
      release = null
      return
    }
    said(lines)
    timer = setTimeout(() => void read(), EVERY)
  }
  void read()
  return () => {
    over = true
    clearTimeout(timer)
    release?.()
    release = null
  }
}
