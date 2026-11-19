import { isKeptPicture } from '../../ui-kit/src/api'
import { sitePicture } from './site-set'

type Painter = (src: string, size: number) => Promise<string | null>
const SIZES = [32, 24, 16]
async function drawn(src: string, size: number): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image !== 'function') return null
  const image = new Image()
  image.src = src
  try {
    await image.decode()
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const pen = canvas.getContext('2d')
  if (!pen) return null
  const wide = image.naturalWidth || size
  const tall = image.naturalHeight || size
  const scale = Math.min(size / wide, size / tall)
  const width = wide * scale
  const height = tall * scale
  pen.imageSmoothingQuality = 'high'
  pen.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
export async function keptPicture(src: string, paint: Painter = drawn): Promise<string | null> {
  for (const size of SIZES) {
    const made = await paint(src, size).catch(() => null)
    if (made !== null && isKeptPicture(made)) return made
  }
  return null
}
export async function keptSitePicture(site: string, paint: Painter = drawn): Promise<string | null> {
  const src = await sitePicture(site).catch(() => null)
  return src === null ? null : keptPicture(src, paint)
}
