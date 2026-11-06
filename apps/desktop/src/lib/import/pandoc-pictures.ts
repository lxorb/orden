import { fromBase64, sha256 } from '../bytes'

export interface PandocPicture {
  link: string
  data: string
}

export type StorePicture = (bytes: Uint8Array, name: string) => Promise<string | null>

export async function keepPictures(
  markdown: string,
  pictures: readonly PandocPicture[],
  store: StorePicture,
): Promise<{ markdown: string; lost: number }> {
  let out = markdown
  let lost = 0

  for (const picture of pictures) {
    const bytes = fromBase64(picture.data)
    const name = `${(await sha256(bytes)).slice(0, 16)}${extensionOf(picture.link)}`
    const stored = await store(bytes, name).catch(() => null)
    if (stored === null) {
      lost += 1
      continue
    }
    out = relinked(out, picture.link, encodeURI(stored))
  }

  return { markdown: out, lost }
}

function extensionOf(link: string): string {
  const found = /\.([a-z0-9]{1,5})$/i.exec(link)?.[1]
  return found ? `.${found.toLowerCase()}` : ''
}

export function relinked(markdown: string, from: string, to: string): string {
  const spellings = [...new Set([from, from.replace(/\//g, '\\')])]
  let out = markdown

  for (const spelling of spellings) {
    const name = `(?:\\.[\\\\/])?${escaped(spelling)}`
    const opening = String.raw`(\]\(<?|\]:[ \t]+<?|\bsrc=["'])`
    const closing = String.raw`(?=[>)"'\s]|$)`
    out = out.replace(
      new RegExp(`${opening}${name}${closing}`, 'g'),
      (_, before) => `${before}${to}`,
    )
  }

  return out
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
