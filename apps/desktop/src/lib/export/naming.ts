/** What an exported file is called, and what happens when that name is taken.
 *
 *  One rule, in one place, because three parts of an export ask the same
 *  question: the file the reader is offered, the pictures gathered into a
 *  package, and the file written straight into a folder on a phone where there
 *  is no dialog to ask in.
 *
 *  The numbering itself is not the export's own: `freePath` in @nib/markdown/paths
 *  is what every part of the app steps a taken name aside with, so `Note 2.docx`
 *  here and a copy in the file list are numbered by one rule. What belongs to the
 *  export is the shape its callers ask in - a set of the names they already hold. */

import { freePath } from '@nib/markdown/paths'

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
  return freePath(wanted, (candidate) => taken.has(candidate))
}

/** The same, over a set that is then told about the name it gave out - which is
 *  how a run of pictures gets a name each. */
export function claimName(wanted: string, taken: Set<string>): string {
  const free = freeName(wanted, taken)
  taken.add(free)
  return free
}
