import {
  added,
  columnHeight,
  GUTTER,
  grown,
  onPage,
  pageCount,
  pagesOf,
  pageShowing,
  settled,
} from '@orden/markdown/pages'
import { type Camera, clampScale, PAPER_CLOSEST, zoomed } from '../camera'
import { type Canvas, canvasRuns, type PageNode, readCanvas, takeParsed } from '../canvas/format'
import { strokeBox } from '../canvas/ink'
import type { KeptView } from '../canvas/place'
import { CanvasStore } from '../canvas/store.svelte'
import type { Highlight } from '../pdf/highlights'
import type { PdfHeading } from '../pdf/outline'
import { stillness } from '../motion'
import type { Tab } from '../workspace/documents.svelte'

const MARGIN = 28

export const PEEK = 88

const SETTLE = 420

export class PagesStore extends CanvasStore {
  constructor(tab: Tab) {
    super(tab)
    if (this.restored?.chose === true) this.tab.zoomChosen = true
  }

  pane = $state.raw<{ width: number; height: number }>({ width: 0, height: 0 })

  outline = $state.raw<readonly PdfHeading[]>([])

  marks = $state.raw<readonly Highlight[]>([])

  private get chose(): boolean {
    return this.tab.zoomChosen
  }

  private set chose(chosen: boolean) {
    this.tab.zoomChosen = chosen
  }

  measured(width: number, height: number) {
    const was = this.pane
    if (was.width === width && was.height === height) return

    this.pane = { width, height }
    if (this.chose || !width || !height || !this.widest) return
    if (this.framed) this.fitWidth()
  }

  private theirs() {
    this.chose = true
  }

  protected override get keptView(): KeptView {
    return this.chose ? { ...this.camera, chose: true } : this.camera
  }

  get pages() {
    return pagesOf(this.canvas)
  }

  get count(): number {
    return pageCount(this.canvas)
  }

  get tall(): number {
    return columnHeight(this.pages)
  }

  get widest(): number {
    return this.pages.reduce((most, page) => Math.max(most, page.width), 0)
  }

  get last(): PageNode | null {
    return this.pages[this.pages.length - 1] ?? null
  }

  get canAdd(): boolean {
    return !this.readOnly && this.pages.length > 0
  }

  get slot(): { x: number; y: number; width: number; height: number } | null {
    const last = this.last
    if (!last || !this.canAdd) return null

    return { x: last.x, y: this.tall + GUTTER, width: last.width, height: last.height }
  }

  get top(): number {
    return this.camera.y - this.pane.height / this.camera.scale / 2
  }

  get showing(): number {
    return pageShowing(this.pages, this.top, this.pane.height / this.camera.scale)
  }

  protected override get closest(): number {
    return PAPER_CLOSEST
  }

  held(next: Camera): Camera {
    const scale = clampScale(next.scale, PAPER_CLOSEST)
    const across = this.pane.width / scale
    const slack = MARGIN / scale
    const widest = this.widest

    const sideways = Math.max(0, (widest - across) / 2 + slack)
    const x = Math.min(Math.max(next.x, -sideways), sideways)

    const { first, last } = this.limits(scale)
    const y = last < first ? this.tall / 2 : Math.min(Math.max(next.y, first), last)

    return { x, y, scale }
  }

  private limits(scale: number): { first: number; last: number } {
    const down = this.pane.height / scale
    const slack = MARGIN / scale
    const below = this.canAdd ? GUTTER + PEEK / scale : slack

    return { first: -slack + down / 2, last: this.tall + below - down / 2 }
  }

  get bottom(): number {
    const { first, last } = this.limits(this.camera.scale)
    return last < first ? this.tall / 2 : last
  }

  get viewBottom(): number {
    return this.camera.y + this.pane.height / this.camera.scale / 2
  }

  turnToPaper(paper: number) {
    const at = this.pages.findIndex((one) => one.page === paper)
    this.turnTo(at >= 0 ? at + 1 : paper)
  }

  turnTo(number: number) {
    const page = this.pages[Math.min(Math.max(1, Math.round(number)), this.pages.length) - 1]
    if (!page) return

    this.halt()

    const down = this.pane.height / this.camera.scale
    this.camera = this.held({
      ...this.camera,
      y: page.y + down / 2 - MARGIN / this.camera.scale,
    })
  }

  fitWidth(keepTop = true) {
    const scale = this.fitted
    if (!scale || !this.pane.height) return

    this.halt()
    const down = this.pane.height / scale
    const y = keepTop ? this.top + down / 2 : down / 2 - MARGIN / scale
    this.camera = this.held({ x: 0, y, scale })
  }

  zoomBy(by: number) {
    const { width, height } = this.pane
    this.theirs()
    this.halt()
    this.camera = this.held(
      zoomed(this.camera, width, height, width / 2, height / 2, by, PAPER_CLOSEST),
    )
  }

  zoomAt(at: { x: number; y: number }, by: number) {
    const { width, height } = this.pane
    this.theirs()
    this.halt()
    this.camera = this.held(zoomed(this.camera, width, height, at.x, at.y, by, PAPER_CLOSEST))
  }

  get fitted(): number {
    const widest = this.widest
    if (!widest || !this.pane.width) return 0

    return clampScale((this.pane.width - 2 * MARGIN) / widest)
  }

  fitPage() {
    const page = this.pages[this.showing - 1] ?? this.last
    if (!page || !this.pane.width || !this.pane.height) return

    this.theirs()
    this.halt()
    const scale = clampScale(
      Math.min(
        (this.pane.width - 2 * MARGIN) / page.width,
        (this.pane.height - 2 * MARGIN) / page.height,
      ),
    )
    this.camera = this.held({ x: 0, y: page.y + page.height / 2, scale })
  }

  zoomTo(scale: number) {
    if (!this.pane.height) return

    this.theirs()
    this.halt()
    const wanted = clampScale(scale, PAPER_CLOSEST)
    this.camera = this.held({
      ...this.camera,
      y: this.top + this.pane.height / wanted / 2,
      scale: wanted,
    })
  }

  fitAgain() {
    this.chose = false
    this.fitWidth()
  }

  addPage(after: string | null = null): number {
    if (!this.canAdd) return 0

    const { canvas, id } = added(this.canvas, after)
    this.edit(canvas)

    const at = pagesOf(this.canvas).findIndex((one) => one.id === id)
    return at < 0 ? 0 : at + 1
  }

  glideTo(number: number) {
    const page = this.pages[Math.min(Math.max(1, Math.round(number)), this.pages.length) - 1]
    if (!page) return

    const down = this.pane.height / this.camera.scale
    const wanted = this.held({
      ...this.camera,
      y: page.y + down / 2 - MARGIN / this.camera.scale,
    })

    this.halt()
    const from = this.camera.y
    if (stillness() || typeof requestAnimationFrame !== 'function' || from === wanted.y) {
      this.camera = wanted
      return
    }

    const began = Date.now()
    const step = () => {
      const part = Math.min(1, (Date.now() - began) / SETTLE)
      const eased = 1 - (1 - part) ** 3
      this.camera = this.held({ ...this.camera, y: from + (wanted.y - from) * eased })
      this.gliding = part < 1 ? requestAnimationFrame(step) : 0
    }
    this.gliding = requestAnimationFrame(step)
  }

  halt() {
    if (!this.gliding) return

    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.gliding)
    this.gliding = 0
  }

  private gliding = 0

  override edit(next: Canvas, run?: string) {
    super.edit(next === this.canvas ? next : grown(settled(next), this.reach(next)), run)
  }

  private reach(canvas: Canvas): Map<string, number> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const lowest = new Map<string, number>()
    const long = pagesOf(canvas).filter((page) => page.paper === 'long')
    if (!long.length) return lowest

    for (const page of long) {
      const box = { x: page.x, y: page.y, width: page.width, height: page.height }
      let reach = page.y

      for (const node of canvas.nodes) {
        if (node.id === page.id) continue
        if (node.x + node.width <= box.x || node.x >= box.x + box.width) continue
        if (node.y + node.height <= box.y || node.y >= box.y + box.height) continue
        reach = Math.max(reach, node.y + node.height)
      }

      for (const stroke of canvas.ink) {
        if (!onPage(stroke, box)) continue
        const around = strokeBox(stroke)
        reach = Math.max(reach, around.y + around.height)
      }

      lowest.set(page.id, reach)
    }

    return lowest
  }

  protected override parse(text: string): Canvas {
    return settled(takeParsed(text) ?? readCanvas(text))
  }

  protected override runs(canvas: Canvas): string[][] {
    return canvasRuns(settled(canvas))
  }
}
