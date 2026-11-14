import type { Carried } from './import/src/api'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'

export async function carryOver(carried: Carried) {
  if (carried.keys) {
    const { presetById } = await import('./shortcuts/presets')
    const preset = presetById(carried.keys)
    if (preset && shortcuts.preset !== 'custom') shortcuts.choose(preset)
  }

  if (carried.vim !== undefined) modes.setVimKeys(carried.vim)
  if (carried.linkFormat) modes.setLinkFormat(carried.linkFormat)
  if (carried.attachments) modes.setAttachments(carried.attachments)
  if (carried.hardBreaks !== undefined && carried.hardBreaks !== modes.hardBreaks) {
    modes.toggleHardBreaks()
  }
  if (carried.quietMarks !== undefined && carried.quietMarks !== modes.quietMarks) {
    modes.toggleQuietMarks()
  }
}
