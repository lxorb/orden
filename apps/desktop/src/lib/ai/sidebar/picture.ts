import type { Drawing } from '../../feedback-pictures'
import { pictureOf } from '../../pictures-away'

export const MOST_CHAT_PICTURES = 20

export interface ChatPicture {
  mime: string
  data: string
}

export async function chatPicture(file: Blob, drawing?: Drawing): Promise<ChatPicture | null> {
  const picture = await pictureOf(file, drawing).catch(() => null)
  if (!picture) return null
  const comma = picture.dataUrl.indexOf(',')
  const mime = picture.dataUrl.slice('data:'.length, picture.dataUrl.indexOf(';'))
  return { mime, data: picture.dataUrl.slice(comma + 1) }
}
