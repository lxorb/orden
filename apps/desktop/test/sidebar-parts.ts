import type { Component } from 'svelte'
import { registerSidebarPart, registerSurfaces } from '@orden/contracts'

const NOTHING = (() => undefined) as unknown as Component

export async function registerSidebarParts(): Promise<void> {
  const [{ askPart }, { outlinePart }, { scratchpadPart }] = await Promise.all([
    import('../src/lib/ai-chat/src/api'),
    import('../src/lib/pages/src/api'),
    import('../src/lib/scratchpad/src/api'),
  ])
  for (const part of [askPart, outlinePart, scratchpadPart]) registerSidebarPart(part)
  registerSurfaces({ ask: () => Promise.resolve({ default: NOTHING }) })
}
