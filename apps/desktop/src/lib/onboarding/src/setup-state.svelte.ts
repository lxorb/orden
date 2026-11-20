import type { Importer } from '@orden/contracts'
import { bringing, mcpImporting } from './bring'
import { BROWSERS, type Preset, type PresetSetting } from './catalog'
import { type Answers, firstStep, markdownStyleFor, type Reach, shows, type Step, stepAfter } from './flow'
import { gate } from './gate.svelte'
import { heardBefore, keepProgress, readProgress } from './kept'
import { isMobile } from '../../platform/src/api'
import { stepped } from '../../usage/src/api'

export interface Issue {
  id: number
  text: string
}
const blank = (): Answers => ({ browser: null, notes: null, code: null })
export interface Brought {
  notes: boolean
  browser: boolean
  ai: boolean
}
class Setup {
  step = $state<Step>('account')
  answers = $state<Answers>(blank())
  forward = $state(true)
  issues = $state<Issue[]>([])
  here = $state<ReadonlySet<Importer>>(new Set())
  signedIn = $state(false)
  signIns = $state(false)
  phone = $state(isMobile)
  connected = $state(false)
  mcp = $state.raw<readonly unknown[]>([])
  mcpFound = $state(false)
  brought = $state<Brought>({ notes: false, browser: false, ai: false })
  get showing(): boolean {
    return gate.showing
  }
  set showing(on: boolean) {
    gate.showing = on
  }
  private trail: Step[] = []
  private told = 0
  resume() {
    if (this.trail.length) return
    const kept = readProgress()
    if (kept === null || kept === 'done') return
    this.answers = kept.answers
    this.signedIn = kept.signedIn
    this.open(kept.step, kept.trail)
  }
  begin(signedIn: boolean) {
    if (readProgress() === 'done' || this.showing) return
    this.signedIn = signedIn
    this.answers = blank()
    this.open(firstStep(this.answers, this.reach))
  }
  private open(step: Step, trail: Step[] = [step]) {
    this.step = step
    this.trail = trail
    this.showing = true
    this.keep()
    stepped(`setup-${step}`)
  }
  async look() {
    void this.lookForMcp()
    const { signInKind } = await import('./connect')
    this.signIns = (['claude', 'chatgpt', 'gemini'] as const).some((one) => signInKind(one))
    if (this.phone) {
      const { ai } = await import('../../ai-providers/src/api')
      this.connected = ai.accounts.length > 0
    } else {
      this.here = await bringing().here()
    }
  }
  private async lookForMcp() {
    if (this.phone) return
    const port = mcpImporting()
    try {
      this.mcp = await port.scan()
      this.mcpFound = port.importable(this.mcp)
    } catch {
      this.mcp = []
      this.mcpFound = false
    }
  }
  get reach(): Reach {
    return {
      signedIn: this.signedIn,
      importable: (id) => {
        const importer = BROWSERS.find((one) => one.id === id)?.importer ?? null
        return importer !== null && this.here.has(importer)
      },
      signIns: this.signIns,
      phone: this.phone,
      heard: heardBefore(),
      connected: this.connected,
      mcpFound: this.mcpFound,
    }
  }
  private get earlier(): Step[] {
    return this.trail.slice(0, -1).filter((step) => shows(step, this.answers, this.reach))
  }
  get canGoBack(): boolean {
    return this.earlier.length > 0
  }
  answer(change: Partial<Answers>) {
    this.answers = { ...this.answers, ...change }
    this.keep()
  }
  next(from: Step) {
    if (from !== this.step) return
    const step = stepAfter(this.step, this.answers, this.reach)
    this.forward = true
    this.trail.push(step)
    this.step = step
    this.keep()
    stepped(`setup-${step}`)
  }
  back() {
    const earlier = this.earlier
    if (!earlier.length) return
    this.trail = earlier
    this.forward = false
    this.step = this.trail.at(-1) ?? 'account'
    this.keep()
  }
  tell(text: string | null) {
    if (text) this.issues = [...this.issues, { id: ++this.told, text }]
  }
  got(what: keyof Brought) {
    this.brought = { ...this.brought, [what]: true }
  }
  finish() {
    this.showing = false
    keepProgress('done')
    stepped('setup-finished')
  }
  showAround() {
    this.finish()
    gate.guiding = true
    stepped('setup-guide')
  }
  private keep() {
    if (this.showing)
      keepProgress({ step: this.step, answers: this.answers, trail: this.trail, signedIn: this.signedIn })
  }
}
export const setup = new Setup()
export function presetOf(browser: string | null): Preset | null {
  return BROWSERS.find((one) => one.id === browser)?.preset ?? null
}
export async function applyPreset(preset: Preset): Promise<void> {
  const [{ fitTabs, iconTabs }, { tabCycle }, { swipeChoice }] = await Promise.all([
    import('../../tab-strip/src/api'),
    import('../../tab-cycle/src/api'),
    import('../../back-swipe/src/api'),
  ])
  const setters: Record<PresetSetting, (on: boolean) => void> = {
    fitTabs: (on) => fitTabs.set(on),
    iconTabs: (on) => iconTabs.set(on),
    byUse: (on) => tabCycle.setByUse(on),
    swipe: (on) => swipeChoice.set(on),
  }
  for (const [setting, on] of Object.entries(preset) as [PresetSetting, boolean][]) {
    setters[setting](on)
  }
}
export async function currentSettings(): Promise<Record<PresetSetting, boolean>> {
  const [{ fitTabs, iconTabs }, { tabCycle }, { swipeChoice }] = await Promise.all([
    import('../../tab-strip/src/api'),
    import('../../tab-cycle/src/api'),
    import('../../back-swipe/src/api'),
  ])
  return {
    fitTabs: fitTabs.on,
    iconTabs: iconTabs.on,
    byUse: tabCycle.byUse,
    swipe: swipeChoice.on,
  }
}
export async function settleMarkdown(app: string | null): Promise<void> {
  const style = markdownStyleFor(app)
  if (!style) return
  const { modes } = await import('../../modes/src/api')
  if ((style === 'clean') !== modes.quietMarks) modes.toggleQuietMarks()
}
