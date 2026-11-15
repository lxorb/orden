import { registerSidebarPart } from '@orden/contracts'

export async function registerSidebarParts(): Promise<void> {
  const [{ askPart }, { outlinePart }, { scratchpadPart }] = await Promise.all([
    import('../src/lib/ai-chat/src/api'),
    import('../src/lib/pages/src/api'),
    import('../src/lib/scratchpad/src/api'),
  ])
  for (const part of [askPart, outlinePart, scratchpadPart]) registerSidebarPart(part)
}
