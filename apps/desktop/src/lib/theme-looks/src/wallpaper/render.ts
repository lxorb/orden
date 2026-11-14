import { hexOf, type Rgb, rgbOf, type Span } from '../../../ui-controls/src/api'
import type { Held } from './held'
import { blurred, fitted, measured, sideFor, toned, type Toning } from './pixels'

const COPY = 3200

export interface Drawable {
  image: CanvasImageSource
  width: number
  height: number
}

export async function decode(picture: Blob): Promise<Drawable> {
  try {
    const bitmap = await createImageBitmap(picture)
    return { image: bitmap, width: bitmap.width, height: bitmap.height }
  } catch {
    const address = URL.createObjectURL(picture)
    try {
      const image = new Image()
      image.src = address
      await image.decode()
      return { image, width: image.naturalWidth, height: image.naturalHeight }
    } finally {
      URL.revokeObjectURL(address)
    }
  }
}

function drawn(source: Drawable, width: number, height: number, blur = 0) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('this window cannot draw a picture')

  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (blur > 0) {
    const margin = Math.ceil(blur * 3)
    context.filter = `blur(${blur.toFixed(2)}px)`
    context.drawImage(source.image, -margin, -margin, width + margin * 2, height + margin * 2)
    context.filter = 'none'
  } else {
    context.drawImage(source.image, 0, 0, width, height)
  }
  return { canvas, context }
}

export async function copyOf(source: Drawable): Promise<Blob> {
  const [width, height] = fitted(source.width, source.height, COPY)
  const { canvas } = drawn(source, width, height)
  return blobOf(canvas, 'image/jpeg', 0.9)
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the picture could not be copied'))),
      type,
      quality,
    )
  })
}

export interface Tone {
  saturation: number
  tint: number
  colour: string
}

function toningOf(tone: Tone): Toning {
  return {
    saturation: tone.saturation,
    tint: tone.tint,
    colour: rgbOf(tone.colour) ?? ([0, 0, 0] as Rgb),
  }
}

export function toneKey(tone: Tone): string {
  const colour = tone.tint > 0 ? tone.colour : ''
  return `${tone.saturation.toFixed(2)} ${tone.tint.toFixed(2)} ${colour}`
}

function heldColours(pixels: Uint8ClampedArray): { span: Span; mean: string } {
  const { least, most, mean } = measured(pixels)
  return { span: { least, most }, mean: hexOf(mean) }
}

export function made(
  source: Drawable,
  blur: number,
  tone: Tone,
  screen: number,
  focus: [number, number],
  size: [number, number],
): Held {
  const side = sideFor(blur, screen)
  const [width, height] = fitted(source.width, source.height, side)
  const { canvas, context } = drawn(source, width, height)

  const sigma = (blur * Math.max(width, height)) / Math.max(1, screen)
  const pixels = blurred(context.getImageData(0, 0, width, height).data, width, height, sigma)
  toned(pixels, toningOf(tone))
  context.putImageData(new ImageData(pixels, width, height), 0, 0)

  return {
    picture: canvas.toDataURL('image/png'),
    blur,
    tone: toneKey(tone),
    ...heldColours(pixels),
    size,
    focus,
  }
}

export async function sharp(
  source: Drawable,
  blur: number,
  tone: Tone,
  screen: number,
  longest: number,
): Promise<{ picture: Blob; span: Span; mean: string }> {
  const [width, height] = fitted(source.width, source.height, longest)
  const sigma = (blur * Math.max(width, height)) / Math.max(1, screen)
  const { canvas, context } = drawn(source, width, height, sigma)
  const image = context.getImageData(0, 0, width, height)
  toned(image.data, toningOf(tone))
  context.putImageData(image, 0, 0)

  return { picture: await blobOf(canvas, 'image/jpeg', 0.92), ...heldColours(image.data) }
}
