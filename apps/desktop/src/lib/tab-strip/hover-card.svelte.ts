import { mount } from 'svelte'
import { modes } from '../modes.svelte'
import { overlays, viewport } from '../ui-kit/src/api'
import { pages } from '../web-tab/pages.svelte'
import { workspace, type Tab } from '../workspace.svelte'
import { type Anchor, type From, fromOf, REENTRY, siteOf, spot, whereOf } from './card'
import { previewDelay } from './preview-delay.svelte'
import TabCard from './TabCard.svelte'
import { stillOf } from './thumb'

export interface Aim {
  tab: Tab
  box: Anchor
  focused?: boolean
}

export interface Shown {
  id: string
  title: string
  where: string
  from: From | null
  still: string | null
  x: number
  y: number
  sliding: boolean
}

const WIDE_REM = 16

const WORDS_TALL = 72
const STILL_TALL = 144
const FACTS_TALL = 48

class Hovering {
  card = $state<Shown | null>(null)
  facts = $state<string[][]>([])
  private unwatch: { id: string; stop: () => void } | null = null

  private aim: Aim | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private leftAt = Number.NEGATIVE_INFINITY
  private hushed: string | null = null
  private uncover: (() => void) | null = null
  private mounted = false

  constructor() {
    const hush = () => this.hush()
    window.addEventListener('pointerdown', hush, true)
    window.addEventListener('wheel', hush, { capture: true, passive: true })
    window.addEventListener('blur', hush)
    window.addEventListener(
      'keydown',
      (event) => {
        if (WALKING.has(event.key) && inStrip(document.activeElement)) return
        this.hush()
      },
      true,
    )
  }

  restOn(tab: Tab, node: Element, focused = false) {
    const body = (node.closest('.tab')?.querySelector('.fill') ?? node).getBoundingClientRect()
    this.enter({
      tab,
      box: { left: body.left, right: body.right, bottom: body.bottom },
      focused,
    })
  }

  enter(aim: Aim) {
    if (viewport.touch || aim.tab.id === this.hushed) return

    this.aim = aim
    clearTimeout(this.timer)
    void this.stillFor(aim)

    const now = this.card !== null || aim.focused === true || this.slippedBack()
    if (now) void this.show(aim)
    else this.timer = setTimeout(() => void this.show(aim), previewDelay.ms)
  }

  leave(tabId: string) {
    if (this.hushed === tabId) this.hushed = null
    if (this.aim?.tab.id !== tabId) return

    this.aim = null
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.aim) this.hide(true)
    })
  }

  hush() {
    if (!this.aim && !this.card) return

    this.hushed = this.aim?.tab.id ?? this.card?.id ?? null
    this.aim = null
    clearTimeout(this.timer)
    this.hide(false)
  }

  private slippedBack(): boolean {
    return performance.now() - this.leftAt < REENTRY
  }

  private may(): boolean {
    const own = this.uncover ? 1 : 0
    return (
      overlays.depth <= own && workspace.panes.dragging === null && workspace.panes.landing === null
    )
  }

  private async show(aim: Aim) {
    if (this.aim !== aim || !this.may()) return

    const { tab } = aim
    const web = tab.kind === 'web'
    const width = wide()
    const at = spot(aim.box, width, window.innerWidth)
    const still = await this.stillFor(aim)
    const facts = !__EVEN_PLUGIN__ && modes.coder ? FACTS_TALL : 0
    const tall = WORDS_TALL + (still ? STILL_TALL : 0) + facts
    const sliding = this.card !== null

    const over = await this.cover({
      left: at.x,
      top: at.y,
      right: at.x + width,
      bottom: at.y + tall,
    })
    if (this.aim !== aim) {
      if (!this.card) this.hide(false)
      return
    }
    if (!over) {
      this.hide(false)
      return
    }

    this.card = {
      id: tab.id,
      title: tab.shown,
      where: web
        ? siteOf(pages.addressOf(tab.id) ?? tab.address)
        : whereOf(tab.path, workspace.spaces),
      from: web ? fromOf(tab.path, tab.note.home, workspace.spaces, workspace.activeSpaceId) : null,
      still,
      x: at.x,
      y: at.y,
      sliding,
    }
    if (sliding && this.uncover) {
      this.uncover()
      this.uncover = overlays.peek(() => this.hush())
    }

    this.watchFacts(tab)

    if (!this.mounted) {
      this.mounted = true
      mount(TabCard, { target: document.body, props: { hovering: this } })
    }
  }

  private watchFacts(tab: Tab | null) {
    if (this.unwatch?.id === tab?.id) return
    this.unwatch?.stop()
    this.unwatch = null
    this.facts = []
    if (__EVEN_PLUGIN__ || !tab || !modes.coder) return
    if (tab.kind !== 'application' && tab.kind !== 'terminal') return
    let stop: (() => void) | null = null
    let gone = false
    this.unwatch = {
      id: tab.id,
      stop: () => {
        gone = true
        stop?.()
      },
    }
    void import('./facts').then(({ watchFacts }) => {
      if (gone) return
      stop = watchFacts(tab, (lines) => {
        if (this.card?.id === tab.id) this.facts = lines
      })
    })
  }

  private async stillFor(aim: Aim): Promise<string | null> {
    const { tab } = aim
    if (tab.kind !== 'web' || workspace.panes.at(tab.paneId)?.activeTabId === tab.id) return null
    const shot = pages.of(tab.id).shot
    return shot ? stillOf(tab.id, shot, wide()) : null
  }

  private hide(left: boolean) {
    if (left && this.card) this.leftAt = performance.now()
    this.card = null
    this.watchFacts(null)
    this.uncover?.()
    this.uncover = null
  }

  private async cover(box: {
    left: number
    top: number
    right: number
    bottom: number
  }): Promise<boolean> {
    const under = workspace.panes.all
      .map((pane) => workspace.tabs.find((one) => one.id === pane.activeTabId))
      .filter((one): one is Tab => one?.kind === 'web')
      .filter((one) => pages.of(one.id).live && pages.of(one.id).shown)
      .filter((one) => overlaps(one.paneId, box))
    if (under.length === 0) return true

    if (!pages.cuts) {
      await Promise.all(under.map((one) => pages.shoot(one.id)))
      if (under.some((one) => pages.of(one.id).shot === null)) return false
    }
    this.uncover ??= overlays.peek(() => this.hush())
    return true
  }
}

const WALKING = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

function inStrip(node: Element | null): boolean {
  return !!node?.closest('[data-strip]')
}

function wide(): number {
  return WIDE_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
}

function overlaps(
  paneId: string,
  box: { left: number; top: number; right: number; bottom: number },
): boolean {
  const pane = document.querySelector(`[data-pane="${CSS.escape(paneId)}"]`)
  if (!pane) return false

  const at = pane.getBoundingClientRect()
  return at.left < box.right && box.left < at.right && at.top < box.bottom && box.top < at.bottom
}

export const hovering = new Hovering()
