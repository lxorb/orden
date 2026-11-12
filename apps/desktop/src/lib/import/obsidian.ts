import type { AttachmentFolder } from '../attachments'
import type { LinkFormat } from '../link-format'
import type { Carried } from './carry'
import { isJunk } from './folder'
import type { Source } from './sources'

const SETTINGS = /^(?:[^/]+\/)?\.obsidian\//

export function atVaultTop(sources: readonly Source[]): Source[] {
  if (sources.some((one) => one.path.startsWith('.obsidian/'))) return [...sources]

  const wrapper = sources
    .map((one) => SETTINGS.exec(one.path)?.[0].slice(0, -'.obsidian/'.length))
    .find(Boolean)
  if (!wrapper) return [...sources]
  const beside = (path: string) => !path.startsWith(wrapper) && !isJunk(path) && !leftInVault(path)
  if (sources.some((one) => beside(one.path))) {
    return [...sources]
  }

  return sources.map((one) =>
    one.path.startsWith(wrapper) ? { ...one, path: one.path.slice(wrapper.length) } : one,
  )
}

export function leftInVault(path: string): boolean {
  if (path.startsWith('.obsidian/')) {
    const rest = path.slice('.obsidian/'.length)
    return (
      /^workspace(?:-[^/]*)?\.json$/i.test(rest) ||
      /^(plugins|themes|cache)\//i.test(rest) ||
      rest.split('/').some((one) => one.startsWith('.'))
    )
  }

  const parts = path.split('/')
  const name = parts.pop() ?? ''
  return name.startsWith('.') || parts.some((one) => one.startsWith('.') || one === 'node_modules')
}

const IN_ICLOUD = /^\.[^/]+\.icloud$/

export function lostInVault(sources: readonly Source[]): string[] {
  const away = sources.filter((one) => {
    const parts = one.path.split('/')
    const name = parts.pop() ?? ''
    return IN_ICLOUD.test(name) && !parts.some((part) => part.startsWith('.'))
  }).length
  if (!away) return []

  return [`${away} files are in iCloud rather than on this Mac`]
}

export async function obsidianCarries(sources: readonly Source[]): Promise<Carried> {
  const app = atVaultTop(sources).find((one) => one.path === '.obsidian/app.json')
  let said: unknown = {}

  if (app) {
    try {
      said = JSON.parse(await app.text())
    } catch {
      // A settings file Obsidian could not read either is a vault on its defaults.
    }
  }

  return fromAppJson(said)
}

export function fromAppJson(said: unknown): Carried {
  const app = said !== null && typeof said === 'object' ? (said as Record<string, unknown>) : {}

  return {
    linkFormat: linkFormatOf(app.useMarkdownLinks, app.newLinkFormat),
    hardBreaks: app.strictLineBreaks !== true,
    attachments: attachmentsOf(app.attachmentFolderPath),
    vim: app.vimMode === true,
    quietMarks: false,
    keys: 'obsidian',
  }
}

function linkFormatOf(markdown: unknown, format: unknown): LinkFormat {
  if (markdown !== true) return 'wikilink'
  return format === 'relative' || format === 'absolute' ? format : 'shortest'
}

function attachmentsOf(path: unknown): AttachmentFolder {
  if (typeof path !== 'string') return 'space'
  return path.startsWith('./') ? 'note' : 'space'
}
