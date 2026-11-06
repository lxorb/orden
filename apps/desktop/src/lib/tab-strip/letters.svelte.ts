import { defaultKeyFor } from '@orden/editor'
import { rowName } from '../note-name'
import { FIXED_ENTRIES, SHORTCUTS } from '../shortcuts/registry'
import { shortcuts } from '../shortcuts.svelte'
import { insideSpace } from '../space-paths'
import { isRecord, keepJson, stored } from '../stored'
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
  private kept = readKept()

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

  pathOf(letter: string): string | null {
    for (const [path, worn] of Object.entries(this.given)) if (worn === letter) return path
    return null
  }

  private remember(given: Record<string, string>) {
    if (Object.entries(given).every(([path, letter]) => this.kept[path] === letter)) return
    this.kept = { ...this.kept, ...given }
    keepJson(STORAGE_KEY, this.kept)
  }
}

export const essentialLetters = new EssentialLetters()
