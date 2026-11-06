import { COVER_KEY } from '@orden/markdown/cover'
import { frontMatterList, frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { blockIds, findLinks, headingsOf, type LinkKind } from '@orden/markdown/links'
import type { ScannedTask, Stamp } from '@orden/bases/scan'
import { tagsIn } from './search/tags'
import { readWebFile } from './shortcut'

export const ICON_KEY = 'icon'
export const ICON_COLOUR_KEY = 'icon-color'

interface ScannedLink {
  kind: LinkKind
  target: string
  heading: string | null
  block: string | null
  alias: string | null
  embed: boolean
  line: number
  text: string
}

export interface ScannedNote {
  path: string
  name: string
  headings: string[]
  blocks: string[]
  links: ScannedLink[]
  tags: string[]
  icon: string | null
  iconColor: string | null
  aliases: string[]
  url: string | null
  favicon: string | null
  address: string | null
  cover: string | null
  bare: boolean
  front?: string | null
  tasks?: ScannedTask[]
  stamp?: Stamp | null
}

export interface SpaceLinks {
  notes: ScannedNote[]
  files: string[]
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

const CONTEXT = 200

export function scanNote(path: string, content: string): ScannedNote {
  const name = (path.split('/').pop() ?? path).replace(MARKDOWN, '')
  return {
    path,
    name,
    headings: headingsOf(content),
    blocks: blockIds(content).map((one) => one.id),
    tags: noteTags(content),
    icon: frontMatterValue(content, ICON_KEY),
    iconColor: frontMatterValue(content, ICON_COLOUR_KEY),
    aliases: frontMatterList(content, 'aliases'),
    url: frontMatterValue(content, 'url'),
    favicon: null,
    address: null,
    cover: frontMatterValue(content, COVER_KEY),
    bare: saysNothing(content, name),
    links: findLinks(content).map((link) => ({
      kind: link.kind,
      target: link.target,
      heading: link.heading,
      block: link.block,
      alias: link.alias,
      embed: link.embed,
      line: link.line,
      text: contextAt(content, link.from),
    })),
  }
}

export function scanShortcut(path: string, content: string): ScannedNote {
  const said = readWebFile(path, content)

  return {
    path,
    name: path.split('/').pop() ?? path,
    headings: [],
    blocks: [],
    tags: [],
    icon: said?.chosen ?? null,
    iconColor: said?.chosenColour ?? null,
    aliases: [],
    url: null,
    favicon: said?.icon ?? null,
    address: said?.url ?? null,
    cover: null,
    bare: false,
    links: [],
  }
}

function noteTags(content: string): string[] {
  return [...new Set(tagsIn(content).map((tag) => tag.slice(1).toLowerCase()))]
}

function contextAt(text: string, at: number): string {
  const from = text.lastIndexOf('\n', at) + 1
  const end = text.indexOf('\n', at)
  return text
    .slice(from, end === -1 ? text.length : end)
    .trim()
    .slice(0, CONTEXT)
}

const BARE_HEADING = /^ {0,3}#{1,6}[ \t](.*)$/

function loose(words: string): string {
  return words
    .replace(/[<>:"/\\|?* -]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
}

export function saysNothing(content: string, name: string): boolean {
  const lines = stripFrontMatter(content)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) return true
  if (lines.length > 1) return false

  const heading = BARE_HEADING.exec(lines[0] ?? '')
  if (heading === null) return false
  const words = (heading[1] ?? '').trim().replace(/#+$/, '').trim()
  return loose(name) !== '' && loose(words) === loose(name)
}
