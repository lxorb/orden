/** The order a list of languages is offered in, for every picker that offers one:
 *  the app's language, the spelling dictionary, the language a rewrite translates
 *  into and the clipper's own language row. Shared so that no two of them can
 *  read differently.
 *
 *  Each language is named the way its own speakers write it, so the list is in
 *  as many scripts as it has languages. A reader scans it for a word in their own
 *  alphabet, and for most readers that is the Latin one: those come first, A to
 *  Z, and every other script after them, one script at a time. Within a script
 *  the names are compared as a person compares them, not by code point, so
 *  Čeština sits with the Cs, Español with the Es and Österreich with the Os.
 *
 *  A row the list does not sort - "Match the system", which is not a language -
 *  stays at the top, where every picker in the app puts its default. */

/** The scripts after Latin, in the order they follow it: the alphabets nearest
 *  Latin first, then right to left, then the Indic family together, South-East
 *  Asia, and the CJK scripts last. A script inside one group is sorted with the
 *  rest of its group, so Hindi and Tamil sit in one run rather than eleven. */
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

/** One collator for every list, in a fixed locale: the names do not change with
 *  the app's language, so neither does their order. `base` compares letters and
 *  leaves accents and case to break ties only. */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base' })

/** Where a name's script sits, read from its first letter. A script nobody
 *  listed goes after all of them rather than among the Latin names. */
function groupOf(name: string): number {
  const letter = /\p{L}/u.exec(name)?.[0] ?? ''
  const found = GROUPS.findIndex((group) => group.test(letter))
  return found === -1 ? GROUPS.length : found
}

/** The rows in the order a picker offers them. The input is left as it is. */
export function inLanguageOrder<T extends { id: string; name: string }>(rows: readonly T[]): T[] {
  const pinned = rows.filter((row) => row.id === 'system')
  const sorted = rows
    .filter((row) => row.id !== 'system')
    .map((row) => ({ row, group: groupOf(row.name) }))
    .sort((a, b) => a.group - b.group || COLLATOR.compare(a.row.name, b.row.name))
    .map(({ row }) => row)
  return [...pinned, ...sorted]
}
