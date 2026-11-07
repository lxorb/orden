import {
  type Band,
  type BandName,
  bandsOf,
  BRIGHT,
  PANEL_HEIGHT,
  PANEL_WIDTH,
} from '@orden/glasses'
import type { Container, Glasses, Made } from './sdk'
import type { View } from './shell'

const CAPTURE: Container = { id: 1, name: 'nib' }
const EMPTY = ' '

const IDS: Record<BandName, Container> = {
  head: { id: 2, name: 'nibHead' },
  rule: { id: 3, name: 'nibRule' },
  nums: { id: 4, name: 'nibNums' },
  body: { id: 5, name: 'nibBody' },
  mic: { id: 7, name: 'nibMic' },
}

const ORDER: readonly BandName[] = ['head', 'rule', 'nums', 'body', 'mic']

const MOST = 2000

function container(name: BandName, band: Band, zOrder: number): unknown {
  return {
    containerID: IDS[name].id,
    containerName: IDS[name].name,
    xPosition: band.x,
    yPosition: band.y,
    width: band.width,
    height: band.height,
    isEventCapture: 0,
    zOrderIndex: zOrder,
    content: EMPTY,
    textColor: BRIGHT[name],
  }
}

function skeleton(lineNumbers: boolean): unknown {
  const bands = bandsOf(lineNumbers)
  const shown = ORDER.filter((name) => name !== 'nums' || lineNumbers)

  return {
    containerTotalNum: 1 + shown.length,
    textObject: [
      {
        containerID: CAPTURE.id,
        containerName: CAPTURE.name,
        xPosition: 0,
        yPosition: 0,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        isEventCapture: 1,
        zOrderIndex: 0,
        content: EMPTY,
      },
      ...shown.map((name, at) => container(name, bands[name], at + 1)),
    ],
  }
}

export class Panel {
  private held = new Map<BandName, string>()
  private era = 0
  private started = false
  private made: Made = 'unknown'
  private numbered: boolean

  constructor(
    private readonly glasses: Glasses,
    lineNumbers: boolean,
  ) {
    this.numbered = lineNumbers
  }

  async open(): Promise<Made> {
    if (this.started) return this.made

    this.started = true
    this.made = await this.glasses.start(skeleton(this.numbered))
    return this.made
  }

  async renumber(lineNumbers: boolean): Promise<boolean> {
    if (lineNumbers === this.numbered) return true

    this.numbered = lineNumbers
    const rebuilt = await this.glasses.rebuild(skeleton(lineNumbers)).catch(() => false)
    if (rebuilt) this.forget()
    else if (this.numbered === lineNumbers) this.numbered = !lineNumbers

    return rebuilt
  }

  async show(view: View): Promise<number> {
    const era = this.era
    let sent = 0

    for (const name of ORDER) {
      if (name === 'nums' && !this.numbered) continue

      const words = (view[name] || EMPTY).slice(0, MOST)
      if (this.held.get(name) === words) continue

      const ok = await this.glasses.words(IDS[name], words)
      if (ok && era === this.era) this.held.set(name, words)
      sent++
    }

    return sent
  }

  forget(): void {
    this.era += 1
    this.held = new Map()
  }
}
