import { pngData } from '../png-off'

export interface Frame {
  png: string
  width: number
  height: number
}

const WITHIN = 3000

export async function frameOf(stream: MediaStream): Promise<Frame | null> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  try {
    const ready = new Promise<boolean>((settle) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) settle(true)
      video.addEventListener('loadeddata', () => settle(true), { once: true })
      setTimeout(() => settle(false), WITHIN)
    })
    await video.play().catch(() => undefined)
    if (!(await ready)) return null
    const width = video.videoWidth
    const height = video.videoHeight
    if (width <= 0 || height <= 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const drawing = canvas.getContext('2d')
    if (!drawing) return null
    drawing.drawImage(video, 0, 0, width, height)
    const url = await pngData(canvas)
    const comma = url?.indexOf(',') ?? -1
    return !url || comma < 0 ? null : { png: url.slice(comma + 1), width, height }
  } finally {
    video.pause()
    video.srcObject = null
  }
}
