const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escape(text: string): string {
  return text.replace(/&(?!#?\w+;)|[<>"']/g, (character) => ESCAPES[character] ?? character)
}

export function escapeAll(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);/i

function withoutBlanks(target: string): string {
  return target.replace(/[\s\p{Cc}\p{Cf}]/gu, '')
}

function schemeOf(target: string): string {
  return /^([a-z][a-z\d+.-]*):/i.exec(withoutBlanks(target))?.[1]?.toLowerCase() ?? ''
}

export function safeHref(target: string): boolean {
  const scheme = schemeOf(target)
  return scheme === '' || SAFE_SCHEMES.has(scheme)
}

export function safeSrc(target: string): boolean {
  return safeHref(target) || SAFE_DATA_IMAGE.test(withoutBlanks(target))
}

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

export function fragment(name: string): string {
  try {
    return encodeURIComponent(name)
  } catch {
    return ''
  }
}
