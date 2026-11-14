import type { Term } from '@orden/online'
import { termOf, termText } from '@orden/online/term'

export interface OwnFile {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  make(): Promise<Term>
}

export async function ownSession(file: OwnFile): Promise<string> {
  const said = termOf((await file.read()) ?? '')
  if (said) return said.session
  const made = await file.make()
  await file.write(termText(made))
  return made.session
}

export function namedSession(words: string | null): string | undefined {
  return termOf(words ?? '')?.session
}

export function wordsFor(words: string | null, term: Term): string | null {
  if (words === null || namedSession(words) === term.session) return null
  const said = termOf(words)
  return termText({
    ...term,
    ...(said?.icon ? { icon: said.icon } : {}),
    ...(said?.iconColor ? { iconColor: said.iconColor } : {}),
  })
}
