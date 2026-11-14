import { barsOf } from './media'

export interface Prepared {
  blob: Blob
  name: string
  type: string
  width?: number
  height?: number
  preview?: Blob
  seconds?: number
  wave?: number[]
}

const PREVIEW_SIDE = 480

const AS_THEY_ARE = new Set(['image/gif', 'image/svg+xml'])

export async function prepared(file: File): Promise<Prepared> {
  const plain: Prepared = {
    blob: file,
    name: file.name,
    type: file.type || 'application/octet-stream',
  }
  try {
    if (file.type.startsWith('image/') && !AS_THEY_ARE.has(file.type)) return await picture(file)
    if (file.type.startsWith('video/')) return { ...plain, ...(await videoFrame(file)) }
    if (file.type.startsWith('audio/'))
      return { ...plain, ...(await sound(await file.arrayBuffer())) }
  } catch {
    // A file this browser cannot read is still a file: it goes as it is, as a card.
  }
  return plain
}

async function picture(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const blob = await encoded(bitmap, bitmap.width, bitmap.height, 0.92)
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height))
    const preview = await encoded(
      bitmap,
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
      0.8,
    )
    return {
      blob,
      name: file.name.replace(/\.[^.]+$/, '') + '.webp',
      type: 'image/webp',
      width: bitmap.width,
      height: bitmap.height,
      preview,
    }
  } finally {
    bitmap.close()
  }
}

async function encoded(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the picture would not encode'))),
      'image/webp',
      quality,
    ),
  )
}

async function videoFrame(file: File): Promise<Partial<Prepared>> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('the video would not load'))
    })
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(video.videoWidth, video.videoHeight))
    const preview = await encoded(
      video,
      Math.round(video.videoWidth * scale),
      Math.round(video.videoHeight * scale),
      0.8,
    )
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      preview,
      ...(Number.isFinite(video.duration) ? { seconds: video.duration } : {}),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function sound(bytes: ArrayBuffer): Promise<Partial<Prepared>> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0))
    return { seconds: decoded.duration, wave: barsOf(decoded.getChannelData(0)) }
  } finally {
    void context.close()
  }
}
