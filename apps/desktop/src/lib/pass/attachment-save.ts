import type { Attachment } from '@orden/pass/types'
import { deliver } from '../export/save'
import { t } from '../i18n.svelte'

function nameParts(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { stem: name || 'file', extension: 'bin' }
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1) }
}

export async function savedAttachment(
  attachment: Attachment,
  bytes: Uint8Array,
): Promise<string | null> {
  const { stem, extension } = nameParts(attachment.name)
  return await deliver(stem, extension, t('File'), { bytes, mime: attachment.type })
}
