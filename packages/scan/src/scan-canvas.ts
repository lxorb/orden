import { readCanvas } from '@orden/markdown/canvas'
import { skim } from './json-skim'
import type { ScannedNote } from './scan-note'

const NIB_LAST = { last: 'nib' }
const ICON_FIRST = { ahead: ['version', 'icon', 'iconColor'] }

function indexed(content: string): string {
  const top = skim(content, ['nodes', 'nib'], undefined, NIB_LAST)
  if (!top) return ''

  const nodes = top.get('nodes')
  const nib = top.get('nib')
  const marks = nib ? skim(content, ['icon', 'iconColor'], nib, ICON_FIRST) : null
  const worn = [...(marks ?? [])].map(([key, at]) => `"${key}":${content.slice(at.from, at.to)}`)

  return `{"nodes":${nodes ? content.slice(nodes.from, nodes.to) : '[]'},"nib":{${worn.join(',')}}}`
}

export type PlaneMarks = Pick<ScannedNote, 'icon' | 'iconColor' | 'links'>

export function planeMarks(content: string): PlaneMarks {
  const canvas = readCanvas(indexed(content))

  return {
    icon: canvas.icon ?? null,
    iconColor: canvas.iconColor ?? null,
    links: canvas.nodes
      .filter((node): node is Extract<typeof node, { type: 'file' }> => node.type === 'file')
      .map((node) => ({
        kind: 'wikilink' as const,
        target: node.file,
        heading: node.subpath?.startsWith('#^') === false ? node.subpath.slice(1) : null,
        block: node.subpath?.startsWith('#^') === true ? node.subpath.slice(2) : null,
        alias: null,
        embed: false,
        line: 0,
        text: node.file,
      })),
  }
}

export function scanCanvas(path: string, content: string): ScannedNote {
  return markedPlane(path, planeMarks(content))
}

export function markedPlane(path: string, marks: PlaneMarks): ScannedNote {
  return {
    path,
    name: path.split('/').pop() ?? path,
    headings: [],
    blocks: [],
    tags: [],
    icon: marks.icon,
    iconColor: marks.iconColor,
    aliases: [],
    url: null,
    favicon: null,
    address: null,
    cover: null,
    bare: false,
    links: marks.links,
  }
}
