import { type Drawing, pictureOf } from '../../feedback-pictures'

export interface ChatPicture {
  mime: string
  data: string
}

export async function chatPicture(file: Blob, drawing?: Drawing): Promise<ChatPicture | null> {
  const picture = await (drawing ? pictureOf(file, drawing) : pictureOf(file)).catch(() => null)
  if (!picture) return null
  const comma = picture.dataUrl.indexOf(',')
  const mime = picture.dataUrl.slice('data:'.length, picture.dataUrl.indexOf(';'))
  return { mime, data: picture.dataUrl.slice(comma + 1) }
}
