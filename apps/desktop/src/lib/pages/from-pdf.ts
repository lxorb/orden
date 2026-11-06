import {
  type Canvas,
  type CanvasNode,
  isPage,
  type PageNode,
  readCanvas,
  writeCanvas,
} from '@orden/markdown/canvas'
import { pagesFromPdf, pagesOf } from '@orden/markdown/pages'
import { folderOf, nameOf, placesOf, samePath } from '../space-paths'
import { joinPath } from '../tauri'
import { holderOf, paperOf } from './held'

export interface Turning {
  root: string | null
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string | null>
  write(path: string, text: string): Promise<void>
  move(from: string, to: string): Promise<void>
  discard(path: string): Promise<void>
  sizes(path: string): Promise<{ width: number; height: number }[]>
}

export async function asPageNote(pdf: string, how: Turning): Promise<string> {
  const holder = holderOf(pdf)
  if (holder && (await how.exists(holder))) return holder

  const wanted = holder ?? pdf.replace(/\.pdf$/i, '.pages')
  if (!holder && (await how.exists(wanted)) && (await movedIn(pdf, wanted, how))) return wanted

  const note = holder ?? (await freeNote(wanted, how))
  const paper = holder ? pdf : paperOf(note)
  await how.write(note, writeCanvas(pagesFromPdf(nameOf(paper), await how.sizes(pdf))))
  if (holder) return note

  try {
    await how.move(pdf, paper)
  } catch (error) {
    if ((await how.exists(paper)) && !(await how.exists(pdf))) return note
    await how.discard(note).catch(() => undefined)
    throw error
  }
  return note
}

export async function noteHolding(
  pdf: string,
  how: Pick<Turning, 'root' | 'exists' | 'read'>,
): Promise<string | null> {
  const holder = holderOf(pdf)
  if (holder) return (await how.exists(holder)) ? holder : null

  const note = pdf.replace(/\.pdf$/i, '.pages')
  if (!(await how.exists(note)) || (await how.exists(paperOf(note)))) return null
  const text = await how.read(note)
  return text !== null && besideIts(text, note, pdf, how.root) ? note : null
}

export async function asItself(
  pdf: string,
  sizes: (path: string) => Promise<{ width: number; height: number }[]>,
): Promise<string> {
  return writeCanvas(pagesFromPdf(nameOf(pdf), await sizes(pdf)))
}

export async function asDraft(
  pdf: string,
  sizes: (path: string) => Promise<{ width: number; height: number }[]>,
): Promise<string> {
  return writeCanvas(pagesFromPdf(pdf, await sizes(pdf)))
}

export function paperOutside(text: string, inSpace: (path: string) => boolean): string | null {
  let pages
  try {
    pages = pagesOf(readCanvas(text))
  } catch {
    return null
  }
  const file = pages.find((page) => page.file && isAbsolute(page.file))?.file
  return file && !inSpace(file) ? file : null
}

export function paperNamed(canvas: Canvas, from: string, name: string): Canvas {
  const held = (node: CanvasNode): node is PageNode =>
    isPage(node) && !!node.file && samePath(node.file, from)
  if (!canvas.nodes.some(held)) return canvas

  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (held(node) ? { ...node, file: name } : node)),
  }
}

function isAbsolute(path: string): boolean {
  return /^[/\\]/.test(path) || /^[A-Za-z]:/.test(path)
}

export async function adoptBeside(note: string, how: Turning): Promise<boolean> {
  const pdf = note.replace(/\.pages$/i, '.pdf')
  return (await how.exists(pdf)) && (await movedIn(pdf, note, how))
}

async function movedIn(pdf: string, note: string, how: Turning): Promise<boolean> {
  if (await how.exists(paperOf(note))) return false

  const text = await how.read(note)
  if (text === null || !besideIts(text, note, pdf, how.root)) return false

  await how.move(pdf, paperOf(note))
  return true
}

function besideIts(text: string, note: string, pdf: string, root: string | null): boolean {
  let pages
  try {
    pages = pagesOf(readCanvas(text))
  } catch {
    return false
  }

  return (
    pages.length > 0 &&
    pages.every(
      (page) => !!page.file && placesOf(page.file, note, root).some((one) => samePath(one, pdf)),
    )
  )
}

const MOST_TRIED = 1000

async function freeNote(wanted: string, how: Turning): Promise<string> {
  const folder = folderOf(wanted)
  const stem = nameOf(wanted).replace(/\.pages$/i, '')

  for (let counter = 1; counter <= MOST_TRIED; counter += 1) {
    const name = counter === 1 ? `${stem}.pages` : `${stem} ${String(counter)}.pages`
    const path = folder ? joinPath(folder, name) : name
    if (!(await how.exists(path)) && !(await how.exists(paperOf(path)))) return path
  }
  throw new Error(`no name is free for ${wanted}`)
}
