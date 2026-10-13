/** The one order every language picker keeps: the system default first, then the
 *  Latin names A to Z as a person sorts them (Čeština with the Cs), then every other
 *  script at the foot, one script at a time, CJK last. Read on the first paint, so
 *  kept short. */

const GROUPS: readonly RegExp[] = [
  /\p{Script=Latin}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Cyrillic}/u,
  /[\p{Script=Armenian}\p{Script=Georgian}]/u,
  /\p{Script=Hebrew}/u,
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u,
  /\p{Script=Ethiopic}/u,
  /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u,
  /[\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}]/u,
  /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
]

/** A fixed locale: the names never change with the app's language, nor their order. */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base' })

function groupOf(name: string): number {
  const letter = /\p{L}/u.exec(name)?.[0] ?? ''
  const found = GROUPS.findIndex((group) => group.test(letter))
  return found === -1 ? GROUPS.length : found
}

export function inLanguageOrder<T extends { id: string; name: string }>(rows: readonly T[]): T[] {
  const pinned = rows.filter((row) => row.id === 'system')
  const sorted = rows
    .filter((row) => row.id !== 'system')
    .map((row) => ({ row, group: groupOf(row.name) }))
    .sort((a, b) => a.group - b.group || COLLATOR.compare(a.row.name, b.row.name))
    .map(({ row }) => row)
  return [...pinned, ...sorted]
}
