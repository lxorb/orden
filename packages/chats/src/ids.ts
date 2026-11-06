const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const MOST_TIME = 2 ** 48 - 1

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

export function ulid(now: number, random: () => number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MOST_TIME) {
    throw new RangeError(`no ULID holds the time ${String(now)}`)
  }
  let time = ''
  for (let rest = now, left = 10; left > 0; left -= 1) {
    time = digit(rest % 32) + time
    rest = Math.floor(rest / 32)
  }
  let noise = ''
  for (let left = 16; left > 0; left -= 1) noise += digit(Math.floor(random() * 32))
  return time + noise
}

function digit(value: number): string {
  return ALPHABET.charAt(Math.min(31, Math.max(0, value)))
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value)
}

export function ulidTime(id: string): number | null {
  if (!isUlid(id)) return null
  let time = 0
  for (const char of id.slice(0, 10)) time = time * 32 + ALPHABET.indexOf(char)
  return time
}
