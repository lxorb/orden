import type { Carried } from './api'
import { modes } from '../../modes/src/api'
import { shortcutPresets, shortcuts } from '../../shortcuts/src/api'

export async function carryOver(carried: Carried) {
  if (carried.keys) {
    const { presetById } = await shortcutPresets()
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
