/** The letter each Essential of the open space wears, kept from one launch to the next so
 *  a letter once learned stays (#1051); which letter is letters.ts. Bookmarks.svelte says
 *  them to a screen reader on the tiles, and numbers.svelte.ts shows them while Alt is
 *  held and goes to an Essential on Alt and its letter.
 *
 *  None on a Mac, where Option and a letter types a character - as Option and a digit
 *  does, which is why the tabs have no Alt numbers there either. */

import { defaultKeyFor } from '@orden/editor'
import { rowName } from '../note-name'
import { FIXED_ENTRIES, SHORTCUTS } from '../shortcuts/registry'
import { shortcuts } from '../shortcuts.svelte'
import { insideSpace } from '../space-paths'
import { isRecord, keep, stored } from '../stored'
import { isTile } from '../workspace/bookmarks.svelte'
import { workspace } from '../workspace.svelte'
import { lettersFor, takenUnderAlt } from './letters'

const STORAGE_KEY = 'nib:essential-letters'

function readKept(): Record<string, string> {
  const value = stored(STORAGE_KEY)
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  )
}

class EssentialLetters {
  /** Every letter given so far, by the Essential's path, in this space and the others. */
  private kept = readKept()

  /** The open space's Essentials and their letters, by path, each written down as it is
   *  first given so that it stays. */
  get given(): Record<string, string> {
    const given = this.reckoned
    this.remember(given)
    return given
  }

  private readonly reckoned = $derived.by((): Record<string, string> => {
    const platform = shortcuts.platform
    const root = workspace.activeSpace?.root
    if (platform === 'mac' || root === undefined) return {}

    const essentials = workspace.bookmarks.list.filter(isTile).flatMap((mark) => {
      const path = insideSpace(root, mark.path)
      const entry = workspace.entryAt(path)
      return entry && !entry.is_dir ? [{ path, name: rowName(entry.name, false) }] : []
    })
    if (!essentials.length) return {}

    const taken = takenUnderAlt(
      [
        ...SHORTCUTS.map((one) => shortcuts.keyFor(one.id)),
        ...FIXED_ENTRIES.map((one) => defaultKeyFor(one, platform)),
      ],
      platform,
    )
    return lettersFor(essentials, this.kept, taken)
  })

  /** The path of the Essential wearing a letter, or null. */
  pathOf(letter: string): string | null {
    for (const [path, worn] of Object.entries(this.given)) if (worn === letter) return path
    return null
  }

  private remember(given: Record<string, string>) {
    if (Object.entries(given).every(([path, letter]) => this.kept[path] === letter)) return
    this.kept = { ...this.kept, ...given }
    keep(STORAGE_KEY, JSON.stringify(this.kept))
  }
}

export const essentialLetters = new EssentialLetters()
