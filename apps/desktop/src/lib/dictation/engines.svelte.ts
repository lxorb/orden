import { account } from '../accounts/src/api'
import { transcriberNow } from '../ai/hears'
import type { Provider } from '../ai/providers'
import { method } from '../mobile/bridge'
import { forget, keep, storedText } from '../stored'
import { isNative, platform } from '../tauri'
import { local } from './local.svelte'
import { speechRecogniser } from './recogniser'

export type Engine = 'auto' | 'local' | 'provider' | 'account' | 'device'

export type Taken = Exclude<Engine, 'auto'>

const ENGINES: readonly Engine[] = ['auto', 'local', 'provider', 'account', 'device']

const NETWORK: readonly Taken[] = ['provider', 'account']

const KEY = 'orden:dictation-engine'

function read(): Engine | null {
  const kept = storedText(KEY)
  return ENGINES.find((one) => one === kept) ?? null
}

export function whereTo(provider: Provider): { local: boolean; host: string } {
  if (provider.kind !== 'compatible') return { local: false, host: 'OpenAI' }
  const host = hostOf(provider.baseUrl ?? '')
  const local = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(host)
  return { local, host }
}

export function deviceHears(): boolean {
  if (method('dictates')?.()) return true
  if (isNative && (platform() === 'windows' || platform() === 'linux')) return false
  return !!speechRecogniser()
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname
  } catch {
    return address
  }
}

class Engines {
  chosen = $state<Engine | null>(read())

  usable(engine: Engine): boolean {
    if (engine === 'auto' || engine === 'local') return local.fits
    if (engine === 'provider') return !!transcriberNow()
    if (engine === 'account') return !!account.accountToken
    return deviceHears()
  }

  offered(): Engine[] {
    return ENGINES.filter((one) => this.usable(one))
  }

  now(): Taken | null {
    const chosen = this.chosen
    if (!chosen || !this.usable(chosen)) return null
    return chosen === 'auto' ? resolved() : chosen
  }

  choose(engine: Engine | null): void {
    this.chosen = engine
    if (engine) keep(KEY, engine)
    else forget(KEY)
    if (engine === 'auto' || engine === 'local') void local.fetch()
  }
}

function resolved(): Taken {
  if (local.ready && local.keepsUp) return 'local'
  return NETWORK.find((one) => engines.usable(one)) ?? 'local'
}

export const engines = new Engines()

export function canDictate(): boolean {
  return engines.offered().length > 0
}
