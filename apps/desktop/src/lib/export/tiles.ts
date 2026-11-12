import BookOpen from 'lucide/dist/esm/icons/book-open.mjs'
import Copy from 'lucide/dist/esm/icons/copy.mjs'
import FileCode from 'lucide/dist/esm/icons/file-code.mjs'
import FileImage from 'lucide/dist/esm/icons/file-image.mjs'
import FilePen from 'lucide/dist/esm/icons/file-pen.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import FileType from 'lucide/dist/esm/icons/file-type.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Hash from 'lucide/dist/esm/icons/hash.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import Package from 'lucide/dist/esm/icons/package.mjs'
import Type from 'lucide/dist/esm/icons/type.mjs'
import type { IconNode } from 'lucide'
import type { MenuItem } from '../menu-item'
import { PANDOC_FORMATS } from '../export-formats'
import { EXPORT_FORMATS } from './formats'

export const SETUP = 'page-setup'

type Shelf = 'documents' | 'text' | 'web' | 'pictures' | 'other'

const SHELVES: readonly { id: Shelf; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'text', label: 'Text' },
  { id: 'web', label: 'Web' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'other', label: 'Other' },
]

interface Kind {
  shelf: Shelf
  icon: IconNode
  name?: string
  option?: { id: string; label: string }
}

const KINDS: Record<string, Kind> = {
  pdf: { shelf: 'documents', icon: FileText },
  docx: { shelf: 'documents', icon: FileType },
  rtf: { shelf: 'documents', icon: FilePen },
  epub: { shelf: 'documents', icon: BookOpen },
  md: {
    shelf: 'text',
    icon: Hash,
    option: { id: 'md-assets', label: 'Include pictures' },
  },
  txt: { shelf: 'text', icon: Type },
  textbundle: { shelf: 'text', icon: Package },
  html: {
    shelf: 'web',
    icon: Globe,
    option: { id: 'html-bare', label: 'Without styles' },
  },
  png: { shelf: 'pictures', icon: Image },
  jpg: { shelf: 'pictures', icon: Image },
  svg: { shelf: 'pictures', icon: FileImage, name: 'SVG' },
  copy: { shelf: 'other', icon: Copy, name: 'Save a copy' },
}

const ORDER = Object.keys(KINDS)

const FOLDED = new Set(
  Object.values(KINDS).flatMap((one) => (one.option ? [`export-${one.option.id}`] : [])),
)

export interface Choice extends MenuItem {
  id: string
}

export interface Tile {
  id: string
  name: string
  icon: IconNode
  disabled: boolean
  option: { label: string; command: string } | null
}

export interface Shelved {
  id: Shelf
  label: string
  tiles: Tile[]
}

function nameOf(id: string): string {
  const own = KINDS[id]?.name
  if (own) return own
  const format = EXPORT_FORMATS.find((one) => one.id === id)
  if (format) return format.label
  const pandoc = PANDOC_FORMATS.find((one) => one.id === id)
  return pandoc ? pandoc.label : id
}

export function shelved(choices: readonly Choice[], first: string | null = null): Shelved[] {
  const offered = new Set(choices.map((one) => one.id))
  const shelves = SHELVES.map((shelf) => ({
    id: shelf.id,
    label: shelf.label,
    tiles: [] as Tile[],
  }))

  for (const choice of choices) {
    if (choice.id === SETUP || FOLDED.has(choice.id) || !choice.id.startsWith('export-')) continue
    const id = choice.id.slice('export-'.length)
    const kind = KINDS[id]
    const option = kind?.option
    const tile: Tile = {
      id,
      name: nameOf(id),
      icon: kind?.icon ?? FileCode,
      disabled: choice.disabled === true,
      option:
        option && offered.has(`export-${option.id}`)
          ? { label: option.label, command: `export-${option.id}` }
          : null,
    }
    shelves.find((one) => one.id === (kind?.shelf ?? 'other'))?.tiles.push(tile)
  }

  const rank = (tile: Tile) => {
    const at = ORDER.indexOf(tile.id)
    return at < 0 ? ORDER.length : at
  }
  for (const shelf of shelves) shelf.tiles.sort((a, b) => rank(a) - rank(b))

  const full = shelves.filter((one) => one.tiles.length)
  const held = full.find((one) => one.tiles.some((tile) => tile.id === first))
  if (!held) return full

  held.tiles.sort((a, b) => Number(b.id === first) - Number(a.id === first))
  return [held, ...full.filter((one) => one !== held)]
}

export function commandFor(tile: Tile, optioned: boolean): string {
  return tile.option && optioned ? tile.option.command : `export-${tile.id}`
}
