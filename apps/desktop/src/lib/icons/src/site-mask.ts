import { isKeptMask, MASKED } from '../../ui-kit/src/api'
import { silhouette } from './silhouette'
import { sitePicture } from './site-set'

export { silhouette }

type Masker = (src: string, size: number) => Promise<string | null>
const SIZES = [48, 32, 24]
async function masked(src: string, size: number): Promise<string | null> {
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
  const pen = canvas.getContext('2d', { willReadFrequently: true })
  if (!pen) return null
  const wide = image.naturalWidth || size
  const tall = image.naturalHeight || size
  const scale = Math.min(size / wide, size / tall)
  pen.imageSmoothingQuality = 'high'
  pen.drawImage(image, (size - wide * scale) / 2, (size - tall * scale) / 2, wide * scale, tall * scale)
  try {
    const seen = pen.getImageData(0, 0, size, size)
    const shape = silhouette(seen.data, size)
    const ink = pen.createImageData(size, size)
    for (let at = 0; at < shape.length; at++) ink.data[at * 4 + 3] = shape[at] ?? 0
    pen.putImageData(ink, 0, 0)
    return `${MASKED}${canvas.toDataURL('image/png')}`
  } catch {
    return null
  }
}
export async function keptMask(src: string, mask: Masker = masked): Promise<string | null> {
  for (const size of SIZES) {
    const made = await mask(src, size).catch(() => null)
    if (made !== null && isKeptMask(made)) return made
  }
  return null
}
export async function keptSiteMask(site: string, mask: Masker = masked): Promise<string | null> {
  const src = await sitePicture(site).catch(() => null)
  return src === null ? null : keptMask(src, mask)
}
