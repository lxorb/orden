import type { Member, Mention } from './types'

const WORDY = /[\p{L}\p{N}_]/u

const SPECIALS = ['here', 'everyone'] as const

export function mentionsIn(body: string, members: readonly Member[]): Mention[] {
  const text = withoutCode(body)
  const labels = labelsOf(members)
  const found: Mention[] = []
  const add = (mention: Mention) => {
    if (!found.includes(mention)) found.push(mention)
  }

  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && (WORDY.test(text.charAt(at - 1)) || text.charAt(at - 1) === '@')) continue
    const special = SPECIALS.find((word) => calls(text, at + 1, word))
    if (special) {
      add(special)
      continue
    }
    const member = labels.find(([label]) => calls(text, at + 1, label))
    if (member) add(member[1])
  }
  return found
}

function labelsOf(members: readonly Member[]): [string, Mention][] {
  const labels: [string, Mention][] = []
  for (const member of members) {
    for (const label of [member.nick, member.name]) {
      const clean = label?.trim()
      if (clean) labels.push([clean, member.who])
    }
  }
  return labels.sort(([a], [b]) => b.length - a.length)
}

function calls(text: string, from: number, label: string): boolean {
  const written = text.slice(from, from + label.length)
  if (written.length !== label.length) return false
  if (written.normalize('NFC').toLowerCase() !== label.normalize('NFC').toLowerCase()) return false
  return !WORDY.test(text.charAt(from + label.length))
}

function withoutCode(body: string): string {
  const blank = (part: string) => part.replace(/[^\n]/g, ' ')
  const fenced = body.replace(
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm,
    blank,
  )
  return fenced.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}
