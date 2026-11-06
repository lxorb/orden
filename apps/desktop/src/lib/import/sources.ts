import { isJunk } from './names'

export interface Picked {
  name: string
  webkitRelativePath?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface Source {
  path: string
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
}

const DEEPEST = 3

const MOST_BYTES = 512 * 1024 * 1024

export function sourceOf(path: string, bytes: Uint8Array): Source {
  return {
    path: tidyPath(path),
    text: () => Promise.resolve(decoded(bytes)),
    bytes: () => Promise.resolve(bytes),
  }
}

export function pickedFolder(picked: readonly Picked[]): string | null {
  let folder: string | null = null

  for (const one of picked) {
    const [first, ...rest] = tidyPath((one.webkitRelativePath ?? '').trim()).split('/')
    if (!first || !rest.length || (folder !== null && first !== folder)) return null
    folder = first
  }

  return folder
}

export function insideFolder(picked: readonly Picked[]): Picked[] {
  const folder = pickedFolder(picked)
  if (folder === null) return [...picked]

  return picked.map((one) => ({
    name: one.name,
    webkitRelativePath: tidyPath((one.webkitRelativePath ?? '').trim()).slice(folder.length + 1),
    arrayBuffer: () => one.arrayBuffer(),
  }))
}

export async function sourcesFrom(picked: readonly Picked[]): Promise<Source[]> {
  const found: Source[] = []
  const parts = onlyZips(picked.map((one) => tidyPath((one.webkitRelativePath ?? '').trim())))

  for (const one of picked) {
    const inside = (one.webkitRelativePath ?? '').trim()
    const path = tidyPath(inside.length ? inside : one.name)
    const bytes = new Uint8Array(await one.arrayBuffer())
    if (inside.length && (!parts || !path.toLowerCase().endsWith('.zip')))
      found.push(sourceOf(path, bytes))
    else found.push(...(await expand(path, bytes, 0)))
  }

  return found
}

async function expand(path: string, bytes: Uint8Array, depth: number): Promise<Source[]> {
  if (depth >= DEEPEST || !isZip(path, bytes)) return [sourceOf(path, bytes)]

  if (__EVEN_PLUGIN__) throw new Error('no import in the Even Realities plugin')

  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes, { decodeFileName: zipName }).catch(() => null)
  if (!zip) return [sourceOf(path, bytes)]
  const inside: Source[] = []
  const entries: { path: string; read: () => Promise<Uint8Array> }[] = []

  zip.forEach((entryPath, entry) => {
    if (entry.dir) return
    entries.push({ path: tidyPath(entryPath), read: () => entry.async('uint8array') })
  })

  const parts = onlyZips(entries.map((entry) => entry.path))

  for (const entry of entries) {
    if (parts && entry.path.toLowerCase().endsWith('.zip')) {
      inside.push(...(await expand(entry.path, await entry.read(), depth + 1)))
      continue
    }

    inside.push(lazily(entry.path, entry.read))
  }

  return inside
}

function onlyZips(paths: readonly string[]): boolean {
  const kept = paths.filter((one) => !isJunk(one))
  return kept.length > 0 && kept.every((one) => one.toLowerCase().endsWith('.zip'))
}

const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'

const OEM: Record<string, string> = {
  ja: 'shift_jis',
  zh: 'gbk',
  'zh-tw': 'big5',
  'zh-hk': 'big5',
  'zh-mo': 'big5',
  'zh-hant': 'big5',
  ko: 'euc-kr',
  ru: 'ibm866',
  uk: 'ibm866',
  be: 'ibm866',
  bg: 'ibm866',
  kk: 'ibm866',
  th: 'windows-874',
}

function oemCodePage(): string | null {
  const tag = (typeof navigator === 'undefined' ? '' : navigator.language).toLowerCase()
  const parts = tag.split('-')
  return OEM[parts.slice(0, 2).join('-')] ?? OEM[parts[0] ?? ''] ?? null
}

function zipName(bytes: Uint8Array | readonly unknown[]): string {
  const said = Uint8Array.from(bytes as ArrayLike<number>)
  for (const page of ['utf-8', oemCodePage()]) {
    if (page === null) continue
    try {
      return new TextDecoder(page, { fatal: true }).decode(said)
    } catch {
      // Not that code page; the next one is tried.
    }
  }
  return Array.from(said, (one) =>
    one < 0x80 ? String.fromCharCode(one) : (CP437[one - 0x80] ?? ''),
  ).join('')
}

function lazily(path: string, read: () => Promise<Uint8Array>): Source {
  let held: Promise<Uint8Array> | null = null
  const once = () => (held ??= read())

  return {
    path,
    text: async () => decoded(await once()),
    bytes: once,
  }
}

const ZIPPED_DOCUMENT =
  /\.(docx|docm|dotx|xlsx|xlsm|pptx|pptm|odt|ods|odp|odg|epub|pages|numbers|key|vsdx)$/i

function isZip(path: string, bytes: Uint8Array): boolean {
  if (!path.toLowerCase().endsWith('.zip') && ZIPPED_DOCUMENT.test(path)) return false
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  )
}

export function tidyPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function decoded(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export function tooMuch(bytes: number): boolean {
  return bytes > MOST_BYTES
}
