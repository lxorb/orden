import { keep, storedText } from './platform/src/api'

const OPEN_KEY = 'orden:archive-open'

class ArchiveList {
  open = $state(storedText(OPEN_KEY) === '1')
  unfolded = $state<string[]>([])
  showing = $state<string | null>(null)

  toggle() {
    this.setOpen(!this.open)
  }

  show(path: string | null = null) {
    this.setOpen(true)
    this.showing = path
  }

  isUnfolded(path: string): boolean {
    return this.unfolded.includes(path)
  }

  unfold(path: string) {
    this.unfolded = this.isUnfolded(path)
      ? this.unfolded.filter((one) => one !== path)
      : [...this.unfolded, path]
  }

  private setOpen(open: boolean) {
    this.open = open
    keep(OPEN_KEY, open ? '1' : '0')
  }
}

export const archiveList = new ArchiveList()
