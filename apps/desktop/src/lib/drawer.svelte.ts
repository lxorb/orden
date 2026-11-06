import { type Panel, type PanelSide, workspace } from './workspace.svelte'
import { TAB_KINDS } from './workspace/tab-kinds'

class Drawer {
  at = $state<number | null>(null)

  width = $state(0)

  held = $state(false)

  settle = $state<number | null>(null)

  private travel = 0
  private travelAt = 0

  constructor(private readonly side: PanelSide) {}

  get sign(): number {
    return this.side === 'left' ? 1 : -1
  }

  get panel(): Panel | null {
    return workspace.openOn(this.side)
  }

  get there(): boolean {
    if (this.side === 'left') return true
    const next = workspace.nextRight
    if (next === null) return false
    const kind = workspace.active?.kind
    return next !== 'outline' || kind === undefined || kind === 'pages' || TAB_KINDS[kind].editor
  }

  get progress(): number | null {
    return this.at === null || !this.width ? null : this.at / this.width
  }

  arrived(event: TransitionEvent) {
    if (event.target === event.currentTarget && event.propertyName === 'transform') {
      this.settle = null
    }
  }

  open() {
    if (this.side === 'left') {
      workspace.showPanel('tree')
      return
    }

    const next = workspace.nextRight
    if (next) workspace.showPanel(next)
  }

  close() {
    workspace.closePanel(this.side)
  }

  measure(host: HTMLElement): number {
    const width = host.querySelector<HTMLElement>(this.layer)?.getBoundingClientRect().width ?? 0
    if (width) {
      this.travel = width
      this.travelAt = window.innerWidth
    }

    return width
  }

  remembered(): number {
    return this.travelAt === window.innerWidth ? this.travel : 0
  }

  private get layer(): string {
    return this.side === 'left' ? '.panels:not(.right)' : '.panels.right'
  }
}

export const drawer = new Drawer('left')
export const rightDrawer = new Drawer('right')
