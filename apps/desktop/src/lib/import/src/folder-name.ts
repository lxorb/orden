import type { PickedFile } from '@orden/contracts'
import { isDesktop, platform } from '../../platform/src/api'
import { safeName } from './names'
import type { FormatId } from './plan'
import { pickedFolder } from './sources'

const MACHINE_MADE =
  /^(applejournalentries|export|takeout|backup|notion|graph|roam|logseq|keep|archive)(?:[\s_-]+|$)/i

export function folderNameFor(picked: readonly PickedFile[], format: FormatId): string {
  if (format === 'todoist') return ''
  const first = picked[0]
  const named = pickedFolder(picked) ?? (picked.length === 1 && first ? stemOf(first) : '')
  const stripped = (format === 'obsidian' ? named : named.replace(MACHINE_MADE, '')).trim()

  const wordy = /\p{L}{2,}/u.test(stripped) && !/^[0-9a-f-]+$/i.test(stripped)

  return wordy ? safeName(stripped) : nameOfFormat(format)
}

export function nameOfFormat(format: FormatId): string {
  switch (format) {
    case 'notion':
      return 'Notion'
    case 'evernote':
      return 'Evernote'
    case 'keep':
      return 'Google Keep'
    case 'bear':
      return 'Bear'
    case 'logseq':
      return 'Logseq'
    case 'roam':
      return 'Roam'
    case 'craft':
      return 'Craft'
    case 'obsidian':
      return 'Obsidian'
    case 'onenote':
      return 'OneNote'
    case 'tomboy':
      return 'Tomboy'
    case 'apple-notes':
      return 'Apple Notes'
    case 'journal':
      return 'Journal'
    case 'pdf-pages':
      return 'Papers'
    case 'todoist':
      return ''
    case 'table':
    case 'markdown':
    case 'pandoc':
      return 'Imported'
  }
}

function stemOf(picked: PickedFile): string {
  return picked.name.replace(/\.[^.]+$/, '')
}

export function onMac(): boolean {
  return isDesktop && platform() === 'macos'
}
