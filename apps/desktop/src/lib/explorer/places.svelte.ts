import type { IconNode } from 'lucide'
import Clapperboard from 'lucide/dist/esm/icons/clapperboard.mjs'
import Download from 'lucide/dist/esm/icons/download.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import HardDrive from 'lucide/dist/esm/icons/hard-drive.mjs'
import House from 'lucide/dist/esm/icons/house.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import Library from 'lucide/dist/esm/icons/library.mjs'
import Monitor from 'lucide/dist/esm/icons/monitor.mjs'
import Music from 'lucide/dist/esm/icons/music.mjs'
import { t } from '../i18n.svelte'
import { samePath } from '../space-paths'
import { keepJson, stored, stringList } from '../stored'
import { listPlaces, type Place, type PlaceKind } from './commands'

const SHOWN: Record<PlaceKind, { name: () => string; mark: IconNode }> = {
  home: { name: () => t('Home'), mark: House },
  desktop: { name: () => t('Desktop'), mark: Monitor },
  documents: { name: () => t('Documents'), mark: FileText },
  downloads: { name: () => t('Downloads'), mark: Download },
  pictures: { name: () => t('Pictures'), mark: Image },
  music: { name: () => t('Music'), mark: Music },
  videos: { name: () => t('Videos'), mark: Clapperboard },
  spaces: { name: () => t('Spaces'), mark: Library },
  root: { name: () => t('Computer'), mark: HardDrive },
  disk: { name: () => '', mark: HardDrive },
}

export function placeName(place: Place): string {
  return place.kind === 'disk' ? (place.name ?? place.path) : SHOWN[place.kind].name()
}

export function placeMark(place: Place): IconNode {
  return SHOWN[place.kind].mark
}

const PINNED = 'nib:explorer-pinned'

class Places {
  list = $state<Place[]>([])
  pinned = $state<string[]>(stringList(stored(PINNED)) ?? [])
  #asked: Promise<Place[]> | null = null

  pin(path: string) {
    if (this.pinned.some((one) => samePath(one, path))) return
    this.pinned = [...this.pinned, path]
    keepJson(PINNED, this.pinned)
  }

  unpin(path: string) {
    this.pinned = this.pinned.filter((one) => !samePath(one, path))
    keepJson(PINNED, this.pinned)
  }

  isPinned(path: string): boolean {
    return this.pinned.some((one) => samePath(one, path))
  }

  ask(again = false): Promise<Place[]> {
    if (!this.#asked || again)
      this.#asked = listPlaces().then(
        (found) => (this.list = found),
        () => this.list,
      )
    return this.#asked
  }

  async home(): Promise<string | null> {
    const found = await this.ask()
    return found.find((one) => one.kind === 'home')?.path ?? found[0]?.path ?? null
  }
}

export const places = new Places()
