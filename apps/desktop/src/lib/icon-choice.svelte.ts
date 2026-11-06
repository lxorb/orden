export type IconTarget =
  | { kind: 'space'; id: string }
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'terminal'; tab: string }

class IconChoice {
  target = $state<IconTarget | null>(null)

  space(id: string) {
    this.target = { kind: 'space', id }
  }

  file(path: string) {
    this.target = { kind: 'file', path }
  }

  folder(path: string) {
    this.target = { kind: 'folder', path }
  }

  terminal(tab: string) {
    this.target = { kind: 'terminal', tab }
  }

  close() {
    this.target = null
  }
}

export const iconChoice = new IconChoice()
