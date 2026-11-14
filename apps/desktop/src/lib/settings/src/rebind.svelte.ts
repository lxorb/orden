import { type Modifier, writeTap } from '../../double-tap'
import { readCombination } from '../../ui-kit/src/api'
import { type Shortcut, shortcuts } from '../../shortcuts.svelte'
import { BY_ID } from '../../shortcuts/registry'

export class Rebind {
  listening = $state<string | null>(null)

  clash = $state<{ id: string; key: string; holders: Shortcut[] } | null>(null)

  turnedDown = $state<{ id: string; reason: string } | null>(null)

  listen(id: string) {
    const same = this.listening === id
    this.forget()
    this.listening = same ? null : id
  }

  forget() {
    this.listening = null
    this.clash = null
    this.turnedDown = null
  }

  takeOver() {
    const clash = this.clash
    if (!clash) return

    for (const holder of clash.holders) shortcuts.set(holder.id, null)
    shortcuts.set(clash.id, clash.key)
    this.clash = null
  }

  record(event: KeyboardEvent) {
    const id = this.listening
    if (!id) return

    if (event.key === 'Escape') {
      this.listening = null
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      shortcuts.set(id, null)
      this.listening = null
      return
    }

    const key = readCombination(event, shortcuts.platform)
    if (!key) return

    this.take(id, key)
  }

  tapped(key: Modifier) {
    const id = this.listening
    if (!id || BY_ID.get(id)?.scope !== 'app') return

    this.take(id, writeTap(key, shortcuts.platform))
  }

  private take(id: string, key: string) {
    const reason = shortcuts.refuse(key, id)
    if (reason) {
      this.turnedDown = { id, reason }
      this.listening = null
      return
    }

    const holders = shortcuts.conflicts(id, key)
    this.listening = null
    if (holders.length) this.clash = { id, key, holders }
    else shortcuts.set(id, key)
  }
}
