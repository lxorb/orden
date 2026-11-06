const PARTS: Record<string, (at: Date) => number> = {
  YYYY: (at) => at.getFullYear(),
  MM: (at) => at.getMonth() + 1,
  DD: (at) => at.getDate(),
  HH: (at) => at.getHours(),
  mm: (at) => at.getMinutes(),
  ss: (at) => at.getSeconds(),
}

const TOKEN = new RegExp(
  Object.keys(PARTS)
    .sort((one, other) => other.length - one.length)
    .join('|'),
  'g',
)

export const ID_FORMATS = ['YYYYMMDDHHmm', 'YYYYMMDDHHmmss', 'YYYY-MM-DD HHmm', 'YYYYMMDD']

export const DEFAULT_ID_FORMAT = 'YYYYMMDDHHmm'

export function noteId(format: string, at: Date = new Date()): string {
  const filled = fill(format, at)
  return filled === format ? fill(DEFAULT_ID_FORMAT, at) : filled
}

function fill(format: string, at: Date): string {
  return format.replace(TOKEN, (token) => {
    const part = PARTS[token]
    return part ? String(part(at)).padStart(token.length, '0') : token
  })
}
