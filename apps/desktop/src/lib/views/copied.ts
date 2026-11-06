interface Rule {
  numbers(path: string): boolean
  without(path: string, text: string): string | null
}

let rule: Rule | null = null

export function leaveIdsBy(given: Rule) {
  rule = given
}

export function numbersAt(path: string): boolean {
  return rule?.numbers(path) ?? false
}

export function withoutIds(path: string, text: string): string | null {
  return rule ? rule.without(path, text) : null
}
