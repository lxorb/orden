/** Which road dictation's sound takes, as the reader chose it on this device (#1128).
 *
 *  Chosen rather than guessed, because each road sends a voice somewhere: to the AI
 *  provider the reader set up (or nowhere past this machine, for a server running on
 *  it), or to Orden's Worker and the Whisper on Cloudflare's Workers AI behind it. Until
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
import { forget, keep, storedText } from '../stored'

export type Engine = 'provider' | 'account'

const ENGINES: readonly Engine[] = ['provider', 'account']

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

  /** Whether a road can be taken here: a provider that transcribes, or an account. */
  usable(engine: Engine): boolean {
    return engine === 'provider' ? !!transcriberNow() : !!account.accountToken
  }

  /** Every road that can be taken here, the reader's own provider first. */
  offered(): Engine[] {
    return ENGINES.filter((one) => this.usable(one))
  }

  /** The road to take now: the one chosen, while it can still be taken. Null asks. */
  now(): Engine | null {
    return this.chosen && this.usable(this.chosen) ? this.chosen : null
  }

  choose(engine: Engine | null): void {
    this.chosen = engine
    if (engine) keep(KEY, engine)
    else forget(KEY)
  }
}

export const engines = new Engines()

/** Whether a field offers dictation at all: a road there is to take, chosen or not. */
export function canDictate(): boolean {
  return engines.offered().length > 0
}
