import type { Spot } from '../../ui-controls/src/api'

export function without(text: string, span: Spot): string {
  const before = text.slice(0, span.from).replace(/\s+$/u, '')
  const after = text.slice(span.to).replace(/^\s+/u, '')
  return before && after ? `${before} ${after}` : before + after
}
export function pastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+•]|\d{1,9}[.)])\s+/u, '')
        .replace(/^\[.\]\s+/u, '')
        .trim(),
    )
    .filter(Boolean)
}
