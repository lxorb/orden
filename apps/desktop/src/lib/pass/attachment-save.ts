import type { Attachment } from '@orden/pass/types'
import { deliver } from '../export/save'

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
  return await deliver(stem, extension, 'File', { bytes, mime: attachment.type })
}
