import { isReserved } from '@orden/markdown/note-name'

const CONTROL = 0x20

const DELETE = 0x7f

export function insideOnly(said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()
  if (!folded) return null

  if (folded.startsWith('/') || /^[A-Za-z]:/.test(folded)) return null
  if (holdsUnnameable(folded)) return null

  const steps = folded.split('/').filter((step) => step !== '' && step !== '.')
  if (!steps.length) return null
  if (steps.some((step) => step === '..')) return null
  if (steps.some(isReserved)) return null

  return steps.join('/')
}

function holdsUnnameable(path: string): boolean {
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code < CONTROL || code === DELETE) return true
  }

  return false
}
