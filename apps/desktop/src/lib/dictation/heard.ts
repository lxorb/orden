const MOST_PROMPT = 300

const MOST_BEFORE = 160

const MOST_WORD = 48

export function promptOf(before: string, words: readonly string[]): string {
  const named: string[] = []
  for (const word of words) {
    const one = word.replace(/\s+/g, ' ').trim()
    if (one && one.length <= MOST_WORD && !named.includes(one)) named.push(one)
  }

  const tail = tailOf(before)
  let list = named.join(', ')
  const room = MOST_PROMPT - tail.length - (tail ? 2 : 0)
  if (list.length > room) list = list.slice(0, Math.max(0, room)).replace(/,?\s*[^,]*$/, '')
  if (!list) return tail
  return tail ? `${list}. ${tail}` : list
}

function tailOf(before: string): string {
  const text = before.replace(/\s+/g, ' ').trim()
  if (text.length <= MOST_BEFORE) return text
  const cut = text.slice(-MOST_BEFORE)
  const space = cut.indexOf(' ')
  return space < 0 ? cut : cut.slice(space + 1)
}

const CREDITS = [
  /\s*Untertitel(?:ung)? (?:der|von|im Auftrag|des|durch)\b.*$/gi,
  /\s*\S*Amara\.org.*$/gi,
  /\s*Thanks? (?:you )?for watching[.!]?/gi,
  /\s*Copyright\b[^.!?]*(?:WDR|ZDF|SWR|NDR|BR|MDR)\b[^.!?]*[.!?]?/gi,
]

const FILLERS =
  /^(?:obrigad[oa]|thank you|thanks|you|bye|danke|vielen dank|tschüss|e aí|merci|gracias)[.!]?$/i

const SURE_SECONDS = 1

export function cleaned(text: string, prompt: string, spokenSeconds: number): string {
  let said = text
  for (const credit of CREDITS) said = said.replace(credit, '')
  said = said.replace(/\s+/g, ' ').trim()

  if (spokenSeconds < SURE_SECONDS && FILLERS.test(said)) return ''
  if (prompt && echoes(said, prompt)) return ''
  return said
}

function echoes(said: string, prompt: string): boolean {
  const plain = (one: string) =>
    one
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const heard = plain(said)
  return heard.length > 0 && plain(prompt).includes(heard) && heard.split(' ').length >= 3
}
