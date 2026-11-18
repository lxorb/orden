import type { PictureResolver } from '@orden/markdown'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import {
  decodeTarget,
  embedKind,
  embedSize,
  encodeTarget,
  type FoundLink,
  findLinks,
} from '@orden/markdown/links'
import {
  assetUrl,
  folderOf,
  imagePath,
  imageUrl,
  isRemote,
  relativePath,
} from '../../platform/src/api'
import { links } from './links.svelte'

function fileNamed(src: string, notePath: string | null): string | null {
  const read = decodeTarget(src)
  return links.fileFor(src, notePath) ?? (read === src ? null : links.fileFor(read, notePath))
}

export function picturePath(
  src: string,
  notePath: string | null,
  source: string,
  wikilink = false,
): string | null {
  if (isRemote(src)) return null
  const held = heldAlready(src)
  if (held !== null) return held
  if (wikilink) return fileNamed(src, notePath)

  const beside = imagePath(src, notePath, source, links.topOf(notePath))
  if (beside !== null && links.holdsFile(beside)) return beside
  return fileNamed(src, notePath)
}

export function notePicture(
  src: string,
  notePath: string | null,
  source: string,
  wikilink = false,
): string {
  const found = picturePath(src, notePath, source, wikilink)
  return found ? assetUrl(found) : imageUrl(src, notePath, source, links.topOf(notePath))
}

function heldAlready(src: string): string | null {
  const read = decodeTarget(src)
  return [read, src].find((one) => ABSOLUTE.test(one) && links.holdsFile(one)) ?? null
}

const ABSOLUTE = /^(?:[a-z]:[\\/]|[\\/])/i

export const picturesOf =
  (
    notePath: string | null,
    source: string,
    finish: (path: string) => string,
    every = false,
  ): PictureResolver =>
  (src, wikilink, from) => {
    if (!every && !wikilink && from?.path === undefined) return null
    const found = from?.path
      ? picturePath(src, from.path, from.text, wikilink)
      : picturePath(src, notePath, source, wikilink)
    return found === null ? null : finish(found)
  }

function besideNote(notePath: string, path: string): string | null {
  const folder = folderOf(notePath).replace(/\\/g, '/')
  const there = path.replace(/\\/g, '/')
  if (folder.split('/')[0] !== there.split('/')[0]) return null
  return relativePath(folder, there)
}

export const pictureBeside =
  (notePath: string | null): ((path: string) => string) =>
  (path) => {
    const beside = notePath === null ? null : besideNote(notePath, path)
    return beside === null ? path : encodeTarget(beside)
  }

function pictureWritten(link: FoundLink, to: string): string {
  if (link.kind !== 'wikilink') return to
  const alt = embedSize(link.alias) === null ? (link.alias ?? '') : ''
  return `![${alt.replace(/[\\[\]]/g, '\\$&')}](${to})`
}

export function picturesWrittenOut(source: string, notePath: string | null): string {
  if (notePath === null) return source
  const body = frontMatterBlock(source)?.to ?? 0
  const pictures = findLinks(source).filter(
    (link) => link.embed && link.from >= body && embedKind(link.target) === 'image',
  )

  let out = source
  for (const link of pictures.reverse()) {
    const found = picturePath(link.target, notePath, source, link.kind === 'wikilink')
    if (found === null) continue
    const to = pictureBeside(notePath)(found)
    const [from, end] =
      link.kind === 'wikilink' ? [link.from, link.to] : [link.targetFrom, link.targetTo]
    out = out.slice(0, from) + pictureWritten(link, to) + out.slice(end)
  }
  return out
}
