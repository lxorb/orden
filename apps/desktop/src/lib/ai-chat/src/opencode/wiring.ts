import type { Preset } from '../../../opencode-client/src/api'
import type { Wiring } from './engine'

export async function openCodeWiring(): Promise<Wiring> {
  const client = await import('../../../opencode-client/src/api')
  const { opencode } = client
  let started: Preset | null = null
  return {
    session: (title) => opencode.session(title),
    messages: (id) => opencode.messages(id),
    permissions: () => opencode.permissions(),
    prompt: (id, text, how) => opencode.prompt(id, text, how),
    abort: (id) => opencode.abort(id),
    summarize: (id, providerID, modelID) => opencode.summarize(id, providerID, modelID),
    providers: () => opencode.providers(),
    async ready(preset) {
      const { state } = await client.openCodeStatus()
      if (state === 'ready' && started === preset) return
      await (state === 'off' ? client.startOpenCode({}, preset) : client.restartOpenCode({}, preset))
      started = preset
    },
    follow: (on) => client.followEvents(on),
  }
}
