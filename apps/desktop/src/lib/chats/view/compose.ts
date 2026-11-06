import type { Member, Who } from '@orden/chats'

export type EnterDoes = 'send' | 'line' | 'editor'

export function enterDoes(before: string, held: { shift: boolean; mod: boolean }): EnterDoes {
  if (held.mod) return 'send'
  if (held.shift) return 'line'
  if (inFence(before) || inList(before)) return 'editor'
  return 'send'
}

function inFence(before: string): boolean {
  const fences = before.match(/^ {0,3}(`{3,}|~{3,})/gm)
  return (fences?.length ?? 0) % 2 === 1
}

function inList(before: string): boolean {
  const line = before.slice(before.lastIndexOf('\n') + 1)
  return /^\s*(?:[-*+]|\d{1,9}[.)])\s(?:\[[ xX]\]\s)?/.test(line)
}

export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const line = text.slice(text.lastIndexOf('\n', caret - 1) + 1, caret)
  const at = line.lastIndexOf('@')
  if (at === -1) return null
  const query = line.slice(at + 1)
  if (/\s/.test(query) || query.length > 32) return null
  if (at > 0 && /[\p{L}\p{N}_]/u.test(line.charAt(at - 1))) return null
  return { from: caret - query.length - 1, query }
}

export type Special = 'nib' | 'here' | 'everyone'

export function nibAsked(words: string): string | null {
  const found = /^\s*@nib(?:\s+([\s\S]*))?$/i.exec(words)
  return found ? (found[1] ?? '').trim() : null
}

export function mentionChoices(
  query: string,
  members: readonly Member[],
  me: Who | null,
  first = false,
): (Member | Special)[] {
  const wanted = fold(query)
  const named = members.filter((one) => one.who !== me)
  const starts = named.filter((one) =>
    [one.nick, one.name].some((name) => name !== undefined && fold(name).startsWith(wanted)),
  )
  const inside = named.filter(
    (one) =>
      !starts.includes(one) &&
      [one.nick, one.name].some(
        (name) =>
          name !== undefined &&
          fold(name)
            .split(/\s+/)
            .some((word) => word.startsWith(wanted)),
      ),
  )
  const specials = (['nib', 'here', 'everyone'] as const).filter(
    (one) => one.startsWith(wanted) && (first || one !== 'nib'),
  )
  return [...starts, ...inside, ...specials].slice(0, 8)
}

export function mentionText(choice: Member | Special): string {
  return typeof choice === 'string' ? `@${choice} ` : `@${choice.nick ?? choice.name} `
}

export function trimmed(text: string): string {
  return text.replace(/^\s*\n/, '').replace(/\s+$/, '')
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}
