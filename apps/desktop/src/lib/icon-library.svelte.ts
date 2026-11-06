import { type IconNode, keyNamed, loadIcons, LUCIDE, shapeFor, type WrittenIcon } from './icons'
import type { IconShape, LoadedSet } from './icon-sets'
import { startup } from './startup.svelte'

class IconLibrary {
  loaded = $state<Record<string, LoadedSet>>({})

  absent = $state<Record<string, true>>({})

  private asked = new Set<string>()

  set = $state<Record<string, IconNode>>({})

  load(id: string = LUCIDE) {
    if (this.asked.has(id)) return
    this.asked.add(id)

    void startup.turn('icons').then(async () => {
      const set = (await import('./icon-sets')).setNamed(id)
      if (!set) {
        this.asked.delete(id)
        return
      }

      void set
        .load()
        .then((held) => {
          this.loaded = { ...this.loaded, [id]: held }
        })
        .catch(() => {
          this.absent = { ...this.absent, [id]: true }
        })

      if (id === LUCIDE) void loadIcons().then((all) => (this.set = all))
    })
  }

  loading(id: string): boolean {
    return this.asked.has(id) && !this.loaded[id] && !this.absent[id]
  }

  spaceShape(chosen: string | null): IconNode | null {
    return shapeFor(this.set, chosen)
  }

  shape(written: string): IconNode | null {
    return shapeFor(this.set, keyNamed(this.set, written))
  }

  drawing(icon: WrittenIcon | null): IconShape | null {
    if (!icon) return null
    if (icon.kind === 'emoji') return { kind: 'emoji', text: icon.text }

    if (icon.kind === 'lucide') {
      const found = this.shape(icon.name)
      return found ? { kind: 'stroked', icon: found } : null
    }

    return this.loaded[icon.set]?.shape(icon.name) ?? null
  }

  setFor(icon: WrittenIcon | null): string | null {
    if (!icon || icon.kind === 'emoji') return null
    return icon.kind === 'lucide' ? LUCIDE : icon.set
  }
}

export const iconLibrary = new IconLibrary()
