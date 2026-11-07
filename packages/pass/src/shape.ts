export const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Length(text: string): number | null {
  if (!BASE64.test(text)) return null
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const last = LETTERS.indexOf(text.charAt(text.length - 1 - padding))
  const unused = padding === 2 ? 15 : padding === 1 ? 3 : 0
  if ((last & unused) !== 0) return null
  return (text.length / 4) * 3 - padding
}

export function isBase64(value: unknown, least: number, most = Infinity): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(most / 3) * 4) return false
  const length = base64Length(value)
  return length !== null && length >= least && length <= most
}

export function isSignPub(value: unknown): value is string {
  return isBase64(value, 65, 65)
}

export function isSignature(value: unknown): value is string {
  return isBase64(value, 64, 64)
}
