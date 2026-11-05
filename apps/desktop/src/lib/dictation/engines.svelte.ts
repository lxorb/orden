/** Which road dictation's sound takes, as the reader chose it on this device (#1128).
 *
 *  Chosen rather than guessed, because each road sends a voice somewhere: to the AI
 *  provider the reader set up (or nowhere past this machine, for a server running on
 *  it), to Orden's Worker and the Whisper on Cloudflare's Workers AI behind it, or to
 *  the device's own recogniser, which is its maker's (device.ts). Or nowhere: a model
 *  on this computer (local.svelte.ts, #1151), and "Auto", which hears there once the
 *  model is here and keeps up, and until then takes the first network road. Until
 *  one is chosen nothing is recorded: the first press asks (EngineChooser.svelte), and
 *  Settings > AI changes it.
 *
 *  Per device, as a word in this window's storage: a whisper server on a laptop is not
 *  there on the phone, and where a voice may go is a question each device answers.
 *
 *  A leaf, light enough for every field that draws the button: the providers' store is
 *  asked through ai/hears.ts, and nothing here reaches a network. */

import { account } from '../account.svelte'
import { transcriberNow } from '../ai/hears'
import type { Provider } from '../ai/providers'
import { method } from '../mobile/bridge'
import { forget, keep, storedText } from '../stored'
import { isNative, platform } from '../tauri'
import { local } from './local.svelte'
import { speechRecogniser } from './recogniser'

export type Engine = 'auto' | 'local' | 'provider' | 'account' | 'device'

/** A road a voice is actually heard along, which "Auto" resolves to. */
export type Taken = Exclude<Engine, 'auto'>

const ENGINES: readonly Engine[] = ['auto', 'local', 'provider', 'account', 'device']

/** The network roads "Auto" falls back on, in its order. */
const NETWORK: readonly Taken[] = ['provider', 'account']

const KEY = 'nib:dictation-engine'

function read(): Engine | null {
  const kept = storedText(KEY)
  return ENGINES.find((one) => one === kept) ?? null
}

/** Where a provider's audio goes, as the chooser says it: this machine, or the server's
 *  own name. Read off the address rather than off the kind, because an OpenAI-compatible
 *  provider is as often a whisper server on localhost as somebody else's computer. */
export function whereTo(provider: Provider): { local: boolean; host: string } {
  if (provider.kind !== 'compatible') return { local: false, host: 'OpenAI' }
  const host = hostOf(provider.baseUrl ?? '')
  const local = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(host)
  return { local, host }
}

/** Whether this device has a recogniser of its own that works: Android's, through the
 *  activity, and the web's where it is more than a name. WebView2 on Windows and CEF on
 *  Linux both carry the web's constructor and neither has a speech service behind it, so
 *  there it would only ever answer with an error. */
export function deviceHears(): boolean {
  if (method('dictates')?.()) return true
  if (isNative && (platform() === 'windows' || platform() === 'linux')) return false
  return !!speechRecogniser()
}

/** An address's host, or the address itself where it is not one. Parsed rather than
 *  kept, so a plain URL and nothing reactive. */
function hostOf(address: string): string {
  try {
    return new URL(address).hostname
  } catch {
    return address
  }
}

class Engines {
  /** What the reader chose, whether or not it can be used right now. */
  chosen = $state<Engine | null>(read())

  /** Whether a road can be taken here: a model this computer can run (downloaded or
   *  not), a provider that transcribes, an account, or a recogniser of the device's own.
   *  "Auto" is offered where this computer can hear on its own. */
  usable(engine: Engine): boolean {
    if (engine === 'auto' || engine === 'local') return local.fits
    if (engine === 'provider') return !!transcriberNow()
    if (engine === 'account') return !!account.accountToken
    return deviceHears()
  }

  /** Every road that can be taken here: Auto and this computer first, then the reader's
   *  own provider. */
  offered(): Engine[] {
    return ENGINES.filter((one) => this.usable(one))
  }

  /** The road to take now: the one chosen, while it can still be taken, with "Auto"
   *  resolved. Null asks. */
  now(): Taken | null {
    const chosen = this.chosen
    if (!chosen || !this.usable(chosen)) return null
    return chosen === 'auto' ? resolved() : chosen
  }

  /** Keeps the choice; one that hears on this computer starts its download. */
  choose(engine: Engine | null): void {
    this.chosen = engine
    if (engine) keep(KEY, engine)
    else forget(KEY)
    if (engine === 'auto' || engine === 'local') void local.fetch()
  }
}

/** What "Auto" hears with: this computer where its model is here and keeps up, else the
 *  first network road there is, else this computer still, which then waits for its
 *  download. */
function resolved(): Taken {
  if (local.ready && local.keepsUp) return 'local'
  return NETWORK.find((one) => engines.usable(one)) ?? 'local'
}

export const engines = new Engines()

/** Whether a field offers dictation at all: a road there is to take, chosen or not. */
export function canDictate(): boolean {
  return engines.offered().length > 0
}
