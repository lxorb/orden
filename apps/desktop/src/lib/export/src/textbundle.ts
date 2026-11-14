import type { Entry } from './zip'
import type { Picture } from './pictures'
import { toMarkdown } from './markdown'
import { type FoundLink } from '@orden/markdown/links'

const ASSETS = 'assets'

const TYPE = 'net.daringfireball.markdown'

function info(): string {
  return `${JSON.stringify(
    {
      version: 2,
      type: TYPE,
      transient: false,
      creatorIdentifier: 'so.orden',
    },
    null,
    2,
  )}\n`
}

export interface BundleOptions {
  link?: (link: FoundLink) => string | null
}

export function bundleFiles(
  source: string,
  pictures: readonly Picture[],
  options: BundleOptions = {},
): Entry[] {
  const inside = new Map(pictures.map((picture) => [picture.src, `${ASSETS}/${picture.name}`]))

  const text = toMarkdown(source, {
    ...(options.link ? { link: options.link } : {}),
    picture: (src) => inside.get(src) ?? null,
  })

  return [
    { path: 'info.json', body: info() },
    { path: 'text.md', body: text },
    ...pictures.map((picture) => ({ path: `${ASSETS}/${picture.name}`, body: picture.bytes })),
  ]
}

export function packEntries(bundle: string, files: readonly Entry[]): Entry[] {
  return files.map((file) => ({ ...file, path: `${bundle}/${file.path}` }))
}
