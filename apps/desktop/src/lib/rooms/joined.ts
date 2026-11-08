import { type Opening, RoomDoor, type Who } from './door'
import type { Seen } from './peers'

export interface Entering {
  noteId: string
  token: string
  who: Who
  scheme: 'dark' | 'light'
  onPeers: (present: number, seen?: Seen) => void
  gone: () => void
  refused: (said: string) => void
  shut: (signedOut: boolean) => void
  demoted?: () => void
  holds: () => boolean
}

export abstract class JoinedRoom {
  protected readonly door: RoomDoor
  protected scheme: 'dark' | 'light'
  protected left = false

  constructor(private readonly entering: Entering) {
    this.scheme = entering.scheme
    this.door = this.opened(entering, {
      noteId: entering.noteId,
      token: entering.token,
      who: entering.who,
      caughtUp: () => this.together(),
      present: () => this.showPresent(),
      gone: () => {
        this.rebuilt()
        entering.gone()
      },
      refused: (said) => entering.refused(said),
      shut: (signedOut) => entering.shut(signedOut),
      demoted: () => {
        this.rebuilt()
        if (entering.demoted) entering.demoted()
        else entering.gone()
      },
    })
  }

  protected opened(_entering: Entering, opening: Opening): RoomDoor {
    return new RoomDoor(opening)
  }

  rename(person: string | undefined) {
    this.door.rename(person)
  }

  repaint(scheme: 'dark' | 'light') {
    if (scheme === this.scheme) return

    this.scheme = scheme
    this.showPresent()
  }

  protected holds(): boolean {
    return !this.left && this.entering.holds()
  }

  protected rebuilt(): void {
    // Nothing for a room that keeps nothing across a rebuild.
  }

  protected abstract together(): Promise<void> | void

  protected abstract showPresent(): void
}
