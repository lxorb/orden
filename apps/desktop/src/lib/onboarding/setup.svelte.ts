import type { BrowserId } from '../import/browsers'
import { BROWSERS, type Preset, type PresetSetting } from './catalog'
import { type Answers, firstStep, markdownStyleFor, type Reach, type Step, stepAfter } from './flow'
import { keepProgress, readProgress } from './kept'
import { stepped } from '../usage/tally'

export interface Issue {
  id: number
  text: string
}

const blank = (): Answers => ({ browser: null, notes: null, code: null })

class Setup {
  showing = $state(false)
  step = $state<Step>('account')
  answers = $state<Answers>(blank())
  forward = $state(true)
  issues = $state<Issue[]>([])
  here = $state<ReadonlySet<BrowserId | 'zen'>>(new Set())
  signedIn = $state(false)
  signIns = $state(false)

  private trail: Step[] = []
  private told = 0

  restore() {
    const kept = readProgress()
    if (kept === null || kept === 'done') return
    this.answers = kept.answers
    this.open(kept.step)
  }

  begin(signedIn: boolean) {
    if (readProgress() === 'done' || this.showing) return
    this.signedIn = signedIn
    this.answers = blank()
    this.open(firstStep(this.answers, this.reach))
  }

  private open(step: Step) {
    this.step = step
    this.trail = [step]
    this.showing = true
    this.keep()
    stepped(`setup-${step}`)
  }

  async look() {
    const [{ browsersHere }, { signInKind }] = await Promise.all([
      import('./bring'),
      import('./connect'),
    ])
    this.signIns = (['claude', 'chatgpt', 'gemini'] as const).some((one) => signInKind(one))
    this.here = await browsersHere()
  }

  get reach(): Reach {
    return {
      signedIn: this.signedIn,
      importable: (id) => {
        const importer = BROWSERS.find((one) => one.id === id)?.importer ?? null
        return importer !== null && this.here.has(importer)
      },
      signIns: this.signIns,
    }
  }

  get canGoBack(): boolean {
    return this.trail.length > 1
  }

  answer(change: Partial<Answers>) {
    this.answers = { ...this.answers, ...change }
    this.keep()
  }

  next() {
    const step = stepAfter(this.step, this.answers, this.reach)
    this.forward = true
    this.trail.push(step)
    this.step = step
    this.keep()
    stepped(`setup-${step}`)
  }

  back() {
    if (this.trail.length < 2) return
    this.trail.pop()
    this.forward = false
    this.step = this.trail.at(-1) ?? 'account'
    this.keep()
  }

  tell(text: string | null) {
    if (text) this.issues = [...this.issues, { id: ++this.told, text }]
  }

  finish() {
    this.showing = false
    keepProgress('done')
    stepped('setup-finished')
  }

  private keep() {
    if (this.showing) keepProgress({ step: this.step, answers: this.answers })
  }
}

export const setup = new Setup()

export function presetOf(browser: string | null): Preset | null {
  return BROWSERS.find((one) => one.id === browser)?.preset ?? null
}

export async function applyPreset(preset: Preset): Promise<void> {
  const [{ fitTabs, iconTabs }, { tabCycle }, { swipeChoice }] = await Promise.all([
    import('../tab-strip/icon-tabs.svelte'),
    import('../tab-cycle.svelte'),
    import('../back-swipe/choice.svelte'),
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
    import('../tab-strip/icon-tabs.svelte'),
    import('../tab-cycle.svelte'),
    import('../back-swipe/choice.svelte'),
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
  const { modes } = await import('../modes.svelte')
  if ((style === 'clean') !== modes.quietMarks) modes.toggleQuietMarks()
}
