import { codeBlocks } from '@orden/markdown'
import {
  DIAGRAM_SCHEMES,
  type DiagramScheme,
  diagramKey,
  isDiagram,
} from '@orden/markdown/diagrams'
import { api } from './api'
import { drawDiagram } from './diagrams'
import { keepJson, stored } from './stored'
import { shapesOnly } from './svg-file'
import { invoke } from './tauri'
import type { Entry } from './workspace.svelte'

const MOST = 100

const BIGGEST = 512 * 1024

export interface DiagramFence {
  language: string
  code: string
}

export function diagramFences(sources: Iterable<string>): DiagramFence[] {
  const found = new Map<string, DiagramFence>()

  for (const source of sources) {
    for (const block of codeBlocks(source)) {
      if (!isDiagram(block.language)) continue

      const language = block.language.toLowerCase()
      found.set(`${language}\n${block.code}`, { language, code: block.code })
    }
  }

  return [...found.values()]
}

export function asFile(svg: string): string | null {
  const opens = svg.indexOf('<svg')
  if (opens === -1) return null

  let out = shapesOnly(svg.slice(opens))
  if (!out.startsWith('<svg')) return null

  const box = /\bviewBox="([\d.\-+eE]+)\s+([\d.\-+eE]+)\s+([\d.\-+eE]+)\s+([\d.\-+eE]+)"/.exec(out)
  const width = Number(box?.[3])
  const height = Number(box?.[4])
  if (!box || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const root = out.slice(0, out.indexOf('>') + 1)
  const sized = root
    .replace(/\swidth="[^"]*"/i, '')
    .replace(/\sheight="[^"]*"/i, '')
    .replace(/\sstyle="[^"]*"/i, '')
    .replace(/>$/, ` width="${Math.round(width)}" height="${Math.round(height)}">`)

  out = sized + out.slice(root.length)
  if (!out.includes('xmlns=')) {
    out = out.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  return out.length > BIGGEST ? null : `<?xml version="1.0" encoding="UTF-8"?>\n${out}`
}

const drawer = (code: string, language: string, scheme: DiagramScheme) =>
  drawDiagram(code, language, scheme, 'page')

export async function drawnBoth(
  spaceId: string,
  fence: DiagramFence,
  draw = drawer,
): Promise<{ hash: string; svg: string; said: string }[]> {
  const out: { hash: string; svg: string; said: string }[] = []

  for (const scheme of DIAGRAM_SCHEMES) {
    const drawn = await draw(fence.code, fence.language, scheme).catch(() => null)
    const svg = drawn === null ? null : asFile(drawn)
    if (svg === null) return []

    const { language, code } = fence
    const said = new URLSearchParams({ space: spaceId, language, scheme, code }).toString()
    out.push({ hash: await diagramKey(spaceId, fence.language, fence.code, scheme), svg, said })
  }

  return out
}

const remembered = (spaceId: string) => `nib:diagrams:${spaceId}`

function alreadySent(spaceId: string): Set<string> {
  const held = stored(remembered(spaceId))

  return new Set(
    Array.isArray(held) ? held.filter((one): one is string => typeof one === 'string') : [],
  )
}

async function notesIn(root: string): Promise<string[]> {
  const tree = await invoke<Entry>('read_tree', { root }).catch(() => null)
  if (!tree) return []

  const paths: string[] = []
  const walk = (entry: Entry) => {
    if (entry.is_dir) for (const child of entry.children) walk(child)
    else if (/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) paths.push(entry.path)
  }
  walk(tree)

  const sources: string[] = []
  for (const path of paths) {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text !== null && (text.includes('```') || text.includes('~~~'))) sources.push(text)
  }

  return sources
}

export async function pushDiagrams(
  token: string,
  spaceId: string,
  root: string,
): Promise<{ sent: number; refused: number }> {
  const fences = diagramFences(await notesIn(root))
  if (!fences.length) return { sent: 0, refused: 0 }

  const sent = alreadySent(spaceId)
  let put = 0
  let refused = 0

  for (const fence of fences.slice(0, MOST)) {
    const names = await Promise.all(
      DIAGRAM_SCHEMES.map((scheme) => diagramKey(spaceId, fence.language, fence.code, scheme)),
    )
    if (names.every((hash) => sent.has(hash))) continue

    const drawn = await drawnBoth(spaceId, fence)
    if (!drawn.length) {
      refused += 1
      continue
    }

    for (const { hash, svg, said } of drawn) {
      const bytes = new TextEncoder().encode(svg)
      const ok = await api
        .putBlob(token, hash, 'image/svg+xml', bytes.buffer, { 'x-nib-diagram': said })
        .then(() => true)
        .catch(() => false)

      if (ok) {
        sent.add(hash)
        put += 1
      } else {
        refused += 1
      }
    }
  }

  keepJson(remembered(spaceId), [...sent].slice(-MOST * 4))
  return { sent: put, refused }
}
