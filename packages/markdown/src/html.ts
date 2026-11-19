const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escape = (text: string): string =>
  text.replace(/&(?!#?\w+;)|[<>"']/g, (character) => ESCAPES[character] ?? character)

export const escapeAll = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function attributeText(written: string): string {
  return written.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi,
    (whole, decimal?: string, hex?: string, name?: string) => {
      if (name) return NAMED[name.toLowerCase()] ?? whole
      const code = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    },
  )
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);/i
const withoutBlanks = (target: string): string => target.replace(/[\s\p{Cc}\p{Cf}]/gu, '')

const schemeOf = (target: string): string =>
  /^([a-z][a-z\d+.-]*):/i.exec(withoutBlanks(target))?.[1]?.toLowerCase() ?? ''

export function safeHref(target: string): boolean {
  const scheme = schemeOf(target)
  return scheme === '' || SAFE_SCHEMES.has(scheme)
}

export const safeSrc = (target: string): boolean => safeHref(target) || SAFE_DATA_IMAGE.test(withoutBlanks(target))

const CODE_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'blob', 'filesystem'])

export function appHref(target: string): boolean {
  const scheme = schemeOf(target)
  return scheme !== '' && !CODE_SCHEMES.has(scheme)
}

export function attributeUrl(target: string): string {
  let encoded: string
  try {
    encoded = encodeURI(target).replace(/%25/g, '%')
  } catch {
    return ''
  }
  return encoded.replace(/&/g, '&amp;')
}

const NOT_IN_PATH = /[#?:]/g

export function pathHref(path: string): string | null {
  if (CODE_SCHEMES.has(schemeOf(path))) return null
  return attributeUrl(path).replace(NOT_IN_PATH, (one) => `%${one.charCodeAt(0).toString(16)}`)
}

export function fragment(name: string): string {
  try {
    return encodeURIComponent(name)
  } catch {
    return ''
  }
}
