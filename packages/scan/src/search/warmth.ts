export interface Warmth {
  notes: number
  of: number
  characters: number
  cap: number
  dropped: number
  read: number
  warm: boolean
}

export function isWarmth(value: unknown): value is Warmth {
  if (typeof value !== 'object' || value === null) return false

  const shape = value as Partial<Record<keyof Warmth, unknown>>
  return (
    typeof shape.notes === 'number' &&
    typeof shape.of === 'number' &&
    typeof shape.characters === 'number' &&
    typeof shape.cap === 'number' &&
    typeof shape.dropped === 'number' &&
    typeof shape.read === 'number' &&
    typeof shape.warm === 'boolean'
  )
}

export interface PapersHeld {
  papers: number
  characters: number
  cap: number
}

export function said(warmth: Warmth | null, papers: PapersHeld | null): string | undefined {
  if (!warmth && !papers) return undefined

  const words = []
  if (warmth) {
    const { notes, of, characters, cap, dropped, read, warm } = warmth
    words.push(
      `notes=${notes}/${of}`,
      `chars=${characters}/${cap}`,
      `dropped=${dropped}`,
      `read=${read}`,
      `warm=${warm ? 1 : 0}`,
    )
  }

  if (papers) words.push(`papers=${papers.papers}`, `pchars=${papers.characters}/${papers.cap}`)

  return words.join(' ')
}
