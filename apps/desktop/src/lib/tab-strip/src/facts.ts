import { tabKindLoaded, type TabStream, type TabUsage } from '@orden/contracts'
import type { Tab } from '../../documents/src/api'
import { readableSize } from '../../accounts/src/api'

const EVERY = 1000
export function usageLine(usage: TabUsage, size: (bytes: number) => string): string[] {
  const parts = [`CPU ${Math.round(usage.cpu)}%`, `RAM ${size(usage.memory)}`]
  if (usage.gpu !== undefined) parts.push(`GPU ${Math.round(usage.gpu)}%`)
  return parts
}
export function streamLine(stream: TabStream): string[] {
  const parts: string[] = []
  if (stream.width !== null && stream.height !== null) parts.push(`${stream.width}×${stream.height}`)
  if (stream.fps !== null) parts.push(`${Math.round(stream.fps)} fps`)
  if (stream.bitrate !== null) parts.push(`${(stream.bitrate / 1e6).toFixed(1)} Mb/s`)
  if (stream.rtt !== null) parts.push(`${Math.round(stream.rtt)} ms`)
  if (stream.encoder) parts.push(stream.encoder)
  return parts
}
export function watchFacts(tab: Tab, said: (lines: string[][]) => void): () => void {
  let over = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let release: (() => void) | null = null
  const read = async () => {
    const kind = await tabKindLoaded(tab.kind)
    if (!kind.facts) return
    release ??= kind.hold?.(tab.id) ?? null
    const facts = await kind.facts(tab.id)
    const lines: string[][] = []
    if (facts?.host) lines.push([`Running on ${facts.host}`])
    if (facts?.usage) lines.push(usageLine(facts.usage, readableSize))
    const stream = facts?.stream ? streamLine(facts.stream) : []
    if (stream.length) lines.push(stream)
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
