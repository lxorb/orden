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
import { listPlaces, type Place, type PlaceKind } from './commands'
import { pins } from './pins.svelte'

const SHOWN: Record<PlaceKind, { name: () => string; mark: IconNode }> = {
  home: { name: () => 'Home', mark: House },
  desktop: { name: () => 'Desktop', mark: Monitor },
  documents: { name: () => 'Documents', mark: FileText },
  downloads: { name: () => 'Downloads', mark: Download },
  pictures: { name: () => 'Pictures', mark: Image },
  music: { name: () => 'Music', mark: Music },
  videos: { name: () => 'Videos', mark: Clapperboard },
  spaces: { name: () => 'Spaces', mark: Library },
  root: { name: () => 'Computer', mark: HardDrive },
  disk: { name: () => '', mark: HardDrive },
}

export function placeName(place: Place): string {
  return place.kind === 'disk' ? (place.name ?? place.path) : SHOWN[place.kind].name()
}

export function placeMark(place: Place): IconNode {
  return SHOWN[place.kind].mark
}

class Places {
  list = $state<Place[]>([])
  #asked: Promise<Place[]> | null = null

  get pinned(): string[] {
    return pins.list
  }

  pin(path: string) {
    pins.pin(path)
  }

  unpin(path: string) {
    pins.unpin(path)
  }

  isPinned(path: string): boolean {
    return pins.has(path)
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
