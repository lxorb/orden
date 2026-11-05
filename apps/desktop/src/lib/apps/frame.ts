/** One frame of an application's picture, as a PNG (issue 1063, step 7): what an agent
 *  sees of it, in the display's own pixels - the same pixels its pointer and clicks
 *  are said in.
 *
 *  Read off the stream the tab already receives, through a video element of its own
 *  that is never on the page, so the tab's picture goes on as it was. */

/** A frame: the PNG's bytes as base64, and its size in the display's pixels. */
export interface Frame {
  png: string
  width: number
  height: number
}

/** How long the stream is given to show its first frame. */
const WITHIN = 3000

/** The frame the stream shows now, or null where it has none to show in time. */
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
    const url = canvas.toDataURL('image/png')
    const comma = url.indexOf(',')
    return comma < 0 ? null : { png: url.slice(comma + 1), width, height }
  } finally {
    video.pause()
    video.srcObject = null
  }
}
