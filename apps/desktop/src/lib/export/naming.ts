/** What an exported file is called, and what happens when that name is taken.
 *
 *  One rule, in one place, because three parts of an export ask the same
 *  question: the file the reader is offered, the pictures gathered into a
 *  package, and the file written straight into a folder on a phone where there
 *  is no dialog to ask in.
 *
 *  The rule is the app's own, the one `free_spot` in the crate follows: the
 *  number goes before the extension, so `Note 2.docx` and never `Note.docx 2`. */

/** The note's name without whatever extension it had. */
export function stemOf(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** The file an export of `name` produces. */
export function fileNameFor(name: string, extension: string): string {
  return `${stemOf(name)}.${extension}`
}

/** `wanted` if nothing has it, else the first free `name 2`, `name 3`... */
export function freeName(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted

  const dot = wanted.lastIndexOf('.')
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted
  const extension = dot > 0 ? wanted.slice(dot) : ''

  for (let counter = 2; ; counter++) {
    const candidate = `${stem} ${counter}${extension}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The same, over a set that is then told about the name it gave out - which is
 *  how a run of pictures gets a name each. */
export function claimName(wanted: string, taken: Set<string>): string {
  const free = freeName(wanted, taken)
  taken.add(free)
  return free
}
