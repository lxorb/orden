import { escapeAll } from '@orden/markdown/html'
import { toXhtml } from './epub'

export interface ImageOptions {
  mime: string
  scale?: number
  background: string
  pageHeight?: number | null
  quality?: number
  width?: number
}

const DEFAULT_WIDTH = 800
const DEFAULT_SCALE = 2

const XHTML = 'http://www.w3.org/1999/xhtml'

export interface Page {
  top: number
  height: number
}

export function pagesOf(totalHeight: number, pageHeight: number | null | undefined): Page[] {
  const total = Math.max(0, totalHeight)

  if (pageHeight === null || pageHeight === undefined || pageHeight <= 0 || total <= pageHeight) {
    return [{ top: 0, height: total }]
  }

  return Array.from({ length: Math.ceil(total / pageHeight) }, (_unused, index) => {
    const top = index * pageHeight
    return { top, height: Math.min(pageHeight, total - top) }
  })
}

function namespaced(xhtml: string): string {
  if (/<html\b[^>]*\sxmlns=/.test(xhtml)) return xhtml
  if (/<html\b/.test(xhtml)) return xhtml.replace(/<html\b/, `<html xmlns="${XHTML}"`)

  return `<div xmlns="${XHTML}">${xhtml}</div>`
}

function schemeOf(html: string): string {
  const scheme = /<html\b[^>]*\sdata-theme="([^"]*)"/.exec(html)?.[1]
  return scheme ? ` data-theme="${escapeAll(scheme)}"` : ''
}

export function svgOf(html: string, size: { width: number; height: number }, background: string) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg"${schemeOf(html)} width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
    `<rect width="100%" height="100%" fill="${escapeAll(background)}" />`,
    '<foreignObject width="100%" height="100%">',
    namespaced(toXhtml(html)),
    '</foreignObject>',
    '</svg>',
  ].join('')
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function decoded(picture: HTMLImageElement): Promise<void> {
  await picture.decode().catch(() => undefined)
}

async function measuredHeight(html: string, width: number): Promise<number> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:100px;border:0;visibility:hidden;`

  try {
    await new Promise<void>((resolve) => {
      frame.addEventListener(
        'load',
        () => {
          resolve()
        },
        { once: true },
      )
      frame.srcdoc = html
      document.body.append(frame)
    })

    const inside = frame.contentDocument
    if (!inside) throw new Error('The note could not be laid out, so it cannot be pictured.')

    await inside.fonts.ready.catch(() => undefined)
    await Promise.all([...inside.images].map(decoded))

    return Math.max(inside.documentElement.scrollHeight, inside.body.scrollHeight, 1)
  } finally {
    frame.remove()
  }
}

function loadedPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const picture = new Image()
    picture.addEventListener('load', () => {
      resolve(picture)
    })
    picture.addEventListener('error', () => {
      reject(new Error('The note could not be drawn, because its markup did not parse as XML.'))
    })
    picture.src = url
  })
}

interface Paper {
  width: number
  scale: number
  background: string
  mime: string
  quality: number | undefined
}

async function bytesOf(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number | undefined,
): Promise<Uint8Array> {
  let picture: Blob | null

  try {
    picture = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (made) => {
          resolve(made)
        },
        mime,
        quality,
      )
    })
  } catch (error) {
    throw new Error(
      'The note could not be saved as a picture, because something in it was loaded from outside the document.',
      { cause: error },
    )
  }

  if (!picture) throw new Error(`This browser cannot write a picture as ${mime}.`)

  return new Uint8Array(await picture.arrayBuffer())
}

async function pageBytes(drawing: HTMLImageElement, page: Page, paper: Paper): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(paper.width * paper.scale))
  canvas.height = Math.max(1, Math.round(page.height * paper.scale))

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser gave the export no canvas to draw the note on.')

  context.fillStyle = paper.background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.scale(paper.scale, paper.scale)
  context.drawImage(drawing, 0, -page.top)

  return bytesOf(canvas, paper.mime, paper.quality)
}

export async function toImages(html: string, options: ImageOptions): Promise<Uint8Array[]> {
  const width = options.width ?? DEFAULT_WIDTH
  const height = await measuredHeight(html, width)
  const drawing = await loadedPicture(svgUrl(svgOf(html, { width, height }, options.background)))

  const paper: Paper = {
    width,
    scale: options.scale ?? DEFAULT_SCALE,
    background: options.background,
    mime: options.mime,
    quality: options.quality,
  }

  const pages: Uint8Array[] = []
  for (const page of pagesOf(height, options.pageHeight)) {
    pages.push(await pageBytes(drawing, page, paper))
  }

  return pages
}
