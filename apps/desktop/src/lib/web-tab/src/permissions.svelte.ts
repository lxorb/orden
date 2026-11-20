import { heardElsewhere, withOrWithout, isRecord, Shared } from '../../platform/src/api'
import { originKey } from '@orden/scan/web-address'

const STORAGE_KEY = 'orden:web-grants'
export const ASKS = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
  'sensors',
  'downloads',
  'fonts',
  'midi',
  'windows',
  'screen',
  'pointer',
  'files',
  'media-keys',
] as const
export type Ask = (typeof ASKS)[number]
export const ASK_NAMES: Record<Ask, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Location',
  notifications: 'Notifications',
  clipboard: 'Clipboard',
  sensors: 'Motion sensors',
  downloads: 'Automatic downloads',
  fonts: 'Fonts',
  midi: 'MIDI devices',
  windows: 'Window management',
  screen: 'Screen sharing',
  pointer: 'Pointer lock',
  files: 'Files and folders',
  'media-keys': 'Protected content',
}
type Answer = 'allow' | 'block'
function isAsk(value: string): value is Ask {
  return ASKS.some((one) => one === value)
}
function isAnswer(value: unknown): value is Answer {
  return value === 'allow' || value === 'block'
}
export function siteOf(url: string | null): string {
  return url === null ? '' : originKey(url)
}
type Table = Record<string, Partial<Record<Ask, Answer>>>
function readTable(read: unknown): Table {
  if (!isRecord(read)) return {}
  const out: Table = {}
  for (const [site, value] of Object.entries(read)) {
    if (!isRecord(value)) continue
    const said: Partial<Record<Ask, Answer>> = {}
    for (const [kind, answer] of Object.entries(value)) {
      if (isAsk(kind) && isAnswer(answer)) said[kind] = answer
    }
    if (Object.keys(said).length) out[site] = said
  }
  return out
}
class Grants {
  private readonly kept = new Shared(STORAGE_KEY, readTable)
  private changed = $state(0)
  private privately = $state<Table>({})
  constructor() {
    heardElsewhere([STORAGE_KEY], () => this.changed++)
  }
  private by(): Table {
    this.heardChange()
    return this.kept.get()
  }
  private heardChange(): number {
    return this.changed
  }
  of(site: string, privately = false): Partial<Record<Ask, Answer>> {
    const by = this.by()
    if (!privately) return by[site] ?? {}
    const blocked = Object.entries(by[site] ?? {}).filter(([, said]) => said === 'block')
    return { ...Object.fromEntries(blocked), ...this.privately[site] }
  }
  said(site: string, ask: Ask, privately = false): Answer | null {
    return this.of(site, privately)[ask] ?? null
  }
  remember(site: string, ask: Ask, answer: Answer | null, privately = false) {
    if (!site) return
    const before = (privately ? this.privately : this.by())[site] ?? {}
    const kept = Object.fromEntries(Object.entries(before).filter(([one]) => one !== ask)) as Partial<
      Record<Ask, Answer>
    >
    if (answer !== null) kept[ask] = answer
    if (privately) {
      this.privately = withOrWithout(this.privately, site, Object.keys(kept).length ? kept : null)
      return
    }
    this.write(withOrWithout(this.by(), site, Object.keys(kept).length ? kept : null))
  }
  private write(all: Table) {
    this.kept.set(all, JSON.stringify(all))
    this.changed++
  }
  leftPrivate() {
    this.privately = {}
  }
  forget(site: string, privately = false) {
    if (privately) {
      this.privately = withOrWithout<Partial<Record<Ask, Answer>>>(this.privately, site, null)
      return
    }
    const all = this.by()
    if (!all[site]) return
    this.write(withOrWithout<Partial<Record<Ask, Answer>>>(all, site, null))
  }
}
export const grants = new Grants()
