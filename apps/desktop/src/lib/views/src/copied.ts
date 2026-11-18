interface Rule {
  numbers(path: string): boolean
  without(path: string, text: string): string | null
}

let rule: Rule | null = null

export function leaveIdsBy(given: Rule) {
  rule = given
}

export const numbersAt = (path: string): boolean => rule?.numbers(path) ?? false

export const withoutIds = (path: string, text: string): string | null =>
  rule ? rule.without(path, text) : null
