export interface Emoji {
  byName: ReadonlyMap<string, string>
  byText: ReadonlyMap<string, string>
}

const TONES = ['', '', '1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff']

const plain = (text: string) => text.replace(/️/g, '')

const textOf = (hex: string) =>
  String.fromCodePoint(...hex.split('-').map((part) => parseInt(part, 16)))

let loaded: Promise<Emoji> | null = null

export function emoji(): Promise<Emoji> {
  loaded ??= import('./names').then(({ NAMES }) => tableOf(NAMES))
  return loaded
}

function tableOf(names: string): Emoji {
  const byName = new Map<string, string>()
  const byText = new Map<string, string>()
  for (const line of names.split('\n')) {
    const [hex, ...called] = line.trim().split(' ')
    if (!hex || !called.length) continue
    const text = textOf(hex)
    for (const name of called) byName.set(name, text)
    const first = called[0]
    if (first && !byText.has(plain(text))) byText.set(plain(text), first)
  }
  return { byName, byText }
}

export function textFor(table: Emoji, name: string): string {
  const [base = '', tone] = name.split('::')
  const text = table.byName.get(base)
  if (!text) return `:${name}:`
  const level = /^skin-tone-([2-6])$/.exec(tone ?? '')?.[1]
  const modifier = level ? TONES[Number(level)] : undefined
  if (!modifier) return text
  const chars = Array.from(plain(text))
  return [chars[0], textOf(modifier), ...chars.slice(1)].join('')
}

export function nameFor(table: Emoji, text: string): string {
  const custom = /^:([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):$/.exec(text)
  if (custom?.[1]) return custom[1]
  const bare = plain(text)
  const direct = table.byText.get(bare)
  if (direct) return direct
  const chars = Array.from(bare)
  const at = chars.findIndex((char) => /\p{Emoji_Modifier}/u.test(char))
  if (at > 0) {
    const tone = TONES.indexOf((chars[at]?.codePointAt(0) ?? 0).toString(16))
    const base = table.byText.get(chars.filter((_, index) => index !== at).join(''))
    if (base && tone > 1) return `${base}::skin-tone-${tone}`
  }
  throw new Error('Slack does not know that emoji')
}

export function emojiIn(table: Emoji, text: string): string {
  return text.replace(/:([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):/g, (whole, name: string) => {
    const found = textFor(table, name)
    return found.startsWith(':') ? whole : found
  })
}
